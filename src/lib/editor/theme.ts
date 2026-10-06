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
