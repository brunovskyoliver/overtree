import { Facet, StateEffect, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { ySyncAnnotation, ySyncFacet } from 'y-codemirror.next';
import type * as Y from 'yjs';
import { changesOf, recordEdit, resolveChanges, type Author, type Edit, type Resolved } from '../track-changes.ts';

// Track changes in the editor (013 plan.md D3): records the user's own edits as suggestions while tracking is on and
// draws every suggestion of the file: insertions highlighted in the author's color, deletions as a small marker whose
// tooltip shows the removed text. The records themselves live in the Yjs document (track-changes.ts).

const refresh = StateEffect.define<null>();

class Deleted extends WidgetType {
	readonly id: string;
	readonly text: string;
	readonly author: Author;
	constructor(id: string, text: string, author: Author) {
		super();
		this.id = id;
		this.text = text;
		this.author = author;
	}
	eq(o: Deleted) {
		return o.id === this.id && o.text === this.text && o.author.color === this.author.color;
	}
	toDOM() {
		const el = document.createElement('span');
		el.className = 'cm-tcDelete';
		el.style.setProperty('--tc-color', this.author.color);
		el.dataset.changeId = this.id;
		el.title = `${this.author.name} deleted: ${this.text}`;
		el.setAttribute('aria-label', el.title);
		return el;
	}
	ignoreEvent() {
		return false;
	}
}

function build(ranges: Resolved[]): DecorationSet {
	const out: Range<Decoration>[] = [];
	for (const r of ranges) {
		const { author } = r.change;
		if (r.change.kind === 'insert')
			out.push(
				Decoration.mark({
					class: 'cm-tcInsert',
					attributes: { style: `--tc-color: ${author.color}`, title: `${author.name} inserted`, 'data-change-id': r.id }
				}).range(r.from, r.to)
			);
		// before the text at the gap, so a replacement reads "deleted, then inserted"
		else out.push(Decoration.widget({ widget: new Deleted(r.id, r.change.text, author), side: -1 }).range(r.from));
	}
	return Decoration.set(out, true);
}

/** The editor side for one tab's Yjs text; `author` is the signed-in user while tracking is on, else null. Goes
 *  after yCollab: its sync plugin has to have written the edit to the Yjs text before this one records it. */
export function trackChanges(ytext: Y.Text, author: () => Author | null): Extension {
	const plugin = ViewPlugin.fromClass(
		class {
			ranges: Resolved[];
			decorations: DecorationSet;
			view: EditorView;
			map = changesOf(ytext.doc!);
			origin: unknown;
			scheduled = false;
			destroyed = false;

			constructor(view: EditorView) {
				this.view = view;
				this.origin = view.state.facet(ySyncFacet);
				this.ranges = resolveChanges(ytext);
				this.decorations = build(this.ranges);
				this.map.observe(this.onmap);
			}

			// Records changed without a text change (someone accepted, a record arrived after its text): redraw once
			// the Yjs transaction is done. Our own writes from update() are drawn there already.
			onmap = (_: unknown, tr: Y.Transaction) => {
				if (tr.origin === this.origin || this.scheduled) return;
				this.scheduled = true;
				queueMicrotask(() => {
					this.scheduled = false;
					if (!this.destroyed) this.view.dispatch({ effects: refresh.of(null) });
				});
			};

			update(u: ViewUpdate) {
				const local = u.docChanged && !u.transactions.some((tr) => tr.annotation(ySyncAnnotation));
				// the length check: the sync plugin did write this edit (it can't fail, but a mismatch would misplace records)
				if (local && !u.state.readOnly && ytext.length === u.state.doc.length) {
					const edits: Edit[] = [];
					u.changes.iterChanges((fromA, toA, fromB, toB) =>
						edits.push({ fromA, toA, fromB, toB, deleted: u.startState.doc.sliceString(fromA, toA) })
					);
					recordEdit(ytext, edits, this.ranges, author(), this.origin);
				}
				if (u.docChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(refresh)))) {
					this.ranges = resolveChanges(ytext);
					this.decorations = build(this.ranges);
				}
			}

			destroy() {
				this.destroyed = true;
				this.map.unobserve(this.onmap);
			}
		},
		{ decorations: (v) => v.decorations }
	);
	return [plugin, tracked.of(plugin)];
}

// the review panel reads the plugin's ranges (one view for every tab: each tab's plugin is found through a facet)
type TrackPlugin = ViewPlugin<{ ranges: Resolved[] }>;
const tracked = Facet.define<TrackPlugin, TrackPlugin | null>({ combine: (v) => v[0] ?? null });

/** The suggestions of the file in the view, in text order (empty for a state without tracking). */
export function trackedChanges(view: EditorView): Resolved[] {
	const p = view.state.facet(tracked);
	return (p && view.plugin(p)?.ranges) || [];
}
