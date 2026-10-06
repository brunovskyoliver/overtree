import { createClerkClient } from '@clerk/backend';
import { clerk } from '@clerk/testing/playwright';
import { expect, test, type Page } from '@playwright/test';

// Smoke set against the real Clerk dev instance (research R4): the `clerk` project in playwright.config.ts, its
// own server without the test bypass. Clerk test emails (`+clerk_test`) take the verification code 424242.

const keys = !!(process.env.CLERK_SECRET_KEY && process.env.PUBLIC_CLERK_PUBLISHABLE_KEY);
test.skip(!keys, 'needs CLERK_SECRET_KEY and PUBLIC_CLERK_PUBLISHABLE_KEY');
test.describe.configure({ mode: 'serial' });

const email = `e2e+clerk_test_${Date.now()}@example.com`;

test.afterAll(async () => {
	if (!keys) return;
	const backend = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
	const { data } = await backend.users.getUserList({ emailAddress: [email] });
	for (const u of data) await backend.users.deleteUser(u.id);
});

/** setupClerkTestingToken, plus the captcha bypass on error responses: @clerk/testing marks `client` and `response`
 *  as captcha-bypassed, but the sign-in-or-up flow's 422 carries the client in `meta.client`, and clerk-js then shows
 *  Cloudflare's "Verify you are human" on the sign-up step. */
async function bypassBotProtection(page: Page) {
	const fapi = process.env.CLERK_FAPI!;
	await page.context().route(new RegExp(`^https://${fapi.replace(/[.]/g, '\\.')}/v1/`), async (route) => {
		const url = new URL(route.request().url());
		url.searchParams.set('__clerk_testing_token', process.env.CLERK_TESTING_TOKEN!);
		const res = await route.fetch({ url: url.href, maxRedirects: 0 });
		if (!res.headers()['content-type']?.includes('json')) return route.fulfill({ response: res });
		const body = await res.json();
		for (const c of [body?.client, body?.response, body?.meta?.client]) if (c && 'captcha_bypass' in c) c.captcha_bypass = true;
		await route.fulfill({ response: res, json: body });
	});
}

test('sign up with an email code on /sign-in lands on the dashboard', async ({ page }) => {
	await bypassBotProtection(page);
	await page.goto('/');
	await expect(page).toHaveURL(/\/sign-in\?redirect=%2F$/);
	await page.getByLabel('Email address').fill(email);
	// typing the code before Clerk has sent it gets "You need to send a verification code before attempting to verify"
	const sent = page.waitForResponse((r) => r.url().includes('/prepare_verification') && r.ok());
	await page.getByRole('button', { name: 'Continue', exact: true }).click();
	// sign-in-or-up: an unknown email continues to sign-up; a password field shows when the instance requires one
	const password = page.getByLabel('Password', { exact: true });
	const code = page.getByRole('textbox', { name: /code|digit/i }).first();
	await expect(password.or(code)).toBeVisible();
	if (await password.isVisible()) {
		await password.fill(`Overtree-${Date.now()}-pw!`);
		await page.getByRole('button', { name: 'Continue', exact: true }).click();
	}
	await sent;
	await code.click();
	await page.keyboard.type('424242');
	await expect(page).not.toHaveURL(/\/sign-in/, { timeout: 15_000 });
	const me = await (await page.request.get('/api/me')).json();
	expect(me.email).toBe(email);
});

test('clerk.signIn → the editor syncs over the token path; sign out → /sign-in', async ({ page }) => {
	await page.goto('/sign-in');
	await clerk.signIn({ page, emailAddress: email });
	const res = await page.request.post('/api/projects', { data: { title: 'Clerk smoke' } });
	expect(res.status()).toBe(201);
	const { id } = await res.json();
	await page.goto(`/project/${id}`);
	await expect(page.getByRole('status')).toHaveText('Saved');
	await page.waitForFunction(() => window.__overtree?.provider.isSynced);
	await expect(page.locator('.cm-content')).toContainText('documentclass');

	await page.getByRole('button', { name: 'Account' }).click();
	await page.getByRole('menuitem', { name: 'Sign out' }).click();
	await expect(page).toHaveURL(/\/sign-in$/);
	expect((await page.request.get('/api/me')).status()).toBe(401);
});
