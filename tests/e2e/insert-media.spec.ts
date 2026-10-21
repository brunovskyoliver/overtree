import { expect, type Browser, type Page } from '@playwright/test';
import type { ProjectInfo } from '../../src/lib/files.ts';
import { allow, api, openEditor, projectPath, SEED, setDoc, signInAs, test, text, upload } from './helpers.ts';

// Feature 015 "Images, figures, tables and symbols" (specs/015-insert-media/spec.md). Each test has a fresh project.

// a valid 1×1 PNG: pdfLaTeX has to include it
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const NO_GRAPHICX = SEED.replace('\\usepackage{graphicx} % Required for inserting images\n', '');

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' });
const tree = (page: Page) => page.getByRole('tree', { name: 'File tree' });
const firstPage = (page: Page) => page.getByTestId('pdf-viewer').locator('.page').first();

/** Paths of every file of the test's project. */
async function paths(page: Page) {
	const { files }: ProjectInfo = await (await page.request.get(`${api()}/files`)).json();
	const byId = new Map(files.map((f) => [f.id, f]));
	const path = (id: string): string => {
		const f = byId.get(id)!;
		return f.parentId ? `${path(f.parentId)}/${f.name}` : f.name;
	};
	return files.filter((f) => f.kind !== 'folder').map((f) => path(f.id)).sort();
}

/** Put the caret right after the first `needle`. */
async function caretAfter(page: Page, needle: string) {
	await page.evaluate((needle) => {
		const { view } = window.__overtree!;
		const at = view.state.doc.toString().indexOf(needle) + needle.length;
		view.dispatch({ selection: { anchor: at } });
		view.focus();
	}, needle);
}

/** A synthetic paste of image files (and optional text) on the editor, like a screenshot from the clipboard. */
async function paste(page: Page, files: { name: string; type?: string }[], plain = '') {
	await page.locator('.cm-content').evaluate(
		(el, { files, png, plain }) => {
			const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
			const data = new DataTransfer();
			for (const f of files) data.items.add(new File([bytes], f.name, { type: f.type ?? 'image/png' }));
			if (plain) data.setData('text/plain', plain);
			el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
		},
		{ files, png: PNG, plain }
	);
}

const caption = (page: Page) =>
	page.evaluate(() => {
		const { state } = window.__overtree!.view;
		const line = state.doc.lineAt(state.selection.main.head);
		return line.text.trim();
	});

test('pasting a screenshot uploads it into figures/ and inserts a figure that compiles (US1-1, US1-2)', async ({ page }) => {
	await openEditor(page);
	await caretAfter(page, '\\maketitle');
	await page.keyboard.press('Enter');
	await paste(page, [{ name: 'image.png' }]);

	await expect.poll(() => paths(page)).toEqual([expect.stringMatching(/^figures\/pasted-\d{8}-\d{6}\.png$/), 'main.tex']);
	const [png] = await paths(page);
	const name = png.slice('figures/'.length, -'.png'.length);
	await expect.poll(() => text(page)).toContain(
		`\\begin{figure}[htbp]\n    \\centering\n    \\includegraphics[width=0.8\\linewidth]{${png}}\n    \\caption{}\n    \\label{fig:${name}}\n\\end{figure}`
	);
	await expect(tree(page).getByRole('treeitem', { name: 'figures', exact: true })).toBeVisible();
	// the caret waits in the caption
	expect(await caption(page)).toBe('\\caption{}');
	await page.keyboard.type('Pasted plot');
	expect(await text(page)).toContain('\\caption{Pasted plot}');

	await page.waitForFunction(() => !window.__overtree!.provider.hasUnsyncedChanges);
	await page.getByRole('button', { name: 'Recompile' }).click();
	await expect(firstPage(page)).toContainText('Figure 1: Pasted plot', { timeout: 15_000 });
});

