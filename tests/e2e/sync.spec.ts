import { expect, type Page } from '@playwright/test';
import { openEditor, resetDoc, test } from './helpers.ts';

let a: Page;
let b: Page;

test.beforeEach(async ({ browser }) => {
	a = await (await browser.newContext()).newPage();
	b = await (await browser.newContext()).newPage();
	await openEditor(a);
	await openEditor(b);
});

test.afterEach(async () => {
	await resetDoc(a);
	await a.context().close();
	await b.context().close();
});

const has = (page: Page, s: string) =>
	page.waitForFunction((s) => window.__overtree!.view.state.doc.toString().includes(s), s);

test('an edit in one tab appears in the other in under 300 ms (US1-6, SC-003)', async () => {
	const marker = `sync-${Date.now()}`;
	// B timestamps the moment it sees the marker, on the same clock as A's timestamp
	const seen = b.evaluate(
		(m) =>
			new Promise<number>((resolve) => {
				const tick = () =>
					window.__overtree!.view.state.doc.toString().includes(m) ? resolve(Date.now()) : setTimeout(tick, 2);
				tick();
			}),
		marker
	);
	await a.locator('.cm-content').press('ControlOrMeta+End');
	const sent = await a.evaluate(() => Date.now());
	await a.keyboard.insertText(`% ${marker}`);
	expect((await seen) - sent).toBeLessThan(300);
});

test('offline edits show "Offline" and sync after reconnect (FR-015)', async () => {
	await a.evaluate(() => window.__overtree!.provider.configuration.websocketProvider.disconnect());
	await expect(a.getByRole('status')).toHaveText('Offline');

	const marker = `offline-${Date.now()}`;
	await a.locator('.cm-content').press('ControlOrMeta+End');
	await a.keyboard.type(`% ${marker}`);
	await b.waitForTimeout(300);
	expect(await b.evaluate(() => window.__overtree!.view.state.doc.toString())).not.toContain(marker);

	await a.evaluate(() => window.__overtree!.provider.configuration.websocketProvider.connect());
	await expect(a.getByRole('status')).toHaveText('Saved');
	await has(b, marker);
});
