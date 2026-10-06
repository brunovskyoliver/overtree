import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { FileEntry } from '../../src/lib/files.ts';
import { openEditor, resetProject, setDoc, text } from './helpers.ts';

// US2: open files in tabs and previews (contracts/ui.md, Tabs and Preview)

test.beforeEach(async ({ page }) => {
	await page.goto('/');
	await page.evaluate(() => localStorage.clear());
	await openEditor(page);
});

test.afterEach(async ({ page }) => {
	await resetProject(page);
});

const tree = (page: Page) => page.getByRole('tree', { name: 'File tree' });
const row = (page: Page, name: string) => tree(page).getByRole('treeitem', { name, exact: true }).locator(':scope > .row');
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open files' });
const tab = (page: Page, name: string) => tabs(page).getByRole('tab', { name, exact: true });
const outline = (page: Page) => page.getByRole('navigation', { name: 'File outline' });

async function create(page: Page, kind: 'folder' | 'text', name: string, parentId: string | null = null): Promise<FileEntry> {
	const res = await page.request.post('/api/files', { data: { kind, name, parentId } });
	expect(res.status()).toBe(201);
	return res.json();
}

/** Open `name` from the tree and wait until its document is in the editor and synced. */
async function open(page: Page, file: FileEntry) {
	await row(page, file.name).click();
	await expect(tab(page, file.name)).toHaveAttribute('aria-selected', 'true');
	await page.waitForFunction((id) => window.__overtree?.fileId === id && window.__overtree.provider.isSynced, file.id);
}

const synced = (page: Page) => page.waitForFunction(() => !window.__overtree!.provider.hasUnsyncedChanges);
const head = (page: Page) => page.evaluate(() => window.__overtree!.view.state.selection.main.head);

test('text files open in tabs with their own text, cursor and undo (US2-1, US2-2, US2-9)', async ({ page }) => {
	const a = await create(page, 'text', 'a.tex');
	const b = await create(page, 'text', 'b.tex');
	await page.reload();

	await open(page, a);
	await expect(tabs(page).getByRole('tab')).toHaveCount(2); // main.tex + a.tex
	await expect(row(page, 'a.tex')).toHaveClass(/active/);
	await page.locator('.cm-content').click();
	await page.keyboard.type('alpha one');
	await page.evaluate(() => window.__overtree!.undoManager.stopCapturing());
	await page.keyboard.type(' two');
	await page.evaluate(() => window.__overtree!.view.dispatch({ selection: { anchor: 3 } }));

	await open(page, b);
	await expect(row(page, 'b.tex')).toHaveClass(/active/);
	await expect(row(page, 'a.tex')).not.toHaveClass(/active/);
	await page.locator('.cm-content').click();
	await page.keyboard.type('beta');
	expect(await text(page)).toBe('beta');
	// undo in b doesn't touch a
	await page.keyboard.press('ControlOrMeta+z');
	expect(await text(page)).toBe('');

	// clicking a tab switches; a keeps its text and cursor
	await tab(page, 'a.tex').click();
	await page.waitForFunction((id) => window.__overtree?.fileId === id, a.id);
	expect(await text(page)).toBe('alpha one two');
	expect(await head(page)).toBe(3);
	await expect(row(page, 'a.tex')).toHaveClass(/active/);
	await page.locator('.cm-content').press('ControlOrMeta+z');
	expect(await text(page)).toBe('alpha one');

	// clicking a file that already has a tab switches to it
	await open(page, b);
	await expect(tabs(page).getByRole('tab')).toHaveCount(3);
});

test('closing a tab activates the neighbour; the last one leaves a hint (US2-3)', async ({ page }) => {
	const a = await create(page, 'text', 'a.tex');
	const b = await create(page, 'text', 'b.md');
	await page.reload();
	await open(page, a);
	await open(page, b);

	await tab(page, 'a.tex').click();
	await tabs(page).getByRole('button', { name: 'Close a.tex' }).click();
	await expect(tab(page, 'a.tex')).toHaveCount(0);
	await expect(tab(page, 'b.md')).toHaveAttribute('aria-selected', 'true'); // right neighbour

	await tab(page, 'b.md').click({ button: 'middle' });
	await expect(tab(page, 'b.md')).toHaveCount(0);
	await expect(tab(page, 'main.tex')).toHaveAttribute('aria-selected', 'true'); // left neighbour

	await tabs(page).getByRole('button', { name: 'Close main.tex' }).click();
	await expect(tabs(page).getByRole('tab')).toHaveCount(0);
	await expect(page.getByText('Open a file from the file tree.')).toBeVisible();
	await expect(page.locator('.cm-editor')).toBeHidden();
	await expect(outline(page).getByText('No outline for this file.')).toBeVisible();
});

