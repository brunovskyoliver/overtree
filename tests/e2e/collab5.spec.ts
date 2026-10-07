import { expect, type Page } from '@playwright/test';
import { allow, api, openEditor, projectPath, signInAs, test, text } from './helpers.ts';

// US4 scenario 8 (SC-004) and SC-003 with five sessions: five users type into one file for a minute, then every
// session holds the same text with every marker, and an edit still shows up elsewhere in under 300 ms.

const TYPING_MS = 60_000;

test.skip(({ browserName }) => browserName !== 'chromium', 'five sessions for a minute: Chromium only');

test('five users typing for a minute converge with every edit; latency stays under 300 ms (8, SC-003, SC-004)', async ({ browser, page, pid }) => {
	test.slow();
	test.setTimeout(240_000);
	await allow(page.request, '@test.local');
	await openEditor(page, pid);
	const run = Math.random().toString(36).slice(2, 6);
	const pages: Page[] = [page];
	for (let u = 1; u < 5; u++) {
		const email = `five-${run}-${u}@test.local`;
		const ctx = await browser.newContext();
		await signInAs(ctx, email);
		const p = await ctx.newPage();
		await p.goto('/'); // creates the user
		expect((await page.request.post(`${api(pid)}/members`, { data: { email, role: 'editor' } })).status()).toBe(201);
		await p.goto(projectPath(pid));
		await expect(p.getByRole('status')).toHaveText('Saved');
		await p.waitForFunction(() => window.__overtree?.provider.isSynced);
		pages.push(p);
	}
	await expect(page.getByRole('button', { name: /\(go to cursor\)$/ })).toHaveCount(4);

	// each user: a caret at the start of a random line, then a marker typed key by key; Yjs keeps each run whole
	const markers: string[][] = pages.map(() => []);
	const until = Date.now() + TYPING_MS;
	await Promise.all(
		pages.map(async (p, u) => {
			await p.locator('.cm-content').click();
			for (let i = 0; Date.now() < until; i++) {
				const marker = `@u${u}-${i};`; // no brackets: closeBrackets would type them out of order
				await p.evaluate((r) => {
					const { view } = window.__overtree!;
					const line = view.state.doc.line(1 + Math.floor(r * view.state.doc.lines));
					view.dispatch({ selection: { anchor: line.from } });
				}, Math.random());
				await p.keyboard.type(marker);
				markers[u].push(marker);
			}
		})
	);

	// every session ends with the same text holding every marker
	const all = markers.flat();
	console.log(`markers typed: ${all.length}`);
	await expect.poll(async () => new Set(await Promise.all(pages.map(text))).size, { timeout: 15_000 }).toBe(1);
	const final = await text(page);
	for (const m of all) expect(final).toContain(m);

	// SC-003 with five sessions: a key pressed in one page shows up in another, both timed inside the pages
	for (let s = 0; s < 5; s++) {
		const from = pages[s];
		const to = pages[(s + 1) % 5];
		const mark = `%lat${s}Q`;
		const seen = to.evaluate(
			(mark) =>
				new Promise<number>((resolve) => {
					const h = window.__overtree!;
					const stop = h.listen((u) => {
						if (u.state.doc.toString().includes(mark)) stop(), resolve(performance.timeOrigin + performance.now());
					});
				}),
			mark
		);
		await from.keyboard.press('ControlOrMeta+End');
		await from.keyboard.insertText(mark.slice(0, -1));
		await to.waitForFunction((m) => window.__overtree!.view.state.doc.toString().includes(m), mark.slice(0, -1));
		// the listener is in place before the key goes out: a busy page could otherwise see the key first and wait forever
		await from.evaluate(() => {
			const w = window as unknown as { __pressAt: Promise<number> };
			w.__pressAt = new Promise<number>((resolve) =>
				addEventListener('keydown', () => resolve(performance.timeOrigin + performance.now()), { capture: true, once: true })
			);
		});
		await from.keyboard.press('Q');
		const press = from.evaluate(() => (window as unknown as { __pressAt: Promise<number> }).__pressAt);
		const latency = (await seen) - (await press);
		console.log(`latency with five sessions: ${latency.toFixed(1)} ms`);
		expect(latency).toBeLessThan(300);
	}

	for (const p of pages.slice(1)) await p.context().close();
});
