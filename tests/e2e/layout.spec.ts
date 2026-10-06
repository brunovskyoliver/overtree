import { expect, test, type Locator, type Page } from '@playwright/test';
import { openEditor, resetDoc } from './helpers.ts';

const pane = (page: Page, id: string) => page.locator(`[data-pane-id="${id}"]`);
const width = async (l: Locator) => (await l.boundingBox())!.width;
const height = async (l: Locator) => (await l.boundingBox())!.height;

/** Drag a handle by (dx, dy) pixels from its center. */
async function drag(page: Page, handle: Locator, dx: number, dy: number) {
	const box = (await handle.boundingBox())!;
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	// stay inside the viewport: Firefox drops a mouseup outside it and the drag never ends
	const { width: vw, height: vh } = page.viewportSize()!;
	const tx = Math.min(Math.max(x + dx, 1), vw - 1);
	const ty = Math.min(Math.max(y + dy, 1), vh - 1);
	await page.mouse.move((x + tx) / 2, (y + ty) / 2, { steps: 5 });
	await page.mouse.move(tx, ty, { steps: 5 });
	await page.mouse.up();
}

// every test starts from the default layout
test.beforeEach(async ({ page }) => {
	await page.goto('/');
	await page.evaluate(() => localStorage.clear());
	await openEditor(page);
});

test.afterEach(async ({ page }) => {
	if (await page.evaluate(() => !!window.__overtree)) await resetDoc(page);
});

test('sidebar, editor and PDF pane are visible (US2-1, US2-5)', async ({ page }) => {
	const tree = page.getByRole('tree', { name: 'File tree' });
	await expect(tree).toBeVisible();
	await expect(tree.getByRole('treeitem', { name: 'main.tex', selected: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'File outline' })).toBeVisible();
	await expect(page.locator('.cm-content')).toBeVisible();
	const pdf = page.getByRole('region', { name: 'PDF preview' });
	await expect(pdf.getByRole('button', { name: 'Recompile' })).toBeVisible();
	const vw = page.viewportSize()!.width;
	expect(await width(pane(page, 'sidebar'))).toBeGreaterThan(vw * 0.15);
	expect(await width(pane(page, 'pdf'))).toBeGreaterThan(vw * 0.35);
});

test('dragging the borders resizes panes within their minimums (US2-2, US2-6)', async ({ page }) => {
	const vw = page.viewportSize()!.width;
	const sidebar = pane(page, 'sidebar');
	const editor = pane(page, 'editor');
	const pdf = pane(page, 'pdf');

	const s0 = await width(sidebar);
	await drag(page, page.getByRole('separator', { name: 'Resize sidebar' }), 80, 0);
	expect(await width(sidebar)).toBeGreaterThan(s0 + 60);

	const p0 = await width(pdf);
	await drag(page, page.getByRole('separator', { name: 'Resize PDF' }), 100, 0);
	expect(await width(pdf)).toBeLessThan(p0 - 80);

	// push the editor as small as it goes: it stops at 25%
	await drag(page, page.getByRole('separator', { name: 'Resize sidebar' }), vw, 0);
	expect(await width(editor)).toBeGreaterThanOrEqual(vw * 0.25 - 8);

	const tree = pane(page, 'tree');
	const outline = pane(page, 'outline');
	const t0 = await height(tree);
	const divider = page.getByRole('separator', { name: 'Resize file tree and outline' });
	await drag(page, divider, 0, -100);
	expect(await height(tree)).toBeLessThan(t0 - 80);
	await drag(page, divider, 0, 2000);
	const total = (await height(tree)) + (await height(outline));
	expect(await height(outline)).toBeGreaterThanOrEqual(total * 0.15 - 2);
});

