import { expect } from '@playwright/test';
import { openEditor, test, text, USER } from './helpers.ts';

// 012 GitHub sync against the fake GitHub (playwright.config.ts: user `octo` with `octo/thesis` and `octo/paper`).

test('the owner connects GitHub and links a repository from the dialog (US1)', async ({ page, pid }) => {
	await openEditor(page);
	await page.getByRole('button', { name: 'GitHub', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'GitHub sync' });
	await expect(dialog.getByText(`You stay signed in to Overtree as ${USER}.`)).toBeVisible();

	// OAuth round trip through the fake; back on the project the dialog opens again and the flag leaves the URL
	await dialog.getByRole('link', { name: 'Connect GitHub' }).click();
	await expect(page).toHaveURL(new RegExp(`/project/${pid}$`));
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText('@octo')).toBeVisible();

	await dialog.getByRole('searchbox', { name: 'Search repositories' }).fill('pap');
	await expect(dialog.getByRole('radio', { name: /octo\/thesis/ })).toHaveCount(0);
	await dialog.getByRole('radio', { name: /octo\/paper/ }).check();
	await expect(dialog.getByRole('combobox', { name: 'Branch' })).toHaveValue('main');
	await dialog.getByRole('button', { name: 'Link repository' }).click();

	await expect(dialog.getByText('Nothing has synced yet.')).toBeVisible();
	await dialog.getByRole('button', { name: 'Sync now' }).click();
	await expect(dialog.getByRole('button', { name: 'Unlink' })).toBeVisible();
	await expect(dialog.getByRole('textbox', { name: 'Not pulled from GitHub' })).toHaveValue(/\.github\/\*\*/);
	const status = await (await page.request.get(`/api/projects/${pid}/github`)).json();
	expect(status.link).toMatchObject({ repo: 'octo/paper', branch: 'main' });
	expect(status.link.state).not.toBe('pending');

	// unlink after confirming; the picker comes back
	await dialog.getByRole('button', { name: 'Unlink' }).click();
	const confirm = page.getByRole('dialog', { name: 'Unlink octo/paper?' });
	await expect(confirm.getByText('Nothing on GitHub or in this project is deleted.')).toBeVisible();
	await confirm.getByRole('button', { name: 'Unlink' }).click();
	await expect(dialog.getByRole('button', { name: 'Link repository' })).toBeVisible();
	expect((await (await page.request.get(`/api/projects/${pid}/github`)).json()).link).toBeNull();
});

test('a GitHub commit reaches two open editors and history shows "Merged from GitHub" (US3)', async ({ page, pid, browser }) => {
	const FAKE = 'http://127.0.0.1:4175';
	const fake = async (helper: string, ...args: unknown[]) => (await page.request.post(`${FAKE}/_fake/${helper}`, { data: { args } })).json();

	// connected through the fake's OAuth (redirects end on the project), a fresh repository linked and confirmed
	await page.goto(`/api/github/connect?return=${encodeURIComponent(`/project/${pid}`)}`);
	await expect(page).toHaveURL(new RegExp(`/project/${pid}$`));
	const repos = await (await page.request.get('/api/github/repos')).json();
	const installationId = repos.accounts.find((a: { login: string }) => a.login === 'octo').installationId;
	const name = `pull-${Date.now()}`;
	const { id: repoId } = await fake('addRepo', { name, installation: installationId, files: { 'README.md': '# Pull\n' } });
	expect((await page.request.put(`/api/projects/${pid}/github`, { data: { installationId, repoId, branch: 'main' } })).status()).toBe(200);
	expect((await page.request.post(`/api/projects/${pid}/github/confirm`, { data: { mode: 'merge' } })).status()).toBe(200);
	const onGitHub = await fake('head', `octo/${name}`, 'main');
	expect(onGitHub).toBeTruthy();

	await openEditor(page);
	const other = await browser.newContext();
	const second = await other.newPage();
	await openEditor(second, pid);

	const seed = await text(page);
	const changed = seed.replace('\\section{Introduction}', '\\section{Introduction from GitHub}');
	expect(changed).not.toBe(seed);
	await fake('commitFiles', `octo/${name}`, 'main', { 'main.tex': changed }, { name: 'Octo Cat', email: 'octo@example.com' }, 'Rename the introduction');

	// within the pull interval (1.5 s in the test server) both editors have it, no reload
	for (const p of [page, second]) await expect.poll(() => text(p), { timeout: 10_000 }).toBe(changed);
	await expect(page.getByRole('treeitem', { name: 'README.md' })).toBeVisible();

	await page.getByRole('button', { name: 'History' }).click();
	const view = page.getByRole('region', { name: 'History' });
	await expect(view.getByRole('option').filter({ hasText: 'Merged from GitHub' }).first()).toBeVisible();
	await expect(view.getByText('Rename the introduction')).toBeVisible();
	await other.close();
});
