import { expect, type Page } from '@playwright/test';
import type { FileEntry } from '../../src/lib/files.ts';
import { allow, api, loadMulti, openEditor, projectPath, resetProject, signInAs, test } from './helpers.ts';

// US3 SyncTeX navigation (contracts/ui.md "Sync strip", research R9–R10) on tests/fixtures/projects/multi:
// page 1 is main.tex + \input chapters/intro.tex, page 2 the \include-d chapters/two.tex, page 3 the image,
// "As shown by \cite{knuth84}." (main.tex line 13) and the bibliography (from main.bbl, not a project file).

test.beforeEach(async ({ page }) => {
	await page.goto(projectPath());
	await page.evaluate(() => localStorage.clear());
	await openEditor(page);
	await loadMulti(page);
	await page.reload();
	await openEditor(page);
});

test.afterEach(async ({ page }) => {
	await resetProject(page);
});

const toPdf = (page: Page) => page.getByRole('button', { name: 'Go to PDF location' });
const toCode = (page: Page) => page.getByRole('button', { name: 'Go to code location' });
const viewer = (page: Page) => page.getByTestId('pdf-viewer');
const pdfPage = (page: Page, n: number) => viewer(page).locator(`.page[data-page-number="${n}"]`);
const tab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Open files' }).getByRole('tab', { name, exact: true });
const row = (page: Page, name: string) => page.getByRole('tree', { name: 'File tree' }).getByRole('treeitem', { name, exact: true }).locator(':scope > .row');
const files = async (page: Page): Promise<FileEntry[]> => (await (await page.request.get(`${api()}/files`)).json()).files;
const cursorLine = (page: Page) =>
	page.evaluate(() => {
		const { state } = window.__overtree!.view;
		return state.doc.lineAt(state.selection.main.head).number;
	});

async function compile(page: Page) {
	await Promise.all([
		page.waitForResponse((r) => r.url().endsWith('/compile') && r.request().method() === 'POST', { timeout: 15_000 }),
		page.getByRole('button', { name: 'Recompile' }).click()
	]);
	await expect(pdfPage(page, 3)).toBeAttached({ timeout: 10_000 });
	await expect(pdfPage(page, 1)).toContainText('INTRO-MARKER', { timeout: 10_000 });
}

/** Open a file from the tree and wait until the editor shows it, synced. */
async function open(page: Page, name: string) {
	const id = (await files(page)).find((f) => f.name === name)!.id;
	if (!(await row(page, name).isVisible())) await row(page, 'chapters').click(); // the fixture's files are in chapters/
	await row(page, name).click();
	await page.waitForFunction((id) => window.__overtree?.fileId === id && window.__overtree.provider.isSynced, id);
}

async function setCursor(page: Page, line: number) {
	await page.evaluate((line) => {
		const { view } = window.__overtree!;
		view.dispatch({ selection: { anchor: view.state.doc.line(line).from } });
		view.focus();
	}, line);
}

/** Double-click a text run of the PDF's text layer. */
async function dblclickText(page: Page, n: number, text: string) {
	const span = pdfPage(page, n).locator('.textLayer span', { hasText: text }).first();
	await span.scrollIntoViewIfNeeded();
	const sync = page.waitForResponse((r) => r.url().includes('/compile/sync/pdf'));
	await span.dblclick();
	return sync;
}

test('the arrows are disabled until the first compile', async ({ page }) => {
	await expect(toPdf(page)).toBeDisabled();
	await expect(toCode(page)).toBeDisabled();
	await expect(toPdf(page)).toHaveAttribute('title', 'Compile first');
	await compile(page);
	await expect(toPdf(page)).toBeEnabled();
	await expect(toCode(page)).toBeEnabled();
});

