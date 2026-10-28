import { expect, type Browser, type Page } from '@playwright/test';
import { allow, api, openEditor, projectPath, setDoc, signInAs, test, text } from './helpers.ts';

// 013 track changes with two contexts: the owner A in `page`, an editor B (and a reader in US1 #3). Scenario
// numbers refer to specs/013-track-changes/spec.md.

const tag = () => Math.random().toString(36).slice(2, 8);
const DOC = 'alpha beta gamma\n';

type Me = { id: string; name: string; color: string };
let b: Page;
let bob: Me;

test.beforeEach(async ({ browser, page, pid }) => {
	await allow(page.request, '@test.local');
	b = await member(browser, page, pid, `editor-${tag()}@test.local`, 'editor');
	bob = await (await b.request.get('/api/me')).json();
	await openEditor(page, pid);
	await setDoc(page, DOC);
	await page.evaluate(() => window.__overtree!.undoManager.stopCapturing()); // A's next typing is an undo step of its own
	await expect.poll(() => text(b)).toBe(DOC);
});

test.afterEach(async () => {
	await b.context().close();
});

/** A user invited with `role`, in a context of their own, on the project's editor page. */
async function member(browser: Browser, owner: Page, pid: string, email: string, role: 'editor' | 'reader') {
	const ctx = await browser.newContext();
	await signInAs(ctx, email);
	const page = await ctx.newPage();
	await page.goto('/'); // creates the user
	expect((await owner.request.post(`${api(pid)}/members`, { data: { email, role } })).status()).toBe(201);
	await page.goto(projectPath(pid));
	await expect(page.getByRole('region', { name: 'Editor', exact: true }).getByRole('status')).toHaveText('Saved');
	await page.waitForFunction(() => window.__overtree?.provider.isSynced);
	return page;
}

const toggle = (p: Page) => p.getByRole('button', { name: 'Track changes', exact: true });
const panel = (p: Page) => p.getByRole('complementary', { name: 'Review', exact: true });
const items = (p: Page) => panel(p).getByRole('listitem');

/** Track changes on (by `who`), and every page in `pages` showing it. */
async function trackOn(who: Page, ...pages: Page[]) {
	await toggle(who).click();
	for (const p of [who, ...pages]) await expect(toggle(p)).toHaveAttribute('aria-pressed', 'true');
}

/** Put the cursor (or a selection) in `p`'s editor. */
async function select(p: Page, from: number, to = from) {
	await p.evaluate(
		([anchor, head]) => {
			const { view } = window.__overtree!;
			view.dispatch({ selection: { anchor, head } });
			view.focus();
		},
		[from, to]
	);
}

const rgb = (hex: string) => {
	const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
	return `rgb(${r}, ${g}, ${bl})`;
};

test('the switch is the project’s: on for everyone live, off again; with it off nothing is recorded (US1 1, 2, 4)', async ({ page }) => {
	await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
	await trackOn(page, b);
	// B (an editor) turns it off for both
	await toggle(b).click();
	for (const p of [page, b]) await expect(toggle(p)).toHaveAttribute('aria-pressed', 'false');
	await select(b, 0);
	await b.keyboard.type('plain ');
	await expect.poll(() => text(page)).toBe(`plain ${DOC}`);
	await expect(page.locator('.cm-tcInsert')).toHaveCount(0);
	await page.getByRole('button', { name: 'Review', exact: true }).click();
	await expect(panel(page).getByText('No changes in this file.')).toBeVisible();
});

test('a reader sees the state and the suggestions but can’t switch or review (US1 3, US3 6)', async ({ browser, page, pid }) => {
	const r = await member(browser, page, pid, `reader-${tag()}@test.local`, 'reader');
	await trackOn(page, r);
	await expect(toggle(r)).toBeDisabled();
	await select(b, 5);
	await b.keyboard.type(' new');
	await expect(r.locator('.cm-tcInsert')).toHaveText(' new');
	await r.getByRole('button', { name: 'Review', exact: true }).click();
	await expect(items(r)).toHaveCount(1);
	await expect(panel(r).getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0);
	await expect(panel(r).getByRole('button', { name: 'Reject all' })).toHaveCount(0);
	// and the server refuses the switch
	expect((await r.request.put(`${api(pid)}/track-changes`, { data: { on: false } })).status()).toBe(403);
	await r.context().close();
});

