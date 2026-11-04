import { expect, type Page } from '@playwright/test';
import { openEditor, setDoc, test, text } from './helpers.ts';

// Spell checking (editor/spelling.ts): English prose only (US or British, from babel), suggestions in the tooltip.

const doc = (body: string, preamble = '') => `\\documentclass{article}\n${preamble}\\begin{document}\n${body}\n\\end{document}`;
const marks = (page: Page) => page.locator('.cm-lintRange.cm-spell');

test.beforeEach(async ({ page }) => {
	await openEditor(page);
});

test('a misspelt word is underlined, a suggestion replaces it and blinks; commands, math and keys are not', async ({ page }) => {
	await setDoc(page, doc('This is a tset of \\textbf{the} editor, see \\ref{sec:intrdo} and $x_{abc} = \\alpha$.'));
	await expect(marks(page)).toHaveText(['tset'], { timeout: 15_000 });
	await marks(page).hover();
	const tooltip = page.locator('.cm-tooltip-lint');
	await expect(tooltip).toContainText('isn’t in the English dictionary');
	await tooltip.getByRole('button', { name: 'test', exact: true }).click();
	await expect.poll(() => text(page)).toContain('This is a test of');
	await expect(page.locator('.cm-flash')).toHaveText('test');
	await expect(marks(page)).toHaveCount(0);
	// the browser's own underline is off where a dictionary covers the language
	await expect(page.locator('.cm-content')).toHaveAttribute('spellcheck', 'false');
});

test('Add to dictionary keeps a word from being marked again', async ({ page }) => {
	await setDoc(page, doc('Overtreeish words are fine.'));
	await expect(marks(page)).toHaveText(['Overtreeish'], { timeout: 15_000 });
	await marks(page).hover();
	await page.locator('.cm-tooltip-lint').getByRole('button', { name: 'Add to dictionary' }).click();
	await expect(marks(page)).toHaveCount(0);
	await page.reload();
	await openEditor(page);
	await setDoc(page, doc('Overtreeish again, and a tset.'));
	await expect(marks(page)).toHaveText(['tset'], { timeout: 15_000 });
});

test('British English from babel: its spellings are fine, its typos get British suggestions', async ({ page }) => {
	await setDoc(page, doc('The colour of my favourate organisation.', '\\usepackage[british]{babel}\n'));
	await expect(marks(page)).toHaveText(['favourate'], { timeout: 15_000 });
	await marks(page).hover();
	await expect(page.locator('.cm-tooltip-lint')).toContainText('British English dictionary');
	await expect(page.locator('.cm-tooltip-lint').getByRole('button', { name: 'favourite', exact: true })).toBeVisible();
});

test('a language other than English is left to the browser; the switch turns it off', async ({ page }) => {
	await setDoc(page, doc('Det er et godt sproog.', '\\usepackage[danish]{babel}\n'));
	await expect(page.locator('.cm-content')).toHaveAttribute('spellcheck', 'true');
	await expect(marks(page)).toHaveCount(0);

	await setDoc(page, doc('Another tset.'));
	await expect(marks(page)).toHaveCount(1, { timeout: 15_000 });
	await page.getByRole('button', { name: 'Editor settings' }).click();
	await page.getByRole('checkbox', { name: 'Check spelling' }).uncheck();
	await page.keyboard.press('Escape');
	await expect(marks(page)).toHaveCount(0);
	await expect(page.locator('.cm-content')).not.toHaveAttribute('spellcheck', 'true');
	await page.getByRole('button', { name: 'Editor settings' }).click();
	await page.getByRole('checkbox', { name: 'Check spelling' }).check();
});
