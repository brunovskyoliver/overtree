import { expect, type Page } from '@playwright/test';
import { api, openEditor, projectPath, resetProject, test, upload } from './helpers.ts';

// A standalone document in a folder, with biblatex + biber and an @online .bib next to it (the live ResQFlow setup).

const DOC = `\\documentclass[11pt,a4paper]{article}
\\usepackage[backend=biber]{biblatex}
\\addbibresource{references.bib}
\\begin{document}
Architecture matters \\parencite{fowler2019}. See \\textcite{ms_oop}.
\\printbibliography
\\end{document}
`;
const BIB = `@online{ms_oop,
  author  = {{Microsoft}},
  title   = {Object-Oriented Programming ({C\\#})},
  date    = {2025-10-10},
  url     = {https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/tutorials/oop},
  urldate = {2026-10-05}
}
@online{fowler2019,
  author  = {Fowler, Martin},
  title   = {Software Architecture Guide},
  date    = {2019-08-01},
  url     = {https://martinfowler.com/architecture/},
  urldate = {2026-10-05}
}
`;

const tree = (page: Page) => page.getByRole('tree', { name: 'File tree' });
const row = (page: Page, name: string) => tree(page).getByRole('treeitem', { name, exact: true }).locator(':scope > .row');
const viewer = (page: Page) => page.getByTestId('pdf-viewer');

test.afterEach(async ({ page }) => {
	await resetProject(page);
});

test('a biblatex document in a folder gets its bibliography from biber', async ({ page }) => {
	await page.goto(projectPath());
	await openEditor(page);
	const folder = await (await page.request.post(`${api()}/files`, { data: { kind: 'folder', name: 'research-topics', parentId: null } })).json();
	const doc = await upload(page, 'OOP-Architecture-&-Data-Model.tex', Buffer.from(DOC), folder.id);
	await upload(page, 'references.bib', Buffer.from(BIB), folder.id);
	await page.reload();
	await openEditor(page);

	await row(page, 'research-topics').click();
	await row(page, 'OOP-Architecture-&-Data-Model.tex').click();
	await expect(viewer(page)).toContainText('Software Architecture Guide', { timeout: 30_000 });
	await expect(viewer(page)).toContainText('Fowler');
	await expect(viewer(page)).not.toContainText('fowler2019'); // an undefined citation prints its key
	const { last } = await (await page.request.get(`${api()}/compile?root=${doc.id}`)).json();
	expect(last.status).toBe('success');
	expect(last.entries.filter((e: { message: string }) => /citation|biber|undefined/i.test(e.message))).toEqual([]);
});
