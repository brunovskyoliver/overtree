import { expect } from '@playwright/test';
import { openEditor, resetDoc, SEED, test, text } from './helpers.ts';

test.afterEach(async ({ page }) => {
	if (await page.evaluate(() => !!window.__overtree)) await resetDoc(page);
});

test('fresh start shows the seed with the editor focused (US1-1)', async ({ page }) => {
	const editor = await openEditor(page);
	expect(await text(page)).toBe(SEED);
	await expect(editor).toBeFocused();
	await expect(page.getByLabel('Editor').getByText('main.tex', { exact: true })).toBeVisible();
	await expect(page.getByRole('banner')).toContainText('Overtree');
	await expect(page.getByRole('banner')).toContainText('Untitled project');
});

test('typed text survives an immediate reload (US1-2, SC-001)', async ({ page }) => {
	const editor = await openEditor(page);
	await editor.press('ControlOrMeta+End');
	const marker = `kept-${Date.now()}`;
	await page.keyboard.type(`% ${marker}`);
	await page.reload();
	await openEditor(page);
	expect(await text(page)).toContain(marker);
});

test('undo and redo by keyboard and toolbar (US1-4)', async ({ page }) => {
	const editor = await openEditor(page);
	await editor.press('ControlOrMeta+End');
	const stop = () => page.evaluate(() => window.__overtree!.undoManager.stopCapturing());
	await page.keyboard.type('one');
	await stop();
	await page.keyboard.type(' two');
	await stop();
	expect(await text(page)).toBe(SEED + 'one two');

	await page.keyboard.press('ControlOrMeta+z');
	expect(await text(page)).toBe(SEED + 'one');
	await page.keyboard.press('ControlOrMeta+z');
	expect(await text(page)).toBe(SEED);
	await page.keyboard.press('ControlOrMeta+Shift+z');
	expect(await text(page)).toBe(SEED + 'one');

	const toolbar = page.getByRole('toolbar', { name: 'Formatting' });
	await toolbar.getByRole('button', { name: 'Redo' }).click();
	expect(await text(page)).toBe(SEED + 'one two');
	await toolbar.getByRole('button', { name: 'Undo' }).click();
	await toolbar.getByRole('button', { name: 'Undo' }).click();
	expect(await text(page)).toBe(SEED);
	await toolbar.getByRole('button', { name: 'Redo' }).click();
	expect(await text(page)).toBe(SEED + 'one');
});

test('line numbers, bracket matching and LaTeX token classes (US1-5)', async ({ page }) => {
	const editor = await openEditor(page);
	await editor.press('ControlOrMeta+End');
	await page.keyboard.type('$a + b$');

	await expect(page.locator('.cm-lineNumbers .cm-gutterElement', { hasText: /^1$/ })).toBeVisible();
	await expect(page.locator('.tok-command', { hasText: '\\documentclass' })).toBeVisible();
	await expect(page.locator('.tok-argument', { hasText: 'document' }).first()).toBeVisible();
	await expect(page.locator('.tok-comment', { hasText: 'Required for inserting images' })).toBeVisible();
	await expect(page.locator('.tok-math').first()).toBeVisible();

	// cursor right after the `{` of \documentclass{article}
	await page.evaluate(() => window.__overtree!.view.dispatch({ selection: { anchor: '\\documentclass{'.length } }));
	await expect(page.locator('.cm-matchingBracket')).toHaveCount(2);
	await expect(page.locator('.cm-matchingBracket').last()).toHaveText('}');
});
