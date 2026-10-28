import { expect, type Browser, type Page } from '@playwright/test';
import { allow, api, openEditor, projectPath, resetDoc, SEED, setDoc, signInAs, test, upload } from './helpers.ts';

// 016 "Friendlier compile errors and code check": hints in the logs, compile markers in the editor, the instant
// code check and the ChkTeX option (specs/016-compile-hints/spec.md).

const recompile = (page: Page) => page.getByRole('button', { name: 'Recompile' });
const logsButton = (page: Page) => page.getByRole('button', { name: 'Logs', exact: true });
const logs = (page: Page) => page.getByRole('region', { name: 'Logs' });
const section = (page: Page, name: string) => logs(page).getByRole('region', { name });
const toggle = (page: Page) => page.getByRole('button', { name: 'Compile options' });
const chktexItem = (page: Page) => page.getByRole('menu', { name: 'Compile options' }).getByRole('menuitemcheckbox', { name: 'Check with ChkTeX' });
const tooltip = (page: Page) => page.locator('.cm-tooltip-lint');
const isCompilePost = (r: { method(): string; url(): string }) => r.method() === 'POST' && r.url().endsWith('/compile');

// line 3: \includegraphics without graphicx (the seed loads it on line 2)
const NO_GRAPHICX = SEED.replace('\\usepackage{graphicx} % Required for inserting images\n', '').replace(
	'\\maketitle\n',
	'\\maketitle\n\\includegraphics{plot.png}\n'
);
const LINE = NO_GRAPHICX.split('\n').findIndex((l) => l.startsWith('\\includegraphics')) + 1;
const MISMATCH = SEED.replace('\\section{Introduction}\n', '\\section{Introduction}\n\\begin{itemize}\n\\item one\n\\end{enumerate}\n');

/** The underlined ranges in the editor: severity, line and text. */
const marks = (page: Page) =>
	page.evaluate(() => {
		const { view } = window.__overtree!;
		return [...view.contentDOM.querySelectorAll('.cm-lintRange')].map((el) => ({
			severity: el.className.match(/cm-lintRange-(\w+)/)![1],
			line: view.state.doc.lineAt(view.posAtDOM(el)).number,
			text: el.textContent
		}));
	});

const cursorLine = (page: Page) =>
	page.evaluate(() => {
		const { state } = window.__overtree!.view;
		return state.doc.lineAt(state.selection.main.head).number;
	});

/** Set the document, recompile and wait for the result. */
async function compileDoc(page: Page, content: string) {
	await setDoc(page, content);
	await Promise.all([page.waitForResponse((r) => isCompilePost(r.request()), { timeout: 15_000 }), recompile(page).click()]);
	await expect(recompile(page)).toBeEnabled({ timeout: 10_000 });
}

test.afterEach(async ({ page }) => {
	await page.evaluate(() => localStorage.clear());
	expect((await page.request.put(`${api()}/compile/settings`, { data: { chktex: false } })).status()).toBe(204);
	await resetDoc(page);
});

test('an undefined command: the hint names the package, the marker is on its line, the entry jumps there (US1-1, US2-1, US2-2)', async ({ page }) => {
	await openEditor(page);
	await compileDoc(page, NO_GRAPHICX);

	// the editor: underline on the command, a gutter marker, the tooltip with message and hint
	await expect.poll(() => marks(page)).toContainEqual({ severity: 'error', line: LINE, text: '\\includegraphics' });
	await expect(page.locator('.cm-gutter-lint .cm-lint-marker-error')).toHaveCount(1);
	await page.locator('.cm-lintRange-error', { hasText: '\\includegraphics' }).hover();
	await expect(tooltip(page)).toContainText('Undefined control sequence');
	await expect(tooltip(page)).toContainText('comes from the graphicx package');
	await expect(tooltip(page)).toContainText('\\usepackage{graphicx}');

	// the logs: the hint is open under the error
	await page.mouse.move(0, 0);
	await logsButton(page).click();
	const item = section(page, 'Errors').getByRole('listitem').filter({ hasText: 'Undefined control sequence' });
	await expect(item.locator('details.hint')).toHaveAttribute('open', '');
	await expect(item.locator('details.hint')).toContainText('graphicx package');
	await expect(item.locator('details.hint code', { hasText: '\\usepackage{graphicx}' })).toBeVisible();

	await page.evaluate(() => window.__overtree!.view.dispatch({ selection: { anchor: 0 } }));
	await item.getByRole('button', { name: `main.tex:${LINE}` }).click();
	expect(await cursorLine(page)).toBe(LINE);
});

