import { expect, test as plain, type Browser, type Page } from '@playwright/test';
import { zips } from '../fixtures/projects/zips.ts';
import { allow, newProject, openEditor, projectPath, signInAs, test, USER } from './helpers.ts';

// US2 "My projects dashboard" (scenarios 1–7, 9; scenario 8, the migrated project, is migration.test.ts). The
// server is shared by every test and browser of the run: titles carry a per-test tag and rows are found by it.

/** A signed-in page of `email` in a context of its own; the user exists once it has loaded a page. */
async function as(browser: Browser, email: string) {
	const ctx = await browser.newContext();
	await signInAs(ctx, email);
	const page = await ctx.newPage();
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
	return page;
}

/** The owner (`owner`'s request) invites `email`, who already has an account, as a collaborator. */
async function share(owner: Page, pid: string, email: string, role: 'editor' | 'reader') {
	const res = await owner.request.post(`/api/projects/${pid}/members`, { data: { email, role } });
	expect(res.status()).toBe(201);
	expect((await res.json()).status).toBe('member');
}

const tag = () => Math.random().toString(36).slice(2, 8);
const row = (page: Page, title: string) => page.getByRole('row').filter({ has: page.getByRole('link', { name: title, exact: true }) });
const actions = (page: Page, title: string) => page.getByRole('button', { name: `Actions for ${title}`, exact: true });

async function pick(page: Page, title: string, item: string) {
	await actions(page, title).click();
	await page.getByRole('menu', { name: `Actions for ${title}` }).getByRole('menuitem', { name: item }).click();
}

/** New project → `template` → title → Create; resolves once the editor of the new project has synced. */
async function create(page: Page, template: string, title: string) {
	await page.getByRole('button', { name: 'New project' }).first().click();
	await page.getByRole('menu', { name: 'New project' }).getByRole('menuitem', { name: template }).click();
	const dialog = page.getByRole('dialog', { name: 'New project' });
	await dialog.getByRole('textbox', { name: 'Project title' }).fill(title);
	await dialog.getByRole('button', { name: 'Create' }).click();
	await expect(page).toHaveURL(/\/project\/[0-9a-f-]{36}$/);
	await expect(page.getByRole('status')).toHaveText('Saved');
	await page.waitForFunction(() => window.__overtree?.provider.isSynced);
	return page.url().split('/').at(-1)!;
}

/** Recompile and expect a PDF with no errors in the log. */
async function compiles(page: Page, pid: string) {
	await page.getByRole('button', { name: 'Recompile' }).click();
	await expect(page.getByTestId('pdf-viewer').locator('.page canvas').first()).toBeVisible({ timeout: 20_000 });
	const { last: result } = await (await page.request.get(`/api/projects/${pid}/compile`)).json();
	expect(result.status, result.message).toBe('success');
	expect(result.entries.filter((e: { level: string }) => e.level === 'error')).toEqual([]);
}

plain('sign-in to an opened Report project in under a minute, then every template compiles (scenarios 1, 2, SC-001)', async ({ page }) => {
	plain.setTimeout(150_000);
	const t = tag();
	const start = Date.now();
	await page.goto('/sign-in');
	await page.getByLabel('Test email').fill(USER);
	await page.getByRole('button', { name: 'Test sign-in' }).click();
	await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
	const thesis = await create(page, 'Report', `Thesis ${t}`);
	expect(Date.now() - start).toBeLessThan(60_000);
	await expect(page.getByRole('button', { name: 'Rename project' })).toHaveText(`Thesis ${t}`);
	await compiles(page, thesis);
	await expect(page.getByTestId('pdf-viewer')).toContainText(`Thesis ${t}`);

	for (const template of ['Blank project', 'Article', 'Beamer presentation', 'Letter']) {
		await page.goto('/');
		const pid = await create(page, template, `${template} ${t}`);
		await compiles(page, pid);
	}

	// newest first, with owner, role and a relative time with the absolute one in its title
	await page.goto('/');
	const rows = page.getByRole('row').filter({ hasText: t });
	await expect(rows.getByRole('link')).toHaveText([`Letter ${t}`, `Beamer presentation ${t}`, `Article ${t}`, `Blank project ${t}`, `Thesis ${t}`]);
	await expect(rows.first()).toContainText('admin');
	await expect(rows.first()).toContainText('Owner');
	await expect(rows.first().getByRole('cell').nth(3)).toHaveText(/just now|second|minute/);
	await expect(rows.first().getByRole('cell').nth(3)).toHaveAttribute('title', /\d/);
});

