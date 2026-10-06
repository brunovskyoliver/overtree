import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { ProjectInfo } from '../../src/lib/files.ts';
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
export const resetDoc = (page: Page) => setDoc(page, SEED);

/** Delete the stored compile output so the app shows the no-PDF state after a reload. */
export function clearCompileOutput() {
	rmSync(join(process.env.OVERTREE_E2E_DATA_DIR!, 'compile', 'main'), { recursive: true, force: true });
}

/** Replace the whole document and wait until the server has it. */
export async function setDoc(page: Page, content: string) {
	await page.evaluate((content) => {
		const { view } = window.__overtree!;
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
	}, content);
	await page.waitForFunction(() => !window.__overtree!.provider.hasUnsyncedChanges);
}

/** Back to the 002 state for the next spec: only a root `main.tex` (the main document) with the seed text,
 *  no tree state in localStorage. Folders take their descendants with them. */
export async function resetProject(page: Page) {
	const api = page.request;
	const { files }: ProjectInfo = await (await api.get('/api/files')).json();
	let main = files.find((f) => f.parentId === null && f.name === 'main.tex');
	main ??= await (await api.post('/api/files', { data: { kind: 'text', name: 'main.tex', parentId: null } })).json();
	await api.put('/api/project', { data: { mainFileId: main!.id } });
	// Origin like a browser: SvelteKit's CSRF check refuses a body-less DELETE without a matching one
	const headers = { origin: new URL(page.url()).origin };
	for (const f of files)
		if (f.parentId === null && f.id !== main!.id) expect((await api.delete(`/api/files/${f.id}`, { headers })).status()).toBe(204);
	await page.goto('/');
	await page.evaluate(() => localStorage.clear());
	await openEditor(page);
	await resetDoc(page);
}
