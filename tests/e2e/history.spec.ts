import { readFileSync } from 'node:fs';
import { expect, type Browser, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import type { HistoryPage } from '../../src/lib/history-types.ts';
import { colorFor, lightColor } from '../../src/lib/presence.ts';
import { allow, api, openEditor, projectPath, signInAs, test, text, USER } from './helpers.ts';

// US1 "Browse history and compare" (quickstart scenarios 1–2). The test server closes versions after 1.5 s idle
// (playwright.config.ts), so each burst of typing becomes its own version within a few seconds.

const tag = () => Math.random().toString(36).slice(2, 8);
const idOf = (email: string) => `test_${email}`;

async function as(browser: Browser, email: string) {
	const ctx = await browser.newContext();
	await signInAs(ctx, email);
	return ctx.newPage();
}

/** The editor as the context's own user (openEditor signs in as USER). */
async function openAs(page: Page, pid: string) {
	await page.goto(projectPath(pid));
	await expect(page.getByRole('status')).toHaveText('Saved');
	await page.waitForFunction(() => window.__overtree?.provider.isSynced);
}

/** Insert `text` at the start or end of the open document and wait until the server has it. */
async function insert(page: Page, where: 'start' | 'end', text: string) {
	await page.evaluate(
		([where, text]) => {
			const { view } = window.__overtree!;
			view.dispatch({ changes: { from: where === 'start' ? 0 : view.state.doc.length, insert: text } });
		},
		[where, text]
	);
	await page.waitForFunction(() => !window.__overtree!.provider.hasUnsyncedChanges);
}

const history = async (page: Page, pid: string): Promise<HistoryPage> => (await page.request.get(`${api(pid)}/history`)).json();

/** Waits until the newest version is by `email` and there are `count` versions. */
async function versionBy(page: Page, pid: string, email: string, count: number) {
	await expect
		.poll(async () => {
			const { versions } = await history(page, pid);
			return versions.length === count && versions[0].authors.some((a) => a.id === idOf(email));
		})
		.toBe(true);
}

const rgba = (hex: string) => {
	const [r, g, b, a] = [1, 3, 5, 7].map((i) => parseInt(lightColor(hex).slice(i, i + 2), 16));
	return `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 100) / 100})`;
};

test.beforeEach(async ({ page }) => {
	await allow(page.request, '@test.local');
});

test('a reader sees both authors’ versions and their colored changes, vs current and vs previous (scenario 1)', async ({ browser, page, pid }) => {
	const bobEmail = `bob-${tag()}@test.local`;
	const readerEmail = `reader-${tag()}@test.local`;
	const bob = await as(browser, bobEmail);
	const reader = await as(browser, readerEmail);
	await bob.goto('/');
	await reader.goto('/');
	expect((await page.request.post(`${api(pid)}/members`, { data: { email: bobEmail, role: 'editor' } })).status()).toBe(201);
	expect((await page.request.post(`${api(pid)}/members`, { data: { email: readerEmail, role: 'reader' } })).status()).toBe(201);

	await openEditor(page, pid);
	await insert(page, 'start', '% alice was here\n');
	await versionBy(page, pid, USER, 2);
	await openAs(bob, pid);
	await insert(bob, 'end', '% bob was here\n');
	await versionBy(page, pid, bobEmail, 3);

	await reader.goto(projectPath(pid));
	const toggle = reader.getByRole('button', { name: 'History' });
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');
	const view = reader.getByRole('region', { name: 'History' });
	const options = view.getByRole('listbox', { name: 'Versions' }).getByRole('option');
	await expect(options).toHaveCount(3);
	await expect(options.nth(0)).toContainText(`By ${bobEmail.split('@')[0]}`);
	await expect(options.nth(0)).toContainText('main.tex');
	await expect(options.nth(1)).toContainText('By admin');
	await expect(options.nth(2)).toContainText('Start of history');
	await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');

	// Alice's version against the current state: Bob's insertion, in Bob's color
	await options.nth(1).click();
	await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
	const diff = view.getByRole('region', { name: 'Diff' });
	await expect(view.getByRole('navigation', { name: 'Changed files' }).getByRole('button', { name: /main\.tex/ })).toBeVisible();
	const bobs = diff.locator(`ins[data-user="${idOf(bobEmail)}"]`);
	await expect(bobs).toHaveText('% bob was here\n');
	await expect(bobs).toHaveCSS('background-color', rgba(colorFor(idOf(bobEmail))));
	await expect(diff.locator(`ins[data-user="${idOf(USER)}"]`)).toHaveCount(0);
	await expect(diff.getByRole('list', { name: 'Authors' })).toContainText(bobEmail.split('@')[0]);

	// the changes in that version: Alice's line only
	const own = diff.getByRole('button', { name: 'Changes in this version' });
	await own.click();
	await expect(own).toHaveAttribute('aria-pressed', 'true');
	await expect(diff.locator(`ins[data-user="${idOf(USER)}"]`)).toHaveText('% alice was here\n');
	await expect(bobs).toHaveCount(0);

	// keyboard: ↑ moves to the newer version, Escape leaves history with the editor still there
	await view.getByRole('listbox', { name: 'Versions' }).focus();
	await reader.keyboard.press('ArrowUp');
	await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
	await expect(diff.locator(`ins[data-user="${idOf(bobEmail)}"]`)).toHaveText('% bob was here\n');
	await reader.keyboard.press('Escape');
	await expect(view).toBeHidden();
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	await expect(reader.locator('.cm-content')).toContainText('% bob was here');

	await bob.context().close();
	await reader.context().close();
});

test('a compile closes a compile-point version; compiling again without edits adds none (scenario 2)', async ({ page, pid }) => {
	await openEditor(page, pid);
	const recompile = page.getByRole('button', { name: 'Recompile' });
	await insert(page, 'end', '% before compiling\n');
	await recompile.click(); // well inside the 1.5 s idle time: the compile closes the version
	await expect(recompile).toBeEnabled({ timeout: 15_000 });
	const first = await history(page, pid);
	expect(first.versions.map((v) => v.kind)).toEqual(['compile', 'baseline']);

	await page.getByRole('button', { name: 'History' }).click();
	const options = page.getByRole('listbox', { name: 'Versions' }).getByRole('option');
	await expect(options).toHaveCount(2);
	await expect(options.nth(0).getByRole('img', { name: 'Compiled' })).toBeVisible();

	// the editor kept its connection while hidden: a compile from the API adds nothing new
	expect((await page.request.post(`${api(pid)}/compile`, { data: { stopOnFirstError: false } })).status()).toBe(200);
	expect((await history(page, pid)).versions).toHaveLength(2);
	await expect(options).toHaveCount(2);

	// a new edit while the panel is open shows up live once it closes
	await page.getByRole('button', { name: 'History' }).click();
	await insert(page, 'end', '% later\n');
	await page.getByRole('button', { name: 'History' }).click();
	await expect(options).toHaveCount(3, { timeout: 10_000 });
	await expect(options.nth(0)).not.toContainText('Compiled');
});

test('labels: an editor names versions, they survive a reload, a reader gets no menu, labels only filters (scenario 8)', async ({
	browser,
	page,
	pid
}) => {
	const readerEmail = `reader-${tag()}@test.local`;
	const reader = await as(browser, readerEmail);
	await reader.goto('/');
	expect((await page.request.post(`${api(pid)}/members`, { data: { email: readerEmail, role: 'reader' } })).status()).toBe(201);

	await openEditor(page, pid);
	await insert(page, 'end', '% before labeling\n');
	await page.getByRole('button', { name: 'History' }).click();
	const view = page.getByRole('region', { name: 'History' });
	const options = view.getByRole('listbox', { name: 'Versions' }).getByRole('option');

	// the current state: the open edit becomes a version and gets the label
	await view.getByRole('button', { name: 'Label current version' }).click();
	const dialog = page.getByRole('dialog', { name: 'Label the current version' });
	await dialog.getByLabel('Label').fill('  Draft A  ');
	await dialog.getByRole('button', { name: 'Add label' }).click();
	await expect(dialog).toBeHidden();
	await expect(options).toHaveCount(2);
	await expect(options.nth(0).getByRole('button', { name: 'Label Draft A' })).toBeVisible();

	// the selected version from the diff header
	await options.nth(1).click();
	await view.getByRole('region', { name: 'Diff' }).getByRole('button', { name: 'Label…' }).click();
	const named = page.getByRole('dialog', { name: /^Label the version of/ });
	await named.getByLabel('Label').fill('Start');
	await named.getByRole('button', { name: 'Add label' }).click();
	await expect(options.nth(1).getByRole('button', { name: 'Label Start' })).toBeVisible();

	// rename and delete through the chip's menu
	await options.nth(1).getByRole('button', { name: 'Label Start' }).click();
	await page.getByRole('menuitem', { name: 'Rename…' }).click();
	const rename = page.getByRole('dialog', { name: 'Rename label' });
	await expect(rename.getByLabel('Label')).toHaveValue('Start');
	await rename.getByLabel('Label').fill('First draft');
	await rename.getByRole('button', { name: 'Rename' }).click();
	await expect(options.nth(1).getByRole('button', { name: 'Label First draft' })).toBeVisible();

	// a new edit is no labeled version: labels only hides it
	await page.getByRole('button', { name: 'History' }).click();
	await insert(page, 'end', '% unlabeled\n');
	await page.reload();
	await page.getByRole('button', { name: 'History' }).click();
	await expect(options).toHaveCount(3, { timeout: 10_000 });
	await expect(options.nth(1).getByRole('button', { name: 'Label Draft A' })).toBeVisible();
	await view.getByRole('checkbox', { name: 'Labels only' }).check();
	await expect(options).toHaveCount(2);
	await expect(options.nth(0)).toContainText('Draft A');
	await expect(options.nth(1)).toContainText('First draft');

	// the reader sees the labels, but no menu and no way to add one
	await reader.goto(projectPath(pid));
	await reader.getByRole('button', { name: 'History' }).click();
	const rview = reader.getByRole('region', { name: 'History' });
	const roptions = rview.getByRole('listbox', { name: 'Versions' }).getByRole('option');
	await expect(roptions.nth(1)).toContainText('Draft A');
	await expect(rview.getByRole('button', { name: /^Label/ })).toHaveCount(0);

	// delete, after a confirmation
	await options.nth(0).getByRole('button', { name: 'Label Draft A' }).click();
	await page.getByRole('menuitem', { name: 'Delete' }).click();
	await page.getByRole('dialog', { name: 'Delete the label “Draft A”?' }).getByRole('button', { name: 'Delete' }).click();
	await expect(options).toHaveCount(1);
	await expect(roptions.nth(1)).not.toContainText('Draft A'); // the reader's open panel follows
	await reader.context().close();
});

test('download zip: the project as it was at the selected version (scenario 9)', async ({ page, pid }) => {
	await openEditor(page, pid);
	const original = await text(page);
	await insert(page, 'end', '% after the start\n');
	await versionBy(page, pid, USER, 2);

	await page.getByRole('button', { name: 'History' }).click();
	const view = page.getByRole('region', { name: 'History' });
	await view.getByRole('listbox', { name: 'Versions' }).getByRole('option').nth(1).click();
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		view.getByRole('region', { name: 'Diff' }).getByRole('link', { name: 'Download zip' }).click()
	]);
	expect(download.suggestedFilename()).toMatch(/^Untitled project-\d{4}-\d\d-\d\d \d\d-\d\d\.zip$/);
	const entries = unzipSync(readFileSync(await download.path()));
	expect(Object.keys(entries)).toEqual(['main.tex']);
	expect(strFromU8(entries['main.tex'])).toBe(original); // the baseline, without the later edit
});
