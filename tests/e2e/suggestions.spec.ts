import { expect, type Page } from '@playwright/test';
import { openEditor, setDoc, test, text } from './helpers.ts';

// Ghost-text predictions (completion/predict.ts, editor/ghost.ts): Tab accepts, Escape drops, a switch turns them off.

const ghost = (page: Page) => page.locator('.cm-ghost');

/** Put the cursor at the end of the first line containing `text`. */
const cursorAfter = (page: Page, text: string) =>
	page.evaluate((text) => {
		const { view } = window.__overtree!;
		const at = view.state.doc.toString().indexOf(text) + text.length;
		view.dispatch({ selection: { anchor: at } });
		view.focus();
	}, text);

test.beforeEach(async ({ page }) => {
	await openEditor(page);
});

test('a table row: Tab fills in the next & and then \\\\ from the row above; Escape drops it', async ({ page }) => {
	await setDoc(page, '\\begin{tabular}{lll}\nName & Age & City \\\\\n\\end{tabular}');
	await cursorAfter(page, 'City \\\\');
	await page.keyboard.press('Enter');
	await page.keyboard.type('Ann');
	await expect(ghost(page)).toHaveText(' & ');
	await page.keyboard.press('Tab');
	await page.keyboard.type('31');
	await page.keyboard.press('Tab'); // right after typing, while the completion popup is still looking
	await page.keyboard.type('Oslo');
	await expect(ghost(page)).toHaveText(' \\\\');
	await page.keyboard.press('Escape');
	await expect(ghost(page)).toHaveCount(0);
	expect(await text(page)).toContain('Ann & 31 & Oslo\n');
	// Tab without a suggestion still indents
	await page.keyboard.press('Tab');
	expect(await text(page)).toContain('Ann & 31 & Oslo');
});

test('a block seen before: each new line suggests the line that followed it then', async ({ page }) => {
	const figure = '\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{figs/a.png}\n  \\caption{A}\n\\end{figure}';
	await setDoc(page, `${figure}\n\n\\begin{figure}[htbp]\n\\end{figure}`);
	await page.evaluate(() => {
		const { view } = window.__overtree!;
		view.dispatch({ selection: { anchor: view.state.doc.toString().lastIndexOf('[htbp]') + 6 } });
		view.focus();
	});
	await page.keyboard.press('Enter');
	await expect(ghost(page)).toHaveText('\\centering');
	await page.keyboard.press('Tab');
	await page.keyboard.press('Enter');
	await expect(ghost(page)).toHaveText('\\includegraphics[width=0.8\\linewidth]{');
	await page.keyboard.press('Tab');
	expect(await text(page)).toMatch(/\[htbp\]\n\s*\\centering\n\s*\\includegraphics\[width=0\.8\\linewidth\]\{\n\\end\{figure\}$/);
});

test('the switch in the editor settings turns them off', async ({ page }) => {
	await setDoc(page, '\\begin{tabular}{ll}\na & b \\\\\n\\end{tabular}');
	await page.getByRole('button', { name: 'Editor settings' }).click();
	await page.getByRole('checkbox', { name: 'Suggestions while typing' }).uncheck();
	await page.keyboard.press('Escape');
	await cursorAfter(page, 'b \\\\');
	await page.keyboard.press('Enter');
	await page.keyboard.type('c');
	await expect(ghost(page)).toHaveCount(0);
	await page.getByRole('button', { name: 'Editor settings' }).click();
	await page.getByRole('checkbox', { name: 'Suggestions while typing' }).check();
});
