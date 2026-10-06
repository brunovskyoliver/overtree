import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import type { FileEntry } from '../../src/lib/files.ts';
import { zips } from '../fixtures/projects/zips.ts';
import { openEditor, resetProject, SEED, text } from './helpers.ts';

// US4: upload files, project zip download and import (contracts/ui.md, contracts/files-api.md).
// The e2e server runs with UPLOAD_MAX_FILE_MB=1 (playwright.config.ts).

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
const tab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Open files' }).getByRole('tab', { name, exact: true });
const uploads = (page: Page) => page.getByRole('list', { name: 'Uploads' });
const dialog = (page: Page) => page.getByRole('dialog');
const files = async (page: Page): Promise<FileEntry[]> => (await (await page.request.get('/api/files')).json()).files;
const byName = async (page: Page, name: string) => (await files(page)).find((f) => f.name === name);
const file = (name: string, content: string | Buffer) => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(content) });

async function folder(page: Page, name: string): Promise<FileEntry> {
	const res = await page.request.post('/api/files', { data: { kind: 'folder', name, parentId: null } });
	expect(res.status()).toBe(201);
	return res.json();
}

/** Click a header button that opens a file picker and pick `chosen`. */
async function choose(page: Page, button: string, chosen: ReturnType<typeof file>[]) {
	const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: button, exact: true }).click()]);
	await chooser.setFiles(chosen);
}

/** Drop desktop files on `target` (a row or the tree), as the browser does: dragover, then drop. */
async function drop(page: Page, target: ReturnType<typeof row>, names: string[]) {
	const dt = await page.evaluateHandle((names) => {
		const dt = new DataTransfer();
		for (const n of names) dt.items.add(new File([`content of ${n}`], n));
		return dt;
	}, names);
	await target.dispatchEvent('dragover', { dataTransfer: dt });
	await target.dispatchEvent('drop', { dataTransfer: dt });
}

test('Upload adds files to the selected folder with progress; an uploaded .bib is editable (US4-1, US4-3)', async ({ page }) => {
	const figures = await folder(page, 'figures');
	await page.reload();
	await row(page, 'figures').click();

	// hold the requests so the progress lines can be seen
	let release!: () => void;
	const held = new Promise<void>((r) => (release = r));
	await page.route('**/api/files', async (route) => {
		if (route.request().method() === 'POST') await held;
		await route.continue();
	});
	await choose(page, 'Upload', [file('plot.png', 'png bytes'), file('refs.bib', '@book{knuth}\n')]);
	await expect(uploads(page).getByRole('progressbar')).toHaveCount(2);
	await expect(uploads(page)).toContainText('plot.png');
	await expect(uploads(page)).toContainText('refs.bib');
	release();
	await expect(uploads(page)).toHaveCount(0);
	await page.unroute('**/api/files');

	await expect(row(page, 'plot.png')).toBeVisible();
	expect(await byName(page, 'plot.png')).toMatchObject({ parentId: figures.id, kind: 'binary' });
	expect(await byName(page, 'refs.bib')).toMatchObject({ parentId: figures.id, kind: 'text' });

	await row(page, 'refs.bib').click();
	await expect(tab(page, 'refs.bib')).toHaveAttribute('aria-selected', 'true');
	await page.waitForFunction(() => window.__overtree?.provider.isSynced);
	expect(await text(page)).toBe('@book{knuth}\n');
	await page.locator('.cm-content').press('ControlOrMeta+End');
	await page.keyboard.type('% edited');
	await page.waitForFunction(() => !window.__overtree!.provider.hasUnsyncedChanges);
	const res = await page.request.get(`/api/files/${(await byName(page, 'refs.bib'))!.id}/raw`);
	expect(await res.text()).toBe('@book{knuth}\n% edited');
});

test('desktop files dropped on a folder row or the empty area upload there (US4-2)', async ({ page }) => {
	const figures = await folder(page, 'figures');
	await page.reload();

	await drop(page, row(page, 'figures'), ['a.png', 'b.png']);
	await expect(tree(page).getByRole('treeitem', { name: 'b.png' })).toBeVisible();
	expect((await files(page)).filter((f) => f.parentId === figures.id).map((f) => f.name).sort()).toEqual(['a.png', 'b.png']);

	await drop(page, tree(page), ['root.txt']);
	await expect(row(page, 'root.txt')).toBeVisible();
	expect(await byName(page, 'root.txt')).toMatchObject({ parentId: null, kind: 'text' });
});

