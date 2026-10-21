// LaTeX completion source (research R11): context detection only; CodeMirror does the fuzzy
// matching, ranking, keyboard handling, ARIA and snippet tab stops.
import { closeCompletion, snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { language } from '@codemirror/language';
import { stripComment } from '../outline.ts';
import { COMMANDS, ENVIRONMENTS, PACKAGES } from './data.ts';
import { applyBegin } from './environments.ts';
import type { ProjectSymbols } from './scan.ts';

// `type` is the kind label shown on the right: cmd, env, pkg, label, cite or file
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

const named = (names: string[], type: string): Completion[] => [...new Set(names)].map((label) => ({ label, type }));
const ext = (path: string) => path.slice(path.lastIndexOf('.') + 1).toLowerCase();
const FILE_TYPES: Record<string, string[]> = {
	input: ['tex'],
	include: ['tex'],
	includegraphics: ['png', 'jpg', 'jpeg', 'pdf', 'eps'],
	bibliography: ['bib'],
	addbibresource: ['bib']
};
/** Project files that `\command{}` takes, relative to the root; the extension is dropped except for `\addbibresource`. */
function paths(p: ProjectSymbols, command: string): Completion[] {
	const files = p.files.filter((f) => FILE_TYPES[command].includes(ext(f.path)));
	const labels = files.map((f) => (command === 'addbibresource' ? f.path : f.path.slice(0, f.path.lastIndexOf('.'))));
	return named(labels, 'file');
}

/** A citation command's argument before the cursor; the group is the key being typed, after any commas. */
export const CITE_ARGUMENT = /\\(?:cite[tp]?|parencite|textcite|autocite|nocite)\*?(?:\[[^\]]*\])*\{(?:[^}]*,)?\s*([^,}]*)$/;

// Argument contexts (research R11, FR-030): the last group is the key being typed, after any commas.
const ARGUMENTS: [RegExp, (p: ProjectSymbols, command: string) => Completion[]][] = [
	[/\\(?:ref|eqref|autoref|pageref|cref|Cref|nameref)\{(?:[^}]*,)?\s*([^,}]*)$/, (p) => named(p.labels, 'label')],
	[CITE_ARGUMENT, (p) => p.bibKeys.map(({ key, title, author }) => ({ label: key, type: 'cite', detail: title ?? author }))],
	[/\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{(?:[^}]*,)?\s*([^,}]*)$/, () => named(PACKAGES, 'pkg')],
	[/\\(input|include|includegraphics|bibliography|addbibresource)(?:\[[^\]]*\])?\{([^}]*)$/, paths],
	[/\\(?:begin|end)\{([^}]*)$/, (p) => named([...ENVIRONMENTS.map((e) => e.name), ...p.environments], 'env')]
];

/** An odd number of backslashes before `at`: the `\` there is escaped (`\\name` is a line break followed by text). */
function escaped(text: string, at: number) {
	let slashes = 0;
	while (text[at - 1 - slashes] === '\\') slashes++;
	return slashes % 2 === 1;
}

/** Completions for the `\name` or command argument before the cursor in LaTeX files; `project` gives the project's symbols. */
export function latexSource(project: ProjectSymbols) {
	return (context: CompletionContext): CompletionResult | null => {
		if (context.state.facet(language)?.name !== 'stex') return null;
		const line = context.state.doc.lineAt(context.pos);
		const before = line.text.slice(0, context.pos - line.from);
		if (stripComment(before) !== before) return null;
		for (const [re, options] of ARGUMENTS) {
			const a = re.exec(before);
			if (!a || escaped(before, a.index)) continue;
			const key = a[a.length - 1];
			// no validFor: a comma starts the next key, so the source runs again on each keystroke
			return { from: context.pos - key.length, options: options(project, a[1]) };
		}
		const m = COMMAND_BEFORE.exec(before);
		if (!m || escaped(before, m.index)) return null;
		const own = project.commands
			.map(({ name, args }) => ({ label: `\\${name}${'{}'.repeat(args)}`, args }))
			.filter((c, i, all) => !BUNDLED_LABELS.has(c.label) && all.findIndex((o) => o.label === c.label) === i)
			.map(({ label, args }) =>
				args ? snippetCompletion(`${label.slice(0, -2 * args)}${'{${}}'.repeat(args)}\${}`, { label, type: 'cmd' }) : { label, type: 'cmd' }
			);
		return { from: line.from + m.index, options: own.length ? [...BUNDLED, ...own] : BUNDLED, validFor: /^\\[a-zA-Z@]*$/ };
	};
}

/** "Add reference…" in a citation argument (017 US1): opens the dialog, which puts the new key where the cursor is.
 *  A source of its own, anchored at the cursor rather than at the key being typed: an empty pattern matches it
 *  whatever was typed, ranked below the keys that match (`filter: false` would rank it first, so Enter after a
 *  typed key would open the dialog). Not in read-only files. */
export function addReferenceSource(open: () => void) {
	const option: Completion = {
		label: 'Add reference…',
		type: 'action',
		boost: -99,
		apply: (view) => {
			closeCompletion(view);
			open();
		}
	};
	return (context: CompletionContext): CompletionResult | null => {
		if (context.state.readOnly || context.state.facet(language)?.name !== 'stex') return null;
		const line = context.state.doc.lineAt(context.pos);
		const before = line.text.slice(0, context.pos - line.from);
		const a = stripComment(before) === before && CITE_ARGUMENT.exec(before);
		if (!a || escaped(before, a.index)) return null;
		return { from: context.pos, options: [option] };
	};
}

/** The kind label at the right of each option (contracts/ui.md, completion popup). */
export function kindLabel(completion: Completion) {
	const span = document.createElement('span');
	span.className = 'cm-completionKind';
	span.textContent = completion.type ?? '';
	return span;
}
