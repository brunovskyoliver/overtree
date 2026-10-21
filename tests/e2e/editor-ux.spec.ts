import { expect } from '@playwright/test';
import { openEditor, projectPath, resetDoc, SEED, test, text } from './helpers.ts';

// Writing habits from word processors (UX review 2026-10-21): Tab, selection, Enter, quotes, spelling, font size,
// word count and edits that outlive a closed tab.

test.afterEach(async ({ page }) => {
	if (await page.evaluate(() => !!window.__overtree)) await resetDoc(page);
});

/** The cursor at the end of the document, which ends in an empty line. */
const toEnd = (page: import('@playwright/test').Page) => page.locator('.cm-content').press('ControlOrMeta+End');

test('Tab indents and keeps focus; Shift+Tab outdents; Escape then Tab leaves the editor', async ({ page }) => {
	const editor = await openEditor(page);
	await toEnd(page);
	await page.keyboard.type('x');
	await page.keyboard.press('Tab');
	await expect(editor).toBeFocused();
	expect(await text(page)).toMatch(/\n\s+x$/);
	await page.keyboard.press('Shift+Tab');
	expect(await text(page)).toBe(SEED + 'x');
	await page.keyboard.press('Escape');
	await page.keyboard.press('Tab');
	await expect(editor).not.toBeFocused();
});

test('the selection shows on the active line, and other matches are only outlined', async ({ page }) => {
	await openEditor(page);
	const alpha = (selector: string, prop: 'backgroundColor' | 'outlineStyle') =>
		page.locator(selector).first().evaluate((e, prop) => getComputedStyle(e)[prop], prop);
	// the selection layer sits behind the text: the active line must let it through
	expect(await alpha('.cm-activeLine', 'backgroundColor')).toMatch(/rgba?\(.*,\s*0?\.\d+\)$/);
	await page.evaluate(() => {
		const { view } = window.__overtree!;
		const at = view.state.doc.toString().indexOf('{document}') + 1;
		view.dispatch({ selection: { anchor: at, head: at + 'document'.length } });
	});
	await expect(page.locator('.cm-selectionMatch')).toHaveCount(1); // the other \begin/\end{document}
	expect(await alpha('.cm-selectionMatch', 'backgroundColor')).toBe('rgba(0, 0, 0, 0)');
});

test('Enter after a command typed out in full makes the new line at once', async ({ page }) => {
	await openEditor(page);
	await toEnd(page);
	await page.keyboard.type('\\maketitle');
	await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible();
	await page.keyboard.press('Enter');
	expect(await text(page)).toBe(SEED + '\\maketitle\n');
});

test('quotes stay single in LaTeX; brackets still pair', async ({ page }) => {
	await openEditor(page);
	await toEnd(page);
	await page.keyboard.type('say "hi" (');
	expect(await text(page)).toBe(SEED + 'say "hi" ()');
});

test('spelling on by default; font size and spelling are per-device settings that survive a reload', async ({ page }) => {
	const editor = await openEditor(page);
	await expect(editor).toHaveAttribute('spellcheck', 'true');
	await page.getByRole('button', { name: 'Editor settings' }).click();
	const settings = page.getByRole('group', { name: 'Editor settings' });
	await settings.getByRole('button', { name: 'Larger text' }).click();
	await settings.getByRole('button', { name: 'Larger text' }).click();
	await expect(settings.locator('output')).toHaveText('15px');
	await expect(page.locator('.cm-scroller')).toHaveCSS('font-size', '15px');
	await settings.getByLabel('Check spelling').uncheck();
	await expect(editor).toHaveAttribute('spellcheck', 'false');

	await page.reload();
	await openEditor(page);
	await expect(page.locator('.cm-scroller')).toHaveCSS('font-size', '15px');
	await expect(page.locator('.cm-content')).toHaveAttribute('spellcheck', 'false');
	await page.evaluate(() => localStorage.removeItem('overtree:editor-prefs'));
});

test('the toolbar counts the words of the body', async ({ page }) => {
	await openEditor(page);
	const words = page.getByRole('toolbar', { name: 'Formatting' }).getByText(/words?$/);
	await expect(words).toHaveText('1 word'); // "Introduction"
	// inside the body: text after \end{document} isn't part of the document
	await page.evaluate(() => {
		const { view } = window.__overtree!;
		view.focus();
		view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf('\\end{document}') } });
	});
	await page.keyboard.type('Two more ');
	await expect(words).toHaveText('3 words');
});

test('edits made offline: leaving asks first, and after a reload they reach the server', async ({ page, browser }) => {
	await openEditor(page);
	await page.evaluate(() => window.__overtree!.provider.configuration.websocketProvider.disconnect());
	await toEnd(page);
	await page.keyboard.type('written offline');
	// IndexedDB writes are asynchronous: give them a moment, as a person closing the tab would
	await page.waitForTimeout(300);
	const asked: string[] = [];
	page.on('dialog', (d) => (asked.push(d.type()), d.accept()));
	await page.reload();
	expect(asked).toEqual(['beforeunload']);
	await openEditor(page);
	const other = await (await browser.newContext()).newPage();
	await openEditor(other);
	await expect.poll(() => text(other)).toBe(SEED + 'written offline');
	await other.context().close();
	expect(page.url()).toContain(projectPath());
});
