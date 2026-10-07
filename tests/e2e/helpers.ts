import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import type { FileEntry, ProjectInfo } from '../../src/lib/files.ts';
import { SEED } from '../../src/lib/server/collab.ts';
import { readTree } from '../fixtures/projects/zips.ts';

export { SEED };

/** The default e2e user: in ADMIN_EMAILS (playwright.config.ts), so the invite-only sign-up policy lets it in. */
export const USER = 'admin@test.local';

/** Sign the context in through the test bypass (research R4): the cookie the server reads with OVERTREE_TEST_AUTH=1. */
export async function signInAs(context: BrowserContext, email = USER) {
	await context.addCookies([{ name: 'overtree-test-user', value: encodeURIComponent(email), domain: '127.0.0.1', path: '/' }]);
}

type Signup = { signupMode: 'open' | 'invite'; allowlist: string[] };

/** Change the sign-up settings through the admin API; `request` must be signed in as an admin (USER is). */
export async function signup(request: APIRequestContext, change: (s: Signup) => Signup) {
	const current: Signup = await (await request.get('/api/admin/settings')).json();
	const res = await request.put('/api/admin/settings', { data: change(current) });
	expect(res.status()).toBe(200);
}

/** Let these emails or domains sign up (invite-only instance). */
export const allow = (request: APIRequestContext, ...entries: string[]) =>
	signup(request, (s) => ({ ...s, allowlist: [...new Set([...s.allowlist, ...entries])] }));

/** Create a blank project through the API as the page's user; returns its id. */
export async function newProject(page: Page, title = 'Untitled project') {
	const res = await page.request.post('/api/projects', { data: { title } });
	expect(res.status()).toBe(201);
	return ((await res.json()) as { id: string }).id;
}

export const openProject = (page: Page, id: string) => page.goto(`/project/${id}`);

// the project of the running test (one worker: a module variable is enough)
let current = '';

/** Every test runs signed in as USER in a fresh project of its own (no coupling between specs). */
export const test = base.extend<{ pid: string }>({
	context: async ({ context }, use) => {
		await signInAs(context);
		await use(context);
	},
	pid: [
		async ({ page }, use) => {
			current = await newProject(page);
			await use(current);
		},
		{ auto: true }
	]
});

/** The editor page of the test's project. */
export const projectPath = (id = current) => `/project/${id}`;

/** Base URL of the test project's API, e.g. `${api()}/files`. */
export const api = (id = current) => `/api/projects/${id}`;

/** Open the test's project (signing in contexts made with `browser.newContext()`) and wait until the editor has
 *  synced its document. */
export async function openEditor(page: Page, id = current) {
	await signInAs(page.context());
	await page.goto(projectPath(id));
	await expect(page.getByRole('status')).toHaveText('Saved');
	await page.waitForFunction(() => window.__overtree?.provider.isSynced);
	return page.locator('.cm-content');
}

export const text = (page: Page) => page.evaluate(() => window.__overtree!.view.state.doc.toString());

/** Put the document back to the seed and wait until the server has it. */
export const resetDoc = (page: Page) => setDoc(page, SEED);

/** Delete the stored compile output of the test's project so the app shows the no-PDF state after a reload. */
export function clearCompileOutput(id = current) {
	rmSync(join(process.env.OVERTREE_E2E_DATA_DIR!, 'compile', id), { recursive: true, force: true });
}

/** Replace the whole document and wait until the server has it. */
export async function setDoc(page: Page, content: string) {
	await page.evaluate((content) => {
		const { view } = window.__overtree!;
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
	}, content);
	await page.waitForFunction(() => !window.__overtree!.provider.hasUnsyncedChanges);
}

/** Back to a fresh project's state: only a root `main.tex` (the main document) with the seed text, no tree
 *  state in localStorage. Folders take their descendants with them. */
export async function resetProject(page: Page) {
	const request = page.request;
	const { files }: ProjectInfo = await (await request.get(`${api()}/files`)).json();
	let main = files.find((f) => f.parentId === null && f.name === 'main.tex');
	main ??= await (await request.post(`${api()}/files`, { data: { kind: 'text', name: 'main.tex', parentId: null } })).json();
	await request.put(`${api()}/main`, { data: { fileId: main!.id } });
	// Origin like a browser: SvelteKit's CSRF check refuses a body-less DELETE without a matching one
	const headers = { origin: new URL(page.url()).origin };
	for (const f of files)
		if (f.parentId === null && f.id !== main!.id) expect((await request.delete(`${api()}/files/${f.id}`, { headers })).status()).toBe(204);
	await page.goto(projectPath());
	await page.evaluate(() => localStorage.clear());
	await openEditor(page);
	await resetDoc(page);
}

/** Upload one file (multipart, T032); `replace` overwrites the seeded main.tex. Origin like a browser form post. */
export async function upload(page: Page, path: string, bytes: Buffer, parentId: string | null) {
	const res = await page.request.post(`${api()}/files`, {
		headers: { origin: new URL(page.url()).origin },
		multipart: { file: { name: path.split('/').at(-1)!, mimeType: 'application/octet-stream', buffer: bytes }, parentId: parentId ?? '', replace: '1' }
	});
	expect(res.ok()).toBe(true);
	return (await res.json()) as FileEntry;
}

/** tests/fixtures/projects/multi into the project: folders by JSON create, files by upload. */
export async function loadMulti(page: Page) {
	const folders = new Map<string, string>();
	for (const [path, bytes] of Object.entries(readTree(fileURLToPath(new URL('../fixtures/projects/multi', import.meta.url))))) {
		const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
		if (dir && !folders.has(dir)) {
			const res = await page.request.post(`${api()}/files`, { data: { kind: 'folder', name: dir, parentId: null } });
			expect(res.status()).toBe(201);
			folders.set(dir, (await res.json()).id);
		}
		await upload(page, path, Buffer.from(bytes), folders.get(dir) ?? null);
	}
}
