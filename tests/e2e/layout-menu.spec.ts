import { expect, type Locator, type Page } from '@playwright/test';
import type { FileEntry } from '../../src/lib/files.ts';
import { allow, api, loadMulti, openEditor, projectPath, resetProject, signInAs, test } from './helpers.ts';

// US7 Layout menu and the separate PDF window (contracts/ui.md "Top bar", "PDF window route"; research R12).
// The window tests use tests/fixtures/projects/multi like synctex.spec.ts: page 1 holds chapters/intro.tex
// (INTRO-MARKER), page 3 "As shown by \cite{knuth84}." from main.tex line 13.

const pane = (page: Page, id: string) => page.locator(`[data-pane-id="${id}"]`);
const width = async (l: Locator) => (await l.boundingBox())?.width ?? 0;
const mode = (page: Page) => page.evaluate(() => localStorage.getItem('overtree:layout-mode'));
const pdfPage = (page: Page, n: number) => page.getByTestId('pdf-viewer').locator(`.page[data-page-number="${n}"]`);
const tab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Open files' }).getByRole('tab', { name, exact: true });
const cursorLine = (page: Page) =>
	page.evaluate(() => {
		const { state } = window.__overtree!.view;
		return state.doc.lineAt(state.selection.main.head).number;
	});

async function choose(page: Page, label: string) {
	await page.getByRole('button', { name: 'Layout' }).click();
	await page.getByRole('menuitemradio', { name: label }).click();
}

async function expectChecked(page: Page, label: string) {
	await page.getByRole('button', { name: 'Layout' }).click();
	await expect(page.getByRole('menuitemradio', { name: label })).toHaveAttribute('aria-checked', 'true');
	await expect(page.getByRole('menuitemradio', { checked: true })).toHaveCount(1);
	await page.keyboard.press('Escape');
}

test.beforeEach(async ({ page }) => {
	await page.goto(projectPath());
	await page.evaluate(() => localStorage.clear());
	await openEditor(page);
});

test.afterEach(async ({ page }) => {
	await page.evaluate(() => localStorage.clear());
});

