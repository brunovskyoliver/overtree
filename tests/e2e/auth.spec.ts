import { join } from 'node:path';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { expect, test as plain, type Browser } from '@playwright/test';
import Database from 'better-sqlite3';
import * as Y from 'yjs';
import { api, newProject, openEditor, projectPath, signInAs, test, USER } from './helpers.ts';

// US1 "Sign in and stay signed in" with the test bypass (research R4); the real Clerk flow is clerk.smoke.spec.ts.

/** The e2e server's database (playwright.config.ts DATA_DIR): for state there is no UI for yet (US3 link sharing,
 *  US5 allowlist). */
function sql(statement: string, ...params: unknown[]) {
	const db = new Database(join(process.env.OVERTREE_E2E_DATA_DIR!, 'overtree.db'));
	try {
		db.pragma('busy_timeout = 5000');
		db.prepare(statement).run(...params);
	} finally {
		db.close();
	}
}

/** A project of USER's, made from a signed-in context of its own. */
async function projectOfUser(browser: Browser, title = 'Untitled project') {
	const ctx = await browser.newContext();
	await signInAs(ctx);
	const page = await ctx.newPage();
	const id = await newProject(page, title);
	await ctx.close();
	return id;
}

plain('signed out: any page goes to sign-in, and signing in returns to the requested page (scenario 1)', async ({ browser, page }) => {
	const pid = await projectOfUser(browser);
	for (const path of ['/', '/admin', projectPath(pid)]) {
		await page.goto(path);
		await expect(page).toHaveURL((u) => u.pathname === '/sign-in' && u.searchParams.get('redirect') === path);
		await expect(page.getByRole('heading', { name: 'Overtree' })).toBeVisible();
	}
	await page.getByLabel('Test email').fill(USER);
	await page.getByRole('button', { name: 'Test sign-in' }).click();
	await expect(page).toHaveURL(projectPath(pid));
	await expect(page.getByRole('status')).toHaveText('Saved');
});

plain('a redirect to another site is ignored', async ({ page }) => {
	await page.goto('/sign-in?redirect=//example.com/x');
	await page.getByLabel('Test email').fill(USER);
	await page.getByRole('button', { name: 'Test sign-in' }).click();
	await expect(page).toHaveURL((u) => u.host === '127.0.0.1:4173' && !u.pathname.startsWith('/sign-in'));
});