test('the New project dialog checks the title and can be cancelled', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'New project' }).first().click();
	await page.getByRole('menuitem', { name: 'Article' }).click();
	const dialog = page.getByRole('dialog', { name: 'New project' });
	const create = dialog.getByRole('button', { name: 'Create' });
	await expect(create).toBeDisabled();
	await dialog.getByRole('textbox', { name: 'Project title' }).fill('   ');
	await expect(create).toBeDisabled();
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toBeHidden();
	await expect(page).toHaveURL('/');
});

test('Upload zip creates a project named after the zip and opens it (scenario 3)', async ({ page }) => {
	const name = `Uploaded ${tag()}`;
	await page.goto('/');
	await page.getByRole('button', { name: 'New project' }).first().click();
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('menuitem', { name: 'Upload zip' }).click();
	await (await chooser).setFiles({ name: `${name}.zip`, mimeType: 'application/zip', buffer: Buffer.from(zips.roundtrip()) });
	await expect(page).toHaveURL(/\/project\/[0-9a-f-]{36}$/);
	await expect(page.getByRole('button', { name: 'Rename project' })).toHaveText(name);
	await expect(page.getByRole('treeitem', { name: 'refs.bib', exact: true })).toBeVisible();
	await expect(page.getByRole('treeitem', { name: 'chapters', exact: true })).toBeVisible();
});

test('rename from the dashboard and from the top bar (scenario 4)', async ({ page, pid }) => {
	const t = tag();
	await page.request.patch(`/api/projects/${pid}`, { data: { title: `Draft ${t}` } });
	await page.goto('/');
	await pick(page, `Draft ${t}`, 'Rename');
	const input = page.getByRole('textbox', { name: `New title for Draft ${t}` });
	await expect(input).toBeFocused();
	await input.fill(`Paper ${t}`);
	await input.press('Escape'); // cancels
	await expect(row(page, `Draft ${t}`)).toBeVisible();
	await pick(page, `Draft ${t}`, 'Rename');
	await input.fill(`  Paper ${t}  `);
	await input.press('Enter');
	await expect(row(page, `Paper ${t}`)).toBeVisible();

	await openEditor(page, pid);
	const button = page.getByRole('button', { name: 'Rename project' });
	await expect(button).toHaveText(`Paper ${t}`);
	await button.click();
	const title = page.getByRole('textbox', { name: 'Project title' });
	await expect(title).toBeFocused();
	await title.fill('Not this');
	await title.press('Escape');
	await expect(button).toHaveText(`Paper ${t}`);
	await button.click();
	await title.fill('');
	await title.press('Enter');
	await expect(title).toHaveAttribute('aria-invalid', 'true'); // still editing
	await title.fill(`Final ${t}`);
	await title.press('Enter');
	await expect(button).toHaveText(`Final ${t}`);
	await expect(page).toHaveTitle(`Final ${t} · Overtree`);
	await page.reload();
	await expect(page.getByRole('button', { name: 'Rename project' })).toHaveText(`Final ${t}`);
	await page.goto('/');
	await expect(row(page, `Final ${t}`)).toBeVisible();
});

test('collaborators see the title but cannot rename; they can duplicate and leave (scenarios 4, 5, 6)', async ({ page, pid, browser, browserName }) => {
	const t = tag();
	await allow(page.request, '@test.local');
	const email = `dash-${browserName}-${t}@test.local`;
	const other = await as(browser, email);
	await page.request.patch(`/api/projects/${pid}`, { data: { title: `Shared ${t}` } });
	await share(page, pid, email, 'reader');

	await other.goto('/');
	const r = row(other, `Shared ${t}`);
	await expect(r).toContainText('admin');
	await expect(r).toContainText('Reader');
	await actions(other, `Shared ${t}`).click();
	await expect(other.getByRole('menu', { name: `Actions for Shared ${t}` }).getByRole('menuitem')).toHaveText(['Duplicate', 'Leave']);
	await other.keyboard.press('Escape');

	await other.goto(projectPath(pid));
	await expect(other.getByRole('banner')).toContainText(`Shared ${t}`);
	await expect(other.getByRole('button', { name: 'Rename project' })).toHaveCount(0);
	expect((await other.request.patch(`/api/projects/${pid}`, { data: { title: 'Mine' } })).status()).toBe(403);

	// the reader's copy is theirs, without collaborators
	await other.goto('/');
	await pick(other, `Shared ${t}`, 'Duplicate');
	await expect(row(other, `Copy of Shared ${t}`)).toContainText('Owner');
	await expect(row(other, `Copy of Shared ${t}`)).toContainText(`dash-${browserName}-${t}`);

	// leave, after confirming
	await pick(other, `Shared ${t}`, 'Leave');
	const confirm = other.getByRole('dialog', { name: `Leave “Shared ${t}”?` });
	await confirm.getByRole('button', { name: 'Leave' }).click();
	await expect(row(other, `Shared ${t}`)).toHaveCount(0);
	await expect(row(other, `Copy of Shared ${t}`)).toBeVisible();
	// the owner keeps the project
	await page.goto('/');
	await expect(row(page, `Shared ${t}`)).toBeVisible();
	await other.context().close();
});

