import { expect, type Page } from '@playwright/test';
import type { FileEntry } from '../../src/lib/files.ts';
import { api, openEditor, projectPath, resetProject, setDoc, test, text } from './helpers.ts';

// US6: argument completion from the project (labels, cite keys, packages, file paths)

const popup = (page: Page) => page.locator('.cm-tooltip-autocomplete');
const options = (page: Page) => popup(page).getByRole('listbox').getByRole('option');
const selected = (page: Page) => popup(page).locator('[role=option][aria-selected=true]');
const row = (page: Page, name: string) =>
	page.getByRole('tree', { name: 'File tree' }).getByRole('treeitem', { name, exact: true }).locator(':scope > .row');
const tab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Open files' }).getByRole('tab', { name, exact: true });

async function upload(page: Page, name: string, content: string | Buffer, parentId = ''): Promise<FileEntry> {
	const res = await page.request.post(`${api()}/files`, {
		multipart: { file: { name, mimeType: 'application/octet-stream', buffer: Buffer.from(content) }, parentId },
		headers: { origin: new URL(page.url()).origin } // SvelteKit's CSRF check wants a browser-like Origin
	});
	expect(res.status()).toBe(201);
	return res.json();
}

async function folder(page: Page, name: string): Promise<FileEntry> {
	const res = await page.request.post(`${api()}/files`, { data: { kind: 'folder', name, parentId: null } });
	expect(res.status()).toBe(201);
	return res.json();
}

/** An empty document with the cursor in it. */
async function empty(page: Page) {
	await setDoc(page, '');
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+End');
}

/** Type `typed` into an empty document until the popup offers `labels` (the project symbols load in the background). */
async function offers(page: Page, typed: string, labels: string[]) {
	await expect(async () => {
		await empty(page);
		await page.keyboard.type(typed);
		try {
			for (const label of labels) await expect(options(page).locator('.cm-completionLabel').getByText(label, { exact: true })).toBeVisible({ timeout: 1000 });
		} finally {
			await page.keyboard.press('Escape');
		}
	}).toPass({ timeout: 10_000 });
	await empty(page);
}

/** The popup is open with `label` selected; keys within CodeMirror's 75 ms interaction delay are ignored. */
async function ready(page: Page, label: string) {
	await expect(selected(page).locator('.cm-completionLabel')).toHaveText(label);
	await page.waitForTimeout(100);
}

test.beforeEach(async ({ page }) => {
	await page.goto(projectPath());
	await page.evaluate(() => localStorage.clear());
	await openEditor(page);
	const chapters = await folder(page, 'chapters');
	await upload(page, 'intro.tex', '\\section{Intro}\\label{sec:intro}\n', chapters.id);
	const figures = await folder(page, 'figures');
	await upload(page, 'plot.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), figures.id);
	await upload(page, 'refs.bib', '@article{knuth84,\n  title = {Literate Programming},\n  author = {Knuth, Donald},\n}\n@book{lamport94, author = {Lamport, Leslie}}\n');
	await page.reload();
	await openEditor(page);
});

test.afterEach(async ({ page }) => {
	await resetProject(page);
});

test('labels from another file in \\ref, \\eqref and \\autoref (US6-1)', async ({ page }) => {
	for (const cmd of ['ref', 'eqref', 'autoref']) await offers(page, `\\${cmd}{`, ['sec:intro']);
	await page.keyboard.type('\\ref{sec');
	await ready(page, 'sec:intro');
	await expect(selected(page).locator('.cm-completionKind')).toHaveText('label');
	await page.keyboard.press('Enter');
	expect(await text(page)).toBe('\\ref{sec:intro}');
});

test('cite keys with the title or author as detail, also after a comma (US6-2)', async ({ page }) => {
	await offers(page, '\\cite{', ['knuth84', 'lamport94']);
	await page.keyboard.type('\\cite{kn');
	await ready(page, 'knuth84');
	await expect(selected(page).locator('.cm-completionDetail')).toHaveText('Literate Programming');
	await expect(selected(page).locator('.cm-completionKind')).toHaveText('cite');
	await page.keyboard.press('Escape');
	await empty(page);
	await page.keyboard.type('\\cite{knuth84,la');
	await ready(page, 'lamport94');
	await expect(selected(page).locator('.cm-completionDetail')).toHaveText('Lamport, Leslie');
	await page.keyboard.press('Enter');
	expect(await text(page)).toBe('\\cite{knuth84,lamport94}');
});

test('\\usepackage{ams offers amsmath, amssymb and amsthm as pkg (US6-3)', async ({ page }) => {
	await empty(page);
	await page.keyboard.type('\\usepackage{ams');
	await expect(popup(page)).toBeVisible();
	for (const name of ['amsmath', 'amssymb', 'amsthm']) {
		const option = options(page).filter({ has: page.locator('.cm-completionLabel').getByText(name, { exact: true }) });
		await expect(option.locator('.cm-completionKind')).toHaveText('pkg');
	}
});

test('project paths for \\input and \\includegraphics, by file type (US6-4)', async ({ page }) => {
	await offers(page, '\\input{', ['chapters/intro', 'main']);
	await expect(options(page).getByText('figures/plot')).toHaveCount(0);
	await page.keyboard.type('\\input{chap');
	await ready(page, 'chapters/intro');
	await expect(selected(page).locator('.cm-completionKind')).toHaveText('file');
	await page.keyboard.press('Enter');
	expect(await text(page)).toBe('\\input{chapters/intro}');

	await offers(page, '\\includegraphics{', ['figures/plot']);
	await offers(page, '\\bibliography{', ['refs']);
});

test('a label added in one tab is offered in another without a reload (US6-5)', async ({ page }) => {
	await page.getByRole('treeitem', { name: 'chapters' }).locator(':scope > .row').click();
	await row(page, 'intro.tex').click();
	await expect(tab(page, 'intro.tex')).toHaveAttribute('aria-selected', 'true');
	await page.waitForFunction(() => window.__overtree?.provider.isSynced && window.__overtree.view.state.doc.toString().includes('sec:intro'));
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.type('\\label{sec:fresh}');
	await tab(page, 'main.tex').click();
	await expect(tab(page, 'main.tex')).toHaveAttribute('aria-selected', 'true');
	await page.waitForFunction(() => window.__overtree?.provider.isSynced);
	await offers(page, '\\ref{', ['sec:intro', 'sec:fresh']);
});
