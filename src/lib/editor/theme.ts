// Dark editor theme modeled on reference-layout.png.
import { syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tagHighlighter, tags } from '@lezer/highlight';

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
