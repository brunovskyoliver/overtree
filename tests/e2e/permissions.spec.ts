import { expect, type Browser, type Page } from '@playwright/test';
import type { FileEntry } from '../../src/lib/files.ts';
import { allow, api, openEditor, projectPath, signInAs, test, text } from './helpers.ts';

// US6 "Per-file and per-folder permissions" (scenarios 1–8) with two browser contexts: the owner is the fixture
// user in `page`, B a per-test email. Scenario 6 (moves) is in tests/unit/overrides.test.ts.

const READ_ONLY = 'Read only: you can view and compile but not edit.';
const MAIN = 'main.tex, main document';
const tag = () => Math.random().toString(36).slice(2, 8);

async function as(browser: Browser, email: string) {
	const ctx = await browser.newContext();
	await signInAs(ctx, email);
	const page = await ctx.newPage();
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
	return page;
}

async function create(page: Page, pid: string, kind: 'folder' | 'text', name: string, parentId: string | null = null): Promise<FileEntry> {
	const res = await page.request.post(`${api(pid)}/files`, { data: { kind, name, parentId } });
	expect(res.status()).toBe(201);
	return res.json();
}

const item = (page: Page, name: string) => page.getByRole('tree', { name: 'File tree' }).getByRole('treeitem', { name, exact: true });
const row = (page: Page, name: string) => item(page, name).locator(':scope > .row');
const lock = (page: Page, name: string) => row(page, name).getByRole('img', { name: 'Read only' });

/** The owner sets B's permission on a tree item through "Permissions…". */
async function setPermission(page: Page, name: string, path: string, email: string, label: 'Editor' | 'Reader') {
	await row(page, name).click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Permissions…' }).click();
	const dialog = page.getByRole('dialog', { name: `Permissions for ${path}` });
	await expect(dialog).toBeVisible();
	const select = dialog.getByRole('combobox', { name: `Permission for ${email}` });
	await select.selectOption({ label });
	await expect(select).toHaveValue(label.toLowerCase());
	await dialog.getByRole('button', { name: 'Close' }).click();
}

async function openAs(page: Page, pid: string) {
	await page.goto(projectPath(pid));
	await expect(page.getByRole('status')).toHaveText('Saved');
	await page.waitForFunction(() => window.__overtree?.provider.isSynced);
}

test.beforeEach(async ({ page }) => {
	await allow(page.request, '@test.local');
});

