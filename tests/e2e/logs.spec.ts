import { expect, test, type Page } from '@playwright/test';
import { openEditor, resetDoc, SEED, setDoc } from './helpers.ts';

const recompile = (page: Page) => page.getByRole('button', { name: 'Recompile' });
const logsButton = (page: Page) => page.getByRole('button', { name: 'Logs', exact: true });
const logs = (page: Page) => page.getByRole('region', { name: 'Logs' });
const section = (page: Page, name: string) => logs(page).getByRole('region', { name });
const badge = (page: Page) => recompile(page).getByRole('img', { name: /errors$/ });
const firstPage = (page: Page) => page.getByTestId('pdf-viewer').locator('.page').first();
const cursorLine = (page: Page) =>
	page.evaluate(() => {
		const { state } = window.__overtree!.view;
		return state.doc.lineAt(state.selection.main.head).number;
	});

// `\foo` lands on line 12 (the seed's \section moves to 13)
const UNDEFINED_12 = SEED.replace('\\section{Introduction}', '\\foo\n\\section{Introduction}');

/** Set the document, recompile and wait for the result. */
async function compileDoc(page: Page, content: string) {
	await setDoc(page, content);
	await Promise.all([
		page.waitForResponse((r) => r.url().endsWith('/api/compile') && r.request().method() === 'POST', { timeout: 15_000 }),
		recompile(page).click()
	]);
	await expect(recompile(page)).toBeEnabled({ timeout: 10_000 });
}

test.afterEach(async ({ page }) => {
	await resetDoc(page);
});

test('an undefined command shows a badge and an entry that jumps to its line (US2-1, US2-2)', async ({ page }) => {
	await openEditor(page);
	await compileDoc(page, UNDEFINED_12);
	await expect(badge(page)).toHaveAccessibleName('1 errors');
	await expect(badge(page)).toHaveText('1');

	await logsButton(page).click();
	await expect(logsButton(page)).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('pdf-viewer')).toBeHidden();
	const entry = section(page, 'Errors').getByRole('button');
	await expect(entry).toHaveCount(1);
	await expect(entry).toContainText('main.tex:12');
	await expect(entry).toContainText('Undefined control sequence');

	await entry.click();
	expect(await cursorLine(page)).toBe(12);
	await expect(page.locator('.cm-content')).toBeFocused();
	await expect(logs(page)).toHaveCount(0);
	await expect(logsButton(page)).toHaveAttribute('aria-pressed', 'false');
	await expect(firstPage(page)).toBeVisible();
});

test('warnings only: listed apart from errors, no badge (US2-3)', async ({ page }) => {
	await openEditor(page);
	const long = 'Averyveryveryveryveryveryveryveryveryveryveryveryveryveryverylongunbreakableword.';
	await compileDoc(page, SEED.replace('\\section{Introduction}', `See \\ref{sec:nope}.\n\n${long}`));
	await expect(badge(page)).toHaveCount(0);

	await logsButton(page).click();
	await expect(section(page, 'Errors')).toHaveCount(0);
	await expect(section(page, 'Warnings').getByRole('button')).toContainText("Reference `sec:nope' on page 1 undefined");
	await expect(section(page, 'Typesetting').getByRole('button')).toContainText('Overfull \\hbox');
	// no line: listed, but not a button
	const noLine = section(page, 'Warnings').getByRole('listitem').filter({ hasText: 'There were undefined references' });
	await expect(noLine).toBeVisible();
	await expect(noLine.getByRole('button')).toHaveCount(0);
});

test('a failed compile keeps the old PDF and points to the logs (US2-4, US2-5)', async ({ page }) => {
	await openEditor(page);
	await compileDoc(page, SEED);
	await expect(firstPage(page).locator('canvas')).toBeVisible({ timeout: 10_000 });

	await setDoc(page, SEED.slice(0, SEED.indexOf('\\begin{document}')));
	await recompile(page).click();
	await expect(page.getByRole('button', { name: 'Compiling…' })).toBeVisible();
	await expect(firstPage(page).locator('canvas')).toBeVisible();
	await expect(recompile(page)).toBeEnabled({ timeout: 10_000 });
	await expect(page.getByRole('alert')).toContainText('Compile failed, showing the previous PDF.');
	await expect(firstPage(page)).toContainText('Untitled project');

	await page.getByRole('alert').getByRole('button', { name: 'See logs' }).click();
	await expect(logs(page)).toBeVisible();
	await expect(section(page, 'Errors').getByRole('listitem').first()).toBeVisible();
});

test('the raw log shows the full log text (US2-6)', async ({ page }) => {
	await openEditor(page);
	await compileDoc(page, SEED);
	await logsButton(page).click();
	await logs(page).getByText('Raw log').click();
	await expect(logs(page).locator('pre')).toContainText('This is pdfTeX');
	await expect(logs(page).locator('pre')).toContainText('Output written on main.pdf');
});

test('fixing the error removes the badge and the entry (US2-7)', async ({ page }) => {
	await openEditor(page);
	await compileDoc(page, UNDEFINED_12);
	await expect(badge(page)).toBeVisible();
	await logsButton(page).click();
	await expect(section(page, 'Errors')).toBeVisible();

	await compileDoc(page, SEED);
	await expect(badge(page)).toHaveCount(0);
	await expect(section(page, 'Errors')).toHaveCount(0);
});

test('an entry past the end of the document jumps to the last line', async ({ page }) => {
	await openEditor(page);
	await compileDoc(page, UNDEFINED_12);
	await setDoc(page, 'short\ndoc');
	await logsButton(page).click();
	await section(page, 'Errors').getByRole('button').click();
	expect(await cursorLine(page)).toBe(2);
});

test('an entry from another file is listed but not a button', async ({ page }) => {
	await openEditor(page);
	await compileDoc(page, SEED.replace('\\usepackage{graphicx}', '\\usepackage[nonsense]{geometry}'));
	await logsButton(page).click();
	const entry = section(page, 'Errors').getByRole('listitem').filter({ hasText: 'geometry.sty' });
	await expect(entry).toContainText('nonsense undefined');
	await expect(entry.getByRole('button')).toHaveCount(0);
});
