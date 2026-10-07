import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import type { FileEntry } from '../../src/lib/files.ts';
import { api, loadMulti, openEditor, projectPath, resetProject, test, upload } from './helpers.ts';

// US3: compile a multi-file project (contracts/files-api.md, research R8)

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

const tree = (page: Page) => page.getByRole('tree', { name: 'File tree' });
const row = (page: Page, name: string) => tree(page).getByRole('treeitem', { name, exact: true }).locator(':scope > .row');
const tab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Open files' }).getByRole('tab', { name, exact: true });
const recompile = (page: Page) => page.getByRole('button', { name: 'Recompile' });
const viewer = (page: Page) => page.getByTestId('pdf-viewer');
const files = async (page: Page): Promise<FileEntry[]> => (await (await page.request.get(`${api()}/files`)).json()).files;

async function compile(page: Page) {
	const [res] = await Promise.all([
		page.waitForResponse((r) => r.url().endsWith('/compile') && r.request().method() === 'POST', { timeout: 15_000 }),
		recompile(page).click()
	]);
	await expect(recompile(page)).toBeEnabled({ timeout: 10_000 });
	return res.json();
}

async function openMenu(page: Page, name: string) {
	await row(page, name).click({ button: 'right' });
	const menu = page.getByRole('menu', { name: `Actions for ${name.replace(', main document', '')}` });
	await expect(menu).toBeVisible();
	return menu;
}

test('the PDF has the input chapter, the image and the bibliography (US3-1, US3-2, US3-3)', async ({ page }) => {
	expect((await compile(page)).status).toBe('success');
	await expect(viewer(page).locator('.page').first()).toContainText('INTRO-MARKER', { timeout: 10_000 });
	// \include starts a new page: the citation and bibliography come last
	const last = viewer(page).locator('.page').last();
	await last.scrollIntoViewIfNeeded();
	await expect(last).toContainText('The TeXbook', { timeout: 10_000 });
	const log = await (await page.request.get(`${api()}/compile/output.log`)).text();
	expect(log.match(/<figures\/dot\.png/g)).toHaveLength(1);
});

test('another .tex becomes main from the menu, survives a reload and is compiled; download takes its name (US3-4, US3-7)', async ({ page }) => {
	const doc = '\\documentclass{article}\n\\begin{document}\nOTHER-MARKER\n\\end{document}\n';
	await upload(page, 'other.tex', Buffer.from(doc), null);
	await page.reload();
	await openEditor(page);

	const bib = await openMenu(page, 'refs.bib');
	await expect(bib.getByRole('menuitem', { name: /Set as main document/ })).toHaveCount(0);
	await page.keyboard.press('Escape');

	const current = await openMenu(page, 'main.tex, main document');
	await expect(current.getByRole('menuitem', { name: 'Set as main document (current)' })).toHaveAttribute('aria-disabled', 'true');
	await page.keyboard.press('Escape');

	await (await openMenu(page, 'other.tex')).getByRole('menuitem', { name: 'Set as main document' }).click();
	await expect(row(page, 'other.tex, main document')).toBeVisible();
	await expect(row(page, 'main.tex')).toBeVisible();
	await page.reload();
	await expect(row(page, 'other.tex, main document')).toBeVisible();
	// the focused tab is still the old main.tex, a document of its own: the PDF shows it until the new main is opened
	await expect(viewer(page).locator('.page').first()).toContainText('INTRO-MARKER', { timeout: 15_000 });
	await row(page, 'other.tex, main document').click();

	expect((await compile(page)).status).toBe('success');
	await expect(viewer(page).locator('.page').first()).toContainText('OTHER-MARKER', { timeout: 10_000 });
	const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download PDF' }).click()]);
	expect(file.suggestedFilename()).toBe('other.pdf');
	expect(readFileSync(await file.path()).subarray(0, 4).toString()).toBe('%PDF');
});

test('without a main document the compile says how to set one (US3-5)', async ({ page }) => {
	const main = (await files(page)).find((f) => f.name === 'main.tex' && f.parentId === null)!;
	const res = await page.request.delete(`${api()}/files/${main.id}`, { headers: { origin: new URL(page.url()).origin } });
	expect(res.status()).toBe(204);
	await page.reload();
	expect((await compile(page)).status).toBe('failure');
	await expect(page.getByRole('alert')).toContainText('No main document. Right-click a .tex file and choose Set as main document.');
});

test('a log entry in an included file opens it with the cursor on the line (US3-6)', async ({ page }) => {
	const intro = (await files(page)).find((f) => f.name === 'intro.tex')!;
	const chapters = (await files(page)).find((f) => f.name === 'chapters')!;
	await upload(page, 'intro.tex', Buffer.from('\\section{Introduction}\n\nThis chapter holds the INTRO-MARKER text.\n\\undefinedmacro\n'), chapters.id);
	await compile(page);

	await page.getByRole('button', { name: 'Logs', exact: true }).click();
	const entry = page.getByRole('region', { name: 'Logs' }).getByRole('region', { name: 'Errors' }).getByRole('button').filter({ hasText: 'chapters/intro.tex:4' });
	await entry.click();
	await expect(tab(page, 'intro.tex')).toHaveAttribute('aria-selected', 'true');
	await page.waitForFunction((id) => window.__overtree?.fileId === id, intro.id);
	await expect
		.poll(() =>
			page.evaluate(() => {
				const { state } = window.__overtree!.view;
				return state.doc.lineAt(state.selection.main.head).number;
			})
		)
		.toBe(4);
	await expect(page.locator('.cm-content')).toBeFocused();
});