test('editor only, PDF only and side-by-side; the mode survives a reload (US7-1, FR-026)', async ({ page }) => {
	const vw = page.viewportSize()!.width;
	await expectChecked(page, 'Side-by-side');
	const p0 = await width(pane(page, 'pdf'));
	expect(p0).toBeGreaterThan(vw * 0.3);

	await choose(page, 'Editor only');
	await expect.poll(() => width(pane(page, 'pdf'))).toBe(0);
	await expect(page.getByRole('button', { name: 'Go to PDF location' })).toHaveCount(0);
	expect(await mode(page)).toBe('editor');
	await expectChecked(page, 'Editor only');
	// paneforge stores the collapse 100 ms after it
	await expect.poll(() => page.evaluate(() => localStorage.getItem('paneforge:overtree:layout:main'))).toContain(',0]}');
	await page.reload();
	await openEditor(page);
	await expect.poll(() => width(pane(page, 'pdf'))).toBe(0);
	await expectChecked(page, 'Editor only');

	await choose(page, 'Side-by-side');
	await expect.poll(() => width(pane(page, 'pdf'))).toBeGreaterThan(vw * 0.3);
	await expect(page.locator('.cm-content')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Go to PDF location' })).toBeVisible();

	await choose(page, 'PDF only');
	await expect(pane(page, 'editor')).toBeHidden();
	await expect(pane(page, 'sidebar')).toBeHidden();
	await expect.poll(() => width(pane(page, 'pdf'))).toBeGreaterThan(vw - 4);
	expect(await mode(page)).toBe('pdf');
	await page.reload();
	await expect(page.getByRole('region', { name: 'PDF preview' })).toBeVisible();
	await expect(pane(page, 'editor')).toBeHidden();
	await expect.poll(() => width(pane(page, 'pdf'))).toBeGreaterThan(vw - 4);
	await expectChecked(page, 'PDF only');

	await choose(page, 'Side-by-side');
	await expect(page.locator('.cm-content')).toBeVisible();
	await expect(pane(page, 'sidebar')).toBeVisible();
	await expect.poll(() => width(pane(page, 'pdf'))).toBeGreaterThan(vw * 0.3);
	expect(await mode(page)).toBe('split');
});

test('expanding the PDF with its tab in editor only goes back to side-by-side', async ({ page }) => {
	await choose(page, 'Editor only');
	await expect.poll(() => width(pane(page, 'pdf'))).toBe(0);
	await page.getByRole('button', { name: 'Expand PDF' }).click();
	await expect.poll(() => width(pane(page, 'pdf'))).toBeGreaterThan(0);
	await expectChecked(page, 'Side-by-side');
});

test.describe('separate window', () => {
	test.afterEach(async ({ page }) => {
		await resetProject(page);
	});

	test('follows recompiles and navigates both ways; closing it goes back to side-by-side (US7-2, US7-3, FR-027)', async ({
		page,
		context
	}) => {
		await loadMulti(page);
		await page.reload();
		await openEditor(page);

		const [popup] = await Promise.all([context.waitForEvent('page'), choose(page, 'PDF in separate window')]);
		await popup.waitForLoadState();
		await expect(popup).toHaveURL(new RegExp(`/project/[^/]+/pdf$`));
		await expect(popup).toHaveTitle('Untitled project — PDF · Overtree');
		await expect(popup.getByText('Click Recompile')).toBeVisible();
		// main: the editor across the whole width, no PDF pane, only "→" on the rail
		await expect.poll(() => width(pane(page, 'pdf'))).toBe(0);
		await expect(page.getByRole('region', { name: 'PDF preview' })).toHaveCount(0);
		await expect(page.getByRole('separator', { name: 'Resize PDF' })).toBeHidden();
		await expect(page.getByRole('button', { name: 'Go to code location' })).toHaveCount(0);
		expect(await mode(page)).toBe('window');

		// a recompile in the main window shows up in the PDF window
		await page.locator('.cm-content').click();
		await Promise.all([
			page.waitForResponse((r) => r.url().endsWith('/compile') && r.request().method() === 'POST', { timeout: 15_000 }),
			page.keyboard.press('ControlOrMeta+Enter')
		]);
		await expect(pdfPage(popup, 1)).toContainText('INTRO-MARKER', {
			timeout: 10_000
		});
		await expect(pdfPage(popup, 3)).toBeAttached();

		// → in the main window highlights the line in the PDF window
		const files: FileEntry[] = (await (await page.request.get(`${api()}/files`)).json()).files;
		const intro = files.find((f) => f.name === 'intro.tex')!.id;
		const row = (name: string) =>
			page.getByRole('tree', { name: 'File tree' }).getByRole('treeitem', { name, exact: true }).locator(':scope > .row');
		await row('chapters').click();
		await row('intro.tex').click();
		await page.waitForFunction((id) => window.__overtree?.fileId === id && window.__overtree.provider.isSynced, intro);
		await page.evaluate(() => {
			const { view } = window.__overtree!;
			view.dispatch({ selection: { anchor: view.state.doc.line(3).from } });
			view.focus();
		});
		await page.getByRole('button', { name: 'Go to PDF location' }).click();
		await expect(pdfPage(popup, 1).locator('.sync-highlight')).toHaveCount(1);

		// a double-click in the PDF window opens the source in the main window
		await pdfPage(popup, 3).scrollIntoViewIfNeeded(); // pdf.js renders text layers near the view only
		const span = pdfPage(popup, 3).locator('.textLayer span', { hasText: 'As shown by' }).first();
		await span.scrollIntoViewIfNeeded();
		const sync = popup.waitForResponse((r) => r.url().includes('/compile/sync/pdf'));
		await span.dblclick();
		expect((await sync).status()).toBe(200);
		await expect(tab(page, 'main.tex')).toHaveAttribute('aria-selected', 'true');
		await expect.poll(() => cursorLine(page)).toBe(13);

		// "←" in the PDF window's toolbar does the same for the visible page
		await expect(popup.getByRole('button', { name: 'Go to code location' })).toBeEnabled();

		await popup.close();
		await expect.poll(() => mode(page), { timeout: 5000 }).toBe('split');
		await expect.poll(() => width(pane(page, 'pdf'))).toBeGreaterThan(0);
		await expect(page.getByRole('region', { name: 'PDF preview' })).toBeVisible();
		await expectChecked(page, 'Side-by-side');
	});

	test('a reload keeps the open window; without one it falls back to side-by-side', async ({ page, context }) => {
		const [popup] = await Promise.all([context.waitForEvent('page'), choose(page, 'PDF in separate window')]);
		await expect(popup.getByRole('region', { name: 'PDF preview' })).toBeVisible();
		await page.reload();
		await openEditor(page);
		// the window answers the reloaded page's hello
		await page.waitForTimeout(1500);
		expect(await mode(page)).toBe('window');
		await expect(page.getByRole('region', { name: 'PDF preview' })).toHaveCount(0);

		// choosing another layout closes the window
		const closed = popup.waitForEvent('close');
		await choose(page, 'Side-by-side');
		await closed;

		await page.evaluate(() => localStorage.setItem('overtree:layout-mode', 'window'));
		await page.reload();
		await openEditor(page);
		await expect.poll(() => mode(page), { timeout: 5000 }).toBe('split');
		await expect(page.getByRole('region', { name: 'PDF preview' })).toBeVisible();
	});

	test('a blocked popup shows a notice and keeps the layout (US7-4)', async ({ page }) => {
		await page.addInitScript(() => (window.open = () => null));
		await page.reload();
		await openEditor(page);
		await choose(page, 'PDF in separate window');
		await expect(page.getByRole('alert')).toHaveText(/Allow pop-ups to open the PDF in a new window/);
		expect(await mode(page)).toBeNull();
		await expect(page.getByRole('region', { name: 'PDF preview' })).toBeVisible();
		await expect.poll(() => width(pane(page, 'pdf'))).toBeGreaterThan(0);
		await expectChecked(page, 'Side-by-side');
	});

	test('the PDF window route refuses non-members', async ({ browser, page, pid }) => {
		const email = `stranger-${Math.random().toString(36).slice(2, 8)}@test.local`;
		await allow(page.request, email);
		const ctx = await browser.newContext();
		await signInAs(ctx, email);
		const other = await ctx.newPage();
		await other.goto(`/project/${pid}/pdf`);
		await expect(
			other.getByRole('heading', {
				name: 'You don’t have access to this project'
			})
		).toBeVisible();
		await expect(other.getByRole('region', { name: 'PDF preview' })).toHaveCount(0);
		await ctx.close();
	});
});
