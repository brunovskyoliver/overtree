import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { clearCompileOutput, openEditor, resetDoc, setDoc, test } from './helpers.ts';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/latex/${name}`, import.meta.url), 'utf8');
const THREE = fixture('three-pages.tex');
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const pageInput = (page: Page) => page.getByRole('textbox', { name: 'Page number' });
const zoomLevel = (page: Page) => page.getByRole('button', { name: /^Zoom level/ });
const viewer = (page: Page) => page.getByTestId('pdf-viewer');
const pdfPage = (page: Page, n: number) => viewer(page).locator(`.page[data-page-number="${n}"]`);
// by label: without an href the PDF's download anchor has no link role
const download = (page: Page) => page.getByLabel('Download PDF');
const percent = async (page: Page) => Number((await zoomLevel(page).textContent())!.replace(/\D/g, ''));
/** Page 1's box; null while pdf.js re-renders it after a zoom, so ask again. */
const pageBox = async (page: Page) => {
	for (;;) {
		const box = await pdfPage(page, 1).boundingBox();
		if (box) return box;
	}
};
const pageWidth = async (page: Page) => (await pageBox(page)).width;
const pane = (page: Page) => viewer(page).evaluate((el) => ({ w: el.clientWidth, h: el.clientHeight }));

/** Compile `content` and wait until the new PDF shows `marker` and has `pages` pages. */
async function compileDoc(page: Page, content: string, marker: string, pages: number) {
	await setDoc(page, content);
	// pdf.js replaces the page elements on a new document: tag the old ones to wait for the new
	await page.evaluate(() => document.querySelectorAll('.page').forEach((p) => p.setAttribute('data-old', '')));
	await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/compile')), page.getByRole('button', { name: 'Recompile' }).click()]);
	await expect(viewer(page)).toContainText(marker, { timeout: 10_000 });
	await expect(page.getByText(`/ ${pages}`, { exact: true })).toBeVisible();
	await expect(viewer(page).locator('.page:not([data-old]) canvas').first()).toBeVisible({ timeout: 10_000 });
}

async function zoomTo(page: Page, label: string) {
	await zoomLevel(page).click();
	await page.getByRole('menu', { name: 'Zoom' }).getByRole('menuitemradio', { name: label, exact: true }).click();
}

/** Click a toolbar button in the page and time it until `what` shows the change (SC-006). */
const timeClick = (page: Page, label: string, what: 'page' | 'zoom' | 'dark') =>
	page.evaluate(
		async ({ label, what }) => {
			const q = <T extends Element>(s: string) => document.querySelector<T>(s)!;
			const state = () =>
				what === 'page'
					? q<HTMLInputElement>('[aria-label="Page number"]').value
					: what === 'zoom'
						? q('[aria-label^="Zoom level"]').textContent
						: getComputedStyle(q('[data-testid="pdf-viewer"] .page canvas')).filter;
			const before = state();
			const t = performance.now();
			q<HTMLElement>(`[aria-label="${label}"]`).click();
			while (state() === before && performance.now() - t < 2000) await new Promise(requestAnimationFrame);
			return performance.now() - t;
		},
		{ label, what }
	);

test.afterEach(async ({ page }) => {
	await page.evaluate(() => localStorage.clear());
	await resetDoc(page);
});

test('page buttons, page input and scrolling move through the pages (US4-1, US4-2)', async ({ page }) => {
	await openEditor(page);
	await compileDoc(page, THREE, 'Page one.', 3);
	await expect(pageInput(page)).toHaveValue('1');
	await expect(button(page, 'Previous page')).toBeDisabled();

	await button(page, 'Next page').click();
	await expect(pageInput(page)).toHaveValue('2');
	await expect(pdfPage(page, 2)).toBeInViewport();

	await pageInput(page).fill('3');
	await pageInput(page).press('Enter');
	await expect(pageInput(page)).toHaveValue('3');
	await expect(pdfPage(page, 3)).toBeInViewport();
	await expect(button(page, 'Next page')).toBeDisabled();

	// invalid input is put back
	await pageInput(page).fill('9');
	await pageInput(page).press('Enter');
	await expect(pageInput(page)).toHaveValue('3');

	await viewer(page).evaluate((el) => (el.scrollTop = 0));
	await expect(pageInput(page)).toHaveValue('1');
	await viewer(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
	await expect(pageInput(page)).toHaveValue('3');
});

test('zoom in/out change the percentage and the page size (US4-3)', async ({ page }) => {
	await openEditor(page);
	await compileDoc(page, THREE, 'Page one.', 3);
	await zoomTo(page, '100%');
	await expect(zoomLevel(page)).toHaveText('100%');
	const w = await pageWidth(page);

	await button(page, 'Zoom in').click();
	await expect.poll(() => percent(page)).toBeGreaterThan(100);
	await expect.poll(() => pageWidth(page)).toBeGreaterThan(w);
	await expect(pdfPage(page, 1).locator('canvas')).toBeVisible();

	await button(page, 'Zoom out').click();
	await button(page, 'Zoom out').click();
	await expect.poll(() => percent(page)).toBeLessThan(100);
	await expect.poll(() => pageWidth(page)).toBeLessThan(w);
});

test('fit width and fit page size against the pane and follow a resize (US4-4)', async ({ page }) => {
	await openEditor(page);
	await compileDoc(page, THREE, 'Page one.', 3);

	await zoomTo(page, 'Fit page');
	await expect
		.poll(async () => {
			const box = await pageBox(page);
			const { w, h } = await pane(page);
			return box.width <= w && box.height <= h && (h - box.height < 30 || w - box.width < 60);
		})
		.toBe(true);

	await zoomTo(page, 'Fit width');
	const fitsWidth = async () => {
		const { w } = await pane(page);
		const pw = await pageWidth(page);
		return pw <= w && w - pw < 60;
	};
	await expect.poll(fitsWidth).toBe(true);
	const before = await pageWidth(page);

	// drag the PDF pane border 150 px to the left: the pane and the fitted page get wider
	const box = (await page.getByRole('separator', { name: 'Resize PDF' }).boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x - 75, box.y + box.height / 2, { steps: 5 });
	await page.mouse.move(box.x - 150, box.y + box.height / 2, { steps: 5 });
	await page.mouse.up();
	await expect.poll(() => pageWidth(page)).toBeGreaterThan(before + 100);
	await expect.poll(fitsWidth).toBe(true);
});

test('dark pages invert the page and survive a reload (US4-5)', async ({ page }) => {
	await openEditor(page);
	await compileDoc(page, THREE, 'Page one.', 3);
	const filter = () => pdfPage(page, 1).locator('canvas').evaluate((c) => getComputedStyle(c).filter);
	expect(await filter()).toBe('none');

	await button(page, 'Dark pages').click();
	await expect(button(page, 'Dark pages')).toHaveAttribute('aria-pressed', 'true');
	expect(await filter()).toContain('invert(1)');

	await openEditor(page); // reload
	await expect(pdfPage(page, 1).locator('canvas')).toBeVisible();
	await expect(button(page, 'Dark pages')).toHaveAttribute('aria-pressed', 'true');
	expect(await filter()).toContain('invert(1)');
});

test('download saves main.pdf (US4-6)', async ({ page }) => {
	await openEditor(page);
	await compileDoc(page, THREE, 'Page one.', 3);
	const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download PDF' }).click()]);
	expect(file.suggestedFilename()).toBe('main.pdf');
});

test('with no PDF the page, zoom and download controls are disabled (US4-7)', async ({ page }) => {
	clearCompileOutput();
	await openEditor(page);
	await expect(page.getByText('Click Recompile or press Ctrl/⌘+Enter to see your PDF.')).toBeVisible();
	for (const name of ['Dark pages', 'Previous page', 'Next page', 'Zoom out', 'Zoom in']) await expect(button(page, name)).toBeDisabled();
	await expect(zoomLevel(page)).toBeDisabled();
	await expect(pageInput(page)).toBeDisabled();
	await expect(download(page)).toHaveAttribute('aria-disabled', 'true');
	await expect(download(page)).not.toHaveAttribute('href');
});

test('a new PDF keeps page 2 at 150 %, clamped when the document shrinks (US4-8, FR-019)', async ({ page }) => {
	await openEditor(page);
	await compileDoc(page, THREE, 'Page one.', 3);
	await zoomTo(page, '150%');
	await pageInput(page).fill('2');
	await pageInput(page).press('Enter');
	await expect(pageInput(page)).toHaveValue('2');

	await compileDoc(page, THREE.replace('Page two.', 'Page two again.'), 'Page two again.', 3);
	await expect(zoomLevel(page)).toHaveText('150%');
	await expect(pageInput(page)).toHaveValue('2');
	await expect(pdfPage(page, 2)).toBeInViewport();

	await compileDoc(page, '\\documentclass{article}\n\\begin{document}\nOnly page.\n\\end{document}\n', 'Only page.', 1);
	await expect(zoomLevel(page)).toHaveText('150%');
	await expect(pageInput(page)).toHaveValue('1');
});

test('page, zoom and dark toggle respond within 200 ms on 20 pages (SC-006)', async ({ page }) => {
	await openEditor(page);
	await compileDoc(page, fixture('twenty-pages.tex'), 'Part 1', 20);
	const ms = {
		page: await timeClick(page, 'Next page', 'page'),
		zoom: await timeClick(page, 'Zoom in', 'zoom'),
		dark: await timeClick(page, 'Dark pages', 'dark')
	};
	console.log(`SC-006 ${test.info().project.name}: ${JSON.stringify(ms)}`);
	for (const v of Object.values(ms)) expect(v).toBeLessThan(200);
});
