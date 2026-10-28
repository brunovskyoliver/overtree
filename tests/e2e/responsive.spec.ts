import { expect, type Locator, type Page } from '@playwright/test';
import { api, openEditor, test } from './helpers.ts';

/** Visibility alone passes for controls painted outside an overflow-hidden pane. */
async function contained(controls: Locator, container: Locator) {
	const box = (await container.boundingBox())!;
	for (const control of await controls.all()) {
		if (!(await control.isVisible())) continue;
		const r = (await control.boundingBox())!;
		const name = (await control.getAttribute('aria-label')) ?? (await control.textContent());
		expect(r.x, name ?? '').toBeGreaterThanOrEqual(box.x - 1);
		expect(r.x + r.width, name ?? '').toBeLessThanOrEqual(box.x + box.width + 1);
		expect(r.y, name ?? '').toBeGreaterThanOrEqual(box.y - 1);
		expect(r.y + r.height, name ?? '').toBeLessThanOrEqual(box.y + box.height + 1);
	}
}

async function noPageOverflow(page: Page) {
	expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

for (const width of [1440, 1024, 768, 390]) {
	test(`editor controls stay inside their panes at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await page.request.patch(api(), { data: { title: 'A long project title with enough words to compete with every toolbar action for space' } });
		await openEditor(page);
		await noPageOverflow(page);
		await contained(page.locator('header.topbar button'), page.locator('header.topbar'));
		for (const id of ['sidebar', 'editor', 'pdf']) {
			const pane = page.locator(`[data-pane-id="${id}"]`);
			await contained(pane.locator('.header button, [role="toolbar"] button, .bar button, .bar input, .bar a'), pane);
		}
		await page.getByRole('button', { name: 'Editor settings', exact: true }).click();
		await expect(page.getByRole('group', { name: 'Editor settings', exact: true })).toBeVisible();
		await page.keyboard.press('Escape');
		await page.getByRole('button', { name: 'Compile options' }).click();
		const menu = page.getByRole('menu', { name: 'Compile options' });
		await expect(menu).toBeVisible();
		await contained(menu, page.locator('body'));
		// Hit testing catches a menu that is geometrically in bounds but clipped by the PDF pane.
		await menu.getByRole('menuitemcheckbox', { name: 'Auto compile', exact: true }).click();
		await expect(menu.getByRole('menuitemcheckbox', { name: 'Auto compile', exact: true })).toHaveAttribute('aria-checked', 'true');
		await page.keyboard.press('Escape');
		await page.getByRole('button', { name: 'Layout', exact: true }).click();
		await contained(page.getByRole('menu', { name: 'Layout', exact: true }), page.locator('body'));
		await page.getByRole('menuitemradio', { name: 'Editor only', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Expand PDF' })).toBeVisible();
	});
}

test('dashboard keeps project names and row actions usable at phone width', async ({ page, pid }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const title = `An exceptionally long project title that should remain readable on a narrow screen ${pid.slice(0, 8)}`;
	await page.request.patch(api(), { data: { title } });
	await page.goto('/');
	await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
	await noPageOverflow(page);
	const titleBox = (await page.getByRole('link', { name: title, exact: true }).boundingBox())!;
	expect(titleBox.width).toBeGreaterThan(200);
	await page.getByRole('button', { name: `Actions for ${title}`, exact: true }).click();
	await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
	await page.getByRole('textbox', { name: 'Project title' }).fill('Renamed from a narrow screen');
	await page.getByRole('textbox', { name: 'Project title' }).press('Enter');
	await expect(page.locator(`a[href="/project/${pid}"]`)).toHaveText('Renamed from a narrow screen');
});

test('admin tables scroll locally without widening the page', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/admin');
	await expect(page.getByRole('table')).toBeVisible();
	await noPageOverflow(page);
	const table = page.getByRole('region', { name: 'Users table' });
	await table.focus();
	await table.evaluate((el) => (el.scrollLeft = el.scrollWidth));
	await contained(page.getByRole('button', { name: 'Remove admin', exact: true }), table);
	await noPageOverflow(page);
});
