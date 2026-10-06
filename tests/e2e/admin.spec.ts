import { expect, type Browser, type Page } from '@playwright/test';
import { allow, api, newProject, projectPath, signInAs, signup, test, USER } from './helpers.ts';

// US5 "Administer the instance" (scenarios 1–8). USER (admin@test.local) is in ADMIN_EMAILS. The server is shared
// by every browser project of the run: emails are per browser and settings are put back.

/** A signed-in page of `email` in a context of its own. */
async function as(browser: Browser, email: string) {
	const ctx = await browser.newContext();
	await signInAs(ctx, email);
	return ctx.newPage();
}

const usersTab = async (page: Page) => {
	await page.goto('/admin');
	await expect(page.getByRole('tab', { name: /Users/ })).toHaveAttribute('aria-selected', 'true');
};
const row = (page: Page, text: string) => page.getByRole('row').filter({ hasText: text });

test('the admin reaches Admin from the account menu and sees every user (scenarios 1, 2)', async ({ page, browser, browserName }) => {
	await allow(page.request, '@test.local');
	const other = `listed-${browserName}@test.local`;
	await (await as(browser, other)).goto('/');

	await page.goto('/');
	await page.getByRole('button', { name: 'Account' }).click();
	await page.getByRole('menuitem', { name: 'Admin' }).click();
	await expect(page).toHaveURL('/admin');
	await expect(page.getByRole('tab')).toHaveText([/Users/, /Projects/, /Settings/]);

	const me = row(page, USER);
	await expect(me).toContainText('Admin');
	await expect(me).toContainText('Active');
	await expect(row(page, other)).toContainText('User');
	await expect(row(page, other)).toContainText(/just now|second/);

	const search = page.getByRole('textbox', { name: 'Search users' });
	await search.fill(`LISTED-${browserName}`);
	await expect(page.getByRole('row')).toHaveCount(2); // header + the match
	await expect(row(page, other)).toBeVisible();
	await search.fill('nobody-matches-this');
	await expect(page.getByText('No users match.')).toBeVisible();
});

test('invite-only refuses an email until the admin allows its domain (scenarios 5, 6)', async ({ page, browser, browserName }) => {
	await signup(page.request, (s) => ({ signupMode: 'invite', allowlist: s.allowlist.filter((e) => e !== '@example.org') }));
	const email = `new-${browserName}@example.org`;
	const outsider = await as(browser, email);
	await outsider.goto('/');
	await expect(outsider).toHaveURL('/blocked?reason=not-allowed');
	await expect(outsider.getByRole('heading', { name: 'Your email isn’t allowed on this instance' })).toBeVisible();

	await page.goto('/admin');
	await page.getByRole('tab', { name: 'Settings' }).click();
	const group = page.getByRole('radiogroup', { name: 'Sign-up' });
	await expect(group.getByRole('radio', { name: /Invite only/ })).toBeChecked();
	const list = page.getByRole('textbox', { name: 'Allowed emails and domains' });

	// a bad entry is refused inline and nothing is saved
	await list.fill(`${await list.inputValue()}\nexample.org`);
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('alert')).toContainText('“example.org” isn’t an email');
	await outsider.goto('/');
	await expect(outsider).toHaveURL('/blocked?reason=not-allowed');

	await list.fill((await list.inputValue()).replace(/example\.org$/, ' @Example.org '));
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
	await expect(list).toHaveValue(/(^|\n)@example\.org$/);

	await outsider.goto('/');
	await expect(outsider).not.toHaveURL(/blocked/);
	expect((await (await outsider.request.get('/api/me')).json()).email).toBe(email);
	await outsider.context().close();

	// open sign-up lets anyone in; back to invite-only for the rest of the run
	await page.getByRole('radio', { name: /Open to anyone/ }).check();
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
	const anyone = await as(browser, `anyone-${browserName}@elsewhere.net`);
	await anyone.goto('/');
	await expect(anyone).not.toHaveURL(/blocked/);
	await anyone.context().close();
	await signup(page.request, (s) => ({ ...s, signupMode: 'invite' }));
});