/** Upload a binary file (multipart, T032). Origin like a browser form post. */
async function upload(page: Page, name: string, bytes: Buffer): Promise<FileEntry> {
	const res = await page.request.post('/api/files', {
		headers: { origin: new URL(page.url()).origin },
		multipart: { file: { name, mimeType: 'application/octet-stream', buffer: bytes }, parentId: '' }
	});
	expect(res.status()).toBe(201);
	return res.json();
}

// one empty page; pdf.js rebuilds the missing xref table
const PDF = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';
const preview = (page: Page, name: string) => page.getByRole('region', { name: `Preview of ${name}` });

async function downloads(page: Page, name: string, bytes: Buffer) {
	const [download] = await Promise.all([page.waitForEvent('download'), preview(page, name).getByRole('link', { name: 'Download' }).click()]);
	expect(download.suggestedFilename()).toBe(name);
	expect(readFileSync(await download.path())).toEqual(bytes);
}

test('a PNG and a PDF open previews with Download (US2-4)', async ({ page }) => {
	const png = readFileSync(fileURLToPath(new URL('../fixtures/projects/multi/figures/dot.png', import.meta.url)));
	await upload(page, 'dot.png', png);
	await upload(page, 'doc.pdf', Buffer.from(PDF));
	await page.reload();

	await row(page, 'dot.png').click();
	await expect(tab(page, 'dot.png')).toHaveAttribute('aria-selected', 'true');
	const img = preview(page, 'dot.png').getByRole('img', { name: 'dot.png' });
	await expect(img).toBeVisible();
	expect(await img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
	await expect(page.locator('.cm-editor')).toBeHidden();
	await expect(page.getByRole('toolbar', { name: 'Formatting' })).toHaveCount(0);
	await downloads(page, 'dot.png', png);

	await row(page, 'doc.pdf').click();
	await expect(preview(page, 'doc.pdf').locator('.page[data-page-number="1"] canvas')).toBeVisible({ timeout: 10_000 });
	await downloads(page, 'doc.pdf', Buffer.from(PDF));
});

test('an unknown binary says there is no preview, with Download (US2-5)', async ({ page }) => {
	const bytes = Buffer.from([0, 1, 2, 3, 255]);
	await upload(page, 'data.bin', bytes);
	await page.reload();
	await row(page, 'data.bin').click();
	await expect(preview(page, 'data.bin').getByText('No preview for this file type.')).toBeVisible();
	await downloads(page, 'data.bin', bytes);
});

test('outline follows the active tab; non-.tex files have none (US2-6)', async ({ page }) => {
	const a = await create(page, 'text', 'a.tex');
	const notes = await create(page, 'text', 'notes.md');
	await page.reload();

	await open(page, a);
	await setDoc(page, 'intro\n\\section{Alpha}\ntext\n\\subsection{Beta}\nmore');
	await expect(outline(page).getByRole('button')).toHaveText(['Alpha', 'Beta']);
	await expect(page.getByRole('toolbar', { name: 'Formatting' })).toBeVisible();

	await open(page, notes);
	await setDoc(page, '\\section{Not an outline}');
	await expect(outline(page).getByText('No outline for this file.')).toBeVisible();
	await expect(outline(page).getByRole('button')).toHaveCount(0);
	await expect(page.getByRole('toolbar', { name: 'Formatting' })).toHaveCount(0);

	// back on a.tex: its sections, and a click jumps within it
	await tab(page, 'a.tex').click();
	await outline(page).getByRole('button', { name: 'Beta' }).click();
	expect(await page.evaluate(() => window.__overtree!.fileId)).toBe(a.id);
	expect(await head(page)).toBe('intro\n\\section{Alpha}\ntext\n'.length);
});

test('reload restores tabs, the active tab and the text (US2-7)', async ({ page }) => {
	const a = await create(page, 'text', 'a.tex');
	const b = await create(page, 'text', 'b.tex');
	await page.reload();
	await open(page, a);
	await page.locator('.cm-content').click();
	await page.keyboard.type('kept in a');
	await synced(page);
	await open(page, b);
	await page.locator('.cm-content').click();
	await page.keyboard.type('kept in b');
	await synced(page);
	await tab(page, 'a.tex').click();

	await page.reload();
	await expect(tabs(page).getByRole('tab')).toHaveText(['main.tex', 'a.tex', 'b.tex']);
	await expect(tab(page, 'a.tex')).toHaveAttribute('aria-selected', 'true');
	await page.waitForFunction((id) => window.__overtree?.fileId === id && window.__overtree.provider.isSynced, a.id);
	await expect.poll(() => text(page)).toBe('kept in a');
	await tab(page, 'b.tex').click();
	await expect.poll(() => text(page)).toBe('kept in b');
});

test('rename and move keep the tab, delete closes it (US2-8)', async ({ page }) => {
	const a = await create(page, 'text', 'a.tex');
	const folder = await create(page, 'folder', 'chapters');
	await page.reload();
	await open(page, a);
	await page.locator('.cm-content').click();
	await page.keyboard.type('same doc');
	await synced(page);

	await tree(page).getByRole('treeitem', { name: 'a.tex' }).press('F2');
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.type('intro.tex');
	await page.keyboard.press('Enter');
	await expect(tab(page, 'intro.tex')).toHaveAttribute('aria-selected', 'true');
	await expect(tab(page, 'a.tex')).toHaveCount(0);

	await row(page, 'intro.tex').dragTo(row(page, 'chapters'));
	await expect(tree(page).getByRole('treeitem', { name: 'chapters' }).getByRole('treeitem', { name: 'intro.tex' })).toBeVisible();
	await expect(tab(page, 'intro.tex')).toBeVisible();
	await tab(page, 'intro.tex').click();
	expect(await text(page)).toBe('same doc');

	// deleting the folder closes the tab of the file inside it
	const headers = { origin: new URL(page.url()).origin };
	expect((await page.request.delete(`/api/files/${folder.id}`, { headers })).status()).toBe(204);
	await page.reload();
	await expect(tab(page, 'intro.tex')).toHaveCount(0);
	await expect(tab(page, 'main.tex')).toHaveAttribute('aria-selected', 'true');
});

test('deleting from the tree closes the tab (US2-8)', async ({ page }) => {
	const a = await create(page, 'text', 'a.tex');
	await page.reload();
	await open(page, a);
	await tree(page).getByRole('treeitem', { name: 'a.tex' }).press('Delete');
	await page.getByRole('dialog', { name: 'Delete "a.tex"?' }).getByRole('button', { name: 'Delete' }).click();
	await expect(tab(page, 'a.tex')).toHaveCount(0);
	await expect(tab(page, 'main.tex')).toHaveAttribute('aria-selected', 'true');
	await page.waitForFunction(() => window.__overtree?.provider.isSynced);
});

test('switching between two 5,000-line files takes < 100 ms (SC-004)', async ({ page }) => {
	const a = await create(page, 'text', 'big-a.tex');
	const b = await create(page, 'text', 'big-b.tex');
	await page.reload();
	const big = (tag: string) => Array.from({ length: 5000 }, (_, i) => `${tag} line ${i + 1} with some filler text.`).join('\n');
	await open(page, a);
	await setDoc(page, big('A'));
	await open(page, b);
	await setDoc(page, big('B') + '\nlast');

	for (const [name, lines] of [
		['big-a.tex', 5000],
		['big-b.tex', 5001]
	] as const) {
		const button = await tab(page, name).elementHandle();
		const ms = await page.evaluate(
			([el, lines]) =>
				new Promise<number>((resolve) => {
					const t0 = performance.now();
					(el as HTMLElement).click();
					const tick = () =>
						window.__overtree?.view.state.doc.lines === lines ? resolve(performance.now() - t0) : requestAnimationFrame(tick);
					tick();
				}),
			[button, lines] as const
		);
		expect(ms).toBeLessThan(100);
		await expect(page.locator('.cm-line').first()).toContainText(name === 'big-a.tex' ? 'A line 1' : 'B line 1');
	}
});
