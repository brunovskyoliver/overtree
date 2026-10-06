// LaTeX completion source (research R11): context detection only; CodeMirror does the fuzzy
// matching, ranking, keyboard handling, ARIA and snippet tab stops.
import { snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { language } from '@codemirror/language';
import { stripComment } from '../outline.ts';
import { COMMANDS, ENVIRONMENTS } from './data.ts';
import { applyBegin } from './environments.ts';
import type { ProjectCommand } from './scan.ts';

// `type` is the kind label shown on the right: cmd, env or pkg (later label, cite, file)
const BUNDLED: Completion[] = [
	...COMMANDS.map(({ label, snippet, detail, boost }) => {
		const type = label.startsWith('\\usepackage') ? 'pkg' : label === '\\begin{}' || label === '\\end{}' ? 'env' : 'cmd';
		if (label === '\\begin{}') return { label, type, boost, apply: applyBegin };
		return snippetCompletion(snippet, { label, type, detail, boost });
	}),
	...ENVIRONMENTS.map(({ name, snippet }) => snippetCompletion(snippet, { label: `\\begin{${name}}`, type: 'env' }))
];
const BUNDLED_LABELS = new Set(BUNDLED.map((c) => c.label));

const COMMAND_BEFORE = /\\[a-zA-Z@]*$/;

/** Completions for the `\name` before the cursor in LaTeX files; `commands()` gives the project's own. */
export function latexSource(commands: () => ProjectCommand[]) {
	return (context: CompletionContext): CompletionResult | null => {
		if (context.state.facet(language)?.name !== 'stex') return null;
		const line = context.state.doc.lineAt(context.pos);
		const before = line.text.slice(0, context.pos - line.from);
		if (stripComment(before) !== before) return null;
		const m = COMMAND_BEFORE.exec(before);
		if (!m) return null;
		// `\\name` is a line break followed by text
		let slashes = 0;
		while (before[m.index - 1 - slashes] === '\\') slashes++;
		if (slashes % 2) return null;
		const own = commands()
			.map(({ name, args }) => ({ label: `\\${name}${'{}'.repeat(args)}`, args }))
			.filter((c, i, all) => !BUNDLED_LABELS.has(c.label) && all.findIndex((o) => o.label === c.label) === i)
			.map(({ label, args }) =>
				args ? snippetCompletion(`${label.slice(0, -2 * args)}${'{${}}'.repeat(args)}\${}`, { label, type: 'cmd' }) : { label, type: 'cmd' }
			);
		return { from: line.from + m.index, options: own.length ? [...BUNDLED, ...own] : BUNDLED, validFor: /^\\[a-zA-Z@]*$/ };
	};
}

/** The kind label at the right of each option (contracts/ui.md, completion popup). */
export function kindLabel(completion: Completion) {
	const span = document.createElement('span');
	span.className = 'cm-completionKind';
	span.textContent = completion.type ?? '';
	return span;
}
