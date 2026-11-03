// Ghost text: the prediction for the cursor (completion/predict.ts) in gray after it; Tab takes it, Escape or moving
// the cursor drops it. Only after the user's own typing (not a collaborator's), never in a read-only file, and
// hidden while the completion popup is open, whose Tab comes first.
import { completionStatus } from '@codemirror/autocomplete';
import { Prec, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { predict } from '../completion/predict.ts';
import { prefs } from './prefs.svelte.ts';

type Ghost = { pos: number; text: string } | null;
const drop = StateEffect.define<null>();

const ghostField = StateField.define<Ghost>({
	create: () => null,
	update(ghost, tr) {
		if (tr.effects.some((e) => e.is(drop))) return null;
		const { main } = tr.state.selection;
		if (tr.docChanged && tr.isUserEvent('input') && main.empty && !tr.state.readOnly && prefs.predictions) {
			const text = predict(tr.state.doc, main.head);
			return text ? { pos: main.head, text } : null;
		}
		// someone else's edit elsewhere keeps it in place; any other change or a cursor move drops it
		if (ghost && tr.docChanged && !tr.isUserEvent('input') && !tr.isUserEvent('delete') && !tr.selection) {
			const pos = tr.changes.mapPos(ghost.pos);
			return pos === main.head ? { ...ghost, pos } : null;
		}
		return ghost && !tr.docChanged && !tr.selection ? ghost : null;
	}
});

class GhostWidget extends WidgetType {
	text: string;
	constructor(text: string) {
		super();
		this.text = text;
	}
	eq(other: GhostWidget) {
		return other.text === this.text;
	}
	toDOM() {
		const span = document.createElement('span');
		span.className = 'cm-ghost';
		span.textContent = this.text;
		span.title = 'Tab to accept, Esc to dismiss';
		return span;
	}
	ignoreEvent() {
		return true;
	}
}

const shown = (view: EditorView): Ghost => {
	const ghost = view.state.field(ghostField);
	// only an open popup: right after each keystroke it is 'pending' for a moment, and a quick Tab then has to work
	return ghost && completionStatus(view.state) !== 'active' ? ghost : null;
};

const ghostView = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = this.build(view);
		}
		update(u: ViewUpdate) {
			this.decorations = this.build(u.view);
		}
		build(view: EditorView) {
			const ghost = shown(view);
			return ghost ? Decoration.set([Decoration.widget({ widget: new GhostWidget(ghost.text), side: 1 }).range(ghost.pos)]) : Decoration.none;
		}
	},
	{ decorations: (p) => p.decorations }
);

function accept(view: EditorView) {
	const ghost = shown(view);
	if (!ghost) return false;
	view.dispatch({
		changes: { from: ghost.pos, insert: ghost.text },
		selection: { anchor: ghost.pos + ghost.text.length },
		userEvent: 'input.complete'
	});
	return true;
}

/** Escape drops the ghost, also one hidden under an open popup (which then closes too, by its own Escape). */
function dismiss(view: EditorView) {
	if (!view.state.field(ghostField)) return false;
	view.dispatch({ effects: drop.of(null) });
	return completionStatus(view.state) !== 'active';
}

/** The ghost text and its keys: Tab above the indent (the completion popup's Tab stays first), and Escape at the top,
 *  so it comes before autocompletion's, which takes Escape even while it is only looking (put this before it). */
export const ghostText: Extension = [
	ghostField,
	ghostView,
	Prec.high(keymap.of([{ key: 'Tab', run: accept }])),
	Prec.highest(keymap.of([{ key: 'Escape', run: dismiss }])),
	EditorView.baseTheme({ '.cm-ghost': { color: 'var(--text-muted)', opacity: '0.75', pointerEvents: 'none' } })
];
