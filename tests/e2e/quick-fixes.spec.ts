import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { hintFor } from '../../src/lib/compile-hints.ts';
import type { CompileResult, LogEntry } from '../../src/lib/compile-types.ts';
import { parseLog } from '../../src/lib/log-parser.ts';
import { openEditor, setDoc, test, text } from './helpers.ts';

// Quick fixes for compile errors (editor/quickfix.ts): a real log of tests/fixtures/hints with the hint the server
// would attach, handed to the page as the last compile, so no TeX image is needed.

/** The fixture's source in the editor and its log's entry matching `message` (with its hint) as the last compile. */
async function compiledFixture(page: Page, name: string, message: RegExp) {
	const dir = new URL('../fixtures/hints/', import.meta.url);
	await setDoc(page, readFileSync(new URL(`${name}.tex`, dir), 'utf8'));
	const e = parseLog(readFileSync(new URL(`${name}.log`, dir), 'utf8')).find((e) => message.test(e.message))!;
	const fileId = await page.evaluate(() => window.__overtree!.fileId);
	const entry: LogEntry = { ...e, file: 'main.tex', fileId, hint: hintFor(e, { paths: ['main.tex'] }) };
	const last: CompileResult = { id: crypto.randomUUID(), status: 'failure', compiler: 'pdflatex', stopOnFirstError: false, startedAt: Date.now(), durationMs: 1, entries: [entry] };
	await page.evaluate((last) => (window.__overtree!.compile!.last = last), last);
	return entry;
}

test.beforeEach(async ({ page }) => {
	await openEditor(page);
});

test('a compile error’s quick fix in the marker’s tooltip adds the package, blinks it, and Ctrl+Z takes it back', async ({ page }) => {
	await compiledFixture(page, 'undefined-includegraphics', /^Undefined control sequence/);
	const before = await text(page);
	const marker = page.locator('.cm-lintRange-error', { hasText: '\\includegraphics' });
	await marker.hover();
	const fix = page.locator('.cm-tooltip-lint').getByRole('button', { name: 'Add \\usepackage{graphicx}' });
	await fix.click();
	expect(await text(page)).toBe(before.replace('\\documentclass{article}', '\\documentclass{article}\n\\usepackage{graphicx}'));
	await expect(page.locator('.cm-flash')).toHaveText('\\usepackage{graphicx}');
	await page.keyboard.press('ControlOrMeta+z');
	await expect.poll(() => text(page)).toBe(before);
});

test('the logs’ Fix button applies it from the list and shows where', async ({ page }) => {
	await compiledFixture(page, 'env-mismatch', /ended by/);
	const before = await text(page);
	await page.getByRole('button', { name: 'Logs', exact: true }).click();
	await page.getByRole('region', { name: 'Logs' }).getByRole('button', { name: 'Fix: Change to \\end{itemize}' }).click();
	await expect.poll(() => text(page)).toBe(before.replace('\\end{enumerate}', '\\end{itemize}'));
	await expect(page.locator('.cm-flash')).toHaveText('\\end{itemize}');
	await expect(page.getByRole('region', { name: 'Logs' })).toHaveCount(0);
});
