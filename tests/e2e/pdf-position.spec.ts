import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { openEditor, resetDoc, setDoc, test } from './helpers.ts';

// US4: the PDF keeps its place across recompiles and reloads (FR-025, SC-007, research R11).

const TWENTY = readFileSync(new URL('../fixtures/latex/twenty-pages.tex', import.meta.url), 'utf8');
const viewer = (page: Page) => page.getByTestId('pdf-viewer');
const pageInput = (page: Page) => page.getByRole('textbox', { name: 'Page number' });

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

/** Which page is at the top edge of the PDF pane and how far down it (0–1). */
const position = (page: Page) =>
	viewer(page).evaluate((el) => {
		const top = el.getBoundingClientRect().top;
		for (const div of el.querySelectorAll<HTMLElement>('.page:not([data-old])')) {
			const r = div.getBoundingClientRect();
			if (r.bottom > top) return { page: Number(div.dataset.pageNumber), offset: (top - r.top - div.clientTop) / div.clientHeight };
		}
		return null;
	});

const near = (page: Page, n: number, offset: number) =>
	expect
		.poll(async () => {
			const p = await position(page);
			return p?.page === n && Math.abs(p.offset - offset) <= 0.05;
		})
		.toBe(true);

test.afterEach(async ({ page }) => {
	await page.evaluate(() => localStorage.clear());
	await resetDoc(page);
});

test('page and offset survive a recompile and a reload; a shorter PDF shows its last page (US4-1..3)', async ({ page }) => {
	await openEditor(page);
	await compileDoc(page, TWENTY, 'Part 1', 20);

	// halfway down page 5
	await viewer(page).evaluate((el) => {
		const div = el.querySelector<HTMLElement>('.page[data-page-number="5"]')!;
		el.scrollTop += div.getBoundingClientRect().top + div.clientTop + div.clientHeight / 2 - el.getBoundingClientRect().top;
	});
	await near(page, 5, 0.5);

	// (the toolbar's page number is pdf.js's most visible page, which may be 6 here: the top edge is the position)
	await compileDoc(page, TWENTY.replace('This is page 5 of', 'Now this is page 5 of'), 'Now this is page 5', 20);
	await near(page, 5, 0.5);

	await openEditor(page); // reload
	await expect(viewer(page).locator('.page canvas').first()).toBeAttached({ timeout: 10_000 });
	await near(page, 5, 0.5);

	const three = TWENTY.split('\\newpage').slice(0, 3).join('\\newpage') + '\n\\end{document}\n';
	await compileDoc(page, three, 'Part 3', 3);
	await expect(pageInput(page)).toHaveValue('3');
	expect((await position(page))?.page).toBe(3);
});

test('the zoom survives a reload with the position', async ({ page }) => {
	await openEditor(page);
	await compileDoc(page, TWENTY, 'Part 1', 20);
	await page.getByRole('button', { name: /^Zoom level/ }).click();
	await page.getByRole('menu', { name: 'Zoom' }).getByRole('menuitemradio', { name: '150%', exact: true }).click();
	await pageInput(page).fill('7');
	await pageInput(page).press('Enter');
	await near(page, 7, 0);

	await openEditor(page); // reload
	await expect(page.getByRole('button', { name: /^Zoom level/ })).toHaveText('150%');
	await expect(pageInput(page)).toHaveValue('7');
	await near(page, 7, 0);
});