test('→ from chapters/intro.tex highlights the line on page 1; the shortcut does the same (US3-1)', async ({ page }) => {
	await compile(page);
	await open(page, 'intro.tex');
	await setCursor(page, 3);
	await toPdf(page).click();
	const mark = pdfPage(page, 1).locator('.sync-highlight');
	await expect(mark).toHaveCount(1);
	await expect(mark).toBeInViewport();
	// gone after about a second
	await expect(mark).toHaveCount(0, { timeout: 3000 });

	const doc = () => page.evaluate(() => window.__overtree!.view.state.doc.toString());
	const before = await doc();
	await setCursor(page, 3);
	await page.keyboard.press('ControlOrMeta+Alt+KeyJ');
	await expect(mark).toHaveCount(1);
	expect(await doc()).toBe(before); // the shortcut types nothing (⌥J is ∆ on a Mac)
});

test('→ from the \\include-d chapter goes to page 2', async ({ page }) => {
	await compile(page);
	await open(page, 'two.tex');
	await setCursor(page, 3);
	await toPdf(page).click();
	await expect(pdfPage(page, 2).locator('.sync-highlight')).toBeInViewport();
});

test('double-clicking a main.tex paragraph opens main.tex at the line (US3-2)', async ({ page }) => {
	await compile(page);
	await open(page, 'intro.tex');
	expect((await dblclickText(page, 3, 'As shown by')).status()).toBe(200);
	await expect(tab(page, 'main.tex')).toHaveAttribute('aria-selected', 'true');
	await expect.poll(() => cursorLine(page)).toBe(13);
	await expect(page.locator('.cm-content')).toBeFocused();
});

test('← opens the source at the top of the visible page', async ({ page }) => {
	await compile(page);
	await page.getByRole('textbox', { name: 'Page number' }).fill('2');
	await page.getByRole('textbox', { name: 'Page number' }).press('Enter');
	await expect(pdfPage(page, 2)).toBeInViewport();
	await toCode(page).click();
	await expect(tab(page, 'two.tex')).toHaveAttribute('aria-selected', 'true');
});

test('after edits without a recompile, → still lands on a page without an error (US3-3)', async ({ page }) => {
	await compile(page);
	await open(page, 'intro.tex');
	await page.evaluate(() => {
		const { view } = window.__overtree!;
		view.dispatch({ changes: { from: 0, insert: 'New line.\n\nAnother.\n\nAnd more.\n\n' } });
	});
	await page.waitForFunction(() => !window.__overtree!.provider.hasUnsyncedChanges);
	await setCursor(page, 11); // past the end of the compiled file: its last mapped line
	await toPdf(page).click();
	await expect(pdfPage(page, 1).locator('.sync-highlight')).toHaveCount(1);
	await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a double-click on text from a TeX Live / generated file changes nothing (US3-6)', async ({ page }) => {
	await compile(page);
	await open(page, 'intro.tex');
	await setCursor(page, 3);
	// the bibliography entry comes from main.bbl
	expect((await dblclickText(page, 3, 'TeXbook')).status()).toBe(404);
	await expect(tab(page, 'intro.tex')).toHaveAttribute('aria-selected', 'true');
	expect(await cursorLine(page)).toBe(3);
	await expect(page.getByRole('alert')).toHaveCount(0);
	await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a reader navigates both ways (US3-5)', async ({ browser, page, pid }) => {
	await compile(page);
	const email = `reader-${Math.random().toString(36).slice(2, 8)}@test.local`;
	await allow(page.request, email);
	expect((await page.request.post(`${api(pid)}/members`, { data: { email, role: 'reader' } })).status()).toBe(201);

	const ctx = await browser.newContext();
	await signInAs(ctx, email);
	const reader = await ctx.newPage();
	await openEditor(reader, pid);
	await expect(pdfPage(reader, 3)).toBeAttached({ timeout: 10_000 });
	await setCursor(reader, 13);
	await toPdf(reader).click();
	await expect(pdfPage(reader, 3).locator('.sync-highlight')).toBeInViewport();

	await open(reader, 'intro.tex');
	expect((await dblclickText(reader, 3, 'As shown by')).status()).toBe(200);
	await expect(tab(reader, 'main.tex')).toHaveAttribute('aria-selected', 'true');
	await expect.poll(() => cursorLine(reader)).toBe(13);
	await ctx.close();
});