test('B types and deletes, A sees the markers within 300 ms, accepts one and rejects the other (US2 1–3, US3 1–4)', async ({ page }) => {
	await trackOn(page, b);

	// an insertion in B's color, timed from B's keydown to A's mark
	const seen = page.evaluate(
		() =>
			new Promise<number>((resolve) => {
				const { view } = window.__overtree!;
				const mo = new MutationObserver(() => view.contentDOM.querySelector('.cm-tcInsert') && (mo.disconnect(), resolve(performance.timeOrigin + performance.now())));
				mo.observe(view.contentDOM, { childList: true, subtree: true, attributes: true });
			})
	);
	await select(b, 5);
	const pressed = b.evaluate(
		() => new Promise<number>((resolve) => addEventListener('keydown', () => resolve(performance.timeOrigin + performance.now()), { capture: true, once: true }))
	);
	await b.keyboard.type(' new');
	const latency = (await seen) - (await pressed);
	console.log(`suggestion latency: ${latency.toFixed(1)} ms`);
	expect(latency).toBeLessThan(300);
	const mark = page.locator('.cm-tcInsert');
	await expect(mark).toHaveText(' new'); // adjacent typing is one suggestion (US2 4)
	await expect(mark).toHaveCSS('border-bottom-color', rgb(bob.color));
	await expect(mark).toHaveAttribute('title', `${bob.name} inserted`);

	// a deletion: applied to the text, a marker with the removed word
	await select(b, 9, 14); // " beta"
	await b.keyboard.press('Backspace');
	const after = 'alpha new gamma\n';
	await expect.poll(() => text(page)).toBe(after);
	const del = page.locator('.cm-tcDelete');
	await expect(del).toHaveAttribute('title', `${bob.name} deleted:  beta`);
	await expect(b.locator('.cm-tcDelete')).toHaveCount(1);

	// the review panel: author, time, snippet; a click selects the change in the editor
	await page.getByRole('button', { name: 'Review', exact: true }).click();
	await expect(items(page)).toHaveCount(2);
	await expect(items(page).nth(0)).toContainText(bob.name);
	await expect(items(page).nth(0)).toContainText('just now');
	await expect(items(page).nth(0)).toContainText('Inserted');
	await expect(items(page).nth(0)).toContainText(' new');
	await expect(items(page).nth(1)).toContainText('Deleted');
	await expect(items(page).nth(1)).toContainText('beta');
	await items(page).nth(0).getByRole('button').first().click();
	expect(await page.evaluate(() => window.__overtree!.view.state.sliceDoc(window.__overtree!.view.state.selection.main.from, window.__overtree!.view.state.selection.main.to))).toBe(' new');

	// accept the insertion (text stays), reject the deletion (text comes back)
	await items(page).nth(0).getByRole('button', { name: 'Accept', exact: true }).click();
	await expect(items(page)).toHaveCount(1);
	await items(page).nth(0).getByRole('button', { name: 'Reject', exact: true }).click();
	await expect(items(page)).toHaveCount(0);
	const final = 'alpha new beta gamma\n';
	for (const p of [page, b]) {
		await expect.poll(() => text(p)).toBe(final);
		await expect(p.locator('.cm-tcInsert, .cm-tcDelete')).toHaveCount(0);
	}
});

test('replacing a selection is a deletion and an insertion; Reject all and Accept all (US2 5, US3 5)', async ({ page }) => {
	await trackOn(page, b);
	await select(b, 6, 10); // "beta"
	await b.keyboard.type('BETA');
	await expect.poll(() => text(page)).toBe('alpha BETA gamma\n');
	await page.getByRole('button', { name: 'Review', exact: true }).click();
	await expect(items(page)).toHaveCount(2);
	await panel(page).getByRole('button', { name: 'Reject all' }).click();
	for (const p of [page, b]) await expect.poll(() => text(p)).toBe(DOC);

	await select(b, 0);
	await b.keyboard.type('% ');
	await select(b, 15, 16); // the first "m" of "gamma"
	await b.keyboard.press('Delete');
	await expect(items(page)).toHaveCount(2);
	await panel(page).getByRole('button', { name: 'Accept all' }).click();
	await expect(items(page)).toHaveCount(0);
	for (const p of [page, b]) await expect.poll(() => text(p)).toBe('% alpha beta gama\n');
});

test('undo takes back your own tracked insertion and its suggestion (US4 1, 2)', async ({ page }) => {
	await trackOn(page, b);
	await select(page, 0);
	await page.keyboard.type('mine ');
	await expect(b.locator('.cm-tcInsert')).toHaveText('mine ');
	await page.keyboard.press('ControlOrMeta+z');
	for (const p of [page, b]) {
		await expect.poll(() => text(p)).toBe(DOC);
		await expect(p.locator('.cm-tcInsert')).toHaveCount(0);
	}
	await page.getByRole('button', { name: 'Review', exact: true }).click();
	await expect(panel(page).getByText('No changes in this file.')).toBeVisible();
	// redo brings both back
	await page.locator('.cm-content').focus();
	await page.keyboard.press('ControlOrMeta+Shift+z');
	await expect(b.locator('.cm-tcInsert')).toHaveText('mine ');
});

test('suggestions survive a reload and show for someone who opens the file later (US2 6)', async ({ page }) => {
	await trackOn(page, b);
	await select(b, 0);
	await b.keyboard.type('kept ');
	await b.waitForFunction(() => !window.__overtree!.provider.hasUnsyncedChanges);
	await page.reload();
	await expect(page.getByRole('region', { name: 'Editor', exact: true }).getByRole('status')).toHaveText('Saved');
	await expect(page.locator('.cm-tcInsert')).toHaveText('kept ');
});
