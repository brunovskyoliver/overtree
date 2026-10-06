// Dark editor theme modeled on reference-layout.png.
import { syntaxHighlighting } from '@codemirror/language';
import type { Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { tagHighlighter, tags } from '@lezer/highlight';
import { ySyncFacet } from 'y-codemirror.next';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';

// Stable class names (tests assert them). stex emits: tag = command, atom = argument,
// keyword = math delimiter, special(variableName) = math letters, comment, bracket, number.
const latexClasses = tagHighlighter([
	{ tag: tags.tagName, class: 'tok-command' },
	{ tag: tags.atom, class: 'tok-argument' },
	{ tag: [tags.keyword, tags.special(tags.variableName)], class: 'tok-math' },
	{ tag: tags.comment, class: 'tok-comment' },
	{ tag: tags.bracket, class: 'tok-bracket' },
	{ tag: tags.number, class: 'tok-number' },
	{ tag: tags.invalid, class: 'tok-invalid' }
]);

const theme = EditorView.theme(
	{
		'&': { height: '100%', backgroundColor: 'var(--bg-editor)', color: '#d7dae0' },
		'.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: '13px', lineHeight: '1.65' },
		'.cm-content': { caretColor: 'var(--accent-bright)' },
		'.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--accent-bright)' },
		'.cm-gutters': { backgroundColor: 'var(--bg-editor)', color: '#6b7385', border: 'none' },
		'.cm-activeLine': { backgroundColor: '#2a3040' },
		'.cm-activeLineGutter': { backgroundColor: '#2a3040', color: '#c3c8d2' },
		'&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
			{ backgroundColor: '#3a4a6b' },
		'.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
			backgroundColor: 'transparent',
			outline: '1px solid #e5c07b'
		},
		'.cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket': { outline: '1px solid #e06c75' },
		'.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--text)' },
		'.cm-panels-top': { borderBottom: '1px solid var(--border)' },
		'.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
		'.cm-panel.cm-search': { padding: '6px 28px 6px 8px', fontFamily: 'var(--font-ui)', fontSize: '13px' },
		'.cm-panel.cm-search label': { fontSize: '13px' },
		'.cm-panel.cm-search [name=close]': { color: 'var(--text-muted)', fontSize: '18px', right: '6px' },
		'.cm-textfield': {
			backgroundColor: 'var(--bg-editor)',
			color: 'var(--text)',
			border: '1px solid var(--border)',
			borderRadius: '4px',
			padding: '3px 6px'
		},
		'.cm-textfield:focus': { outline: '2px solid var(--focus)', outlineOffset: '-1px' },
		'.cm-button': {
			backgroundImage: 'none',
			backgroundColor: 'var(--panel-raised)',
			color: 'var(--text)',
			border: '1px solid var(--border)',
			borderRadius: '4px',
			padding: '3px 10px'
		},
		'.cm-button:hover': { backgroundColor: 'var(--handle)' },
		'.cm-searchMatch': { backgroundColor: '#5c4a1e', outline: '1px solid #a8862f' },
		'.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#2f6a31', outline: '1px solid var(--accent-bright)' },
		'.cm-selectionMatch': { backgroundColor: '#33405a' },
		// completion popup (reference-autocomplete.png): 8 rows of 23 px, label left, kind right
		'.cm-tooltip.cm-tooltip-autocomplete': {
			backgroundColor: '#23262e',
			border: '1px solid var(--border)',
			borderRadius: '2px',
			boxShadow: '0 4px 12px rgb(0 0 0 / 0.4)'
		},
		'.cm-tooltip.cm-tooltip-autocomplete > ul': {
			fontFamily: 'var(--font-mono)',
			fontSize: '13px',
			width: '500px',
			maxWidth: 'min(500px, 90vw)',
			maxHeight: `${8 * 23}px`
		},
		'.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
			display: 'flex',
			alignItems: 'center',
			height: '23px',
			padding: '0 8px',
			color: '#d7dae0'
		},
		'.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent)', color: '#fff' },
		'.cm-completionLabel': { whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis' },
		'.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '700', color: '#fff' },
		'.cm-completionDetail': { marginLeft: '12px', color: 'var(--text-muted)', fontStyle: 'normal', overflow: 'hidden', textOverflow: 'ellipsis' },
		'.cm-completionKind': { marginLeft: 'auto', paddingLeft: '16px', color: 'var(--text-muted)' },
		'li[aria-selected] .cm-completionKind': { color: '#c9d6c9' },
		// remote cursors (y-codemirror): the name label sits on the caret in the user's color (R9 palette, dark text)
		'.cm-ySelectionCaret': { borderLeftWidth: '2px', borderRightWidth: '0', marginRight: '0' },
		'.cm-ySelectionInfo': {
			top: '-1.35em',
			padding: '1px 5px',
			borderRadius: '3px 3px 3px 0',
			color: '#1b1e26',
			fontFamily: 'var(--font-ui)',
			fontSize: '11px',
			fontWeight: '600'
		},
		'.cm-yRecent .cm-ySelectionInfo': { opacity: '1' },
		'.tok-command': { color: '#d27fb3' },
		'.tok-argument': { color: '#e5a85c', fontStyle: 'italic' },
		'.tok-math': { color: '#7fc8a9' },
		'.tok-comment': { color: '#5f6b85' },
		'.tok-bracket': { color: '#c3c8d2' },
		'.tok-number': { color: '#d19a66' },
		'.tok-invalid': { color: '#e06c75' }
	},
	{ dark: true }
);