test('a named image keeps its name and never overwrites; text on the clipboard pastes as text (US1-3, US1-7)', async ({ page }) => {
	await openEditor(page);
	await caretAfter(page, '\\maketitle');
	await page.keyboard.press('Enter');
	await paste(page, [{ name: 'diagram.png' }]);
	await expect.poll(() => paths(page)).toEqual(['figures/diagram.png', 'main.tex']);
	await caretAfter(page, '\\maketitle');
	await paste(page, [{ name: 'diagram.png' }]);
	await expect.poll(() => paths(page)).toEqual(['figures/diagram-2.png', 'figures/diagram.png', 'main.tex']);
	await expect.poll(() => text(page)).toContain('{figures/diagram-2.png}');
	expect(await text(page)).toContain('\\label{fig:diagram-2}');

	// Word and Excel put a picture of the selection next to the text: the text wins
	await caretAfter(page, '\\end{document}');
	await paste(page, [{ name: 'image.png' }], ' tail');
	await expect.poll(() => text(page)).toMatch(/\\end\{document\} tail/);
	expect(await paths(page)).toHaveLength(3);

	// LaTeX can't include a GIF: a message, nothing uploaded
	await paste(page, [{ name: 'anim.gif', type: 'image/gif' }]);
	await expect(page.getByRole('alert').filter({ hasText: "LaTeX can't include anim.gif" })).toBeVisible();
	expect(await paths(page)).toHaveLength(3);
});

test('a main document without graphicx gets \\usepackage{graphicx} after \\documentclass (US1-4)', async ({ page }) => {
	await openEditor(page);
	await setDoc(page, NO_GRAPHICX);
	await caretAfter(page, '\\maketitle');
	await page.keyboard.press('Enter');
	await paste(page, [{ name: 'image.png' }]);
	await expect.poll(() => text(page)).toMatch(/^\\documentclass\{article\}\n\\usepackage\{graphicx\}\n/);
	await expect.poll(() => text(page)).toContain('\\includegraphics[width=0.8\\linewidth]{figures/pasted-');
	expect((await text(page)).match(/usepackage\{graphicx\}/g)).toHaveLength(1);
});

/** Desktop image files dropped on the editor at the start of `needle`'s line. */
async function dropAt(page: Page, needle: string, files: string[]) {
	const box = (await page.locator('.cm-line', { hasText: needle }).first().boundingBox())!;
	await page.locator('.cm-content').evaluate(
		(el, { x, y, files, png }) => {
			const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
			const dt = new DataTransfer();
			for (const f of files) dt.items.add(new File([bytes], f, { type: 'image/png' }));
			for (const type of ['dragenter', 'dragover', 'drop'])
				el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
		},
		{ x: box.x + 2, y: box.y + box.height / 2, files, png: PNG }
	);
}

test('dropping a desktop image on the text inserts a figure there (US1-5)', async ({ page }) => {
	await openEditor(page);
	await dropAt(page, '\\section{Introduction}', ['photo.png']);
	await expect.poll(() => paths(page)).toEqual(['figures/photo.png', 'main.tex']);
	await expect.poll(() => text(page)).toContain('\\label{fig:photo}\n\\end{figure}\n\\section{Introduction}');
});

test('dragging project files from the tree inserts a reference (US2-1, US2-2)', async ({ page }) => {
	const res = await page.request.post(`${api()}/files`, { data: { kind: 'text', name: 'intro.tex', parentId: null } });
	expect(res.status()).toBe(201);
	const editor = await openEditor(page);
	await upload(page, 'logo.png', Buffer.from(PNG, 'base64'), null);
	await setDoc(page, NO_GRAPHICX.replace('\\section{Introduction}', '\\section{Introduction}\n'));
	/** Drag tree item `name` onto the empty line under the section heading. */
	const drag = async (name: string) => {
		const row = tree(page).getByRole('treeitem', { name, exact: true }).locator(':scope > .row');
		const box = (await page.locator('.cm-line', { hasText: '\\section{Introduction}' }).boundingBox())!;
		await row.dragTo(editor, { targetPosition: { x: 5, y: box.y - (await editor.boundingBox())!.y + box.height * 1.5 } });
	};
	await drag('intro.tex');
	await expect.poll(() => text(page)).toContain('\\section{Introduction}\n\\input{intro}');
	await drag('logo.png');
	await expect.poll(() => text(page)).toContain('\\section{Introduction}\n\\includegraphics{logo.png}\\input{intro}');
	await expect.poll(() => text(page)).toMatch(/^\\documentclass\{article\}\n\\usepackage\{graphicx\}\n/);
});

