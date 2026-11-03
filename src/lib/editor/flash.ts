// What just happened in the source blinks in the PDF's sync-highlight amber, so the eye finds it: where a PDF
// double-click (reverse SyncTeX) or a log entry landed, a collaborator's line, what a quick fix changed.
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';

const FLASH_MS = 1600;
type Range = { from: number; to: number };
const flashEffect = StateEffect.define<Range[] | null>();
const mark = Decoration.mark({ class: 'cm-flash' });
const line = Decoration.line({ class: 'cm-flash' });

const flashField = StateField.define({
	create: () => Decoration.none,
	update(deco, tr) {
		deco = deco.map(tr.changes);
		for (const e of tr.effects) {
			if (!e.is(flashEffect)) continue;
			const marks = (e.value ?? []).map((r) => (r.from < r.to ? mark.range(r.from, r.to) : line.range(tr.state.doc.lineAt(r.from).from)));
			deco = Decoration.set(marks, true);
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

/** Blink `ranges` of `view` (an empty one: its whole line), replacing a blink still running. */
export function flash(view: EditorView, ...ranges: Range[]) {
	clearTimeout(timers.get(view));
	view.dispatch({ effects: flashEffect.of(ranges) });
	timers.set(view, setTimeout(() => view.dispatch({ effects: flashEffect.of(null) }), FLASH_MS));
}
