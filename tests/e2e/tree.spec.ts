import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import type { FileEntry } from '../../src/lib/files.ts';
import { api, openEditor, projectPath, resetProject, SEED, test, text } from './helpers.ts';

// US1: organize project files in the tree (contracts/ui.md, File tree)

test.beforeEach(async ({ page }) => {
	await page.goto(projectPath());
	await page.evaluate(() => localStorage.clear());
	await openEditor(page);
});

test.afterEach(async ({ page }) => {
	await resetProject(page);
});

const tree = (page: Page) => page.getByRole('tree', { name: 'File tree' });
const item = (page: Page, name: string) => tree(page).getByRole('treeitem', { name, exact: true });
const row = (page: Page, name: string) => item(page, name).locator(':scope > .row');
const MAIN = 'main.tex, main document';

/** Create through the API and reload, for specs where creating isn't what's tested. */
async function create(page: Page, kind: 'folder' | 'text', name: string, parentId: string | null = null): Promise<FileEntry> {
	const res = await page.request.post(`${api()}/files`, { data: { kind, name, parentId } });
	expect(res.status()).toBe(201);
	return res.json();
}

const files = async (page: Page): Promise<FileEntry[]> => (await (await page.request.get(`${api()}/files`)).json()).files;

/** aria-labels of the items directly under `parent` (the tree root by default), in display order. */
const names = (page: Page, parent = tree(page)) =>
	parent.locator(':scope > [role="treeitem"], :scope > [role="group"] > [role="treeitem"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));

async function openMenu(page: Page, name: string) {
	await row(page, name).click({ button: 'right' });
	const menu = page.getByRole('menu', { name: `Actions for ${name.replace(', main document', '')}` });
	await expect(menu).toBeVisible();
	return menu;
}

test('new file appears, opens and is empty; inside the selected folder (US1-1)', async ({ page }) => {
	await page.getByRole('button', { name: 'New file' }).click();
	await page.getByRole('textbox', { name: 'New file name' }).fill('intro.tex');
	await page.keyboard.press('Enter');
	await expect(item(page, 'intro.tex')).toBeVisible();
	await expect(page.getByLabel('Editor').getByText('intro.tex', { exact: true })).toBeVisible();
	await page.waitForFunction(() => window.__overtree?.provider.isSynced && window.__overtree.view.state.doc.length === 0);
	await expect(row(page, 'intro.tex')).toHaveClass(/active/);

	await create(page, 'folder', 'chapters');
	await page.reload();
	await row(page, 'chapters').click(); // selects and expands
	await page.getByRole('button', { name: 'New file' }).click();
	await page.getByRole('textbox', { name: 'New file name' }).fill('two.tex');
	await page.keyboard.press('Enter');
	await expect(item(page, 'chapters').getByRole('group').getByRole('treeitem', { name: 'two.tex' })).toBeVisible();
});

test('new folder expands and collapses (US1-2)', async ({ page }) => {
	await page.getByRole('button', { name: 'New folder' }).click();
	await page.getByRole('textbox', { name: 'New folder name' }).fill('chapters');
	await page.keyboard.press('Enter');
	const folder = item(page, 'chapters');
	await expect(folder).toHaveAttribute('aria-expanded', 'false');
	await expect(folder).toBeFocused();

	const parent = (await files(page)).find((f) => f.name === 'chapters')!;
	await create(page, 'text', 'intro.tex', parent.id);
	await page.reload();
	await row(page, 'chapters').click();
	await expect(folder).toHaveAttribute('aria-expanded', 'true');
	await expect(item(page, 'intro.tex')).toBeVisible();
	await expect(item(page, 'intro.tex')).toHaveAttribute('aria-level', '2');
	await row(page, 'chapters').click();
	await expect(folder).toHaveAttribute('aria-expanded', 'false');
	await expect(item(page, 'intro.tex')).toHaveCount(0);
});

test('rename via the kebab menu and F2; a folder keeps its contents (US1-3)', async ({ page }) => {
	const dir = await create(page, 'folder', 'chapters');
	await create(page, 'text', 'intro.tex', dir.id);
	await create(page, 'text', 'notes.txt');
	await page.reload();

	await row(page, 'notes.txt').hover();
	await page.getByRole('button', { name: 'Actions for notes.txt' }).click();
	await page.getByRole('menuitem', { name: 'Rename' }).click();
	const input = page.getByRole('textbox', { name: 'New name for notes.txt' });
	await expect(input).toBeFocused();
	await input.fill('todo.txt');
	await input.press('Enter');
	await expect(item(page, 'todo.txt')).toBeVisible();
	await expect(item(page, 'notes.txt')).toHaveCount(0);

	await row(page, 'chapters').click();
	await item(page, 'chapters').press('F2');
	await page.getByRole('textbox', { name: 'New name for chapters' }).fill('parts');
	await page.keyboard.press('Enter');
	await expect(item(page, 'parts').getByRole('group').getByRole('treeitem', { name: 'intro.tex' })).toBeVisible();

	// Escape cancels
	await item(page, 'parts').press('F2');
	await page.getByRole('textbox', { name: 'New name for parts' }).fill('other');
	await page.keyboard.press('Escape');
	await expect(item(page, 'parts')).toBeFocused();
	expect((await files(page)).map((f) => f.name).sort()).toEqual(['intro.tex', 'main.tex', 'parts', 'todo.txt']);
});

test('drag a file and a folder into folders; a folder never into its child (US1-4)', async ({ page }) => {
	const outer = await create(page, 'folder', 'outer');
	await create(page, 'folder', 'inner', outer.id);
	await create(page, 'folder', 'figures');
	await create(page, 'text', 'intro.tex');
	await page.reload();
	const parentName = async (name: string) => {
		const all = await files(page);
		return all.find((f) => f.id === all.find((x) => x.name === name)!.parentId)?.name ?? null;
	};

	await row(page, 'intro.tex').dragTo(row(page, 'figures'));
	await expect(item(page, 'figures').getByRole('treeitem', { name: 'intro.tex' })).toBeVisible();
	expect(await parentName('intro.tex')).toBe('figures');

	await row(page, 'figures').dragTo(row(page, 'outer'));
	await expect(item(page, 'outer').getByRole('treeitem', { name: 'figures' })).toBeVisible();
	expect(await parentName('figures')).toBe('outer');

	// back to the root through the empty area under the rows
	await row(page, 'intro.tex').dragTo(tree(page), { targetPosition: { x: 40, y: (await tree(page).boundingBox())!.height - 10 } });
	await expect.poll(() => parentName('intro.tex')).toBe(null);

	// outer onto its own child: no highlight, nothing moves
	await row(page, 'outer').hover();
	await page.mouse.down();
	const box = (await row(page, 'inner').boundingBox())!;
	await page.mouse.move(box.x + 20, box.y + 10, { steps: 5 });
	await page.mouse.move(box.x + 30, box.y + 12, { steps: 5 });
	await expect(tree(page).locator('.drop')).toHaveCount(0);
	await page.mouse.up();
	expect(await parentName('outer')).toBe(null);
	expect(await parentName('inner')).toBe('outer');
});

test('delete asks first, names the item and the folder file count (US1-5)', async ({ page }) => {
	const dir = await create(page, 'folder', 'chapters');
	const sub = await create(page, 'folder', 'deep', dir.id);
	await create(page, 'text', 'a.tex', dir.id);
	await create(page, 'text', 'b.tex', sub.id);
	await create(page, 'text', 'c.tex', sub.id);
	await page.reload();

	let menu = await openMenu(page, 'chapters');
	await menu.getByRole('menuitem', { name: 'Delete' }).click();
	const dialog = page.getByRole('dialog', { name: 'Delete "chapters"?' });
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText('This folder contains 3 files.');
	await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toBeHidden();
	await expect(item(page, 'chapters')).toBeVisible();
	expect(await files(page)).toHaveLength(6);

	// Escape cancels too
	menu = await openMenu(page, 'chapters');
	await menu.getByRole('menuitem', { name: 'Delete' }).click();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	expect(await files(page)).toHaveLength(6);

	menu = await openMenu(page, 'chapters');
	await menu.getByRole('menuitem', { name: 'Delete' }).click();
	await dialog.getByRole('button', { name: 'Delete' }).click();
	await expect(item(page, 'chapters')).toHaveCount(0);
	expect((await files(page)).map((f) => f.name)).toEqual(['main.tex']);
});

test('download saves the file with its name and content (US1-6)', async ({ page }) => {
	const menu = await openMenu(page, MAIN);
	const [download] = await Promise.all([page.waitForEvent('download'), menu.getByRole('menuitem', { name: 'Download' }).click()]);
	expect(download.suggestedFilename()).toBe('main.tex');
	expect(await readFile((await download.path())!, 'utf8')).toBe(SEED);
});

test('invalid names are refused inline and nothing changes (US1-7)', async ({ page }) => {
	await create(page, 'folder', 'Figures');
	await page.reload();
	await page.getByRole('button', { name: 'New file' }).click();
	const input = page.getByRole('textbox', { name: 'New file name' });
	const alert = tree(page).getByRole('alert');
	for (const [name, message] of [
		['', 'Name must not be empty.'],
		['a/b.tex', 'Name must not contain / or \\.'],
		['a\\b.tex', 'Name must not contain / or \\.'],
		['a\u0001b.tex', 'Name must not contain control characters.'],
		['.', 'Name must not be . or ..'],
		['..', 'Name must not be . or ..'],
		['x'.repeat(256), 'Name must be at most 255 characters.'],
		['MAIN.TEX', '"MAIN.TEX" already exists here.'],
		['figures', '"figures" already exists here.']
	]) {
		await input.fill(name);
		// Firefox drops control characters while typing: nothing to refuse there (the server rule is unit-tested)
		if ((await input.inputValue()) !== name) continue;
		await input.press('Enter');
		await expect(alert, name).toHaveText(message);
		await expect(input).toBeVisible();
		await expect(input).toHaveAttribute('aria-invalid', 'true');
	}
	await input.press('Escape');
	expect((await files(page)).map((f) => f.name).sort()).toEqual(['Figures', 'main.tex']);

	// the same rules on rename
	await item(page, MAIN).focus();
	await item(page, MAIN).press('F2');
	const rename = page.getByRole('textbox', { name: 'New name for main.tex' });
	await rename.fill('figures');
	await expect(alert).toHaveText('"figures" already exists here.');
	await rename.press('Enter');
	await expect(rename).toBeVisible();
	await rename.press('Escape');
	expect((await files(page)).map((f) => f.name).sort()).toEqual(['Figures', 'main.tex']);
});

test('folders sort first, names case-insensitively; reload keeps tree and expansion (US1-8, FR-001)', async ({ page }) => {
	const z = await create(page, 'folder', 'zeta');
	await create(page, 'folder', 'Alpha');
	await create(page, 'text', 'b.tex');
	await create(page, 'text', 'A.tex');
	await create(page, 'text', 'inside.tex', z.id);
	await page.reload();
	await expect.poll(() => names(page)).toEqual(['Alpha', 'zeta', 'A.tex', 'b.tex', MAIN]);

	await row(page, 'zeta').click();
	await expect(item(page, 'inside.tex')).toBeVisible();
	await page.reload();
	await expect.poll(() => names(page)).toEqual(['Alpha', 'zeta', 'A.tex', 'b.tex', MAIN]);
	await expect(item(page, 'zeta')).toHaveAttribute('aria-expanded', 'true');
	await expect(item(page, 'inside.tex')).toBeVisible();
});

test('keyboard only: arrows, Enter, F2, Delete and the menu key (US1-9)', async ({ page, browserName }) => {
	const dir = await create(page, 'folder', 'chapters');
	await create(page, 'text', 'intro.tex', dir.id);
	await create(page, 'text', 'notes.txt');
	await page.reload();
	await openEditor(page);

	await expect(tree(page)).toBeVisible();
	await expect(item(page, MAIN)).toHaveAttribute('aria-selected', 'true');
	await expect(item(page, MAIN)).toHaveAttribute('tabindex', '0');
	await expect(item(page, 'chapters')).toHaveAttribute('tabindex', '-1');
	await item(page, MAIN).focus();

	const focused = (name: string) => expect(item(page, name)).toBeFocused();
	await page.keyboard.press('Home');
	await focused('chapters');
	await expect(item(page, 'chapters')).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('ArrowRight');
	await expect(item(page, 'chapters')).toHaveAttribute('aria-expanded', 'true');
	await page.keyboard.press('ArrowRight');
	await focused('intro.tex');
	await page.keyboard.press('ArrowLeft');
	await focused('chapters');
	await page.keyboard.press('ArrowLeft');
	await expect(item(page, 'chapters')).toHaveAttribute('aria-expanded', 'false');
	await page.keyboard.press('Enter');
	await expect(item(page, 'chapters')).toHaveAttribute('aria-expanded', 'true');
	await page.keyboard.press('Enter');
	await page.keyboard.press('ArrowDown');
	await focused(MAIN);
	await page.keyboard.press('End');
	await focused('notes.txt');
	await page.keyboard.press('ArrowUp');
	await focused(MAIN);
	await page.keyboard.press('ArrowDown');

	// Shift+F10 opens the row menu; Escape returns to the row
	await page.keyboard.press('Shift+F10');
	await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeFocused();
	await page.keyboard.press('Escape');
	await focused('notes.txt');

	await page.keyboard.press('F2');
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.type('todo.txt');
	await page.keyboard.press('Enter');
	await focused('todo.txt');

	await page.keyboard.press('Delete');
	const dialog = page.getByRole('dialog', { name: 'Delete "todo.txt"?' });
	await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
	await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab'); // Safari tabs to buttons with Option only
	await expect(dialog.getByRole('button', { name: 'Delete' })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(item(page, 'todo.txt')).toHaveCount(0);

	// Enter opens a text file in the editor
	await item(page, 'chapters').focus();
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await focused('intro.tex');
	await page.keyboard.press('Enter');
	await expect(page.getByLabel('Editor').getByText('intro.tex', { exact: true })).toBeVisible();
	await expect(row(page, 'intro.tex')).toHaveClass(/active/);
	await page.waitForFunction(() => window.__overtree?.provider.isSynced);
	expect(await text(page)).toBe('');
});
