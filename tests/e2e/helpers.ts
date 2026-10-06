import { expect, type Page } from '@playwright/test';
import { SEED } from '../../src/lib/server/collab.ts';

export { SEED };

/** Open the app and wait until the editor has synced the shared document. */
export async function openEditor(page: Page) {
	await page.goto('/');
	await expect(page.getByRole('status')).toHaveText('Saved');
	await page.waitForFunction(() => window.__overtree?.provider.isSynced);
	return page.locator('.cm-content');
}

export const text = (page: Page) => page.evaluate(() => window.__overtree!.view.state.doc.toString());

/** Put the shared document back to the seed (all specs share one server) and wait until the server has it. */
export async function resetDoc(page: Page) {
	await page.evaluate((seed) => {
		const { view } = window.__overtree!;
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: seed } });
	}, SEED);
	await page.waitForFunction(() => !window.__overtree!.provider.hasUnsyncedChanges);
}
