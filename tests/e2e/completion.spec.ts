import { expect, test, type Page } from '@playwright/test';
import type { FileEntry } from '../../src/lib/files.ts';
import { openEditor, resetProject, setDoc, text } from './helpers.ts';

// US5: command completion while typing (contracts/ui.md, Completion popup)

test.beforeEach(async ({ page }) => {
	await page.goto('/');
	await page.evaluate(() => localStorage.clear());
	await openEditor(page);
});

test.afterEach(async ({ page }) => {
	await resetProject(page);
});

const popup = (page: Page) => page.locator('.cm-tooltip-autocomplete');
const listbox = (page: Page) => popup(page).getByRole('listbox');
const options = (page: Page) => listbox(page).getByRole('option');
const selected = (page: Page) => listbox(page).locator('[role=option][aria-selected=true]');
const tab = (page: Page, name: string) => page.getByRole('tablist', { name: 'Open files' }).getByRole('tab', { name, exact: true });
const row = (page: Page, name: string) =>
	page.getByRole('tree', { name: 'File tree' }).getByRole('treeitem', { name, exact: true }).locator(':scope > .row');

/** An empty document with the cursor in it. */
async function empty(page: Page, doc = '') {
	await setDoc(page, doc);
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+End');
}

/** The popup is open with `label` selected; keys sent within CodeMirror's 75 ms interaction delay after it opens are ignored. */
async function ready(page: Page, label?: string) {
	await expect(listbox(page)).toBeVisible();
	if (label) await expect(selected(page).locator('.cm-completionLabel')).toHaveText(label);
	await page.waitForTimeout(100);
}

async function upload(page: Page, name: string, content: string): Promise<FileEntry> {
	const res = await page.request.post('/api/files', {
		multipart: { file: { name, mimeType: 'text/plain', buffer: Buffer.from(content) }, parentId: '' },
		headers: { origin: new URL(page.url()).origin } // SvelteKit's CSRF check wants a browser-like Origin
	});
	expect(res.status()).toBe(201);
	return res.json();
}

test('\\ opens the popup with kind labels, first entry selected; \\sec + Enter inserts \\section{} (US5-1)', async ({ page }) => {
	await empty(page);
	await page.keyboard.type('\\');
	await ready(page);
	await expect(options(page).first()).toHaveAttribute('aria-selected', 'true');
	await expect(options(page).nth(0)).toHaveText('\\usepackage{}pkg');
	await expect(options(page).nth(1)).toHaveText('\\begin{}env');
	await expect(options(page).nth(4)).toHaveText('\\itemcmd');
	await expect(options(page).nth(0).locator('.cm-completionKind')).toHaveText('pkg');

	await page.keyboard.type('sec');
	await ready(page, '\\section{}');
	await expect(selected(page).locator('.cm-completionKind')).toHaveText('cmd');
	await page.keyboard.press('Enter');
	await expect(popup(page)).toHaveCount(0);
	await page.keyboard.type('Intro');
	expect(await text(page)).toBe('\\section{Intro}');
	// Tab leaves the braces
	await page.keyboard.press('Tab');
	await page.keyboard.type(' x');
	expect(await text(page)).toBe('\\section{Intro} x');
});

test('fuzzy sbsc narrows to \\subsection{} with the matched characters marked (US5-2)', async ({ page }) => {
	await empty(page);
	await page.keyboard.type('\\sbsc');
	await ready(page);
	const sub = options(page).filter({ hasText: /^\\subsection\{\}cmd$/ });
	await expect(sub).toBeVisible();
	expect(await options(page).allTextContents().then((all) => all.slice(0, 3))).toContain('\\subsection{}cmd');
	await expect(sub.locator('.cm-completionMatchedText')).not.toHaveCount(0);
	const marked = (await sub.locator('.cm-completionMatchedText').allTextContents()).join('');
	expect(marked).toBe('\\sbsc');
});

