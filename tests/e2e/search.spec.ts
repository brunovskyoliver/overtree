import { expect, type Browser, type Page } from '@playwright/test';
import type { FileEntry } from '../../src/lib/files.ts';
import { allow, api, openEditor, projectPath, setDoc, signInAs, test, text, upload } from './helpers.ts';

// 014 project search and replace (spec.md US1–US3) with two browser contexts for the collaborative parts.

const tag = () => Math.random().toString(36).slice(2, 8);
const MAIN = 'Alpha beta.\n\\input{chapters/intro}\nalpha again\n';
const INTRO = 'Intro line one.\nThe needle is here, alpha too.\n';

async function as(browser: Browser, email: string) {
	const ctx = await browser.newContext();
	await signInAs(ctx, email);
	const page = await ctx.newPage();
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
	return page;
}

async function openAs(page: Page, pid: string) {
	await page.goto(projectPath(pid));
	await expect(page.getByRole('status')).toHaveText('Saved');
	await page.waitForFunction(() => window.__overtree?.provider.isSynced);
}

/** main.tex (open) plus chapters/intro.tex, never opened; returns intro's entry. */
async function multiFile(page: Page, pid: string): Promise<FileEntry> {
	const res = await page.request.post(`${api(pid)}/files`, { data: { kind: 'folder', name: 'chapters', parentId: null } });
	const chapters: FileEntry = await res.json();
	await openEditor(page, pid);
	const intro = await upload(page, 'intro.tex', Buffer.from(INTRO), chapters.id);
	await setDoc(page, MAIN);
	return intro;
}

const panel = (page: Page) => page.getByRole('region', { name: 'Search' });
const results = (page: Page) => panel(page).getByRole('list', { name: 'Search results' });
const fileGroup = (page: Page, path: string) => results(page).getByRole('listitem', { name: path, exact: true });

async function search(page: Page, query: string) {
	await page.keyboard.press('ControlOrMeta+Shift+F');
	const field = panel(page).getByRole('searchbox', { name: 'Search in project' });
	await expect(field).toBeFocused();
	await field.fill(query);
}

test.beforeEach(async ({ page }) => {
	await allow(page.request, '@test.local');
});

test('finds matches in a closed file; clicking opens it with the match selected; keyboard; invalid regex (US1)', async ({ page, pid }) => {
	await multiFile(page, pid);
	// the tree's search button opens the view too (US1 #1)
	await page.getByRole('button', { name: 'Search project' }).click();
	await expect(panel(page).getByRole('searchbox', { name: 'Search in project' })).toBeFocused();
	await panel(page).getByRole('button', { name: 'Close search' }).click();
	await expect(page.getByRole('tree', { name: 'File tree' })).toBeVisible();

	await search(page, 'needle');
	await expect(panel(page).getByRole('status').first()).toHaveText('1 match in 1 file');
	const group = fileGroup(page, 'chapters/intro.tex');
	await expect(group).toContainText('1');
	const hit = group.getByRole('button', { name: /line 2:/ });
	await expect(hit.locator('mark')).toHaveText('needle');

	// click: the closed file opens in a tab with the match selected (US1 #3)
	await hit.click();
	await expect(page.getByRole('tab', { name: /intro\.tex/ })).toHaveAttribute('aria-selected', 'true');
	await page.waitForFunction(() => {
		const { state } = window.__overtree!.view;
		return state.sliceDoc(state.selection.main.from, state.selection.main.to) === 'needle';
	});
	expect(await page.evaluate(() => window.__overtree!.view.state.selection.main.from)).toBe(INTRO.indexOf('needle'));

	// options: case, whole word (US1 #4); keyboard: ↓ from the field, Enter opens (US1 #5)
	await search(page, 'alpha');
	await expect(panel(page).getByRole('status').first()).toHaveText('3 matches in 2 files');
	await panel(page).getByRole('button', { name: 'Match case' }).click();
	await expect(panel(page).getByRole('status').first()).toHaveText('2 matches in 2 files');
	await panel(page).getByRole('searchbox', { name: 'Search in project' }).focus();
	await page.keyboard.press('ArrowDown');
	await expect(fileGroup(page, 'chapters/intro.tex').getByRole('button', { name: /line 2:/ })).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(fileGroup(page, 'main.tex').getByRole('button', { name: /line 3:/ })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.getByRole('tab', { name: /main\.tex/ })).toHaveAttribute('aria-selected', 'true');
	await page.waitForFunction((at) => window.__overtree!.view.state.selection.main.from === at, MAIN.lastIndexOf('alpha'));

	// the user's own typing refreshes the results after a pause (US1 #10)
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.type('alpha once more');
	await expect(panel(page).getByRole('status').first()).toHaveText('3 matches in 2 files');

	// invalid regex: an inline error, no results, the page keeps working (US1 #7)
	await search(page, 'alpha(');
	await panel(page).getByRole('button', { name: 'Regular expression' }).click();
	await expect(panel(page).getByRole('alert')).toBeVisible();
	await expect(results(page)).toHaveCount(0);
	await panel(page).getByRole('searchbox', { name: 'Search in project' }).press('End');
	await page.keyboard.type(')');
	await expect(panel(page).getByRole('alert')).toHaveCount(0);
	await expect(panel(page).getByRole('status').first()).toHaveText('3 matches in 2 files');

	// Escape goes back to the file tree
	await page.keyboard.press('Escape');
	await expect(page.getByRole('button', { name: 'Search project' })).toBeFocused();
});

