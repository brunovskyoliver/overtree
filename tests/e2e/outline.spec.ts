import { expect, test, type Page } from '@playwright/test';
import { openEditor, resetDoc } from './helpers.ts';

test.afterEach(async ({ page }) => {
	if (await page.evaluate(() => !!window.__overtree)) await resetDoc(page);
});

/** Replace the whole document (no typing thousands of lines). */
const setDoc = (page: Page, doc: string) =>
	page.evaluate((doc) => {
		const { view } = window.__overtree!;
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
	}, doc);

const cursorLine = (page: Page) =>
	page.evaluate(() => {
		const { state } = window.__overtree!.view;
		return state.doc.lineAt(state.selection.main.head).number;
	});

const outline = (page: Page) => page.getByRole('navigation', { name: 'File outline' });

test('clicking an entry far down jumps there and focuses the editor (US3-2, SC-005)', async ({ page }) => {
	const editor = await openEditor(page);
	const lines = Array.from({ length: 5000 }, (_, i) => `Line ${i + 1} of filler text.`);
	lines[9] = '\\section{Start}';
	lines[4499] = '\\subsection{Far away}';
	await setDoc(page, lines.join('\n'));
	await page.evaluate(() => window.__overtree!.view.dispatch({ selection: { anchor: 0 } }));

	await outline(page).getByRole('button', { name: 'Far away' }).click();
	expect(await cursorLine(page)).toBe(4500);
	await expect(editor).toBeFocused();
	await expect(page.locator('.cm-line', { hasText: '\\subsection{Far away}' })).toBeInViewport();

	await outline(page).getByRole('button', { name: 'Start' }).click();
	expect(await cursorLine(page)).toBe(10);
	await expect(page.locator('.cm-line', { hasText: '\\section{Start}' })).toBeInViewport();
});

test('a typed section appears within one second (US3-3)', async ({ page }) => {
	const editor = await openEditor(page);
	await expect(outline(page).getByRole('button')).toHaveText(['Introduction']);
	await editor.press('ControlOrMeta+End');
	// closeBrackets adds the `}`; typing it steps over
	await page.keyboard.type('\\section{Methods}');
	await expect(outline(page).getByRole('button')).toHaveText(['Introduction', 'Methods'], { timeout: 1000 });
});

test('the entry containing the cursor is marked current (US3-5)', async ({ page }) => {
	await openEditor(page);
	await setDoc(page, '\\section{One}\ntext\n\\subsection{Two}\nmore\n\\section{Three}\n');
	const entry = (name: string) => outline(page).getByRole('button', { name });
	await expect(entry('Three')).toBeVisible();

	await page.evaluate(() => window.__overtree!.view.dispatch({ selection: { anchor: '\\section{One}\ntext\n\\subsection{Two}\nmo'.length } }));
	await expect(entry('Two')).toHaveAttribute('aria-current', 'location');
	await expect(outline(page).locator('[aria-current]')).toHaveCount(1);

	await page.evaluate(() => window.__overtree!.view.dispatch({ selection: { anchor: 3 } }));
	await expect(entry('One')).toHaveAttribute('aria-current', 'location');
	await expect(entry('Two')).not.toHaveAttribute('aria-current');
});

test('an empty document shows "No sections yet"', async ({ page }) => {
	await openEditor(page);
	await setDoc(page, '');
	await expect(outline(page)).toHaveText('No sections yet');
	await expect(outline(page).getByRole('button')).toHaveCount(0);
});
