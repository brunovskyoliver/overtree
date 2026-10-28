// 018 light theme: app.css defines every color token in both sets, and the light editor colors meet WCAG AA.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/app.css', import.meta.url), 'utf8');
const block = (selector: string) => {
	const body = css.slice(css.indexOf(selector + ' {')).match(/\{([^}]*)\}/)![1];
	return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
};
const dark = block(':root');
const light = block(":root[data-theme='light']");

// the same in both themes on purpose: fonts, and the dark initials on a presence color
const SHARED = ['--font-ui', '--font-mono', '--on-presence'];

/** WCAG 2 contrast ratio of two #rrggbb colors. */
function contrast(a: string, b: string) {
	const lum = (hex: string) => {
		const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
	return (x + 0.05) / (y + 0.05);
}

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? sources(join(dir, e.name)) : /\.(svelte|ts|css)$/.test(e.name) ? [join(dir, e.name)] : []
	);
}

describe('theme tokens', () => {
	it('the light set overrides every dark token except the shared ones, and adds none', () => {
		expect(Object.keys(light).sort()).toEqual(Object.keys(dark).filter((k) => !SHARED.includes(k)).sort());
	});

	it('every var(--token) in src without a fallback is defined in app.css or by its component', () => {
		const src = new URL('../../src', import.meta.url).pathname;
		// set on an element by its component: style:--x or `--x:` inside a component's own CSS
		const local = new Set<string>();
		const used = new Map<string, string>();
		for (const file of sources(src)) {
			const text = readFileSync(file, 'utf8');
			for (const m of text.matchAll(/(?:style:|^\s*)(--[\w-]+)\s*[:=]/gm)) local.add(m[1]);
			for (const m of text.matchAll(/var\((--[\w-]+)\)/g)) used.set(m[1], file); // with a fallback it renders anyway
		}
		const missing = [...used].filter(([name]) => !(name in dark) && !local.has(name));
		expect(missing).toEqual([]);
	});

	it.each([['dark', dark], ['light', light]] as const)('%s editor text reaches 4.5:1, carets and outlines 3:1', (_name, theme) => {
		const bg = theme['--bg-editor'];
		const text = ['--editor-text', '--gutter-text', '--syntax-command', '--syntax-argument', '--syntax-math', '--syntax-comment', '--syntax-bracket', '--syntax-number', '--syntax-invalid', '--text', '--text-muted', '--error', '--accent-bright'];
		const low = text.map((t) => [t, contrast(theme[t], bg)] as const).filter(([, r]) => r < 4.5);
		expect(low).toEqual([]);
		expect(contrast(theme['--bracket-match'], bg)).toBeGreaterThanOrEqual(3);
		expect(contrast(theme['--focus'], bg)).toBeGreaterThanOrEqual(3);
		expect(contrast(theme['--on-accent'], theme['--accent'])).toBeGreaterThanOrEqual(4.5);
	});

	it.each([['dark', dark], ['light', light]] as const)('%s UI text stays readable on the surfaces where it is used', (_name, theme) => {
		for (const bg of ['--bg', '--panel', '--bg-editor', '--pdf'])
			for (const fg of ['--text', '--text-muted'])
				expect(contrast(theme[fg], theme[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
		expect(contrast(theme['--on-accent'], theme['--accent'])).toBeGreaterThanOrEqual(4.5);
	});
});