test('replace one, replace in a file, replace all across files: live for a collaborator (US2)', async ({ browser, page, pid }) => {
	const b = `search-${tag()}@test.local`;
	const bob = await as(browser, b);
	expect((await page.request.post(`${api(pid)}/members`, { data: { email: b, role: 'editor' } })).status()).toBe(201);
	await multiFile(page, pid);
	await openAs(bob, pid); // B has main.tex open

	// one match (US2 #1)
	await search(page, 'alpha');
	await expect(panel(page).getByRole('status').first()).toHaveText('3 matches in 2 files');
	await panel(page).getByRole('textbox', { name: 'Replace with' }).fill('gamma');
	await fileGroup(page, 'main.tex').getByRole('button', { name: 'Replace match on line 3 of main.tex' }).click();
	await expect(panel(page).getByText('Replaced 1 match.')).toBeVisible();
	await bob.waitForFunction((t) => window.__overtree!.view.state.doc.toString() === t, MAIN.replace('alpha again', 'gamma again'));
	await expect(panel(page).getByRole('status').first()).toHaveText('2 matches in 2 files');

	// all in one file (US2 #2)
	await fileGroup(page, 'main.tex').getByRole('button', { name: 'Replace all in main.tex' }).click();
	await bob.waitForFunction(() => window.__overtree!.view.state.doc.toString().startsWith('gamma beta.'));
	await expect(panel(page).getByRole('status').first()).toHaveText('1 match in 1 file');

	// all in the project, after a confirm with the counts (US2 #3, #4)
	await search(page, 'gamma');
	await panel(page).getByRole('textbox', { name: 'Replace with' }).fill('omega');
	await panel(page).getByRole('button', { name: 'Replace all', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Replace in all files?' });
	await expect(dialog).toContainText('Replace 2 matches in 1 file with “omega”.');
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	expect(await text(page)).toContain('gamma');
	await search(page, 'gamma|alpha');
	await panel(page).getByRole('button', { name: 'Regular expression' }).click();
	await expect(panel(page).getByRole('status').first()).toHaveText('3 matches in 2 files');
	await panel(page).getByRole('button', { name: 'Replace all', exact: true }).click();
	await expect(dialog).toContainText('Replace 3 matches in 2 files with “omega”.');
	await dialog.getByRole('button', { name: 'Replace all', exact: true }).click();
	await expect(panel(page).getByText('Replaced 3 matches in 2 files.')).toBeVisible();
	await expect(panel(page).getByRole('status').first()).toHaveText('No matches');

	// the collaborator sees both files changed, including the one they didn't have open
	const omegaMain = 'omega beta.\n\\input{chapters/intro}\nomega again\n';
	await bob.waitForFunction((t) => window.__overtree!.view.state.doc.toString() === t, omegaMain);
	await bob.getByRole('tree', { name: 'File tree' }).getByRole('treeitem', { name: 'chapters' }).click();
	await bob.getByRole('tree', { name: 'File tree' }).getByRole('treeitem', { name: 'intro.tex' }).click();
	await bob.waitForFunction((t) => window.__overtree!.view.state.doc.toString() === t, INTRO.replace('alpha', 'omega'));
	await bob.context().close();
});

test('readers see results but cannot replace; a per-file Reader override disables only that file (US3)', async ({ browser, page, pid }) => {
	const r = `reader-${tag()}@test.local`;
	const e = `limited-${tag()}@test.local`;
	const reader = await as(browser, r);
	const limited = await as(browser, e);
	expect((await page.request.post(`${api(pid)}/members`, { data: { email: r, role: 'reader' } })).status()).toBe(201);
	expect((await page.request.post(`${api(pid)}/members`, { data: { email: e, role: 'editor' } })).status()).toBe(201);
	const intro = await multiFile(page, pid);
	const members = await (await page.request.get(`${api(pid)}/members`)).json();
	const limitedId = members.members.find((m: { user: { email: string } }) => m.user.email === e).user.id;
	expect((await page.request.put(`${api(pid)}/overrides`, { data: { userId: limitedId, fileId: intro.id, role: 'reader' } })).status()).toBe(200);

	// project reader: everything read-only, with the reason (US3 #1, #2)
	await openAs(reader, pid);
	await search(reader, 'alpha');
	await expect(panel(reader).getByRole('status').first()).toHaveText('3 matches in 2 files');
	for (const path of ['main.tex', 'chapters/intro.tex']) {
		await expect(fileGroup(reader, path).getByText('read only')).toBeVisible();
		await expect(fileGroup(reader, path).getByRole('button', { name: `Replace all in ${path}` })).toBeDisabled();
	}
	await expect(panel(reader).getByRole('button', { name: 'Replace all', exact: true })).toBeDisabled();
	await expect(panel(reader).getByRole('button', { name: 'Replace all', exact: true })).toHaveAttribute('title', /Read only/);
	// the server refuses too
	const refused = await reader.request.post(`${api(pid)}/search/replace`, { data: { q: 'alpha', replacement: 'x', fileId: intro.id } });
	expect(refused.status()).toBe(403);

	// editor with a Reader override on intro.tex: main.tex replaceable, intro.tex not (US3 #3)
	await openAs(limited, pid);
	await search(limited, 'alpha');
	await expect(fileGroup(limited, 'chapters/intro.tex').getByText('read only')).toBeVisible();
	await expect(fileGroup(limited, 'main.tex').getByText('read only')).toHaveCount(0);
	await panel(limited).getByRole('textbox', { name: 'Replace with' }).fill('beta');
	await panel(limited).getByRole('button', { name: 'Replace all', exact: true }).click();
	const dialog = limited.getByRole('dialog', { name: 'Replace in all files?' });
	await expect(dialog).toContainText('1 match in 1 read-only file won’t change.');
	await dialog.getByRole('button', { name: 'Replace all', exact: true }).click();
	await expect(panel(limited).getByText('Replaced 2 matches in 1 file. Skipped 1 match in read-only files.')).toBeVisible();
	await expect(panel(limited).getByRole('status').first()).toHaveText('1 match in 1 file');
	await page.waitForFunction(() => window.__overtree!.view.state.doc.toString() === 'beta beta.\n\\input{chapters/intro}\nbeta again\n');
	await reader.context().close();
	await limited.context().close();
});
