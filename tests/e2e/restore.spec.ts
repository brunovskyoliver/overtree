import { expect, type Browser, type Page } from '@playwright/test';
import type { FileEntry, ProjectInfo } from '../../src/lib/files.ts';
import type { HistoryPage } from '../../src/lib/history-types.ts';
import { allow, api, openEditor, projectPath, SEED, signInAs, test, text } from './helpers.ts';

// US2 "Restore a file or the whole project" (quickstart scenarios 3–5). The test server closes versions after
// 1.5 s idle (playwright.config.ts).

const tag = () => Math.random().toString(36).slice(2, 8);
const idOf = (email: string) => `test_${email}`;

async function as(browser: Browser, email: string) {
	const ctx = await browser.newContext();
	await signInAs(ctx, email);
	const page = await ctx.newPage();
	await page.goto('/');
	return page;
}

/** The editor as the context's own user (openEditor signs in as the admin). */
async function openAs(page: Page, pid: string) {
	await page.goto(projectPath(pid));
	await expect(page.getByRole('status')).toHaveText('Saved');
	await page.waitForFunction(() => window.__overtree?.provider.isSynced);
}

async function insert(page: Page, where: 'start' | 'end', s: string) {
	await page.evaluate(
		([where, s]) => {
			const { view } = window.__overtree!;
			view.dispatch({
				changes: {
					from: where === 'start' ? 0 : view.state.doc.length,
					insert: s
				}
			});
		},
		[where, s]
	);
	await page.waitForFunction(() => !window.__overtree!.provider.hasUnsyncedChanges);
}

const history = async (page: Page, pid: string): Promise<HistoryPage> => (await page.request.get(`${api(pid)}/history`)).json();
const versions = (page: Page, pid: string, n: number) =>
	expect
		.poll(async () => (await history(page, pid)).versions.length, {
			timeout: 10_000
		})
		.toBe(n);
const tree = async (page: Page, pid: string): Promise<ProjectInfo> => (await page.request.get(`${api(pid)}/files`)).json();

async function member(page: Page, pid: string, email: string, role: 'editor' | 'reader') {
	expect((await page.request.post(`${api(pid)}/members`, { data: { email, role } })).status()).toBe(201);
}

/** Open History in `page` and select the version at `index` (0: newest). */
async function select(page: Page, index: number) {
	await page.getByRole('button', { name: 'History' }).click();
	const options = page.getByRole('listbox', { name: 'Versions' }).getByRole('option');
	await options.nth(index).click();
	await expect(options.nth(index)).toHaveAttribute('aria-selected', 'true');
	return page.getByRole('region', { name: 'Diff' });
}

test.beforeEach(async ({ page }) => {
	await allow(page.request, '@test.local');
});

test('restore a file: a collaborator sees it live and can’t undo it (scenario 3)', async ({ browser, page, pid }) => {
	const bobEmail = `bob-${tag()}@test.local`;
	const bob = await as(browser, bobEmail);
	await member(page, pid, bobEmail, 'editor');

	await openEditor(page, pid);
	await insert(page, 'start', '% good\n');
	await versions(page, pid, 2);
	await insert(page, 'start', '% bad\n');
	await versions(page, pid, 3);
	await openAs(bob, pid);
	await insert(bob, 'end', '% bob\n'); // bob's own undo step
	await expect.poll(() => text(page)).toContain('% bob');

	const diff = await select(page, 1); // the "good" version
	const file = diff.getByRole('article', { name: 'main.tex' });
	await file.getByRole('button', { name: 'Restore this file' }).click();
	await expect(diff.getByRole('status')).toContainText('File restored.');
	const restored = `% good\n${SEED}`;
	await expect.poll(() => text(bob)).toBe(restored);
	// the timeline gains a restore version that points at its source
	const options = page.getByRole('listbox', { name: 'Versions' }).getByRole('option');
	await expect(options.nth(0)).toContainText('Restored from');
	const { versions: list } = await history(page, pid);
	expect(list[0]).toMatchObject({
		kind: 'restore',
		authors: [{ id: idOf('admin@test.local') }]
	});
	expect(list.slice(1).map((v) => v.kind)).toEqual(['edit', 'edit', 'edit', 'baseline']);

	// bob's Ctrl+Z only reaches his own (already restored away) edit
	await bob.locator('.cm-content').click();
	await bob.keyboard.press('ControlOrMeta+z');
	await bob.keyboard.press('ControlOrMeta+z');
	await bob.waitForTimeout(300);
	expect(await text(bob)).toBe(restored);
	await bob.context().close();
});

