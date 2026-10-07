import { expect, type Page } from '@playwright/test';
import { api, openEditor, projectPath, resetProject, setDoc, test, upload } from './helpers.ts';

// The PDF follows the focused document: a standalone .tex (its own \documentclass) compiles and shows on its own,
// a chapter without one shows the main document.

const MAIN = '\\documentclass{article}\n\\begin{document}\nMAIN-DOC\n\\input{chapter}\n\\end{document}\n';
const OTHER = '\\documentclass{article}\n\\begin{document}\nOTHER-DOC\n\\end{document}\n';
const CHAPTER = 'CHAPTER-TEXT\n';

const tree = (page: Page) => page.getByRole('tree', { name: 'File tree' });
const row = (page: Page, name: string) => tree(page).getByRole('treeitem', { name, exact: true }).locator(':scope > .row');
const viewer = (page: Page) => page.getByTestId('pdf-viewer');
const compiles = (page: Page) => {
	const bodies: { root?: string }[] = [];
	page.on('request', (r) => r.method() === 'POST' && r.url().endsWith('/compile') && bodies.push(r.postDataJSON()));
	return bodies;
};

test.beforeEach(async ({ page }) => {
	await page.goto(projectPath());
	await page.evaluate(() => localStorage.clear());
	await openEditor(page);
	await setDoc(page, MAIN);
});

test.afterEach(async ({ page }) => {
	await resetProject(page);
});

test('a standalone .tex shows its own PDF; a chapter and the main file show the main one', async ({ page }) => {
	const other = await upload(page, 'other.tex', Buffer.from(OTHER), null);
	await upload(page, 'chapter.tex', Buffer.from(CHAPTER), null);
	await page.reload();
	await openEditor(page);
	const sent = compiles(page);

	await page.getByRole('button', { name: 'Recompile' }).click();
	await expect(viewer(page)).toContainText('MAIN-DOC', { timeout: 15_000 });
	await expect(viewer(page)).toContainText('CHAPTER-TEXT');

	// first focus on the standalone document: compiled on its own and shown
	await row(page, 'other.tex').click();
	await expect(viewer(page)).toContainText('OTHER-DOC', { timeout: 15_000 });
	await expect(viewer(page)).not.toContainText('MAIN-DOC');
	expect(sent.at(-1)?.root).toBe(other.id);

	// Recompile there compiles that document again
	await page.getByRole('button', { name: 'Recompile' }).click();
	await expect.poll(() => sent.length).toBe(3);
	expect(sent.at(-1)?.root).toBe(other.id);

	// a chapter belongs to the main document
	await row(page, 'chapter.tex').click();
	await expect(viewer(page)).toContainText('MAIN-DOC', { timeout: 10_000 });

	// back to the standalone one: its last PDF, no new compile
	await row(page, 'other.tex').click();
	await expect(viewer(page)).toContainText('OTHER-DOC', { timeout: 10_000 });
	expect(sent.length).toBe(3);

	// its PDF and SyncTeX are its own
	const { last } = await (await page.request.get(`${api()}/compile?root=${other.id}`)).json();
	expect(last.rootId).toBe(other.id);
	const sync = await page.request.get(`${api()}/compile/sync/code?pdfId=${last.pdfId}&fileId=${other.id}&line=3&root=${other.id}`);
	expect(sync.status()).toBe(200);
	expect((await page.request.get(`${api()}/compile/output.pdf?root=${other.id}`)).headers()['content-type']).toBe('application/pdf');

	// the main tab: the main PDF again
	await row(page, 'main.tex, main document').click();
	await expect(viewer(page)).toContainText('MAIN-DOC', { timeout: 10_000 });
});

test('root must be a .tex file of the project', async ({ page }) => {
	const png = await upload(page, 'pic.png', Buffer.from('not really a png'), null);
	expect((await page.request.get(`${api()}/compile?root=${png.id}`)).status()).toBe(404);
	expect((await page.request.get(`${api()}/compile?root=nope`)).status()).toBe(404);
});