test('Down/Up move the selection, Tab and Enter accept, Escape closes without inserting (US5-3)', async ({ page }) => {
	await empty(page);
	await page.keyboard.type('\\ite');
	await ready(page, '\\item');
	// the listbox exposes the active option to assistive technology
	const active = async () => page.locator('.cm-content').getAttribute('aria-activedescendant');
	expect(await active()).toBe(await selected(page).getAttribute('id'));
	await page.keyboard.press('ArrowDown');
	await expect(selected(page).locator('.cm-completionLabel')).toHaveText('\\item[]');
	expect(await active()).toBe(await selected(page).getAttribute('id'));
	await page.keyboard.press('ArrowUp');
	await expect(selected(page).locator('.cm-completionLabel')).toHaveText('\\item');
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('Tab');
	await expect(popup(page)).toHaveCount(0);
	expect(await text(page)).toBe('\\item[]');

	await empty(page);
	await page.keyboard.type('\\emp');
	await ready(page, '\\emph{}');
	await page.keyboard.press('Escape');
	await expect(popup(page)).toHaveCount(0);
	expect(await text(page)).toBe('\\emp');
});

test('\\begin{} mirrors the name into \\end{} and Tab goes into the body (US5-4)', async ({ page }) => {
	await empty(page);
	await page.keyboard.type('\\begin');
	await ready(page, '\\begin{}');
	await page.keyboard.press('Enter');
	expect(await text(page)).toBe('\\begin{}\n  \n\\end{}');
	await page.keyboard.type('figure');
	expect(await text(page)).toBe('\\begin{figure}\n  \n\\end{figure}');
	await page.keyboard.press('Tab');
	await page.keyboard.type('body');
	expect(await text(page)).toBe('\\begin{figure}\n  body\n\\end{figure}');
});

test('\\usepackage[]{} starts in {}, Tab moves to [], Tab again leaves (US5-5)', async ({ page }) => {
	await empty(page);
	await page.keyboard.type('\\usepackage');
	await ready(page, '\\usepackage{}');
	await page.keyboard.press('ArrowDown');
	await expect(selected(page).locator('.cm-completionLabel')).toHaveText('\\usepackage[]{}');
	await page.keyboard.press('Enter');
	await page.keyboard.type('amsmath');
	await page.keyboard.press('Tab');
	await page.keyboard.type('fleqn');
	await page.keyboard.press('Tab');
	await page.keyboard.type('%');
	expect(await text(page)).toBe('\\usepackage[fleqn]{amsmath}%');
});

test('Enter after \\begin{itemize} closes it, but not twice (US5-6)', async ({ page }) => {
	await empty(page);
	// closeBrackets adds the `}`; typing it steps over
	await page.keyboard.type('\\begin{itemize}');
	await expect(popup(page)).toHaveCount(0);
	await page.keyboard.press('Enter');
	await page.keyboard.type('\\item a');
	expect(await text(page)).toBe('\\begin{itemize}\n  \\item a\n\\end{itemize}');

	await empty(page, '\\begin{itemize}\n\\end{itemize}');
	await page.evaluate(() => window.__overtree!.view.dispatch({ selection: { anchor: '\\begin{itemize}'.length } }));
	await page.keyboard.press('Enter');
	expect(await text(page)).toBe('\\begin{itemize}\n\n\\end{itemize}');
});

test('commands defined in another project file are offered (US5-7)', async ({ page }) => {
	await upload(page, 'macros.tex', '\\newcommand{\\R}{\\mathbb{R}}\n\\newcommand{\\pair}[2]{(#1, #2)}\n');
	await page.reload();
	await openEditor(page);
	await empty(page);
	await expect(async () => {
		await page.keyboard.type('\\R');
		try {
			await expect(options(page).first()).toHaveText('\\Rcmd', { timeout: 1000 });
		} finally {
			await page.keyboard.press('Escape');
			await empty(page);
		}
	}).toPass({ timeout: 10_000 });
	await page.keyboard.type('\\pai');
	await ready(page, '\\pair{}{}');
	await page.keyboard.press('Enter');
	await page.keyboard.type('a');
	await page.keyboard.press('Tab');
	await page.keyboard.type('b');
	expect(await text(page)).toBe('\\pair{a}{b}');
});

