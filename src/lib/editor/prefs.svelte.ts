// Editor preferences per device, like the layout mode (layout.svelte.ts): font size, browser spellcheck, the
// instant code check (016) and the appearance (018: dark, light or the system's choice), which colors the whole app
// through <html data-theme>.

const KEY = 'overtree:editor-prefs';
export const FONT_SIZES = { min: 10, max: 24, default: 13 };

export type Appearance = 'dark' | 'light' | 'system';
export type Theme = 'dark' | 'light';
export const APPEARANCES: { value: Appearance; label: string }[] = [
	{ value: 'dark', label: 'Dark' },
	{ value: 'light', label: 'Light' },
	{ value: 'system', label: 'System' }
];
const isAppearance = (v: unknown): v is Appearance => APPEARANCES.some((a) => a.value === v);

/** The theme an appearance shows. src/app.html repeats this before first paint (tests/unit/appearance.test.ts). */
export const resolveTheme = (appearance: Appearance, systemLight: boolean): Theme =>
	appearance === 'light' || (appearance === 'system' && systemLight) ? 'light' : 'dark';

class EditorPrefs {
	fontSize = $state(FONT_SIZES.default);
	spellcheck = $state(true);
	appearance = $state<Appearance>('dark');
	#systemLight = $state(false);
	theme = $derived(resolveTheme(this.appearance, this.#systemLight));
	codeCheck = $state(true);

	constructor() {
		try {
			const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
			if (Number.isInteger(stored.fontSize)) this.fontSize = clamp(stored.fontSize);
			if (typeof stored.spellcheck === 'boolean') this.spellcheck = stored.spellcheck;
			if (isAppearance(stored.appearance)) this.appearance = stored.appearance;
			if (typeof stored.codeCheck === 'boolean') this.codeCheck = stored.codeCheck;
		} catch {
			// unreadable storage: defaults
		}
		if (typeof matchMedia !== 'function') return; // server and unit tests
		const light = matchMedia('(prefers-color-scheme: light)');
		this.#systemLight = light.matches;
		light.addEventListener('change', (e) => {
			this.#systemLight = e.matches;
			this.#apply();
		});
		this.#apply();
	}

	setFontSize(size: number) {
		this.fontSize = clamp(size);
		this.#store();
	}

	setSpellcheck(on: boolean) {
		this.spellcheck = on;
		this.#store();
	}

	setCodeCheck(on: boolean) {
		this.codeCheck = on;
		this.#store();
	}

	setAppearance(appearance: Appearance) {
		this.appearance = appearance;
		this.#apply();
		this.#store();
	}

	#apply() {
		if (typeof document !== 'undefined') document.documentElement.dataset.theme = this.theme;
	}

	#store() {
		try {
			localStorage.setItem(KEY, JSON.stringify({ fontSize: this.fontSize, spellcheck: this.spellcheck, codeCheck: this.codeCheck, appearance: this.appearance }));
		} catch {
			// private mode or full: the choice lasts for this page
		}
	}
}

const clamp = (n: number) => Math.min(FONT_SIZES.max, Math.max(FONT_SIZES.min, n));

export const prefs = new EditorPrefs();
