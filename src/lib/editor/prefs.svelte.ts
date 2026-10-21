// Editor preferences per device, like the layout mode (layout.svelte.ts): font size and browser spellcheck.

const KEY = 'overtree:editor-prefs';
export const FONT_SIZES = { min: 10, max: 24, default: 13 };

class EditorPrefs {
	fontSize = $state(FONT_SIZES.default);
	spellcheck = $state(true);

	constructor() {
		try {
			const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}');
			if (Number.isInteger(stored.fontSize)) this.fontSize = clamp(stored.fontSize);
			if (typeof stored.spellcheck === 'boolean') this.spellcheck = stored.spellcheck;
		} catch {
			// unreadable storage: defaults
		}
	}

	setFontSize(size: number) {
		this.fontSize = clamp(size);
		this.#store();
	}

	setSpellcheck(on: boolean) {
		this.spellcheck = on;
		this.#store();
	}

	#store() {
		try {
			localStorage.setItem(KEY, JSON.stringify({ fontSize: this.fontSize, spellcheck: this.spellcheck }));
		} catch {
			// private mode or full: the choice lasts for this page
		}
	}
}

const clamp = (n: number) => Math.min(FONT_SIZES.max, Math.max(FONT_SIZES.min, n));

export const prefs = new EditorPrefs();
