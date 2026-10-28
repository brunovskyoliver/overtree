import type { Facet } from '@codemirror/state';
import { expect, type Page } from '@playwright/test';
import { openEditor, test } from './helpers.ts';

// 018 light theme: the Appearance setting (Dark, Light, System) colors every page and survives a reload.

const KEY = 'overtree:editor-prefs';
const DARK = { page: 'rgb(27, 30, 38)', editor: 'rgb(30, 34, 48)', command: 'rgb(210, 127, 179)' }; // app.css before 018
const LIGHT = { page: 'rgb(236, 238, 242)', editor: 'rgb(255, 255, 255)', command: 'rgb(163, 43, 132)' };

const html = (page: Page) => page.locator('html');
const bodyBackground = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const colorScheme = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
/** Whether CodeMirror uses its dark base styles (EditorView.darkTheme). */
const cmDark = (page: Page) =>
	page.evaluate(() => {
		const v = window.__overtree!.view;
		return v.state.facet((v.constructor as unknown as { darkTheme: Facet<boolean, boolean> }).darkTheme);
	});

/** Pick an appearance in the account menu (top bar, every signed-in page). */
async function pick(page: Page, name: 'Dark' | 'Light' | 'System') {
	await page.getByRole('button', { name: 'Account' }).click();
	const item = page.getByRole('menu', { name: 'Account' }).getByRole('menuitemradio', { name });
	await item.click();
	await expect(page.getByRole('menu', { name: 'Account' })).toBeHidden();
}

test('Dark is the default and looks as before (US1-1, US1-4)', async ({ page }) => {
	await openEditor(page);
	await expect(html(page)).toHaveAttribute('data-theme', 'dark');
	expect(await bodyBackground(page)).toBe(DARK.page);
	expect(await colorScheme(page)).toBe('dark');
	await expect(page.locator('.cm-editor')).toHaveCSS('background-color', DARK.editor);
	await expect(page.locator('.tok-command').first()).toHaveCSS('color', DARK.command);
	expect(await cmDark(page)).toBe(true);
	await page.getByRole('button', { name: 'Account' }).click();
	await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
});

test('Light from the account menu colors the dashboard and editor and survives a reload without a dark flash (US1-2, US1-3, US3-1)', async ({ page }) => {
	await page.goto('/');
	await pick(page, 'Light');
	await expect(html(page)).toHaveAttribute('data-theme', 'light');
	expect(await bodyBackground(page)).toBe(LIGHT.page);
	expect(await colorScheme(page)).toBe('light');

	// every value <html data-theme> takes from the first parsed byte on, and the theme when <body> appears
	await page.addInitScript(() => {
		const seen: string[] = [];
		(window as unknown as { __themes: string[] }).__themes = seen;
		new MutationObserver((records) => {
			for (const r of records) {
				if (r.type === 'attributes') seen.push(document.documentElement.dataset.theme!);
				else if ([...r.addedNodes].some((n) => n.nodeName === 'BODY')) seen.push(`body:${document.documentElement.dataset.theme}`);
			}
		}).observe(document, { attributes: true, attributeFilter: ['data-theme'], childList: true, subtree: true });
	});
	await openEditor(page);
	await expect(html(page)).toHaveAttribute('data-theme', 'light');
	await expect(page.locator('.cm-editor')).toHaveCSS('background-color', LIGHT.editor);
	await expect(page.locator('.tok-command').first()).toHaveCSS('color', LIGHT.command);
	const themes = await page.evaluate(() => (window as unknown as { __themes: string[] }).__themes);
	// the head script turns the markup's "dark" light before <body> exists, and nothing ever sets it dark again
	expect(themes.slice(0, 2)).toEqual(['light', 'body:light']);
	expect(themes.every((t) => t.endsWith('light'))).toBe(true);
});

test('the stored choice applies before the app loads (US3-1)', async ({ page }) => {
	// A cold page avoids WebKit restoring already-loaded app modules on a same-URL visit.
	await page.addInitScript(() => localStorage.setItem('overtree:editor-prefs', JSON.stringify({ appearance: 'light' })));
	let blocked = 0;
	await page.route('**/_app/**/*.js', (route) => { blocked++; return route.abort(); });
	await page.goto('/');
	await expect(html(page)).toHaveAttribute('data-theme', 'light');
	expect(blocked).toBeGreaterThan(0);
	await expect(page.getByRole('button', { name: 'Account' })).toHaveCount(0);
});

test('the editor settings switch the appearance too (US1-5)', async ({ page }) => {
	await openEditor(page);
	await page.getByRole('button', { name: 'Editor settings' }).click();
	const select = page.getByRole('combobox', { name: 'Appearance' });
	await expect(select).toHaveValue('dark');
	await select.selectOption('Light');
	await expect(html(page)).toHaveAttribute('data-theme', 'light');
	await expect(page.locator('.cm-editor')).toHaveCSS('background-color', LIGHT.editor);
	// CodeMirror's own base styles follow
	expect(await cmDark(page)).toBe(false);
	await select.selectOption('Dark');
	await expect(html(page)).toHaveAttribute('data-theme', 'dark');
	await expect(page.locator('.cm-editor')).toHaveCSS('background-color', DARK.editor);
	expect(await cmDark(page)).toBe(true);
});

test('System follows the operating system live; Dark and Light ignore it (US2-1, US2-2, US2-3)', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'light' });
	await page.goto('/');
	await expect(html(page)).toHaveAttribute('data-theme', 'dark');
	await pick(page, 'System');
	await expect(html(page)).toHaveAttribute('data-theme', 'light');
	await page.emulateMedia({ colorScheme: 'dark' });
	await expect(html(page)).toHaveAttribute('data-theme', 'dark');
	expect(await bodyBackground(page)).toBe(DARK.page);
	await page.emulateMedia({ colorScheme: 'light' });
	await expect(html(page)).toHaveAttribute('data-theme', 'light');

	// the editor too, after a reload under a dark system
	await page.emulateMedia({ colorScheme: 'dark' });
	await openEditor(page);
	await expect(page.locator('.cm-editor')).toHaveCSS('background-color', DARK.editor);
	await page.emulateMedia({ colorScheme: 'light' });
	await expect(page.locator('.cm-editor')).toHaveCSS('background-color', LIGHT.editor);

	await pick(page, 'Dark');
	await page.emulateMedia({ colorScheme: 'light' });
	await expect(html(page)).toHaveAttribute('data-theme', 'dark');
});

test('the sign-in page follows the stored choice (US3-2)', async ({ browser }) => {
	const context = await browser.newContext(); // signed out
	await context.addInitScript((key) => localStorage.setItem(key, JSON.stringify({ appearance: 'light' })), KEY);
	const page = await context.newPage();
	await page.goto('/sign-in');
	await expect(page.getByRole('heading', { name: 'Overtree' })).toBeVisible();
	await expect(html(page)).toHaveAttribute('data-theme', 'light');
	await expect(page.locator('main')).toHaveCSS('background-color', LIGHT.page);
	await context.close();
});