test('Insert figure: pick or upload an image, caption, label, width; Escape cancels (US3-1, US3-2, US3-3)', async ({ page }) => {
	await openEditor(page);
	await caretAfter(page, '\\maketitle');
	await page.keyboard.press('Enter');

	await toolbar(page).getByRole('button', { name: 'Insert figure' }).click();
	const dialog = page.getByRole('dialog', { name: 'Insert figure' });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Insert' })).toBeDisabled();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	expect(await text(page)).toBe(SEED.replace('\\maketitle', '\\maketitle\n'));

	await toolbar(page).getByRole('button', { name: 'Insert figure' }).click();
	await dialog.getByLabel('Upload an image').setInputFiles({ name: 'cat.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64') });
	await expect(dialog.getByRole('combobox', { name: 'Image' })).toHaveValue(/.+/);
	await expect(dialog.getByRole('combobox', { name: 'Image' }).locator('option:checked')).toHaveText('figures/cat.png');
	await expect(dialog.getByRole('textbox', { name: 'Label' })).toHaveValue('cat');
	await dialog.getByRole('textbox', { name: 'Caption' }).fill('A cat');
	await dialog.getByRole('spinbutton', { name: 'Width (× line width)' }).fill('0.5');
	// focus stays in the modal dialog
	for (let i = 0; i < 8; i++) {
		await page.keyboard.press('Tab');
		expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
	}
	await dialog.getByRole('button', { name: 'Insert' }).click();
	await expect(dialog).toBeHidden();
	expect(await text(page)).toContain(
		'\\begin{figure}[htbp]\n    \\centering\n    \\includegraphics[width=0.5\\linewidth]{figures/cat.png}\n    \\caption{A cat}\n    \\label{fig:cat}\n\\end{figure}'
	);
	expect(await caption(page)).toBe('\\caption{A cat}');
	await expect(page.locator('.cm-content')).toBeFocused();

	// an image already in the project, defaults kept; Cancel changes nothing
	await upload(page, 'logo.png', Buffer.from(PNG, 'base64'), null);
	await caretAfter(page, '\\end{document}');
	await page.keyboard.press('Enter');
	await toolbar(page).getByRole('button', { name: 'Insert figure' }).click();
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toBeHidden();
	await toolbar(page).getByRole('button', { name: 'Insert figure' }).click();
	await dialog.getByRole('combobox', { name: 'Image' }).selectOption({ label: 'logo.png' });
	await expect(dialog.getByRole('textbox', { name: 'Label' })).toHaveValue('logo');
	await dialog.getByRole('button', { name: 'Insert' }).click();
	expect(await text(page)).toMatch(
		/\\end\{document\}\n\\begin\{figure\}\[htbp\]\n {4}\\centering\n {4}\\includegraphics\[width=0\.8\\linewidth\]\{logo\.png\}\n {4}\\caption\{\}\n {4}\\label\{fig:logo\}\n\\end\{figure\}\n$/
	);
});

