import { expect } from '@playwright/test';
import { openEditor, test, USER } from './helpers.ts';

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
