import { expect, type Page } from '@playwright/test';
import { openEditor, resetDoc, setDoc, test } from './helpers.ts';

const ONE = '\\documentclass{article}\n\\begin{document}\nOnly page.\n\\end{document}\n';
const viewer = (page: Page) => page.getByTestId('pdf-viewer');

test.afterEach(async ({ page }) => {
	await page.evaluate(() => localStorage.clear());
	await resetDoc(page);
});

// A page that only needs a vertical scrollbar at the wider fit: with a classic (space-taking) scrollbar, refitting
// to the narrower pane dropped the scrollbar again, and the zoom flipped back and forth for good.
test('fit width settles when the page is just taller than the pane', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 1400 });
	await openEditor(page);
	await setDoc(page, ONE);
	await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/compile')), page.getByRole('button', { name: 'Recompile' }).click()]);
	await expect(viewer(page)).toContainText('Only page.', { timeout: 10_000 });
	// fit width is the default zoom
	// headless browsers draw overlay scrollbars; macOS "always show scrollbars" takes width like this
	await page.addStyleTag({ content: '::-webkit-scrollbar { width: 15px; height: 15px; } ::-webkit-scrollbar-thumb { background: #888; }' });
	await expect(viewer(page).locator('.page canvas').first()).toBeVisible();
	await page.waitForTimeout(500);

	// shrink the window until the pane is a few pixels shorter than the fitted page
	const { content, client } = await viewer(page).evaluate((el) => ({ content: el.querySelector<HTMLElement>('.pdfViewer')!.offsetHeight, client: el.clientHeight }));
	expect(content).toBeLessThan(client); // tall window: no scrollbar yet
	await page.setViewportSize({ width: 1280, height: 1400 - (client - content) - 6 });

	const changes = await page.evaluate(async () => {
		const label = document.querySelector('[aria-label^="Zoom level"]')!;
		let n = 0;
		const watch = new MutationObserver(() => n++);
		watch.observe(label, { childList: true, characterData: true, subtree: true });
		await new Promise((r) => setTimeout(r, 1500));
		watch.disconnect();
		return n;
	});
	expect(changes).toBeLessThanOrEqual(2);
});