export const editorTheme = [theme, syntaxHighlighting(latexClasses)];

const LABEL_MS = 2000;

/** Remote name labels show for 2 s after that user's cursor moves, then only on hover: the lines holding a
 *  recently moved remote caret get `cm-yRecent`. y-codemirror reuses the caret DOM, so a CSS animation can't. */
// ponytail: per line, not per caret; two users on one line both show while either moves
export const cursorLabels = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet = Decoration.none;
		moved = new Map<number, number>(); // awareness client id → last cursor change
		timer: ReturnType<typeof setTimeout> | undefined;
		view: EditorView;
		conf: { ytext: Y.Text; awareness: Awareness } | null;

		constructor(view: EditorView) {
			this.view = view;
			// absent in the empty state a closed tab leaves behind
			this.conf = view.state.facet(ySyncFacet) ?? null;
			this.conf?.awareness.on('change', this.onchange);
			this.decorations = this.build();
		}

		onchange = ({ added, updated }: { added: number[]; updated: number[] }) => {
			const self = this.conf!.awareness.clientID;
			const remote = [...added, ...updated].filter((id) => id !== self);
			// local changes come from inside a view update (y-codemirror sets our cursor there): no dispatch
			if (!remote.length) return;
			for (const id of remote) this.moved.set(id, Date.now());
			this.refresh();
		};

		/** Redraw now and again when the oldest label is due to hide. */
		refresh() {
			this.view.dispatch({});
			clearTimeout(this.timer);
			if (this.moved.size) this.timer = setTimeout(() => this.refresh(), Math.max(0, Math.min(...this.moved.values()) + LABEL_MS - Date.now()) + 10);
		}

		update(u: ViewUpdate) {
			if (u.docChanged || u.transactions.length) this.decorations = this.build();
		}

		build() {
			if (!this.conf) return Decoration.none;
			const { ytext, awareness } = this.conf;
			const states = awareness.getStates();
			const lines = new Set<number>();
			for (const [id, at] of this.moved) {
				const head = states.get(id)?.cursor?.head;
				if (Date.now() - at >= LABEL_MS || !head) {
					this.moved.delete(id);
					continue;
				}
				const pos = Y.createAbsolutePositionFromRelativePosition(head, ytext.doc!);
				if (pos?.type === ytext && pos.index <= this.view.state.doc.length) lines.add(this.view.state.doc.lineAt(pos.index).from);
			}
			const recent = Decoration.line({ class: 'cm-yRecent' });
			return Decoration.set([...lines].sort((a, b) => a - b).map((from): Range<Decoration> => recent.range(from)));
		}

		destroy() {
			clearTimeout(this.timer);
			this.conf?.awareness.off('change', this.onchange);
		}
	},
	{ decorations: (v) => v.decorations }
);
