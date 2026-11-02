// A PDF double-click (reverse SyncTeX) lands in the source: the word, or its line when the word wasn't found
// nearby, blinks in the PDF's own sync-highlight amber so the eye finds where it went.
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';

const FLASH_MS = 1600;
const flashEffect = StateEffect.define<{ from: number; to: number } | null>();
const mark = Decoration.mark({ class: 'cm-flash' });
const line = Decoration.line({ class: 'cm-flash' });

const flashField = StateField.define({
	create: () => Decoration.none,
	update(deco, tr) {
		deco = deco.map(tr.changes);
		for (const e of tr.effects) {
			if (!e.is(flashEffect)) continue;
			const r = e.value;
			deco = !r ? Decoration.none : Decoration.set(r.from < r.to ? mark.range(r.from, r.to) : line.range(tr.state.doc.lineAt(r.from).from));
		}
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f)
});

export const flashing = [
	flashField,
	EditorView.baseTheme({
		'.cm-flash': { animation: 'cm-flash 0.4s ease-in-out 4 alternate', borderRadius: '2px' },
		'@keyframes cm-flash': { from: { backgroundColor: 'transparent' }, to: { backgroundColor: 'rgb(255 196 0 / 45%)' } },
		'@media (prefers-reduced-motion: reduce)': { '.cm-flash': { animation: 'none', backgroundColor: 'rgb(255 196 0 / 35%)' } }
	})
];

const timers = new WeakMap<EditorView, ReturnType<typeof setTimeout>>();

/** Blink `from`–`to` of `view` (an empty range: its whole line), replacing a blink still running. */
export function flash(view: EditorView, from: number, to: number) {
	clearTimeout(timers.get(view));
	view.dispatch({ effects: flashEffect.of({ from, to }) });
	timers.set(view, setTimeout(() => view.dispatch({ effects: flashEffect.of(null) }), FLASH_MS));
}