test('promote and demote apply on the next request; the last admin is protected (scenario 3)', async ({ page, browser, browserName }) => {
	await allow(page.request, '@test.local');
	const email = `promo-${browserName}@test.local`;
	const other = await as(browser, email);
	await other.goto('/');
	const role = async () => (await (await other.request.get('/api/me')).json()).role;
	expect(await role()).toBe('user');

	await usersTab(page);
	const r = row(page, email);
	await r.getByRole('button', { name: 'Make admin' }).click();
	await expect(r.getByRole('button', { name: 'Remove admin' })).toBeVisible();
	expect(await role()).toBe('admin');
	// two admins: either may be removed
	await expect(row(page, USER).getByRole('button', { name: 'Remove admin' })).toBeEnabled();

	await r.getByRole('button', { name: 'Remove admin' }).click();
	await expect(r.getByRole('button', { name: 'Make admin' })).toBeVisible();
	expect(await role()).toBe('user');
	await other.context().close();

	// USER is the only admin now: its own demote and disable are off, and the API refuses them too
	const mine = row(page, USER);
	await expect(mine.getByRole('button', { name: 'Remove admin' })).toBeDisabled();
	await expect(mine.getByRole('button', { name: 'Disable' })).toBeDisabled();
	await expect(mine.locator('.actions [title]').first()).toHaveAttribute('title', 'The last admin can’t be removed or disabled.');
	const { id } = await (await page.request.get('/api/me')).json();
	const res = await page.request.patch(`/api/admin/users/${encodeURIComponent(id)}`, { data: { role: 'user' } });
	expect(res.status()).toBe(409);
});

test('disabling cuts an open editor within 2 s and blocks sign-in; enabling restores it (scenario 4)', async ({ page, browser, browserName }) => {
	await allow(page.request, '@test.local');
	const email = `cut-${browserName}@test.local`;
	const other = await as(browser, email);
	const pid = await newProject(other, 'Kept project');
	await other.goto(projectPath(pid));
	await expect(other.getByRole('status')).toHaveText('Saved');

	await usersTab(page);
	const r = row(page, email);
	const t = Date.now();
	await r.getByRole('button', { name: 'Disable' }).click();
	await expect(other).toHaveURL('/blocked?reason=disabled', { timeout: 2000 });
	expect(Date.now() - t).toBeLessThan(2000);
	await expect(other.getByRole('heading', { name: 'Your account is disabled' })).toBeVisible();
	await expect(r).toContainText('Disabled');

	// a new sign-in is blocked too
	await other.goto(projectPath(pid));
	await expect(other).toHaveURL('/blocked?reason=disabled');
	expect((await other.request.get('/api/me')).status()).toBe(403);

	await r.getByRole('button', { name: 'Enable' }).click();
	await expect(r).toContainText('Active');
	await signInAs(other.context(), email);
	await other.goto(projectPath(pid));
	await expect(other.getByRole('status')).toHaveText('Saved');
	await expect(other.locator('.cm-content')).toContainText('documentclass');
	await other.context().close();
});

test('Projects lists every project and deletes after confirming; admins cannot open them (scenario 7)', async ({ page, browser, browserName }) => {
	await allow(page.request, '@test.local');
	const owner = await as(browser, `owner-${browserName}@test.local`);
	const title = `Their thesis ${browserName} ${Date.now()}`;
	const pid = await newProject(owner, title);
	await owner.goto(projectPath(pid));
	await expect(owner.getByRole('status')).toHaveText('Saved');

	// no access without an invite, admin or not
	expect((await page.request.get(api(pid))).status()).toBe(404);

	await page.goto('/admin');
	await page.getByRole('tab', { name: /Projects/ }).click();
	const r = row(page, title);
	await expect(r).toContainText(`owner-${browserName}`);
	await expect(r.getByRole('link')).toHaveCount(0); // no "open" action

	await r.getByRole('button', { name: `Delete ${title}` }).click();
	const dialog = page.getByRole('dialog', { name: `Delete “${title}”?` });
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(r).toBeVisible();

	await r.getByRole('button', { name: `Delete ${title}` }).click();
	await dialog.getByRole('button', { name: 'Delete' }).click();
	await expect(r).toHaveCount(0);
	expect((await owner.request.get(api(pid))).status()).toBe(404);
	await owner.context().close();
});

test('a normal user gets Not found on /admin and 403 from the admin API (scenario 8)', async ({ page, browser, browserName }) => {
	await allow(page.request, '@test.local');
	const plain = await as(browser, `plain-${browserName}@test.local`);
	await plain.goto('/admin');
	await expect(plain.getByRole('heading', { name: 'Not found' })).toBeVisible();
	await expect(plain.getByRole('tab')).toHaveCount(0);
	for (const path of ['/api/admin/users', '/api/admin/projects', '/api/admin/settings']) expect((await plain.request.get(path)).status(), path).toBe(403);
	expect((await plain.request.put('/api/admin/settings', { data: { signupMode: 'open', allowlist: [] } })).status()).toBe(403);
	const { id } = await (await plain.request.get('/api/me')).json();
	expect((await plain.request.patch(`/api/admin/users/${encodeURIComponent(id)}`, { data: { role: 'admin' } })).status()).toBe(403);
	await plain.context().close();
});