test('the drop target is outlined while desktop files are dragged over it (US4-2)', async ({ page }) => {
	await folder(page, 'figures');
	await page.reload();
	const dt = await page.evaluateHandle(() => {
		const dt = new DataTransfer();
		dt.items.add(new File(['x'], 'x.png'));
		return dt;
	});
	await row(page, 'figures').dispatchEvent('dragover', { dataTransfer: dt });
	await expect(row(page, 'figures')).toHaveClass(/drop/);
	await tree(page).dispatchEvent('dragover', { dataTransfer: dt });
	await expect(row(page, 'figures')).not.toHaveClass(/drop/);
	await expect(tree(page)).toHaveClass(/drop/);
});

test('Download project as zip has every file and folder (US4-4)', async ({ page }) => {
	const figures = await folder(page, 'figures');
	await folder(page, 'empty');
	const png = Buffer.from([137, 80, 78, 71, 1, 2, 3]);
	const res = await page.request.post('/api/files', {
		headers: { origin: new URL(page.url()).origin },
		multipart: { file: file('dot.png', png), parentId: figures.id }
	});
	expect(res.status()).toBe(201);
	await page.reload();

	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('link', { name: 'Download project as zip' }).click()
	]);
	expect(download.suggestedFilename()).toBe('project.zip');
	const entries = unzipSync(readFileSync(await download.path()));
	expect(Object.keys(entries).sort()).toEqual(['empty/', 'figures/', 'figures/dot.png', 'main.tex']);
	expect(strFromU8(entries['main.tex'])).toBe(SEED);
	expect(Buffer.from(entries['figures/dot.png'])).toEqual(png);
});

test('New project from zip asks first, then replaces the files and opens the main document (US4-5)', async ({ page }) => {
	const zip = file('thesis.zip', Buffer.from(zips.roundtrip()));
	const before = await files(page);

	await choose(page, 'New project from zip', [zip]);
	await expect(dialog(page)).toContainText('Replace the project with "thesis.zip"?');
	await expect(dialog(page)).toContainText('This removes all 1 current file.');
	await dialog(page).getByRole('button', { name: 'Cancel' }).click();
	expect(await files(page)).toEqual(before);

	await choose(page, 'New project from zip', [zip]);
	await dialog(page).getByRole('button', { name: 'Replace project' }).click();
	await expect(row(page, 'chapters')).toBeVisible();
	await expect(row(page, 'figures')).toBeVisible();
	await expect(row(page, 'refs.bib')).toBeVisible();
	await expect(tree(page).getByRole('treeitem', { name: 'main.tex, main document' })).toBeVisible();
	await expect(page.getByRole('tablist', { name: 'Open files' }).getByRole('tab')).toHaveText(['main.tex']);
	const main = readFileSync(fileURLToPath(new URL('../fixtures/projects/multi/main.tex', import.meta.url)), 'utf8');
	await page.waitForFunction((id) => window.__overtree?.fileId === id && window.__overtree.provider.isSynced, (await byName(page, 'main.tex'))!.id);
	expect(await text(page)).toBe(main);
});

test('a name clash asks Replace or Cancel; Replace updates the open tab (US4-6)', async ({ page }) => {
	const res = await page.request.post('/api/files', {
		headers: { origin: new URL(page.url()).origin },
		multipart: { file: file('notes.txt', 'old text'), parentId: '' }
	});
	expect(res.status()).toBe(201);
	await page.reload();
	await row(page, 'notes.txt').click();
	await page.waitForFunction(() => window.__overtree?.provider.isSynced);
	expect(await text(page)).toBe('old text');

	await choose(page, 'Upload', [file('notes.txt', 'new text')]);
	await expect(dialog(page)).toContainText('Replace existing file "notes.txt"?');
	await dialog(page).getByRole('button', { name: 'Cancel' }).click();
	await expect(uploads(page)).toHaveCount(0);
	expect(await (await page.request.get(`/api/files/${(await byName(page, 'notes.txt'))!.id}/raw`)).text()).toBe('old text');

	await choose(page, 'Upload', [file('notes.txt', 'new text')]);
	await dialog(page).getByRole('button', { name: 'Replace' }).click();
	await expect.poll(() => text(page)).toBe('new text');
	expect((await files(page)).filter((f) => f.name === 'notes.txt')).toHaveLength(1);
});

test('an oversized file and a broken zip are refused with a message, nothing changes (US4-7)', async ({ page }) => {
	const before = await files(page);
	await choose(page, 'Upload', [file('big.png', Buffer.alloc(1024 * 1024 + 1))]);
	await expect(uploads(page).getByRole('alert')).toHaveText('A file can be at most 1 MB.');
	await uploads(page).getByRole('button', { name: 'Dismiss big.png' }).click();
	await expect(uploads(page)).toHaveCount(0);

	await choose(page, 'New project from zip', [file('broken.zip', Buffer.from(zips['not-a-zip']()))]);
	await dialog(page).getByRole('button', { name: 'Replace project' }).click();
	await expect(page.getByRole('alert')).toHaveText('This file is not a valid zip.');
	expect(await files(page)).toEqual(before);
});
