import { expect, type Page } from '@playwright/test';
import type { ProjectInfo } from '../../src/lib/files.ts';
import { ZOTERO } from '../fake-refs/server.ts';
import { allow, api, openEditor, setDoc, signInAs, test, text, upload } from './helpers.ts';

// 017 References against tests/fake-refs (playwright.config.ts): DOI/arXiv lookup, de-duplication, Zotero.

const DOC = (bib: string) => `\\documentclass{article}
\\begin{document}
As shown in .
\\bibliographystyle{plain}
\\bibliography{${bib}}
\\end{document}
`;

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Add reference' });
const row = (page: Page, name: string) =>
	page.getByRole('tree', { name: 'File tree' }).getByRole('treeitem', { name, exact: true }).locator(':scope > .row');
const popup = (page: Page) => page.locator('.cm-tooltip-autocomplete');
const viewer = (page: Page) => page.getByTestId('pdf-viewer');

/** The cursor right after `before` in the open document. */
async function cursorAfter(page: Page, before: string) {
	await page.evaluate((before) => {
		const { view } = window.__overtree!;
		const at = view.state.doc.toString().indexOf(before) + before.length;
		view.dispatch({ selection: { anchor: at } });
	}, before);
}

/** The server's text of a project file, by name. */
async function fileText(page: Page, name: string) {
	const { files }: ProjectInfo = await (await page.request.get(`${api()}/files`)).json();
	const f = files.find((f) => f.name === name);
	return f ? (await page.request.get(`${api()}/files/${f.id}/raw`)).text() : null;
}

async function lookUp(page: Page, id: string) {
	await page.getByRole('button', { name: 'Add reference' }).click();
	await expect(dialog(page)).toBeVisible();
	await dialog(page).getByLabel('DOI or arXiv ID').fill(id);
	await dialog(page).getByRole('button', { name: 'Look up' }).click();
}

test('DOI → preview → new references.bib → \\cite completion → compiled bibliography (US1, US3)', async ({ page }) => {
	test.setTimeout(60_000); // two compile passes with bibtex
	await openEditor(page);
	await setDoc(page, DOC('references'));
	await cursorAfter(page, 'As shown in ');

	await lookUp(page, 'https://doi.org/10.1234/deep.2021');
	const d = dialog(page);
	await expect(d.getByLabel('Key')).toHaveValue('smith2021deep');
	const preview = d.getByLabel('BibTeX entry');
	await expect(preview).toContainText('@article{smith2021deep,');
	await expect(preview).toContainText('title = {Deep Learning for Typesetting}');
	await expect(preview).toContainText('author = {Smith, Jane and Doe, John}');
	// the main document loads references.bib, which doesn't exist yet: it is the default, created on insert
	await expect(d.getByLabel('Add to')).toHaveValue('references.bib');
	await expect(d.getByLabel('Add to').locator('option:checked')).toHaveText('references.bib (new file)');
	await expect(d.getByRole('checkbox', { name: /Also insert/ })).toBeChecked();
	await d.getByRole('button', { name: 'Add to references.bib' }).click();
	await expect(d).toBeHidden();

	await expect.poll(() => text(page)).toContain('As shown in \\cite{smith2021deep}.');
	await expect(row(page, 'references.bib')).toBeVisible();
	expect(await fileText(page, 'references.bib')).toContain('@article{smith2021deep,\n  title = {Deep Learning for Typesetting},');

	// the new key is in \cite completion, with "Add reference…" offered last
	// (symbols load in the background and an open popup shows them from the next keystroke: type again until then)
	const cited = await text(page);
	await expect(async () => {
		await setDoc(page, cited);
		await cursorAfter(page, '\\cite{smith2021deep}.');
		await page.keyboard.type(' See \\cite{smi');
		await expect(popup(page).getByRole('option').first()).toContainText('smith2021deep', { timeout: 1000 });
	}).toPass();
	await expect(popup(page).getByRole('option').last()).toContainText('Add reference…');
	await page.waitForTimeout(100); // CodeMirror ignores Enter for a moment after the popup changes
	await page.keyboard.press('Enter');
	await expect.poll(() => text(page)).toContain('See \\cite{smith2021deep}');

	// bibtex runs and the bibliography shows the entry
	await page.keyboard.press('ControlOrMeta+s');
	// (the plain style lowercases titles)
	await expect(viewer(page)).toContainText('Jane Smith and John Doe. Deep learning for typesetting.', { timeout: 30_000 });
	await expect(viewer(page)).toContainText('As shown in [1]. See [1]');
	await expect(viewer(page)).not.toContainText('[?]');
});

test('"Add reference…" in \\cite{ opens the dialog and the key goes into that citation (US1)', async ({ page }) => {
	await openEditor(page);
	await setDoc(page, DOC('references'));
	await cursorAfter(page, 'As shown in ');
	await page.locator('.cm-content').focus();
	// a half-typed key: the new key replaces it (closeBrackets adds no `}` before the period: typed here)
	await page.keyboard.type('\\cite{lov}');
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('Control+Space');
	await popup(page).getByRole('option', { name: /Add reference…/ }).click();
	await dialog(page).getByLabel('DOI or arXiv ID').fill('arXiv:2101.00001');
	await dialog(page).getByRole('button', { name: 'Look up' }).click();
	await expect(dialog(page).getByLabel('Key')).toHaveValue('lovelace2021attention');
	await expect(dialog(page).getByLabel('BibTeX entry')).toContainText('archiveprefix = {arXiv}');
	await dialog(page).getByRole('button', { name: 'Add to references.bib' }).click();
	await expect.poll(() => text(page)).toContain('As shown in \\cite{lovelace2021attention}.');
	// one undo step takes the citation back out (the entry stays in references.bib)
	await page.keyboard.press('ControlOrMeta+z');
	await expect.poll(() => text(page)).toContain('As shown in \\cite{lov}.');
});