test('duplicate, then delete the copy after a cancelled first try (scenarios 5, 6)', async ({ page, pid }) => {
	const t = tag();
	await page.request.patch(`/api/projects/${pid}`, { data: { title: `Original ${t}` } });
	await openEditor(page, pid);
	await page.evaluate(() => window.__overtree!.view.dispatch({ changes: { from: 0, insert: '% copied\n' } }));
	await page.waitForFunction(() => !window.__overtree!.provider.hasUnsyncedChanges);

	await page.goto('/');
	await pick(page, `Original ${t}`, 'Duplicate');
	const copy = `Copy of Original ${t}`;
	await expect(row(page, copy)).toContainText('Owner');
	await row(page, copy).getByRole('link').click();
	await expect(page.getByRole('status')).toHaveText('Saved');
	await expect(page.locator('.cm-content')).toContainText('% copied');

	await page.goto('/');
	await pick(page, copy, 'Delete');
	const dialog = page.getByRole('dialog', { name: `Delete “${copy}”?` });
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(row(page, copy)).toBeVisible();
	await pick(page, copy, 'Delete');
	await dialog.getByRole('button', { name: 'Delete' }).click();
	await expect(row(page, copy)).toHaveCount(0);
	await expect(row(page, `Original ${t}`)).toBeVisible();
	await page.reload();
	await expect(row(page, copy)).toHaveCount(0);
});

test('search filters by title, case-insensitively (scenario 7)', async ({ page, pid }) => {
	const t = tag();
	await page.request.patch(`/api/projects/${pid}`, { data: { title: `Thesis ${t}` } });
	await newProject(page, `Notes ${t}`);
	await page.goto('/');
	const search = page.getByRole('textbox', { name: 'Search projects' });
	await search.fill(`THES`);
	await expect(row(page, `Thesis ${t}`)).toBeVisible();
	await expect(row(page, `Notes ${t}`)).toHaveCount(0);
	await search.fill(t.toUpperCase());
	await expect(page.getByRole('row').filter({ hasText: t })).toHaveCount(2);
	await search.fill(`zz-nothing-${t}`);
	await expect(page.getByText(`No projects match “zz-nothing-${t}”.`)).toBeVisible();
	await search.fill('');
	await expect(row(page, `Notes ${t}`)).toBeVisible();
});

test('another user’s project URL shows the no-access page (scenario 9)', async ({ page, pid, browser, browserName }) => {
	await allow(page.request, '@test.local');
	const other = await as(browser, `outsider-${browserName}-${tag()}@test.local`);
	await page.request.patch(`/api/projects/${pid}`, { data: { title: 'Secret title' } });
	await other.goto(projectPath(pid));
	await expect(other.getByRole('heading', { name: /You don.t have access to this project/ })).toBeVisible();
	await expect(other.getByText('Secret title')).toHaveCount(0);
	await expect(other.getByRole('button', { name: 'Recompile' })).toHaveCount(0);
	await other.getByRole('link', { name: 'Back to dashboard' }).click();
	await expect(other).toHaveURL('/');
	await expect(other.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
	await other.context().close();
});

plain('a new user sees the empty state', async ({ browser, page, browserName }) => {
	await signInAs(page.context());
	await allow(page.request, '@test.local');
	const fresh = await as(browser, `empty-${browserName}-${tag()}@test.local`);
	await expect(fresh.getByRole('heading', { name: 'No projects yet' })).toBeVisible();
	await expect(fresh.getByRole('button', { name: 'New project' })).toBeVisible();
	await fresh.context().close();
});
