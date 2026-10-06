import { expect, type Browser, type Page } from '@playwright/test';
import { allow, api, openEditor, projectPath, setDoc, signInAs, test, text } from './helpers.ts';

// US4 "Edit together live" (scenarios 1–7) with two contexts: the owner in `page` (name "admin"), an editor B.
// Scenario 8 (five sessions) is collab5.spec.ts.

const tag = () => Math.random().toString(36).slice(2, 8);
const tree = (page: Page) => page.getByRole('tree', { name: 'File tree' });
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Open files' });
const rgb = (hex: string, alpha?: number) => {
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
	return alpha === undefined ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

type Me = { id: string; name: string; color: string };
let b: Page;
let bob: Me;

test.beforeEach(async ({ browser, page, pid }) => {
	await allow(page.request, '@test.local');
	b = await editor(browser, page, pid, `editor-${tag()}@test.local`);
	bob = await (await b.request.get('/api/me')).json();
	await openEditor(page, pid);
});

test.afterEach(async () => {
	await b.context().close();
});

/** A user invited as editor, in a context of their own, on the project's editor page. */
async function editor(browser: Browser, owner: Page, pid: string, email: string) {
	const ctx = await browser.newContext();
	await signInAs(ctx, email);
	const page = await ctx.newPage();
	await page.goto('/'); // creates the user
	expect((await owner.request.post(`${api(pid)}/members`, { data: { email, role: 'editor' } })).status()).toBe(201);
	await page.goto(projectPath(pid)); // not openEditor: that signs the context in as USER
	await expect(page.getByRole('status')).toHaveText('Saved');
	await page.waitForFunction(() => window.__overtree?.provider.isSynced);
	return page;
}

/** Wall-clock time in the page with sub-millisecond precision, comparable across pages on this machine. */
const NOW = 'performance.timeOrigin + performance.now()';

/** In `page`: resolves with the time the next keydown happened. */
const nextKeydown = (page: Page) =>
	page.evaluate(
		(now) => new Promise<number>((resolve) => addEventListener('keydown', () => resolve(eval(now)), { capture: true, once: true })),
		NOW
	);

/** In `page`: resolves with the time a remote caret is drawn at `pos` (checked on every DOM change). */
function caretAt(page: Page, pos: number) {
	return page.evaluate(
		([pos, now]) =>
			new Promise<number>((resolve) => {
				const { view } = window.__overtree!;
				const found = () => [...view.contentDOM.querySelectorAll('.cm-ySelectionCaret')].some((el) => view.posAtDOM(el) === pos);
				if (found()) return resolve(eval(now));
				const mo = new MutationObserver(() => found() && (mo.disconnect(), resolve(eval(now))));
				mo.observe(view.contentDOM, { childList: true, subtree: true });
			}),
		[pos, NOW] as const
	);
}

test('remote caret and selection in the user color with a name label within 300 ms; avatars come and go (1, 2)', async ({ page }) => {
	// avatars: each sees the other, in their color, never themselves
	const bAvatar = page.getByRole('button', { name: `${bob.name} (go to cursor)` });
	await expect(bAvatar).toBeVisible();
	await expect(bAvatar).toHaveCSS('border-top-color', rgb(bob.color));
	await expect(bAvatar).toHaveAttribute('title', bob.name);
	await expect(b.getByRole('button', { name: 'admin (go to cursor)' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'admin (go to cursor)' })).toHaveCount(0);

	// B's caret at the start, labelled and colored
	await b.locator('.cm-content').click();
	await b.keyboard.press('ControlOrMeta+Home');
	await caretAt(page, 0);
	const caret = page.locator('.cm-ySelectionCaret');
	await expect(caret).toHaveCSS('border-left-color', rgb(bob.color));
	await expect(caret.locator('.cm-ySelectionInfo')).toHaveText(bob.name);

	// SC-003: keypress in B → caret drawn in A, both timed inside the pages
	const end = (await text(page)).length;
	const seen = caretAt(page, end);
	const pressed = nextKeydown(b);
	await b.keyboard.press('ControlOrMeta+End');
	const latency = (await seen) - (await pressed);
	console.log(`remote caret latency: ${latency.toFixed(1)} ms`);
	expect(latency).toBeLessThan(300);

	// the label shows after the move, then hides (hover only) once 2 s have passed
	const label = caret.locator('.cm-ySelectionInfo');
	await expect(label).toHaveCSS('opacity', '1');
	await expect(label).toHaveCSS('opacity', '0', { timeout: 4_000 });
	await caret.hover();
	await expect(label).toHaveCSS('opacity', '1');

	// a selection in B's color at 20 %
	await b.keyboard.press('Shift+ArrowUp');
	await expect(page.locator('.cm-ySelection').first()).toHaveCSS('background-color', rgb(bob.color, 0.2));

	// B leaves: the avatar and caret go
	await b.close();
	await expect(bAvatar).toHaveCount(0);
	await expect(caret).toHaveCount(0);
});

test('clicking an avatar opens that user’s file and scrolls to their cursor (3)', async ({ page }) => {
	const res = await page.request.post(`${api()}/files`, { data: { kind: 'text', name: 'long.tex', parentId: null } });
	expect(res.status()).toBe(201);
	await tree(b).getByRole('treeitem', { name: 'long.tex', exact: true }).click();
	await b.waitForFunction(() => window.__overtree?.provider.isSynced);
	await setDoc(b, Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join('\n'));
	await b.locator('.cm-content').click();
	await b.keyboard.press('ControlOrMeta+End');
	for (let i = 0; i < 40; i++) await b.keyboard.press('ArrowUp'); // line 260

	await page.getByRole('button', { name: `${bob.name} (go to cursor)` }).click();
	await expect(tabs(page).getByRole('tab', { name: 'long.tex', exact: true })).toHaveAttribute('aria-selected', 'true');
	await expect(page.locator('.cm-ySelectionCaret')).toBeInViewport();
	await expect(page.locator('.cm-line', { hasText: /^line 255$/ })).toBeInViewport(); // the caret's line holds its label
});

test('tree changes reach the other user without reload: create, rename, move, main, delete (4)', async ({ page }) => {
	const post = (data: object) => page.request.post(`${api()}/files`, { data });
	const patch = (id: string, data: object) => page.request.patch(`${api()}/files/${id}`, { data });
	const { id } = await (await post({ kind: 'text', name: 'notes.tex', parentId: null })).json();
	await expect(tree(b).getByRole('treeitem', { name: 'notes.tex', exact: true })).toBeVisible();
	await tree(b).getByRole('treeitem', { name: 'notes.tex', exact: true }).click();
	await expect(tabs(b).getByRole('tab', { name: 'notes.tex', exact: true })).toBeVisible();

	expect((await patch(id, { name: 'ideas.tex' })).status()).toBe(200);
	await expect(tabs(b).getByRole('tab', { name: 'ideas.tex', exact: true })).toBeVisible();

	const folder = await (await post({ kind: 'folder', name: 'sub', parentId: null })).json();
	expect((await patch(id, { parentId: folder.id })).status()).toBe(200);
	const sub = tree(b).getByRole('treeitem', { name: 'sub', exact: true });
	await expect(sub).toBeVisible();
	await expect(tree(b).getByRole('treeitem', { name: 'ideas.tex', exact: true })).toHaveCount(0); // inside the closed folder
	await sub.click();
	await expect(sub.getByRole('treeitem', { name: 'ideas.tex', exact: true })).toBeVisible();

	expect((await page.request.put(`${api()}/main`, { data: { fileId: id } })).status()).toBe(204);
	await expect(tree(b).getByRole('treeitem', { name: 'ideas.tex, main document' })).toBeVisible();

	const headers = { origin: new URL(page.url()).origin };
	expect((await page.request.delete(`${api()}/files/${folder.id}`, { headers })).status()).toBe(204);
	await expect(tree(b).getByRole('treeitem', { name: 'sub', exact: true })).toHaveCount(0);
	await expect(tabs(b).getByRole('tab', { name: 'ideas.tex', exact: true })).toHaveCount(0);
});

test('undo reverts only the user’s own text (5)', async ({ page }) => {
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+Home');
	await page.keyboard.type('MINE ');
	await b.waitForFunction(() => window.__overtree!.view.state.doc.toString().startsWith('MINE '));
	await b.locator('.cm-content').click();
	await b.keyboard.press('ControlOrMeta+End');
	await b.keyboard.type(' THEIRS');
	await page.waitForFunction(() => window.__overtree!.view.state.doc.toString().endsWith(' THEIRS'));

	await page.keyboard.press('ControlOrMeta+z');
	for (const p of [page, b]) {
		await expect.poll(() => text(p)).not.toContain('MINE ');
		expect(await text(p)).toMatch(/ THEIRS$/);
	}
});

test('30 s offline with edits on both sides: both edits survive, offline indicator meanwhile (6, SC-006)', async ({ page }) => {
	test.setTimeout(120_000);
	await b.context().setOffline(true);
	await expect(b.getByRole('status')).toHaveText('Offline, reconnecting…');

	await b.locator('.cm-content').click();
	await b.keyboard.press('ControlOrMeta+Home');
	await b.keyboard.type('offline-b ');
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.type(' online-a');
	await b.waitForTimeout(30_000);
	await expect(b.getByRole('status')).toHaveText('Offline, reconnecting…');
	expect(await text(page)).not.toContain('offline-b');

	await b.context().setOffline(false);
	await expect(b.getByRole('status')).toHaveText('Saved');
	for (const p of [page, b]) await expect.poll(() => text(p)).toMatch(/^offline-b [^]* online-a$/);
	expect(await text(page)).toBe(await text(b));
});

test('a removed user is disconnected within 2 s and their edits stop reaching others (7)', async ({ page }) => {
	const headers = { origin: new URL(page.url()).origin };
	expect((await page.request.delete(`${api()}/members/${bob.id}`, { headers })).status()).toBe(204);
	await expect(b.getByRole('heading', { name: 'Your access was removed' })).toBeVisible({ timeout: 2_000 });
	await expect(page.getByRole('button', { name: `${bob.name} (go to cursor)` })).toHaveCount(0);
	// a direct write through a fresh socket is refused too (the editor is gone from B's page)
	await b.goto(projectPath());
	await expect(b.getByRole('heading', { name: 'You don’t have access to this project' })).toBeVisible();
});