test('collapse and expand restore the previous width; reload keeps the layout (US2-3, US2-4, US2-7)', async ({
	page
}) => {
	const sidebar = pane(page, 'sidebar');
	const editor = pane(page, 'editor');
	const pdf = pane(page, 'pdf');

	await drag(page, page.getByRole('separator', { name: 'Resize sidebar' }), 60, 0);
	const s0 = await width(sidebar);
	const e0 = await width(editor);

	const collapseSidebar = page.getByRole('button', { name: 'Collapse sidebar' });
	await expect(collapseSidebar).toHaveAttribute('aria-expanded', 'true');
	await collapseSidebar.click();
	await expect.poll(() => width(sidebar)).toBe(0);
	expect(await width(editor)).toBeGreaterThan(e0 + s0 - 4);
	const expandSidebar = page.getByRole('button', { name: 'Expand sidebar' });
	await expect(expandSidebar).toHaveAttribute('aria-expanded', 'false');
	await expandSidebar.click();
	await expect.poll(() => width(sidebar)).toBeCloseTo(s0, 0);

	const p0 = await width(pdf);
	await page.getByRole('button', { name: 'Collapse PDF' }).click();
	await expect.poll(() => width(pdf)).toBe(0);
	await page.getByRole('button', { name: 'Expand PDF' }).click();
	await expect.poll(() => width(pdf)).toBeCloseTo(p0, 0);

	// collapsed PDF + custom sidebar width survive a reload (FR-018)
	await page.getByRole('button', { name: 'Collapse PDF' }).click();
	await expect.poll(() => width(pdf)).toBe(0);
	// paneforge writes local storage 100 ms after the last change
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('paneforge:overtree:layout:main')))
		.toContain(',0]}');
	await page.reload();
	await openEditor(page);
	await expect.poll(() => width(pdf)).toBe(0);
	await expect(page.getByRole('button', { name: 'Expand PDF' })).toHaveAttribute('aria-expanded', 'false');
	expect(await width(sidebar)).toBeCloseTo(s0, 0);
	await page.getByRole('button', { name: 'Expand PDF' }).click();
	await expect.poll(() => width(pdf)).toBeCloseTo(p0, 0);

	// the tree/outline split and a collapsed sidebar survive a reload too
	const tree = pane(page, 'tree');
	const t0 = await height(tree);
	await drag(page, page.getByRole('separator', { name: 'Resize file tree and outline' }), 0, -100);
	const t1 = await height(tree);
	expect(t1).toBeLessThan(t0 - 80);
	await page.getByRole('button', { name: 'Collapse sidebar' }).click();
	await expect.poll(() => width(sidebar)).toBe(0);
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('paneforge:overtree:layout:main')))
		.toContain('[0,');
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('paneforge:overtree:layout:sidebar')))
		.toBeTruthy();
	await page.reload();
	await openEditor(page);
	await expect.poll(() => width(sidebar)).toBe(0);
	await expect(page.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false');
	await page.getByRole('button', { name: 'Expand sidebar' }).click();
	await expect.poll(() => width(sidebar)).toBeCloseTo(s0, 0);
	expect(await height(tree)).toBeCloseTo(t1, 0);
});

/** Tab 30 times from the header; returns `role:name` of every focused control, each checked for a focus ring. */
async function tabThrough(page: Page, browserName: string) {
	// Safari only tabs to buttons with Option+Tab
	const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
	await page.locator('header').click();
	const seen = new Set<string>();
	for (let i = 0; i < 30; i++) {
		await page.keyboard.press(tab);
		const info = await page.evaluate(() => {
			const el = document.activeElement as HTMLElement;
			const name = el.getAttribute('aria-label') ?? el.textContent!.trim();
			return { name: `${el.getAttribute('role') ?? el.tagName.toLowerCase()}:${name}`, outline: getComputedStyle(el).outlineStyle };
		});
		if (info.name.startsWith('body:')) continue; // focus left the page
		if (info.name.startsWith('textbox:')) continue; // CodeMirror content, ringed by its own theme
		expect(info.outline, info.name).not.toBe('none');
		seen.add(info.name);
	}
	return [...seen];
}

test('Tab reaches every control with a visible focus ring (US2-8, FR-016)', async ({ page, browserName }) => {
	// the outline parses 200 ms after the document syncs
	await expect(page.getByRole('navigation', { name: 'File outline' }).getByRole('button')).toHaveText(['Introduction']);
	const seen = await tabThrough(page, browserName);
	for (const name of [
		'treeitem:main.tex',
		'button:Introduction',
		'separator:Resize file tree and outline',
		'separator:Resize sidebar',
		'separator:Resize PDF',
		'button:Undo',
		'button:Redo',
		'button:Bold',
		'button:Italic',
		'button:Section',
		'button:Link',
		'button:Figure',
		'button:Table',
		'button:Search',
		'button:Collapse sidebar',
		'button:Collapse PDF'
	])
		expect(seen).toContain(name);
});

test('Tab skips a collapsed sidebar (US2-8, FR-016)', async ({ page, browserName }) => {
	await expect(page.getByRole('navigation', { name: 'File outline' }).getByRole('button')).toHaveText(['Introduction']);
	await page.getByRole('button', { name: 'Collapse sidebar' }).click();
	await expect.poll(() => width(pane(page, 'sidebar'))).toBe(0);
	const seen = await tabThrough(page, browserName);
	expect(seen).toContain('button:Expand sidebar');
	for (const name of ['treeitem:main.tex', 'button:Introduction', 'separator:Resize file tree and outline'])
		expect(seen).not.toContain(name);
});

test('a 1024 px window keeps the minimum widths (edge case)', async ({ page }) => {
	await page.setViewportSize({ width: 1024, height: 768 });
	const min = { sidebar: 0.12, editor: 0.25, pdf: 0.15 };
	for (const [id, share] of Object.entries(min))
		expect(await width(pane(page, id))).toBeGreaterThanOrEqual(1024 * share - 8);
	// squeezing the editor from both sides stops at its minimum
	await drag(page, page.getByRole('separator', { name: 'Resize sidebar' }), 1024, 0);
	await drag(page, page.getByRole('separator', { name: 'Resize PDF' }), -1024, 0);
	expect(await width(pane(page, 'editor'))).toBeGreaterThanOrEqual(1024 * min.editor - 8);
});
