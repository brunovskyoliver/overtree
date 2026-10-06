import { expect, type Page } from '@playwright/test';
import { openEditor, resetDoc, SEED, test, text } from './helpers.ts';

test.afterEach(async ({ page }) => {
	if (await page.evaluate(() => !!window.__overtree)) await resetDoc(page);
});

const button = (page: Page, name: string) =>
	page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', { name, exact: true });

/** Text of the current selection. */
const selected = (page: Page) =>
	page.evaluate(() => {
		const { state } = window.__overtree!.view;
		return state.sliceDoc(state.selection.main.from, state.selection.main.to);
	});

/** Type `word` at the end of the document and select it. */
async function typeAndSelect(page: Page, word: string) {
	await page.locator('.cm-content').press('ControlOrMeta+End');
	await page.keyboard.type(word);
	for (const _ of word) await page.keyboard.press('Shift+ArrowLeft');
}

test('Bold, Italic, Section and Link wrap the selection (US4-1, US4-3, US4-4)', async ({ page }) => {
	await openEditor(page);
	await typeAndSelect(page, 'important');
	await button(page, 'Bold').click();
	expect(await text(page)).toBe(SEED + '\\textbf{important}');
	expect(await selected(page)).toBe('important');
	await expect(page.locator('.cm-content')).toBeFocused();

	await button(page, 'Italic').click();
	expect(await text(page)).toBe(SEED + '\\textbf{\\textit{important}}');
	await button(page, 'Section').click();
	expect(await text(page)).toBe(SEED + '\\textbf{\\textit{\\section{important}}}');

	await button(page, 'Link').click();
	expect(await text(page)).toBe(SEED + '\\textbf{\\textit{\\section{\\href{}{important}}}}');
	// cursor in the URL braces
	await page.keyboard.type('url');
	expect(await text(page)).toBe(SEED + '\\textbf{\\textit{\\section{\\href{url}{important}}}}');
});

test('Bold with no selection puts the cursor between the braces (US4-2)', async ({ page }) => {
	const editor = await openEditor(page);
	await editor.press('ControlOrMeta+End');
	await button(page, 'Bold').click();
	await page.keyboard.type('x');
	expect(await text(page)).toBe(SEED + '\\textbf{x}');
});

test('Figure and Table on an empty line select their first placeholder (US4-5)', async ({ page }) => {
	const editor = await openEditor(page);
	await editor.press('ControlOrMeta+End');
	await button(page, 'Figure').click();
	expect(await selected(page)).toBe('example-image');
	expect(await text(page)).toContain('\\includegraphics[width=0.5\\linewidth]{example-image}');

	await page.evaluate(() => {
		const { view } = window.__overtree!;
		view.dispatch({ changes: { from: view.state.doc.length, insert: '\n' }, selection: { anchor: view.state.doc.length + 1 } });
	});
	await button(page, 'Table').click();
	expect(await selected(page)).toBe('A');
	expect(await text(page)).toContain('        A & B \\\\\n');
	expect(await text(page)).toMatch(/\\label\{tab:label\}\n\\end\{table\}$/);
});

test('one undo reverts a whole insertion (US4-7)', async ({ page }) => {
	await openEditor(page);
	await typeAndSelect(page, 'word');
	await button(page, 'Table').click();
	await page.keyboard.press('ControlOrMeta+z');
	expect(await text(page)).toBe(SEED + 'word');

	await page.keyboard.press('ControlOrMeta+End');
	for (const _ of 'word') await page.keyboard.press('Shift+ArrowLeft');
	await button(page, 'Bold').click();
	await page.keyboard.type('er'); // typing right after is its own step
	await page.keyboard.press('ControlOrMeta+z');
	expect(await text(page)).toBe(SEED + '\\textbf{word}');
	await page.keyboard.press('ControlOrMeta+z');
	expect(await text(page)).toBe(SEED + 'word');
});

test('search button and the find shortcut open find/replace (US4-6)', async ({ page }) => {
	const editor = await openEditor(page);
	await page.evaluate(() => {
		const { view } = window.__overtree!;
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'cat dog cat\ncat' }, selection: { anchor: 0 } });
	});

	await button(page, 'Search').click();
	const find = page.getByRole('textbox', { name: 'Find' });
	await expect(find).toBeFocused();
	await page.keyboard.type('cat');
	await expect(page.locator('.cm-searchMatch')).toHaveCount(3);

	await page.getByRole('button', { name: 'next', exact: true }).click();
	expect(await selected(page)).toBe('cat');

	await page.getByRole('textbox', { name: 'Replace' }).click();
	await page.keyboard.type('cow');
	await page.getByRole('button', { name: 'replace', exact: true }).click();
	expect(await text(page)).toBe('cow dog cat\ncat');
	await page.getByRole('button', { name: 'replace all', exact: true }).click();
	expect(await text(page)).toBe('cow dog cow\ncow');

	// WebKit doesn't focus clicked buttons: put focus back in the panel before Escape
	await find.press('Escape');
	await expect(find).toBeHidden();
	await editor.click();
	await page.keyboard.press('ControlOrMeta+f');
	await expect(find).toBeVisible();
	await expect(find).toBeFocused();
});