test('a warning’s hint is collapsed and expands; filters show one level (US1-2, US1-3)', async ({ page }) => {
	await openEditor(page);
	await compileDoc(page, SEED.replace('\\section{Introduction}', 'See \\ref{sec:nope}.\n\\section{Introduction}'));
	await expect.poll(() => marks(page)).toContainEqual({ severity: 'warning', line: 12, text: 'sec:nope' });

	await logsButton(page).click();
	const item = section(page, 'Warnings').getByRole('listitem').filter({ hasText: "Reference `sec:nope'" });
	const hint = item.locator('details.hint');
	await expect(hint).not.toHaveAttribute('open');
	await hint.getByText('Hint').click();
	await expect(hint).toContainText('No \\label{sec:nope} defines this reference');
	await expect(hint).toContainText('one more compile');

	const filters = logs(page).getByRole('group', { name: 'Show' });
	await filters.getByRole('button', { name: /^Warnings/ }).click();
	await expect(section(page, 'Warnings')).toBeVisible();
	await expect(section(page, 'Errors')).toHaveCount(0);
	await expect(section(page, 'Typesetting')).toHaveCount(0);
	await filters.getByRole('button', { name: 'All' }).click();
	await expect(filters.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
});

test('a missing image: the hint suggests the closest file in the project (US1-4)', async ({ page }) => {
	await openEditor(page);
	await upload(page, 'plot.png', Buffer.from('not really a png'), null);
	await compileDoc(page, SEED.replace('\\maketitle\n', '\\maketitle\n\\includegraphics{plott.png}\n'));
	await logsButton(page).click();
	const item = section(page, 'Errors').getByRole('listitem').filter({ hasText: "File `plott.png' not found" });
	await expect(item.locator('details.hint')).toContainText('Did you mean plot.png?');
	await expect.poll(() => marks(page)).toContainEqual({ severity: 'error', line: 11, text: 'plott.png' });
});

test('compile markers move with edits and clear after a fixing compile (US2-3, US2-4)', async ({ page }) => {
	const editor = await openEditor(page);
	await compileDoc(page, NO_GRAPHICX);
	await expect.poll(() => marks(page)).toContainEqual({ severity: 'error', line: LINE, text: '\\includegraphics' });

	// two lines typed above it: the marker follows its text
	await page.evaluate(() => window.__overtree!.view.dispatch({ changes: { from: 0, insert: '% a\n% b\n' } }));
	await expect.poll(() => marks(page)).toContainEqual({ severity: 'error', line: LINE + 2, text: '\\includegraphics' });

	await compileDoc(page, SEED);
	await expect.poll(() => marks(page)).toEqual([]);
	await expect(editor.locator('.cm-lint-marker')).toHaveCount(0);
	await expect(page.locator('.cm-gutter-lint .cm-lint-marker')).toHaveCount(0);
});

test('markers follow a collaborator’s edits (US2-5)', async ({ page, browser, pid }) => {
	await allow(page.request, '@test.local');
	await openEditor(page);
	await compileDoc(page, NO_GRAPHICX);
	await expect.poll(() => marks(page)).toContainEqual({ severity: 'error', line: LINE, text: '\\includegraphics' });

	const b = await collaborator(browser, page, pid);
	await b.evaluate(() => window.__overtree!.view.dispatch({ changes: { from: 0, insert: '% from B\n% again\n% and again\n' } }));
	await b.waitForFunction(() => !window.__overtree!.provider.hasUnsyncedChanges);
	await expect.poll(() => marks(page)).toContainEqual({ severity: 'error', line: LINE + 3, text: '\\includegraphics' });
	await b.context().close();
});

test('the code check marks a mismatched environment before any compile, and fixing it clears it (US3-1, US3-2)', async ({ page }) => {
	await openEditor(page);
	const posts: string[] = [];
	page.on('request', (r) => isCompilePost(r) && posts.push(r.url()));
	await setDoc(page, MISMATCH);
	const lines = MISMATCH.split('\n');
	const begin = lines.indexOf('\\begin{itemize}') + 1;
	const end = lines.indexOf('\\end{enumerate}') + 1;
	await expect.poll(() => marks(page)).toEqual([
		{ severity: 'error', line: begin, text: '\\begin{itemize}' },
		{ severity: 'error', line: end, text: '\\end{enumerate}' }
	]);
	await page.locator('.cm-lintRange-error', { hasText: '\\end{enumerate}' }).hover();
	await expect(tooltip(page)).toContainText(`\\end{enumerate} doesn’t match \\begin{itemize} on line ${begin}`);
	await expect(tooltip(page)).toContainText('Code check');
	expect(posts).toEqual([]);

	// typing the fix: the markers go without a compile
	await page.evaluate(() => {
		const { view } = window.__overtree!;
		const at = view.state.doc.toString().indexOf('enumerate');
		view.dispatch({ changes: { from: at, to: at + 'enumerate'.length, insert: 'itemize' } });
	});
	await expect.poll(() => marks(page)).toEqual([]);
	expect(posts).toEqual([]);
});

test('the code check can be switched off per device, and stays off after a reload (US3-3)', async ({ page }) => {
	await openEditor(page);
	await setDoc(page, MISMATCH);
	await expect.poll(async () => (await marks(page)).length).toBe(2);

	await page.getByRole('button', { name: 'Editor settings' }).click();
	const box = page.getByRole('checkbox', { name: 'Code check' });
	await expect(box).toBeChecked();
	await box.uncheck();
	await expect.poll(() => marks(page)).toEqual([]);

	await page.reload();
	await expect(page.getByRole('region', { name: 'Editor', exact: true }).getByRole('status')).toHaveText('Saved');
	await page.waitForFunction(() => window.__overtree?.provider.isSynced);
	await page.waitForTimeout(800); // past the linter's delay
	expect(await marks(page)).toEqual([]);
	await page.getByRole('button', { name: 'Editor settings' }).click();
	await page.getByRole('checkbox', { name: 'Code check' }).check();
	await expect.poll(async () => (await marks(page)).length).toBe(2);
});

test('ChkTeX: off by default; on, its warnings get markers and their own filter (US4-1, US4-2)', async ({ page }) => {
	await openEditor(page);
	await toggle(page).click();
	await expect(chktexItem(page)).toHaveAttribute('aria-checked', 'false');
	await expect(chktexItem(page)).not.toHaveAttribute('aria-disabled');
	const put = page.waitForResponse((r) => r.url().endsWith(`${api()}/compile/settings`));
	await chktexItem(page).click();
	expect((await put).status()).toBe(204);
	await expect(chktexItem(page)).toHaveAttribute('aria-checked', 'true');
	await page.keyboard.press('Escape');

	// the setting is the project's: a reload keeps it
	await page.reload();
	await page.waitForFunction(() => window.__overtree?.provider.isSynced);
	await toggle(page).click();
	await expect(chktexItem(page)).toHaveAttribute('aria-checked', 'true');
	await page.keyboard.press('Escape');

	const quotes = SEED.replace('\\section{Introduction}', 'Say "hi".\n\\section{Introduction}');
	await compileDoc(page, quotes);
	const line = quotes.split('\n').indexOf('Say "hi".') + 1;
	await expect.poll(() => marks(page)).toContainEqual({ severity: 'warning', line, text: '"' });

	await logsButton(page).click();
	const filters = logs(page).getByRole('group', { name: 'Show' });
	await filters.getByRole('button', { name: /^ChkTeX/ }).click();
	await expect(section(page, 'ChkTeX').getByRole('button').first()).toContainText(`main.tex:${line}`);
	await expect(section(page, 'ChkTeX')).toContainText('(ChkTeX 18)');
	await expect(section(page, 'Warnings')).toHaveCount(0);
});

test('ChkTeX missing from the TeX image: the option says so and is disabled (US4-3)', async ({ page }) => {
	await page.route(`**${api()}/compile`, async (route) => {
		if (route.request().method() !== 'GET') return route.continue();
		const res = await route.fetch();
		await route.fulfill({ response: res, json: { ...(await res.json()), chktexAvailable: false } });
	});
	await openEditor(page);
	await toggle(page).click();
	await expect(chktexItem(page)).toHaveAttribute('aria-disabled', 'true');
	await expect(chktexItem(page)).toHaveAccessibleDescription('ChkTeX isn’t in this TeX image');
	await chktexItem(page).dispatchEvent('click'); // aria-disabled: Playwright's click would wait for it to enable
	await expect(chktexItem(page)).toHaveAttribute('aria-checked', 'false');
});

/** An editor of the project in a context of their own. */
async function collaborator(browser: Browser, owner: Page, pid: string) {
	const email = `hints-${Math.random().toString(36).slice(2, 8)}@test.local`;
	const ctx = await browser.newContext();
	await signInAs(ctx, email);
	const page = await ctx.newPage();
	await page.goto('/');
	expect((await owner.request.post(`${api(pid)}/members`, { data: { email, role: 'editor' } })).status()).toBe(201);
	await page.goto(projectPath(pid));
	await page.waitForFunction(() => window.__overtree?.provider.isSynced);
	return page;
}