test('a work already in the project offers its key; a taken key is refused; collaborators see the entry live (US1, US3)', async ({
	page,
	browser
}) => {
	await openEditor(page);
	await upload(page, 'refs.bib', Buffer.from('@article{mine,\n  title = {Mine},\n  doi = {10.1234/deep.2021}\n}\n'), null);
	await setDoc(page, DOC('refs'));
	await cursorAfter(page, 'As shown in ');

	// the same DOI, written differently: the existing key is offered, nothing is added
	await lookUp(page, '10.1234/DEEP.2021');
	await expect(dialog(page).getByRole('status')).toHaveText('Already in refs.bib as mine.');
	await dialog(page).getByRole('button', { name: 'Cite mine' }).click();
	await expect.poll(() => text(page)).toContain('As shown in \\cite{mine}.');

	// a second browser has refs.bib open
	const other = await browser.newContext();
	const second = await other.newPage();
	await openEditor(second);
	await row(second, 'refs.bib').click();
	await second.waitForFunction(() => window.__overtree?.view.state.doc.toString().includes('@article{mine'));

	await lookUp(page, 'https://arxiv.org/abs/2101.00001v2');
	const d = dialog(page);
	await expect(d.getByLabel('Key')).toHaveValue('lovelace2021attention');
	await d.getByLabel('Key').fill('mine');
	await expect(d.getByText('“mine” is already used in this project.')).toBeVisible();
	await expect(d.getByRole('button', { name: 'Add to refs.bib' })).toBeDisabled();
	await d.getByLabel('Key').fill('turing');
	await d.getByRole('checkbox', { name: /Also insert/ }).uncheck();
	await d.getByRole('button', { name: 'Add to refs.bib' }).click();
	await expect(d).toBeHidden();

	await expect.poll(() => second.evaluate(() => window.__overtree!.view.state.doc.toString())).toContain('@misc{turing,');
	expect(await text(page)).not.toContain('turing'); // no \cite this time
	expect(await fileText(page, 'refs.bib')).toMatch(/^@article\{mine,[\s\S]*\}\n\n@misc\{turing,\n {2}title = \{Attention Is Mostly What You Need \\& More\},/);
	await other.close();
});

test('readers can’t add references (US1)', async ({ page, browser, pid }) => {
	await openEditor(page);
	const reader = `reader-refs-${Date.now()}@test.local`;
	await allow(page.request, reader);
	expect((await page.request.post(`${api(pid)}/members`, { data: { email: reader, role: 'reader' } })).status()).toBe(201);
	const other = await browser.newContext();
	await signInAs(other, reader);
	const second = await other.newPage();
	await second.goto(`/project/${pid}`); // not openEditor: it signs in as the owner
	await expect(second.getByRole('button', { name: 'Add reference' })).toBeDisabled();
	expect((await second.request.get(`${api(pid)}/references/lookup?id=10.1234/deep.2021`)).status()).toBe(403);
	await other.close();
});

test('Zotero: connect with user ID and key, search, insert, disconnect (US2)', async ({ page }) => {
	await openEditor(page);
	const origin = new URL(page.url()).origin;
	await page.request.delete('/api/zotero/account', { headers: { origin } }); // the e2e user may be connected from a rerun
	await setDoc(page, DOC('references'));
	await cursorAfter(page, 'As shown in ');

	await page.getByRole('button', { name: 'Add reference' }).click();
	const d = dialog(page);
	await d.getByRole('tab', { name: 'Zotero' }).click();
	await d.getByLabel('User ID').fill(ZOTERO.userId);
	await d.getByLabel('API key').fill('WrongKey0000000000000000');
	await d.getByRole('button', { name: 'Connect Zotero' }).click();
	await expect(d.getByRole('alert')).toContainText('Zotero doesn’t accept this API key');
	await d.getByLabel('API key').fill(ZOTERO.key);
	await d.getByRole('button', { name: 'Connect Zotero' }).click();
	await expect(d.getByText('Connected as zuser')).toBeVisible();

	// the library's items, most recent first; the note is left out
	const items = d.getByRole('list', { name: 'Zotero items' }).getByRole('checkbox');
	await expect(items).toHaveCount(3);
	await d.getByLabel('Search your Zotero library').fill('knuth');
	await d.getByRole('button', { name: 'Search', exact: true }).click();
	await expect(items).toHaveCount(1);
	await d.getByRole('checkbox', { name: /The TeXbook/ }).check();
	await d.getByRole('button', { name: 'Add 1 reference' }).click();
	await expect(d).toBeHidden();
	await expect.poll(() => text(page)).toContain('As shown in \\cite{knuth1986texbook}.');
	expect(await fileText(page, 'references.bib')).toContain('@book{knuth1986texbook,\n  title = {The {TeXbook}},');

	// the key never reaches the browser after saving
	expect(await (await page.request.get('/api/zotero/account')).text()).not.toContain(ZOTERO.key);
	expect(await page.content()).not.toContain(ZOTERO.key);

	// already there: marked, and adding it again only cites it
	await page.getByRole('button', { name: 'Add reference' }).click();
	await d.getByRole('tab', { name: 'Zotero' }).click();
	await d.getByLabel('Search your Zotero library').fill('texbook');
	await d.getByRole('button', { name: 'Search', exact: true }).click();
	await expect(d.getByText('Already in references.bib as knuth1986texbook')).toBeVisible();

	await d.getByRole('button', { name: 'Disconnect' }).click();
	await expect(d.getByRole('button', { name: 'Connect Zotero' })).toBeVisible();
	expect(await (await page.request.get('/api/zotero/account')).json()).toEqual({ connected: false });
});
