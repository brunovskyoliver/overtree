// Editor theme modeled on reference-layout.png. Every color is an app.css token, so the same theme serves dark and
// light; `colorScheme` tells CodeMirror which of its own base styles (tooltips, panels) to use.
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
		'&': { height: '100%', backgroundColor: 'var(--bg-editor)', color: 'var(--editor-text)' },
		'.cm-scroller': { fontFamily: 'var(--font-mono)', fontSize: 'var(--editor-font-size, 13px)', lineHeight: '1.65' },
		'.cm-content': { caretColor: 'var(--accent-bright)' },
		'.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--accent-bright)' },
		'.cm-gutters': { backgroundColor: 'var(--bg-editor)', color: 'var(--gutter-text)', border: 'none' },
		// translucent: the selection layer sits behind the text, an opaque line background would hide it
		'.cm-activeLine': { backgroundColor: 'var(--active-line)' },
		'.cm-activeLineGutter': { backgroundColor: 'var(--active-gutter)', color: 'var(--active-gutter-text)' },
		'&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
			{ backgroundColor: 'var(--selection)' },
		'.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
			backgroundColor: 'transparent',
			outline: '1px solid var(--bracket-match)'
		},
		'.cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket': { outline: '1px solid var(--bracket-mismatch)' },
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
		'.cm-searchMatch': { backgroundColor: 'var(--search-match)', outline: '1px solid var(--search-match-outline)' },
		'.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--search-match-current)', outline: '1px solid var(--accent-bright)' },
		// an outline, so other matches never look like the selection itself
		'.cm-selectionMatch': { backgroundColor: 'transparent', outline: '1px solid var(--selection-match-outline)', borderRadius: '2px' },
		// completion popup (reference-autocomplete.png): 8 rows of 23 px, label left, kind right
		'.cm-tooltip.cm-tooltip-autocomplete': {
			backgroundColor: 'var(--popup)',
			border: '1px solid var(--border)',
			borderRadius: '2px',
			boxShadow: 'var(--shadow-popup)'
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
			color: 'var(--editor-text)'
		},
		'.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent)', color: '#fff' },
		'.cm-completionLabel': { whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis' },
		'.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '700', color: 'var(--editor-text-strong)' },
		'li[aria-selected] .cm-completionMatchedText': { color: 'inherit' },
		'.cm-completionDetail': { marginLeft: '12px', color: 'var(--text-muted)', fontStyle: 'normal', overflow: 'hidden', textOverflow: 'ellipsis' },
		'.cm-completionKind': { marginLeft: 'auto', paddingLeft: '16px', color: 'var(--text-muted)' },
		'li[aria-selected] .cm-completionKind': { color: 'var(--completion-kind-selected)' },
		// remote cursors (y-codemirror): the name label sits on the caret in the user's color (R9 palette, dark text); the light
		// theme darkens caret and label through a filter and turns the label text white (plan.md, presence contrast)
		'.cm-ySelectionCaret': { borderLeftWidth: '2px', borderRightWidth: '0', marginRight: '0', filter: 'var(--presence-caret-filter)' },
		'.cm-ySelectionInfo': {
			top: '-1.35em',
			padding: '1px 5px',
			borderRadius: '3px 3px 3px 0',
			color: 'var(--presence-label-text)',
			fontFamily: 'var(--font-ui)',
			fontSize: '11px',
			fontWeight: '600'
		},
		'.cm-yRecent .cm-ySelectionInfo': { opacity: '1' },
		'.tok-command': { color: 'var(--syntax-command)' },
		'.tok-argument': { color: 'var(--syntax-argument)', fontStyle: 'italic' },
		'.tok-math': { color: 'var(--syntax-math)' },
		'.tok-comment': { color: 'var(--syntax-comment)' },
		'.tok-bracket': { color: 'var(--syntax-bracket)' },
		'.tok-number': { color: 'var(--syntax-number)' },
		'.tok-invalid': { color: 'var(--syntax-invalid)' }
	}
);

export const editorTheme = [theme, syntaxHighlighting(latexClasses)];

/** CodeMirror's base styles for the resolved app theme; goes in a compartment next to `editorTheme`. */
export const colorScheme = (theme: 'dark' | 'light') => EditorView.darkTheme.of(theme === 'dark');

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