test('account menu shows the user, reload keeps the session (scenarios 2, 3)', async ({ page }) => {
	await openEditor(page);
	const account = page.getByRole('button', { name: 'Account' });
	// the name falls back to the email's local part; no avatar image: the initial
	await expect(account).toHaveText('A');
	await account.click();
	const menu = page.getByRole('menu', { name: 'Account' });
	await expect(menu).toContainText('admin');
	await expect(menu).toContainText(USER);
	await expect(menu.getByRole('menuitem')).toHaveText(['Dashboard', 'Admin', 'Sign out']);
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();

	await page.reload();
	await openEditor(page);
	await expect(account).toHaveText('A');
	const me = await (await page.request.get('/api/me')).json();
	expect(me).toMatchObject({ email: USER, name: 'admin', role: 'admin', avatarUrl: null });
	expect(me.color).toMatch(/^#[0-9a-f]{6}$/);
});

test('a non-admin sees no Admin item', async ({ browser }) => {
	sql(`UPDATE settings SET allowlist = '["@test.local"]' WHERE id = 1`);
	const ctx = await browser.newContext();
	await signInAs(ctx, 'plain@test.local');
	const page = await ctx.newPage();
	const pid = await newProject(page);
	await page.goto(projectPath(pid));
	await page.getByRole('button', { name: 'Account' }).click();
	await expect(page.getByRole('menu', { name: 'Account' }).getByRole('menuitem')).toHaveText(['Dashboard', 'Sign out']);
	await ctx.close();
});

test('sign out ends the session and disconnects the editor (scenario 4)', async ({ page, pid }) => {
	// count sockets opened and closed by the app in sessionStorage, which survives the navigation to /sign-in
	await page.addInitScript(() => {
		const bump = (k: string) => sessionStorage.setItem(k, String(Number(sessionStorage.getItem(k) ?? 0) + 1));
		window.WebSocket = class extends WebSocket {
			constructor(...args: ConstructorParameters<typeof WebSocket>) {
				super(...args);
				bump('opened');
			}
			close(...args: Parameters<WebSocket['close']>) {
				if (this.readyState < WebSocket.CLOSING) bump('closed');
				super.close(...args);
			}
		};
	});
	await openEditor(page);
	const counts = () => page.evaluate(() => [sessionStorage.getItem('opened'), sessionStorage.getItem('closed')]);
	const [opened] = await counts();
	expect(Number(opened)).toBeGreaterThan(0);

	await page.getByRole('button', { name: 'Account' }).click();
	await page.getByRole('menuitem', { name: 'Sign out' }).click();
	await expect(page).toHaveURL(/\/sign-in$/);
	// every socket the editor opened was closed by the app before the page went away
	expect(await counts()).toEqual([opened, opened]);
	expect((await page.request.get(`/api/projects/${pid}`)).status()).toBe(401);
	await page.goto(projectPath(pid));
	await expect(page).toHaveURL(/\/sign-in\?redirect=/);
});

test('without a session the API and the live connection refuse (scenario 5)', async ({ page, pid, playwright }) => {
	const { mainFileId } = await (await page.request.get(api(pid))).json();
	const anon = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:4173' });
	for (const path of ['/api/me', '/api/projects', api(pid), `${api(pid)}/files`, `${api(pid)}/files/${mainFileId}/raw`, `${api(pid)}/zip`, `${api(pid)}/compile/output.pdf`]) {
		const res = await anon.get(path);
		expect(res.status(), path).toBe(401);
		expect(await res.text()).not.toContain('documentclass');
	}
	expect((await anon.post(`${api(pid)}/compile`, { headers: { origin: 'http://127.0.0.1:4173' } })).status()).toBe(401);
	await anon.dispose();

	// a raw provider without a token, and one of a user without access
	for (const token of [null, 'test:stranger@test.local']) {
		const doc = new Y.Doc();
		const provider = new HocuspocusProvider({ url: 'ws://127.0.0.1:4173/collab', name: mainFileId, document: doc, token });
		const outcome = await new Promise<string>((resolve) => {
			provider.on('authenticationFailed', () => resolve('authenticationFailed'));
			provider.on('synced', () => resolve('synced'));
			setTimeout(() => resolve('timeout'), 5000);
		});
		provider.destroy();
		expect(outcome, String(token)).toBe('authenticationFailed');
		expect(doc.getText('content').toString()).toBe('');
	}
});

test('share link landing page: title only signed out, joins signed in, bad links say so (scenario 6)', async ({ browser, pid }) => {
	sql(`UPDATE projects SET title = 'Shared thesis', link_token = ?, link_role = 'reader' WHERE id = ?`, `tok-${pid}`, pid);
	sql(`UPDATE settings SET allowlist = '["@test.local"]' WHERE id = 1`);

	const out = await browser.newContext();
	const page = await out.newPage();
	await page.goto(`/share/tok-${pid}`);
	await expect(page.getByRole('heading', { name: 'Shared thesis' })).toBeVisible();
	await expect(page.getByText('Sign in to open this project')).toBeVisible();
	await expect(page.locator('body')).not.toContainText('documentclass');
	await expect(page.locator('.cm-content')).toHaveCount(0);
	await page.getByRole('link', { name: 'Sign in' }).click();
	await expect(page).toHaveURL(`/sign-in?redirect=${encodeURIComponent(`/share/tok-${pid}`)}`);
	await page.getByLabel('Test email').fill('reader@test.local');
	await page.getByRole('button', { name: 'Test sign-in' }).click();
	await expect(page).toHaveURL(projectPath(pid));
	expect((await (await page.request.get(api(pid))).json()).role).toBe('reader');

	await page.goto('/share/not-a-token');
	await expect(page.getByRole('heading', { name: 'This link is no longer valid' })).toBeVisible();
	await out.close();
});

plain('blocked page names the reason and signs out', async ({ page, context }) => {
	await signInAs(context, 'outsider@example.com');
	await page.goto('/');
	await expect(page).toHaveURL('/blocked?reason=not-allowed');
	await expect(page.getByRole('heading', { name: 'Your email isn’t allowed on this instance' })).toBeVisible();
	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page).toHaveURL('/sign-in');
	await page.goto('/blocked?reason=disabled');
	await expect(page.getByRole('heading', { name: 'Your account is disabled' })).toBeVisible();
});