test('editor with Reader overrides: set from the tree, listed in Share, locks, read-only file, nested rule, server refuses (1–5)', async ({ browser, page, pid }) => {
	const b = `perm-${tag()}@test.local`;
	const bob = await as(browser, b);
	const figures = await create(page, pid, 'folder', 'figures');
	await create(page, pid, 'text', 'plot.tex', figures.id);
	const chapters = await create(page, pid, 'folder', 'chapters');
	await create(page, pid, 'text', 'intro.tex', chapters.id);
	await create(page, pid, 'text', 'outro.tex', chapters.id);
	expect((await page.request.post(`${api(pid)}/members`, { data: { email: b, role: 'editor' } })).status()).toBe(201);

	await openEditor(page, pid);
	await setPermission(page, MAIN, 'main.tex', b, 'Reader');
	await setPermission(page, 'figures', 'figures', b, 'Reader');
	await setPermission(page, 'chapters', 'chapters', b, 'Reader');
	await item(page, 'chapters').click();
	await setPermission(page, 'intro.tex', 'chapters/intro.tex', b, 'Editor');

	// listed in the Share dialog under B (scenario 1)
	await page.getByRole('button', { name: 'Share', exact: true }).click();
	const share = page.getByRole('dialog', { name: 'Share project' });
	await share.getByText('File permissions (4)').click();
	const listed = share.getByRole('list', { name: `File permissions for ${b}` });
	for (const [path, role] of [['main.tex', 'Reader'], ['figures', 'Reader'], ['chapters', 'Reader'], ['chapters/intro.tex', 'Editor']])
		await expect(listed.getByRole('listitem').filter({ has: page.getByText(path, { exact: true }) })).toContainText(role);
	await share.getByRole('button', { name: 'Close' }).click();

	// the owner is never restricted (scenario 5)
	await expect(page.getByRole('tree', { name: 'File tree' }).getByRole('img', { name: 'Read only' })).toHaveCount(0);
	await expect(page.getByText(READ_ONLY)).toHaveCount(0);

	// B: lock and read-only editor on main.tex, the rest of the root editable
	await openAs(bob, pid);
	await expect(lock(bob, MAIN)).toBeVisible();
	await expect(bob.getByText(READ_ONLY)).toBeVisible();
	await expect(bob.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
	const before = await text(bob);
	await bob.locator('.cm-content').click();
	await bob.keyboard.type('nope');
	expect(await text(bob)).toBe(before);

	// figures/ and everything inside it locked, no create, upload, rename or delete there (scenario 2)
	await expect(lock(bob, 'figures')).toBeVisible();
	await item(bob, 'figures').click();
	await expect(lock(bob, 'plot.tex')).toBeVisible();
	await expect(bob.getByRole('button', { name: 'New file' })).toBeDisabled();
	await expect(bob.getByRole('button', { name: 'Upload' })).toBeDisabled();
	await row(bob, 'plot.tex').click({ button: 'right' });
	const menu = bob.getByRole('menu', { name: 'Actions for plot.tex' });
	await expect(menu.getByRole('menuitem', { name: 'Download' })).toBeVisible();
	for (const name of ['Rename', 'Delete', 'Permissions…']) await expect(menu.getByRole('menuitem', { name })).toHaveCount(0);
	await bob.keyboard.press('Escape');
	await item(bob, 'plot.tex').click();
	await expect(bob.getByText(READ_ONLY)).toBeVisible();

	// nested rule: chapters/ Reader, chapters/intro.tex Editor (scenario 3)
	await item(bob, 'chapters').click();
	await expect(lock(bob, 'chapters')).toBeVisible();
	await expect(lock(bob, 'outro.tex')).toBeVisible();
	await expect(lock(bob, 'intro.tex')).toHaveCount(0);
	await item(bob, 'intro.tex').click();
	await expect(bob.getByText(READ_ONLY)).toHaveCount(0);
	await expect(bob.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
	await bob.locator('.cm-content').click();
	await bob.keyboard.type('by bob');
	await bob.waitForFunction(() => !window.__overtree!.provider.hasUnsyncedChanges && window.__overtree!.view.state.doc.toString() === 'by bob');

	// direct changes to read-only items are refused (scenario 4; the Yjs side is overrides.test.ts)
	const { files }: { files: (FileEntry & { canEdit: boolean })[] } = await (await bob.request.get(`${api(pid)}/files`)).json();
	const main = files.find((f) => f.name === 'main.tex')!;
	expect(main.canEdit).toBe(false);
	expect((await bob.request.patch(`${api(pid)}/files/${main.id}`, { data: { name: 'mine.tex' } })).status()).toBe(403);
	expect((await bob.request.post(`${api(pid)}/files`, { data: { kind: 'text', name: 'x.tex', parentId: figures.id } })).status()).toBe(403);
	expect((await bob.request.post(`${api(pid)}/files`, { data: { kind: 'text', name: 'x.tex', parentId: null } })).status()).toBe(201);
	expect((await bob.request.put(`${api(pid)}/overrides`, { data: { userId: 'x', fileId: main.id, role: 'editor' } })).status()).toBe(403);
	await bob.context().close();
});

test('reader raised to Editor on chapters/; removing the override restores the project role live (7, 8)', async ({ browser, page, pid }) => {
	const b = `raise-${tag()}@test.local`;
	const bob = await as(browser, b);
	const chapters = await create(page, pid, 'folder', 'chapters');
	await create(page, pid, 'text', 'intro.tex', chapters.id);
	expect((await page.request.post(`${api(pid)}/members`, { data: { email: b, role: 'reader' } })).status()).toBe(201);
	await openEditor(page, pid);
	await setPermission(page, 'chapters', 'chapters', b, 'Editor');

	await openAs(bob, pid);
	await expect(bob.getByText(READ_ONLY)).toBeVisible(); // main.tex: project role
	await expect(lock(bob, MAIN)).toBeVisible();
	await expect(lock(bob, 'chapters')).toHaveCount(0);
	await item(bob, 'chapters').click();
	await expect(bob.getByRole('button', { name: 'New file' })).toBeEnabled();
	await bob.getByRole('button', { name: 'New file' }).click();
	await bob.getByRole('textbox', { name: 'New file name' }).fill('new.tex');
	await bob.keyboard.press('Enter');
	await expect(item(bob, 'new.tex')).toBeVisible();
	await item(bob, 'intro.tex').click();
	await expect(bob.getByText(READ_ONLY)).toHaveCount(0);
	await expect(bob.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
	await item(bob, MAIN).click();
	await expect(bob.getByRole('button', { name: 'New file' })).toBeDisabled();
	await item(bob, 'intro.tex').click();
	await expect(bob.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');

	// the owner removes it from the Share dialog: B is a Reader everywhere again within 2 s, no reload
	await page.getByRole('button', { name: 'Share', exact: true }).click();
	const share = page.getByRole('dialog', { name: 'Share project' });
	await share.getByText('File permissions (1)').click();
	await share.getByRole('button', { name: `Remove permission on chapters for ${b}` }).click();
	await expect(bob.getByText(READ_ONLY)).toBeVisible({ timeout: 2_000 });
	await expect(bob.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
	await expect(lock(bob, 'chapters')).toBeVisible();
	await expect(share.getByText(/File permissions/)).toHaveCount(0);
	await bob.context().close();
});
