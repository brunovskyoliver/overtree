// Inline markers (016): compile errors and warnings plus the instant code check, through @codemirror/lint.
import { forceLinting, linter, lintGutter, lintKeymap, type Diagnostic } from '@codemirror/lint';
import { StateEffect, type Extension, type Text } from '@codemirror/state';
import { EditorView, keymap, type ViewUpdate } from '@codemirror/view';
import type { LogEntry } from '../compile-types.ts';
import { codeCheck } from './codecheck.ts';

const SEVERITY: Record<LogEntry['level'], Diagnostic['severity']> = {
	error: 'error',
	warning: 'warning',
	chktex: 'warning',
	typesetting: 'info'
};

const refresh = StateEffect.define<null>();

/** The editor's linter: `source` gives the diagnostics of the shown document (re-run on every change, debounced). */
export function latexLint(source: (view: EditorView) => Diagnostic[]): Extension {
	const needsRefresh = (u: ViewUpdate) => u.transactions.some((tr) => tr.effects.some((e) => e.is(refresh)));
	return [linter(source, { delay: 400, needsRefresh }), lintGutter(), keymap.of(lintKeymap), lintTheme];
}

/** Run the linter now, without a change (a new compile result, the code check switched). */
export function relint(view: EditorView) {
	view.dispatch({ effects: refresh.of(null) });
	forceLinting(view); // skips the delay
}

/** The code check's problems as diagnostics. */
export function codeCheckDiagnostics(doc: string): Diagnostic[] {
	return codeCheck(doc).map((p) => ({ ...p, severity: 'error', source: 'Code check' }));
}

/** Where an entry's marker goes in `doc`: the exact ChkTeX range, else the hint's token on its line (or up to two
 *  lines before: TeX often reports the line after a \usepackage), else the line's text. */
export function entryRange(doc: Text, entry: LogEntry): { from: number; to: number } {
	const n = Math.min(Math.max(entry.line ?? 1, 1), doc.lines);
	const line = doc.line(n);
	if (entry.column) {
		const from = Math.min(line.from + entry.column - 1, line.to);
		return { from, to: Math.min(from + Math.max(entry.length ?? 1, 1), line.to) };
	}
	const token = entry.hint?.token;
	if (token)
		for (let k = n; k >= Math.max(1, n - 2); k--) {
			const l = doc.line(k);
			const at = l.text.lastIndexOf(token);
			if (at >= 0) return { from: l.from + at, to: l.from + at + token.length };
		}
	const indent = line.text.length - line.text.trimStart().length;
	return { from: line.from + indent, to: line.to };
}

/** A compile entry at a range: the tooltip shows the message, then the hint. */
export function entryDiagnostic(entry: LogEntry, from: number, to: number): Diagnostic {
	const { hint } = entry;
	return {
		from,
		to,
		severity: SEVERITY[entry.level],
		source: entry.level === 'chktex' ? 'ChkTeX' : 'Compile',
		message: hint ? `${entry.message}\n${hint.explanation}${hint.fix ? `\n${hint.fix}` : ''}` : entry.message,
		renderMessage: hint
			? () => {
					const box = document.createElement('div');
					box.className = 'cm-hint-message';
					// `code` spans of the hint texts as <code>, like the logs panel
					const add = (tag: string, text: string, cls?: string) => {
						const el = box.appendChild(document.createElement(tag));
						for (const [i, part] of text.split('`').entries()) {
							if (i % 2) el.appendChild(document.createElement('code')).textContent = part;
							else el.append(part);
						}
						if (cls) el.className = cls;
					};
					add('strong', entry.message);
					add('p', hint.explanation);
					if (hint.fix) add('p', hint.fix, 'cm-hint-fix');
					return box;
				}
			: undefined
	};
}

const lintTheme = EditorView.theme({
	// the package's markers are SVGs with fixed colors: drawn again from the theme variables
	'.cm-lintRange': { backgroundImage: 'none', paddingBottom: '0', textDecorationLine: 'underline', textDecorationStyle: 'wavy', textDecorationSkipInk: 'none', textUnderlineOffset: '3px' },
	'.cm-lintRange-error': { backgroundImage: 'none', textDecorationColor: 'var(--danger)' },
	'.cm-lintRange-warning': { backgroundImage: 'none', textDecorationColor: 'var(--warn-stripe)' },
	'.cm-lintRange-info, .cm-lintRange-hint': { backgroundImage: 'none', textDecorationColor: 'var(--info)' },
	'.cm-lintRange-active': { backgroundColor: 'color-mix(in srgb, var(--warn-stripe) 25%, transparent)' },
	'.cm-lintPoint:after': { borderBottomColor: 'var(--danger)' },
	'.cm-lintPoint-warning:after': { borderBottomColor: 'var(--warn-stripe)' },
	'.cm-lintPoint-info:after': { borderBottomColor: 'var(--info)' },
	'.cm-gutter-lint .cm-gutterElement': { display: 'flex', alignItems: 'center', justifyContent: 'center' },
	'.cm-lint-marker': { content: 'normal', width: '0.65em', height: '0.65em' },
	'.cm-lint-marker-error': { content: 'normal', borderRadius: '50%', backgroundColor: 'var(--danger)' },
	'.cm-lint-marker-warning': { content: 'normal', clipPath: 'polygon(50% 0, 100% 100%, 0 100%)', backgroundColor: 'var(--warn-stripe)' },
	'.cm-lint-marker-info': { content: 'normal', borderRadius: '2px', backgroundColor: 'var(--info)' },
	'.cm-tooltip.cm-tooltip-lint': { maxWidth: '420px', backgroundColor: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--border)', fontFamily: 'var(--font-ui)', fontSize: '13px' },
	'.cm-diagnostic-error': { borderLeft: '4px solid var(--danger)' },
	'.cm-diagnostic-warning': { borderLeft: '4px solid var(--warn-stripe)' },
	'.cm-diagnostic-info, .cm-diagnostic-hint': { borderLeft: '4px solid var(--info)' },
	'.cm-diagnosticSource': { color: 'var(--text-muted)', opacity: '1' },
	'.cm-hint-message p': { margin: '4px 0 0' },
	'.cm-hint-fix': { color: 'var(--text-muted)' },
	'.cm-hint-message code': { padding: '0 3px', borderRadius: '3px', backgroundColor: 'var(--bg)', fontFamily: 'var(--font-mono)', fontSize: '12px' },
	'.cm-panel.cm-panel-lint ul [aria-selected]': { backgroundColor: 'var(--panel-raised)' },
	'.cm-panel.cm-panel-lint ul:focus [aria-selected]': { backgroundColor: 'var(--panel-raised)', color: 'var(--text)' }
});