test('restore the project: a deleted file comes back and a rename is reverted (scenario 4)', async ({ page, pid }) => {
	await openEditor(page, pid);
	const { files, mainFileId } = await tree(page, pid);
	const res = await page.request.post(`${api(pid)}/files`, {
		data: { kind: 'text', name: 'notes.tex', parentId: null }
	});
	const notes: FileEntry = await res.json();
	await versions(page, pid, 2);
	const headers = { origin: new URL(page.url()).origin };
	expect((await page.request.delete(`${api(pid)}/files/${notes.id}`, { headers })).status()).toBe(204);
	expect(
		(
			await page.request.patch(`${api(pid)}/files/${mainFileId}`, {
				data: { name: 'paper.tex' }
			})
		).status()
	).toBe(200);
	await versions(page, pid, 3);
	expect(files).toHaveLength(1);

	const diff = await select(page, 1);
	await diff.getByRole('button', { name: 'Restore project' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('Restore the whole project to');
	await expect(dialog).toContainText('Changes after it stay in history.');
	await dialog.getByRole('button', { name: 'Restore project' }).click();
	await expect(diff.getByRole('status')).toContainText('Project restored.');
	// the recreated notes.tex has a new id but the same path: the diff pairs it, nothing differs any more
	await expect(diff).toContainText('No differences from the current state.');

	const after = await tree(page, pid);
	expect(after.files.map((f) => f.name).sort()).toEqual(['main.tex', 'notes.tex']);
	expect(after.files.find((f) => f.name === 'main.tex')!.id).toBe(mainFileId);
	expect(after.mainFileId).toBe(mainFileId);
	// the tree updated live: leaving history shows it
	await page.keyboard.press('Escape');
	const items = page.getByRole('tree', { name: 'File tree' }).getByRole('treeitem');
	await expect(items.filter({ hasText: 'notes.tex' })).toHaveCount(1);
	await expect(items.filter({ hasText: 'paper.tex' })).toHaveCount(0);
});

test('a reader gets no restore buttons and the server refuses (scenario 5)', async ({ browser, page, pid }) => {
	const readerEmail = `reader-${tag()}@test.local`;
	const reader = await as(browser, readerEmail);
	await member(page, pid, readerEmail, 'reader');
	await openEditor(page, pid);
	await insert(page, 'start', '% change\n');
	await versions(page, pid, 2);

	await reader.goto(projectPath(pid));
	const diff = await select(reader, 1);
	await expect(diff.getByRole('article', { name: 'main.tex' })).toBeVisible();
	await expect(diff.getByRole('button', { name: 'Restore this file' })).toHaveCount(0);
	await expect(diff.getByRole('button', { name: 'Restore project' })).toHaveCount(0);
	const vid = (await history(page, pid)).versions[1].id;
	expect(
		(
			await reader.request.post(`${api(pid)}/history/${vid}/restore`, {
				data: {}
			})
		).status()
	).toBe(403);
	await reader.context().close();
});

test('an editor with a read-only file restores the rest and gets the skipped list (scenario 5)', async ({ browser, page, pid }) => {
	const bobEmail = `bob-${tag()}@test.local`;
	const bob = await as(browser, bobEmail);
	await member(page, pid, bobEmail, 'editor');
	const { mainFileId } = await tree(page, pid);
	await openEditor(page, pid);
	await insert(page, 'start', '% owner edit\n');
	await page.request.post(`${api(pid)}/files`, {
		data: { kind: 'text', name: 'extra.tex', parentId: null }
	});
	await versions(page, pid, 2);
	expect(
		(
			await page.request.put(`${api(pid)}/overrides`, {
				data: { userId: idOf(bobEmail), fileId: mainFileId, role: 'reader' }
			})
		).status()
	).toBe(200);

	await bob.goto(projectPath(pid));
	const diff = await select(bob, 1); // the baseline
	await expect(diff.getByRole('article', { name: 'extra.tex' }).getByRole('button', { name: 'Restore this file' })).toBeVisible();
	await expect(diff.getByRole('article', { name: 'main.tex' }).getByRole('button', { name: 'Restore this file' })).toHaveCount(0);
	await diff.getByRole('button', { name: 'Restore project' }).click();
	await bob.getByRole('dialog').getByRole('button', { name: 'Restore project' }).click();
	await expect(diff.getByRole('status')).toContainText('Project restored.');
	await expect(diff.getByRole('list', { name: 'Skipped files' })).toHaveText('main.tex');

	const after = await tree(page, pid);
	expect(after.files.map((f) => f.name)).toEqual(['main.tex']);
	expect(await text(page)).toContain('% owner edit');
	await bob.context().close();
});