test('no popup in comments or non-LaTeX files (US5-8)', async ({ page }) => {
	await empty(page);
	await page.keyboard.type('% see \\sec');
	await page.waitForTimeout(300);
	await expect(popup(page)).toHaveCount(0);

	const notes = await upload(page, 'notes.md', '');
	await page.reload();
	await openEditor(page);
	await row(page, 'notes.md').click();
	await expect(tab(page, 'notes.md')).toHaveAttribute('aria-selected', 'true');
	await page.waitForFunction((id) => window.__overtree?.fileId === id && window.__overtree.provider.isSynced, notes.id);
	await page.locator('.cm-content').click();
	await page.keyboard.type('\\sec');
	await page.keyboard.press('Control+Space');
	await page.waitForTimeout(300);
	await expect(popup(page)).toHaveCount(0);
	expect(await text(page)).toBe('\\sec');
});

test('Ctrl+Space opens the popup after a partial command (US5-9)', async ({ page }) => {
	await empty(page);
	await page.keyboard.type('\\fra');
	await ready(page);
	await page.keyboard.press('Escape');
	await expect(popup(page)).toHaveCount(0);
	await page.keyboard.press('Control+Space');
	await ready(page, '\\frac{}{}');
});

test('the popup flips above the cursor near the bottom of the editor', async ({ page }) => {
	await empty(page, Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
	await page.keyboard.type('\\');
	await ready(page);
	const cursor = (await page.locator('.cm-activeLine').boundingBox())!;
	const box = (await popup(page).boundingBox())!;
	expect(box.y + box.height).toBeLessThanOrEqual(cursor.y + cursor.height / 2);
});

test('popup < 100 ms after \\ and < 50 ms per keystroke with 1,000 project labels and commands (SC-005)', async ({ page }) => {
	// command names are letters only: 12 → cmdaam
	const name = (i: number) => `cmd${[...i.toString(26).padStart(3, '0')].map((c) => String.fromCharCode(97 + parseInt(c, 26))).join('')}`;
	const big = Array.from({ length: 1000 }, (_, i) => `\\newcommand{\\${name(i)}}{x}\n\\label{lab:${i}}`).join('\n');
	await upload(page, 'big.tex', big);
	await page.reload();
	await openEditor(page);
	await empty(page);
	// the project commands are loaded once the last one is offered
	await expect(async () => {
		await page.keyboard.type(`\\${name(999)}`);
		try {
			await expect(options(page).first()).toHaveText(`\\${name(999)}cmd`, { timeout: 1000 });
		} finally {
			await page.keyboard.press('Escape');
			await empty(page);
		}
	}).toPass({ timeout: 10_000 });

	// keydown -> the frame after the popup (or its first option) changed
	await page.evaluate(() => {
		const w = window as unknown as { __keyAt: number; __lat: number[] };
		w.__lat = [];
		addEventListener('keydown', (e) => (w.__keyAt = e.timeStamp), true);
		new MutationObserver(() => {
			const at = w.__keyAt;
			if (at && document.querySelector('.cm-tooltip-autocomplete li')) {
				w.__keyAt = 0;
				requestAnimationFrame(() => w.__lat.push(performance.now() - at));
			}
		}).observe(document.querySelector('.cm-editor')!, { childList: true, subtree: true, characterData: true, attributes: true });
	});
	const lat = () => page.evaluate(() => (window as unknown as { __lat: number[] }).__lat);
	await page.keyboard.press('\\');
	await page.waitForFunction(() => (window as unknown as { __lat: number[] }).__lat.length === 1);
	const open = (await lat())[0];
	for (const k of name(12)) {
		const n = (await lat()).length;
		await page.keyboard.press(k);
		await page.waitForFunction((n) => (window as unknown as { __lat: number[] }).__lat.length > n, n);
	}
	const narrow = (await lat()).slice(1);
	const summary = `open ${open.toFixed(1)} ms, narrow max ${Math.max(...narrow).toFixed(1)} ms`;
	console.log(`[completion ${test.info().project.name}] ${summary}`);
	test.info().annotations.push({ type: 'perf', description: summary });
	expect(open).toBeLessThan(100);
	expect(Math.max(...narrow)).toBeLessThan(50);
	await expect(options(page).first()).toHaveText(`\\${name(12)}cmd`);
});
