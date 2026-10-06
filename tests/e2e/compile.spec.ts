import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { clearCompileOutput, openEditor, resetDoc, SEED, setDoc } from './helpers.ts';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/latex/${name}`, import.meta.url), 'utf8');
const recompile = (page: Page) => page.getByRole('button', { name: 'Recompile' });
const compiling = (page: Page) => page.getByRole('button', { name: 'Compiling…' });
const firstPage = (page: Page) => page.getByTestId('pdf-viewer').locator('.page').first();

test.afterEach(async ({ page }) => {
	await resetDoc(page);
});

test('Recompile shows the PDF within 5 s (US1-1, US1-2)', async ({ page }) => {
	clearCompileOutput();
	await openEditor(page);
	await expect(page.getByText('Click Recompile or press Ctrl/⌘+Enter to see your PDF.')).toBeVisible();

	const start = Date.now();
	await recompile(page).click();
	await expect(compiling(page)).toBeDisabled();
	await expect(compiling(page)).toHaveAttribute('aria-busy', 'true');
	await expect(firstPage(page).locator('canvas')).toBeVisible({ timeout: 5000 });
	expect(Date.now() - start).toBeLessThan(5000);
	await expect(firstPage(page)).toContainText('Untitled project');
	await expect(recompile(page)).toBeEnabled();
	await expect(recompile(page)).not.toHaveAttribute('aria-busy', 'true');
});

test('an edited title shows up after recompiling (US1-3)', async ({ page }) => {
	await openEditor(page);
	await setDoc(page, SEED.replace('Untitled project', 'Fresh Title'));
	await recompile(page).click();
	await expect(firstPage(page)).toContainText('Fresh Title', { timeout: 10_000 });
});

test('a reload shows the last PDF without compiling (US1-4)', async ({ page }) => {
	await openEditor(page);
	await recompile(page).click();
	await expect(firstPage(page)).toContainText('Untitled project', { timeout: 10_000 });

	const posts: string[] = [];
	page.on('request', (r) => r.method() === 'POST' && posts.push(r.url()));
	await page.reload();
	await expect(firstPage(page)).toContainText('Untitled project');
	expect(posts).toEqual([]);
});

test('shell escape is blocked (US1-5)', async ({ page }) => {
	await openEditor(page);
	await setDoc(page, fixture('escape-shell.tex'));
	await recompile(page).click();
	await expect(firstPage(page)).toContainText('safe', { timeout: 10_000 });
	await expect(firstPage(page)).not.toContainText('PWNED');
});

test('the previous PDF stays during a compile and after a failed one (SC-007)', async ({ page }) => {
	await openEditor(page);
	await recompile(page).click();
	await expect(firstPage(page).locator('canvas')).toBeVisible({ timeout: 10_000 });

	// preamble only: no \begin{document}, no pages, no PDF
	await setDoc(page, SEED.slice(0, SEED.indexOf('\\begin{document}')));
	await recompile(page).click();
	await expect(compiling(page)).toBeVisible();
	await expect(firstPage(page).locator('canvas')).toBeVisible();
	await expect(recompile(page)).toBeEnabled({ timeout: 10_000 });
	await expect(page.getByRole('alert')).toContainText('Compile failed, showing the previous PDF.');
	await expect(firstPage(page).locator('canvas')).toBeVisible();
	await expect(firstPage(page)).toContainText('Untitled project');
});

test('a failed compile request shows in the banner and keeps the PDF (F7)', async ({ page }) => {
	await openEditor(page);
	await recompile(page).click();
	await expect(firstPage(page).locator('canvas')).toBeVisible({ timeout: 10_000 });

	await page.route('**/api/compile', (route) =>
		route.request().method() === 'POST' ? route.fulfill({ status: 500 }) : route.continue()
	);
	await recompile(page).click();
	await expect(page.getByRole('alert')).toContainText('Compile request failed (500)');
	await expect(page.getByRole('alert')).toContainText('showing the previous PDF');
	await expect(firstPage(page).locator('canvas')).toBeVisible();
	await expect(recompile(page)).toBeEnabled();
});

test('an endless loop times out and the app stays responsive (US1-6, SC-004)', async ({ page, browser }) => {
	await openEditor(page);
	await setDoc(page, fixture('loop.tex'));
	const start = Date.now();
	await recompile(page).click();
	await expect(compiling(page)).toBeVisible();

	// another user opens the app and edits while the loop compiles
	const other = await (await browser.newContext()).newPage();
	await openEditor(other);
	await other.locator('.cm-content').press('ControlOrMeta+End');
	const marker = `alive-${Date.now()}`;
	const sent = Date.now();
	await other.keyboard.insertText(`% ${marker}`);
	await page.waitForFunction((m) => window.__overtree!.view.state.doc.toString().includes(m), marker, { timeout: 1000 });
	expect(Date.now() - sent).toBeLessThan(1000);
	await other.context().close();

	await expect(page.getByRole('alert')).toContainText('timed out', { timeout: 10_000 });
	// COMPILE_TIMEOUT_MS is 5000 in playwright.config.ts
	expect(Date.now() - start).toBeLessThan(7000 + 1000);
});
