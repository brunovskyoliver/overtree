import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openEditor, resetDoc, SEED, setDoc } from './helpers.ts';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/latex/${name}`, import.meta.url), 'utf8');
const recompile = (page: Page) => page.getByRole('button', { name: 'Recompile' });
const toggle = (page: Page) => page.getByRole('button', { name: 'Compile options' });
const menu = (page: Page) => page.getByRole('menu', { name: 'Compile options' });
const item = (page: Page, name: string) => menu(page).getByRole(/LaTeX$/.test(name) ? 'menuitemradio' : 'menuitemcheckbox', { name });
const firstPage = (page: Page) => page.getByTestId('pdf-viewer').locator('.page').first();
const last = (page: Page) => page.evaluate(() => window.__overtree!.compile!.last);
const isCompilePost = (r: { method(): string; url(): string }) => r.method() === 'POST' && r.url().endsWith('/api/compile');

/** Timestamps (test clock) of every compile POST from now on. */
function trackPosts(page: Page) {
	const at: number[] = [];
	page.on('request', (r) => isCompilePost(r) && at.push(Date.now()));
	return at;
}

/** Open the menu, click an item, wait for the compiler PUT if it is one, close with Escape. */
async function choose(page: Page, name: string) {
	await toggle(page).click();
	const put = /LaTeX$/.test(name) && page.waitForResponse((r) => r.url().endsWith('/api/compile/settings'));
	await item(page, name).click();
	if (put) expect((await put).status()).toBe(204);
	await page.keyboard.press('Escape');
}

/** Put the cursor right after `text` and focus the editor. */
async function cursorAfter(page: Page, text: string) {
	await page.evaluate((text) => {
		const { view } = window.__overtree!;
		view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(text) + text.length } });
		view.focus();
	}, text);
}

test.afterEach(async ({ page }) => {
	// options are per browser (local storage) and per server (compiler): put both back to the defaults
	await page.evaluate(() => {
		window.__overtree?.compile?.setOption('autoCompile', false);
		localStorage.clear();
	});
	expect((await page.request.put('/api/compile/settings', { data: { compiler: 'pdflatex' } })).status()).toBe(204);
	await expect(recompile(page)).toBeEnabled({ timeout: 15_000 });
	await resetDoc(page);
});

test('auto compile starts ~2 s after the last keystroke and the PDF follows within 7 s (US3-1, SC-002)', async ({ page }) => {
	await openEditor(page);
	await choose(page, 'Auto compile');
	const posts = trackPosts(page);
	await cursorAfter(page, 'Untitled project');
	await page.keyboard.type(' Live');
	const typed = Date.now();

	await expect(firstPage(page)).toContainText('Untitled project Live', { timeout: 10_000 });
	expect(Date.now() - typed).toBeLessThan(7000);
	expect(posts).toHaveLength(1);
	// the timer can't fire early; allow slack for the request event reaching the test
	expect(posts[0] - typed).toBeGreaterThanOrEqual(1900);
	expect(posts[0] - typed).toBeLessThan(3500);
});

test('typing without a 2 s pause compiles only after the pause (US3-2)', async ({ page }) => {
	await openEditor(page);
	await choose(page, 'Auto compile');
	const posts = trackPosts(page);
	await cursorAfter(page, 'Untitled project');
	let typed = 0;
	for (let i = 0; i < 8; i++) {
		await page.keyboard.type('x');
		typed = Date.now();
		await page.waitForTimeout(500);
	}
	expect(posts).toEqual([]);

	await expect.poll(() => posts.length, { timeout: 5000 }).toBe(1);
	expect(posts[0] - typed).toBeGreaterThanOrEqual(1900);
	expect(posts[0] - typed).toBeLessThan(3500);
});

test('auto compile is off by default: no compile after 4 s idle (US3-3)', async ({ page }) => {
	await openEditor(page);
	await toggle(page).click();
	await expect(item(page, 'Auto compile')).toHaveAttribute('aria-checked', 'false');
	await page.keyboard.press('Escape');

	const posts = trackPosts(page);
	await cursorAfter(page, 'Untitled project');
	await page.keyboard.type(' Idle');
	await page.waitForTimeout(4000);
	expect(posts).toEqual([]);
});

test('edits during a compile lead to exactly one follow-up compile (US3-4)', async ({ page }) => {
	await openEditor(page);
	const posts = trackPosts(page);
	await setDoc(page, SEED.replace('Untitled project', 'First'));
	await recompile(page).click();
	await expect(page.getByRole('button', { name: 'Compiling…' })).toBeVisible();

	await setDoc(page, SEED.replace('Untitled project', 'Second'));
	await cursorAfter(page, 'Second');
	await page.keyboard.press('ControlOrMeta+Enter');
	await page.keyboard.press('ControlOrMeta+Enter');

	await expect(firstPage(page)).toContainText('Second', { timeout: 15_000 });
	await expect(recompile(page)).toBeEnabled();
	expect(posts).toHaveLength(2);
});

test('XeLaTeX and LuaLaTeX compile fontspec, pdfLaTeX fails it (US3-5)', async ({ page }) => {
	await openEditor(page);
	await setDoc(page, fixture('fontspec.tex'));
	for (const [label, compiler] of [
		['XeLaTeX', 'xelatex'],
		['LuaLaTeX', 'lualatex']
	]) {
		await choose(page, label);
		await recompile(page).click();
		await expect(recompile(page)).toBeEnabled({ timeout: 15_000 });
		expect(await last(page)).toMatchObject({ compiler, status: 'success' });
		await expect(firstPage(page)).toContainText('Fontspec works.');
	}

	await choose(page, 'pdfLaTeX');
	await recompile(page).click();
	await expect(recompile(page)).toBeEnabled({ timeout: 15_000 });
	expect(await last(page)).toMatchObject({ compiler: 'pdflatex', status: 'failure' });
});

test('stop on first error halts at the first error (US3-6)', async ({ page }) => {
	await openEditor(page);
	await setDoc(page, SEED.replace('\\section{Introduction}', '\\foo\n\\baz\n\\section{Introduction}'));
	await choose(page, 'Stop on first error');

	const [post] = await Promise.all([page.waitForRequest(isCompilePost), recompile(page).click()]);
	expect(post.postDataJSON()).toEqual({ stopOnFirstError: true });
	await expect(recompile(page)).toBeEnabled({ timeout: 15_000 });

	const errors = (await last(page))!.entries.filter((e) => e.level === 'error');
	expect(errors).toHaveLength(1);
	expect(errors[0]).toMatchObject({ line: 12, message: 'Undefined control sequence.' });
	expect(await (await page.request.get('/api/compile/output.log')).text()).toMatch(/==> Fatal error occurred|Emergency stop/);
});

test('options survive a reload; the compiler is shared with another browser (US3-7)', async ({ page, browser }) => {
	await openEditor(page);
	await choose(page, 'Auto compile');
	await choose(page, 'Stop on first error');
	await choose(page, 'XeLaTeX');

	await openEditor(page); // reload
	await toggle(page).click();
	await expect(item(page, 'Auto compile')).toHaveAttribute('aria-checked', 'true');
	await expect(item(page, 'Stop on first error')).toHaveAttribute('aria-checked', 'true');
	await expect(item(page, 'XeLaTeX')).toHaveAttribute('aria-checked', 'true');
	await expect(item(page, 'pdfLaTeX')).toHaveAttribute('aria-checked', 'false');
	await page.keyboard.press('Escape');

	const other = await (await browser.newContext()).newPage();
	await openEditor(other);
	await toggle(other).click();
	await expect(item(other, 'XeLaTeX')).toHaveAttribute('aria-checked', 'true');
	await expect(item(other, 'Auto compile')).toHaveAttribute('aria-checked', 'false');
	await expect(item(other, 'Stop on first error')).toHaveAttribute('aria-checked', 'false');
	await other.context().close();
});

test('Ctrl/⌘+Enter and Ctrl/⌘+S compile from the editor (US3-8)', async ({ page }) => {
	await openEditor(page);
	// a keydown the editor handled has defaultPrevented set by the time it bubbles to window
	await page.evaluate(() => window.addEventListener('keydown', (e) => ((window as unknown as { prevented: boolean }).prevented = e.defaultPrevented)));
	for (const key of ['ControlOrMeta+Enter', 'ControlOrMeta+s']) {
		const before = await page.evaluate(() => window.__overtree!.view.state.doc.toString());
		await cursorAfter(page, 'Untitled project');
		await Promise.all([page.waitForRequest(isCompilePost), page.keyboard.press(key)]);
		expect(await page.evaluate(() => (window as unknown as { prevented: boolean }).prevented)).toBe(true);
		expect(await page.evaluate(() => window.__overtree!.view.state.doc.toString())).toBe(before);
		await expect(recompile(page)).toBeEnabled({ timeout: 15_000 });
	}
});

test('the options menu works from the keyboard', async ({ page }) => {
	await openEditor(page);
	await toggle(page).focus();
	await page.keyboard.press('Enter');
	await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
	await expect(item(page, 'Auto compile')).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(item(page, 'pdfLaTeX')).toBeFocused();
	await page.keyboard.press('End');
	await expect(item(page, 'Stop on first error')).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(item(page, 'Auto compile')).toBeFocused();
	await page.keyboard.press('ArrowUp');
	await expect(item(page, 'Stop on first error')).toBeFocused();
	await page.keyboard.press('Home');
	await expect(item(page, 'Auto compile')).toBeFocused();

	await page.keyboard.press('ArrowUp');
	await page.keyboard.press('Space');
	await expect(item(page, 'Stop on first error')).toHaveAttribute('aria-checked', 'true');
	await page.keyboard.press('Enter');
	await expect(item(page, 'Stop on first error')).toHaveAttribute('aria-checked', 'false');

	await page.keyboard.press('Escape');
	await expect(menu(page)).toHaveCount(0);
	await expect(toggle(page)).toBeFocused();
	await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');

	await page.keyboard.press('ArrowDown');
	await expect(item(page, 'Auto compile')).toBeFocused();
	await page.locator('.cm-content').click();
	await expect(menu(page)).toHaveCount(0);
});
