import { expect, type Browser, type Page } from '@playwright/test';
import { allow, api, openEditor, projectPath, signInAs, test, text } from './helpers.ts';

// US3 "Share a project with roles" (scenarios 1–9) with two and three browser contexts. The owner is the fixture
// user in `page`; collaborators get per-test emails because every browser of the run shares one server.

const READ_ONLY = 'Read only: you can view and compile but not edit.';
const tag = () => Math.random().toString(36).slice(2, 8);

/** A signed-in page of `email` in a context of its own; the user exists once it has loaded a page. */
async function as(browser: Browser, email: string) {
	const ctx = await browser.newContext();
	await signInAs(ctx, email);
	const page = await ctx.newPage();
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
	return page;
}

/** The owner's Share dialog, opened from the top bar. */
async function shareDialog(page: Page) {
	await page.getByRole('button', { name: 'Share', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Share project' });
	await expect(dialog).toBeVisible();
	return dialog;
}

async function invite(page: Page, email: string, role: 'Editor' | 'Reader') {
	const dialog = await shareDialog(page);
	await dialog.getByRole('textbox', { name: 'Email' }).fill(email);
	await dialog.getByRole('combobox', { name: 'Role', exact: true }).selectOption({ label: role });
	await dialog.getByRole('button', { name: 'Invite', exact: true }).click();
	return dialog;
}

/** Open the project as a collaborator and wait for the synced editor. */
async function openAs(page: Page, pid: string) {
	await page.goto(projectPath(pid));
	await expect(page.getByRole('status')).toHaveText('Saved');
	await page.waitForFunction(() => window.__overtree?.provider.isSynced);
}

test.beforeEach(async ({ page }) => {
	await allow(page.request, '@test.local');
});

test('reader: listed, read-only editor and tree, compiles and downloads; editor switch and removal reach the open session (1, 3, 5, 8)', async ({ browser, page, pid }) => {
	const b = `reader-${tag()}@test.local`;
	const bob = await as(browser, b);
	await openEditor(page, pid);
	const dialog = await invite(page, b, 'Reader');
	await expect(dialog.getByRole('combobox', { name: `Role for ${b}` })).toHaveValue('reader');
	await dialog.getByRole('button', { name: 'Close' }).click();

	// the project shows on B's dashboard
	await bob.reload();
	await expect(bob.getByRole('link', { name: 'Untitled project' }).first()).toBeVisible();
	await openAs(bob, pid);
	await expect(bob.getByText(READ_ONLY)).toBeVisible();
	await expect(bob.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
	await expect(bob.getByRole('button', { name: 'Bold' })).toBeDisabled();
	await expect(bob.getByRole('button', { name: 'New file' })).toBeDisabled();
	await expect(bob.getByRole('button', { name: 'Upload' })).toBeDisabled();

	// typing does nothing locally or on the server
	const before = await text(bob);
	await bob.locator('.cm-content').click();
	await bob.keyboard.type('nope');
	expect(await text(bob)).toBe(before);
	expect(await text(page)).toBe(before);

	// compile and downloads work (FR-037)
	await bob.getByRole('button', { name: 'Recompile' }).click();
	await expect(bob.getByTestId('pdf-viewer').locator('.page canvas').first()).toBeVisible({ timeout: 20_000 });
	expect((await bob.request.get(`${api(pid)}/zip`)).status()).toBe(200);
	const { files } = await (await bob.request.get(`${api(pid)}/files`)).json();
	expect((await bob.request.get(`${api(pid)}/files/${files[0].id}/raw?download=1`)).status()).toBe(200);
	// a direct tree change is refused (scenario 8; the Yjs side is sharing.test.ts)
	expect((await bob.request.post(`${api(pid)}/files`, { data: { kind: 'text', name: 'x.tex', parentId: null } })).status()).toBe(403);

	// owner makes B an Editor: B's open editor unlocks within 2 s and B can type
	await shareDialog(page);
	await page.getByRole('combobox', { name: `Role for ${b}` }).selectOption('editor');
	await expect(bob.getByText(READ_ONLY)).toBeHidden({ timeout: 2_000 });
	await expect(bob.locator('.cm-content')).toHaveAttribute('contenteditable', 'true');
	await expect(bob.getByRole('status')).toHaveText('Saved');
	const marker = `% by-bob-${tag()}`;
	await bob.locator('.cm-content').press('ControlOrMeta+End');
	await bob.keyboard.type(marker);
	await page.waitForFunction((m) => window.__overtree!.view.state.doc.toString().includes(m), marker);

	// removed: B's page closes with the message within 2 s
	await page.getByRole('button', { name: `Remove ${b}` }).click();
	await expect(bob.getByRole('heading', { name: 'Your access was removed' })).toBeVisible({ timeout: 2_000 });
	await expect(bob.getByRole('link', { name: 'Back to dashboard' })).toBeVisible();
	expect((await bob.request.get(api(pid))).status()).toBe(404);
	await bob.context().close();
});

test('invite an unknown email: listed as invited, a collaborator once they sign in; withdrawn invites give nothing (2)', async ({ browser, page, pid }) => {
	const newcomer = `new-${tag()}@test.local`;
	const withdrawn = `gone-${tag()}@test.local`;
	await openEditor(page, pid);
	const dialog = await invite(page, newcomer, 'Editor');
	await expect(dialog.getByText(`${newcomer} (invited)`)).toBeVisible();
	await dialog.getByRole('textbox', { name: 'Email' }).fill(withdrawn);
	await dialog.getByRole('button', { name: 'Invite', exact: true }).click();
	await expect(dialog.getByText(`${withdrawn} (invited)`)).toBeVisible();
	await dialog.getByRole('button', { name: `Withdraw invite ${withdrawn}` }).click();
	await expect(dialog.getByText(`${withdrawn} (invited)`)).toHaveCount(0);

	const n = await as(browser, newcomer);
	const row = n.getByRole('row').filter({ has: n.getByRole('link', { name: 'Untitled project' }) });
	await expect(row.getByRole('cell', { name: 'Editor' })).toBeVisible();
	await expect(dialog.getByRole('combobox', { name: `Role for ${newcomer}` })).toHaveValue('editor');

	const g = await as(browser, withdrawn);
	expect((await g.request.get(api(pid))).status()).toBe(404);
	await n.context().close();
	await g.context().close();
});

test('link sharing: a third user joins read-only, resetting invalidates the link and disconnects them (4)', async ({ browser, page, pid }) => {
	const c = `link-${tag()}@test.local`;
	await openEditor(page, pid);
	const dialog = await shareDialog(page);
	await dialog.getByRole('switch', { name: 'Anyone with the link' }).click();
	await expect(dialog.getByRole('switch', { name: 'Anyone with the link' })).toHaveAttribute('aria-checked', 'true');
	await expect(dialog.getByRole('combobox', { name: 'Link role' })).toHaveValue('reader');
	const link = await dialog.getByRole('textbox', { name: 'Share link' }).inputValue();
	expect(link).toMatch(/\/share\/[\w-]{40,}$/);
	await expect(dialog.getByRole('button', { name: 'Copy link' })).toBeVisible();

	const carol = await as(browser, c);
	await carol.goto(link);
	await expect(carol).toHaveURL(projectPath(pid));
	await expect(carol.getByText(READ_ONLY)).toBeVisible();
	// the owner's list shows them, joined by link
	await expect(dialog.getByText(c)).toBeVisible();

	await dialog.getByRole('button', { name: 'Reset link' }).click();
	await page.getByRole('dialog', { name: 'Reset the share link?' }).getByRole('button', { name: 'Reset link' }).click();
	await expect(carol.getByRole('heading', { name: 'Your access was removed' })).toBeVisible({ timeout: 2_000 });
	await expect(dialog.getByRole('textbox', { name: 'Share link' })).not.toHaveValue(link);
	await expect(dialog.getByText(c)).toHaveCount(0);

	await carol.goto(link);
	await expect(carol.getByRole('heading', { name: 'This link is no longer valid' })).toBeVisible();

	// turning it off
	await dialog.getByRole('switch', { name: 'Anyone with the link' }).click();
	await expect(dialog.getByRole('textbox', { name: 'Share link' })).toHaveCount(0);
	await carol.context().close();
});

test('editor: edits the tree, sees the Share dialog read-only, cannot rename; transfer makes them owner (6, 7, 9)', async ({ browser, page, pid }) => {
	const b = `editor-${tag()}@test.local`;
	const bob = await as(browser, b);
	await openEditor(page, pid);
	const dialog = await invite(page, b, 'Editor');
	await expect(dialog.getByRole('combobox', { name: `Role for ${b}` })).toHaveValue('editor');

	await openAs(bob, pid);
	await expect(bob.getByText(READ_ONLY)).toHaveCount(0);
	await expect(bob.getByRole('button', { name: 'New file' })).toBeEnabled();
	await expect(bob.getByRole('button', { name: 'Rename project' })).toHaveCount(0);
	const bobDialog = await shareDialog(bob);
	await expect(bobDialog.getByText('Owner')).toBeVisible();
	await expect(bobDialog.getByText(b)).toBeVisible();
	await expect(bobDialog.getByRole('textbox', { name: 'Email' })).toHaveCount(0);
	await expect(bobDialog.getByRole('switch', { name: 'Anyone with the link' })).toHaveCount(0);
	await expect(bobDialog.getByRole('combobox')).toHaveCount(0);
	await expect(bobDialog.getByRole('button', { name: /^Remove / })).toHaveCount(0);
	await bobDialog.getByRole('button', { name: 'Close' }).click();
	for (const res of [
		await bob.request.post(`${api(pid)}/members`, { data: { email: 'x@test.local', role: 'reader' } }),
		await bob.request.put(`${api(pid)}/link`, { data: { role: 'editor' } }),
		await bob.request.patch(api(pid), { data: { title: 'Mine' } })
	])
		expect(res.status()).toBe(403);

	// transfer: B becomes owner, the former owner an Editor
	await dialog.getByRole('button', { name: `More for ${b}` }).click();
	await page.getByRole('menuitem', { name: 'Make owner' }).click();
	await page.getByRole('dialog', { name: /^Make .* the owner\?$/ }).getByRole('button', { name: 'Make owner' }).click();
	await expect(dialog.getByRole('textbox', { name: 'Email' })).toHaveCount(0);
	expect((await (await page.request.get(api(pid))).json()).role).toBe('editor');
	expect((await (await bob.request.get(api(pid))).json()).role).toBe('owner');
	// B's open page follows: they can rename now
	await expect(bob.getByRole('button', { name: 'Rename project' })).toBeVisible({ timeout: 2_000 });
	const owners = (await (await bob.request.get(`${api(pid)}/members`)).json()) as { owner: { email: string }; members: { user: { email: string }; role: string }[] };
	expect(owners.owner.email).toBe(b);
	expect(owners.members.map((m) => [m.user.email, m.role])).toEqual([['admin@test.local', 'editor']]);
	await bob.context().close();
});

test('lowered to Reader while offline with edits: the tab starts over from the server and says so (edge case 1)', async ({ browser, page, pid }) => {
	const b = `offline-${tag()}@test.local`;
	const bob = await as(browser, b);
	await openEditor(page, pid);
	const dialog = await invite(page, b, 'Editor');
	await openAs(bob, pid);
	const before = await text(page);

	await bob.evaluate(() => window.__overtree!.provider.configuration.websocketProvider.disconnect());
	await expect(bob.getByRole('status')).toHaveText('Offline');
	await bob.locator('.cm-content').press('ControlOrMeta+End');
	await bob.keyboard.type('% lost');
	await dialog.getByRole('combobox', { name: `Role for ${b}` }).selectOption('reader');
	await expect(dialog.getByRole('combobox', { name: `Role for ${b}` })).toHaveValue('reader');

	await bob.evaluate(() => window.__overtree!.provider.configuration.websocketProvider.connect());
	await expect(bob.getByRole('alert')).toHaveText(/Your changes could not be saved: you no longer have edit access/);
	await expect(bob.getByText(READ_ONLY)).toBeVisible();
	await bob.waitForFunction((t) => window.__overtree?.provider.isSynced && window.__overtree.view.state.doc.toString() === t, before);
	expect(await text(page)).toBe(before);
	await bob.context().close();
});

test('deleted while a collaborator has it open: their page says so (FR-036)', async ({ browser, page, pid }) => {
	const b = `deleted-${tag()}@test.local`;
	const bob = await as(browser, b);
	await openEditor(page, pid);
	await invite(page, b, 'Reader');
	await openAs(bob, pid);
	expect((await page.request.delete(api(pid), { headers: { origin: new URL(page.url()).origin } })).status()).toBe(204);
	await expect(bob.getByRole('heading', { name: 'This project was deleted' })).toBeVisible({ timeout: 2_000 });
	await bob.context().close();
});
