import { expect, test } from '@playwright/test';
import { openEditor, resetDoc } from './helpers.ts';

// SC-004 budgets on a 5,000-line document
const LINES = 5000;
const BIG = Array.from({ length: LINES }, (_, i) =>
	i % 500 === 0 ? `\\section{Part ${i / 500 + 1}}` : `Line ${i + 1} of filler text, with some $math$ and \\emph{words}.`
).join('\n');

test.afterEach(async ({ page }) => {
	if (await page.evaluate(() => !!window.__overtree)) await resetDoc(page);
});

test('5,000-line document: load < 2 s, keystroke < 50 ms, outline < 1 s (SC-004)', async ({ page }) => {
	await openEditor(page);
	await page.evaluate((doc) => {
		const { view } = window.__overtree!;
		view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: doc } });
	}, BIG);
	await page.waitForFunction(() => !window.__overtree!.provider.hasUnsyncedChanges);

	// navigation -> editor synced with the full document and accepting input
	const t0 = Date.now();
	await page.goto('/');
	await page.waitForFunction((n) => {
		const h = window.__overtree;
		return h?.provider.isSynced && h.view.state.doc.lines >= n && h.view.hasFocus;
	}, LINES);
	const loadMs = Date.now() - t0;

	// keystroke latency, measured in the page: keydown event time -> first animation frame after the doc changed
	await page.evaluate((line) => {
		const { view } = window.__overtree!;
		const w = window as unknown as { __keyAt: number; __lat: number[] };
		w.__lat = [];
		addEventListener('keydown', (e) => (w.__keyAt = e.timeStamp), true);
		new MutationObserver(() => {
			const at = w.__keyAt;
			if (at) requestAnimationFrame(() => w.__lat.push(performance.now() - at));
			w.__keyAt = 0;
		}).observe(view.contentDOM, { childList: true, subtree: true, characterData: true });
		const pos = view.state.doc.line(line).to;
		view.dispatch({ selection: { anchor: pos } });
		view.focus();
	}, LINES / 2);
	const keys = 'abcdefghijklmnopqrst';
	for (const k of keys) await page.keyboard.press(k);
	await page.waitForFunction((n) => (window as unknown as { __lat: number[] }).__lat.length >= n, keys.length);
	const lat = await page.evaluate(() => (window as unknown as { __lat: number[] }).__lat);
	const avg = lat.reduce((a, b) => a + b, 0) / lat.length;
	const max = Math.max(...lat);

	// outline picks up a new heading
	const t1 = Date.now();
	await page.keyboard.insertText(' \\section{Perf check}');
	await expect(page.getByRole('navigation', { name: 'File outline' }).getByRole('button', { name: 'Perf check' })).toBeVisible({
		timeout: 1000
	});
	const outlineMs = Date.now() - t1;

	const summary = `load ${loadMs} ms, keystroke avg ${avg.toFixed(1)} ms / max ${max.toFixed(1)} ms, outline ${outlineMs} ms`;
	console.log(`[perf ${test.info().project.name}] ${summary}`);
	test.info().annotations.push({ type: 'perf', description: summary });

	expect(loadMs).toBeLessThan(2000);
	expect(avg).toBeLessThan(50);
	expect(outlineMs).toBeLessThan(1000);
});