test('Insert table: a 3 × 2 grid pick inserts a booktabs table, caret in the first cell (US4-1, US4-2)', async ({ page }) => {
	await openEditor(page);
	await setDoc(page, NO_GRAPHICX);
	await caretAfter(page, '\\maketitle');
	await page.keyboard.press('Enter');
	await toolbar(page).getByRole('button', { name: 'Insert table' }).click();
	const dialog = page.getByRole('dialog', { name: 'Insert table' });
	await dialog.getByRole('button', { name: '3 rows × 2 columns' }).hover();
	await expect(dialog.getByText('3 rows × 2 columns', { exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: '3 rows × 2 columns' }).click();
	await expect(dialog).toBeHidden();

	await page.keyboard.type('Name');
	await page.keyboard.press('Tab');
	await page.keyboard.type('Value');
	expect(await text(page)).toContain(
		[
			'\\begin{table}[htbp]',
			'    \\centering',
			'    \\begin{tabular}{ll}',
			'        \\toprule',
			'        Name & Value \\\\',
			'        \\midrule',
			'         &  \\\\',
			'         &  \\\\',
			'        \\bottomrule',
			'    \\end{tabular}',
			'    \\caption{}',
			'    \\label{tab:}',
			'\\end{table}'
		].join('\n')
	);
	await expect.poll(() => text(page)).toMatch(/^\\documentclass\{article\}\n\\usepackage\{booktabs\}\n/);
});

test('Insert table by keyboard: arrows size the grid, Enter inserts, Escape cancels (US4-3)', async ({ page }) => {
	await openEditor(page);
	await caretAfter(page, '\\maketitle');
	await page.keyboard.press('Enter');
	await toolbar(page).getByRole('button', { name: 'Insert table' }).click();
	const dialog = page.getByRole('dialog', { name: 'Insert table' });
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	expect(await text(page)).not.toContain('tabular');
	await toolbar(page).getByRole('button', { name: 'Insert table' }).click();
	await expect(dialog.getByRole('button', { name: '2 rows × 2 columns' })).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('ArrowRight');
	await expect(dialog.getByRole('button', { name: '3 rows × 4 columns' })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(dialog).toBeHidden();
	expect(await text(page)).toContain('\\begin{tabular}{llll}');
	expect((await text(page)).match(/ & {2}& {2}& {2}\\\\/g)).toHaveLength(3);
});

const palette = (page: Page) => page.getByRole('region', { name: 'Symbol palette' });

test('symbol palette: search and Enter wrap in $…$ outside math, a click inserts bare inside math (US5-1, US5-2)', async ({ page }) => {
	await openEditor(page);
	await caretAfter(page, '\\maketitle');
	await page.keyboard.type(' x');
	await toolbar(page).getByRole('button', { name: 'Symbols' }).click();
	const search = palette(page).getByRole('searchbox', { name: 'Search symbols' });
	await expect(search).toBeFocused();
	await search.fill('alpha');
	await expect(palette(page).getByRole('button', { name: 'alpha \\alpha' })).toHaveAttribute('title', '\\alpha (alpha)');
	await page.keyboard.press('Enter');
	expect(await text(page)).toContain('\\maketitle x$\\alpha$\n');

	await caretAfter(page, '\\maketitle x$\\alpha$');
	await page.keyboard.type(' and $y = $');
	await page.keyboard.press('ArrowLeft');
	await palette(page).getByRole('tab', { name: 'Greek' }).click();
	await palette(page).getByRole('button', { name: 'beta \\beta' }).click();
	expect(await text(page)).toContain('\\maketitle x$\\alpha$ and $y = \\beta$\n');
	await expect(page.locator('.cm-content')).toBeFocused();
});

test('symbol palette by keyboard: shortcut, categories, arrows, Enter, Escape (US5-3)', async ({ page }) => {
	await openEditor(page);
	await caretAfter(page, '\\maketitle');
	await page.keyboard.type(' $');
	await page.keyboard.press('ControlOrMeta+Shift+y');
	await expect(palette(page)).toBeVisible();
	await expect(palette(page).getByRole('tab', { name: 'Greek' })).toHaveAttribute('aria-selected', 'true');
	for (const name of ['Operators', 'Relations', 'Arrows', 'Delimiters', 'Misc']) await expect(palette(page).getByRole('tab', { name })).toBeVisible();
	await page.keyboard.press('ArrowDown'); // from the search into the grid
	await expect(palette(page).getByRole('button', { name: 'alpha \\alpha' })).toBeFocused();
	await page.keyboard.press('ArrowRight');
	await expect(palette(page).getByRole('button', { name: 'beta \\beta' })).toBeFocused();
	await page.keyboard.press('Enter');
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Enter');
	// after `$`: math was opened and not closed, so the symbols go in bare
	expect(await text(page)).toContain('\\maketitle $\\beta\\gamma\n');
	await expect(palette(page).getByRole('button', { name: 'gamma \\gamma' })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(palette(page)).toBeHidden();
	await expect(page.locator('.cm-content')).toBeFocused();
});

async function as(browser: Browser, email: string) {
	const ctx = await browser.newContext();
	await signInAs(ctx, email);
	const page = await ctx.newPage();
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
	return page;
}

test('a reader can neither paste nor drop images nor open the insert tools (US1-6, US5-4)', async ({ browser, page, pid }) => {
	await allow(page.request, '@test.local');
	const email = `reader-${Math.random().toString(36).slice(2, 8)}@test.local`;
	const reader = await as(browser, email);
	expect((await page.request.post(`${api(pid)}/members`, { data: { email, role: 'reader' } })).status()).toBe(201);
	await reader.goto(projectPath(pid));
	await expect(reader.getByText('Read only: you can view and compile but not edit.')).toBeVisible();
	await reader.waitForFunction(() => window.__overtree?.provider.isSynced);

	await paste(reader, [{ name: 'image.png' }]);
	await dropAt(reader, '\\section{Introduction}', ['photo.png']);
	await reader.waitForTimeout(500);
	expect(await paths(page)).toEqual(['main.tex']);
	expect(await text(reader)).toBe(SEED);
	for (const name of ['Insert figure', 'Insert table', 'Symbols']) await expect(toolbar(reader).getByRole('button', { name })).toBeDisabled();
	await reader.locator('.cm-content').click();
	await reader.keyboard.press('ControlOrMeta+Shift+y');
	await expect(palette(reader)).toBeHidden();
	await reader.context().close();
});
