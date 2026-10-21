// 018 light theme: the appearance choice, the theme it resolves to, and the pre-paint script in app.html.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPEARANCES, resolveTheme, type Appearance } from '../../src/lib/editor/prefs.svelte.ts';

const KEY = 'overtree:editor-prefs';

/** Browser globals the prefs store and the app.html script touch: storage, the color-scheme query, <html>. */
function fakeBrowser(stored: Record<string, unknown> | string | null, systemLight: boolean) {
	const store = new Map<string, string>();
	if (stored !== null) store.set(KEY, typeof stored === 'string' ? stored : JSON.stringify(stored));
	const listeners: ((e: { matches: boolean }) => void)[] = [];
	const query = { matches: systemLight, addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.push(fn) };
	const html = { dataset: {} as Record<string, string> };
	return {
		store,
		html,
		localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
		matchMedia: (q: string) => (expect(q).toBe('(prefers-color-scheme: light)'), query),
		document: { documentElement: html },
		/** the OS switches between light and dark */
		setSystem(light: boolean) {
			query.matches = light;
			for (const fn of listeners) fn({ matches: light });
		}
	};
}

const combos = APPEARANCES.flatMap(({ value }) => [false, true].map((light) => [value, light] as const));

describe('resolveTheme', () => {
	it('dark and light ignore the system, system follows it', () => {
		expect(combos.map(([a, light]) => `${a}/${light}=${resolveTheme(a, light)}`)).toEqual([
			'dark/false=dark',
			'dark/true=dark',
			'light/false=light',
			'light/true=light',
			'system/false=dark',
			'system/true=light'
		]);
	});
});

describe('app.html pre-paint script', () => {
	const html = readFileSync(new URL('../../src/app.html', import.meta.url), 'utf8');
	const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
	const run = (b: ReturnType<typeof fakeBrowser>) => new Function('localStorage', 'matchMedia', 'document', script)(b.localStorage, b.matchMedia, b.document);

	it('runs before the app in <head> and defaults <html> to dark', () => {
		expect(html.indexOf(script)).toBeLessThan(html.indexOf('%sveltekit.head%'));
		expect(html).toContain('<html lang="en" data-theme="dark">');
	});

	it.each(combos)('stored %s with a light system %s gives the same theme as resolveTheme', (a, light) => {
		const b = fakeBrowser({ fontSize: 14, appearance: a }, light);
		run(b);
		expect(b.html.dataset.theme).toBe(resolveTheme(a, light));
	});

	it('falls back to dark for nothing stored, junk and unknown values', () => {
		for (const stored of [null, '{not json', { appearance: 'sepia' }]) {
			const b = fakeBrowser(stored, true);
			run(b);
			expect(b.html.dataset.theme).toBe('dark');
		}
	});

	it('follows the system live when the choice is System', () => {
		const b = fakeBrowser({ appearance: 'system' }, false);
		run(b);
		expect(b.html.dataset.theme).toBe('dark');
		b.setSystem(true);
		expect(b.html.dataset.theme).toBe('light');
		b.setSystem(false);
		expect(b.html.dataset.theme).toBe('dark');
	});
});

describe('prefs store', () => {
	let b: ReturnType<typeof fakeBrowser>;
	async function load(stored: Record<string, unknown> | null, systemLight = false) {
		b = fakeBrowser(stored, systemLight);
		vi.stubGlobal('localStorage', b.localStorage);
		vi.stubGlobal('matchMedia', b.matchMedia);
		vi.stubGlobal('document', b.document);
		vi.resetModules();
		return (await import('../../src/lib/editor/prefs.svelte.ts')).prefs;
	}
	beforeEach(() => vi.unstubAllGlobals());
	afterEach(() => vi.unstubAllGlobals());

	it('defaults to Dark and leaves the other prefs alone', async () => {
		const prefs = await load({ fontSize: 16, spellcheck: false });
		expect([prefs.appearance, prefs.theme, b.html.dataset.theme]).toEqual(['dark', 'dark', 'dark']);
		expect([prefs.fontSize, prefs.spellcheck]).toEqual([16, false]);
	});

	it('stores the choice next to the other prefs and applies it to <html>', async () => {
		const prefs = await load({ fontSize: 16 });
		prefs.setAppearance('light');
		expect(b.html.dataset.theme).toBe('light');
		expect(JSON.parse(b.store.get(KEY)!)).toEqual({ fontSize: 16, spellcheck: true, appearance: 'light' });
		const again = await load(JSON.parse(b.store.get(KEY)!));
		expect([again.appearance, again.theme]).toEqual(['light', 'light']);
	});

	it('System tracks the OS while it is chosen, not after', async () => {
		const prefs = await load({ appearance: 'system' satisfies Appearance }, true);
		expect(prefs.theme).toBe('light');
		b.setSystem(false);
		expect([prefs.theme, b.html.dataset.theme]).toEqual(['dark', 'dark']);
		prefs.setAppearance('light');
		b.setSystem(false);
		expect(b.html.dataset.theme).toBe('light');
	});

	it('ignores an unknown stored appearance', async () => {
		const prefs = await load({ appearance: 'sepia' }, true);
		expect(prefs.appearance).toBe('dark');
	});
});
