// Project symbols for completion (research R13), shared by the symbols route and the browser.
import { stripComment } from '../outline.ts';

export type ProjectCommand = { name: string; args: number };
export type BibKey = { key: string; title?: string; author?: string };
export type TexSymbols = { labels: string[]; commands: ProjectCommand[]; environments: string[] };
/** `GET /api/project/symbols` (data-model.md `Symbols`). */
export type ProjectSymbols = TexSymbols & { bibKeys: BibKey[]; files: { path: string; kind: 'text' | 'binary' }[] };

const LABEL = /\\label\{([^}]+)\}/g;
// \newcommand{\R}[2], \renewcommand*\x, \providecommand{\y}
const NEWCOMMAND = /\\(?:(?:re)?new|provide)command\*?\s*\{?\s*\\([a-zA-Z@]+)\s*\}?\s*(?:\[(\d)\])?/g;
const MATHOP = /\\DeclareMathOperator\*?\s*\{\s*\\([a-zA-Z@]+)\s*\}/g;
const DEF = /\\def\s*\\([a-zA-Z@]+)((?:#\d)*)/g;
const NEWENV = /\\newenvironment\*?\s*\{([^}]+)\}/g;

/** Labels, defined commands and environments of a LaTeX source, comments ignored. */
export function scanTex(text: string): TexSymbols {
	const code = text.split('\n').map(stripComment).join('\n');
	const all = (re: RegExp, group = 1) => [...code.matchAll(re)].map((m) => m[group].trim());
	return {
		labels: all(LABEL),
		commands: [
			...[...code.matchAll(NEWCOMMAND)].map((m) => ({ name: m[1], args: Number(m[2] ?? 0) })),
			...all(MATHOP).map((name) => ({ name, args: 0 })),
			...[...code.matchAll(DEF)].map((m) => ({ name: m[1], args: m[2].length / 2 }))
		],
		environments: all(NEWENV)
	};
}

/** The text from `open` (an opening brace or quote) to its match, without the delimiters; `end` is after the match. */
function delimited(text: string, open: number): { value: string; end: number } {
	const quote = text[open] === '"';
	let depth = 0;
	for (let i = open + 1; i < text.length; i++) {
		const c = text[i];
		if (c === '\\') i++;
		else if (c === '{') depth++;
		else if (c === '}' && depth-- === 0) return { value: text.slice(open + 1, i), end: i + 1 };
		else if (quote && c === '"' && depth === 0) return { value: text.slice(open + 1, i), end: i + 1 };
	}
	return { value: text.slice(open + 1), end: text.length };
}

const tidy = (s: string) => s.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();

/** Entry keys of a `.bib` file with their title and author; `@string`, `@comment` and `@preamble` are skipped. */
export function scanBib(text: string): BibKey[] {
	// ponytail: only whole-line `%` comments; a `%` inside a field (URLs) stays
	const src = text.replace(/^[ \t]*%.*$/gm, '');
	const keys: BibKey[] = [];
	const ENTRY = /@(\w+)\s*\{\s*([^,\s{}]*)/g;
	for (let m; (m = ENTRY.exec(src)); ) {
		const { value: body, end } = delimited(src, m.index + m[0].indexOf('{'));
		ENTRY.lastIndex = end; // whole entries: an `@` inside one (a @comment's text, an email) starts nothing
		if (/^(string|comment|preamble)$/i.test(m[1]) || !/^\s*[^,\s{}]+\s*,/.test(body)) continue;
		const entry: BibKey = { key: m[2] };
		for (const f of body.matchAll(/(?:^|,)\s*(title|author)\s*=\s*/gi)) {
			const at = f.index + f[0].length;
			const value = '{"'.includes(body[at]) ? delimited(body, at).value : body.slice(at).split(',')[0];
			entry[f[1].toLowerCase() as 'title' | 'author'] = tidy(value);
		}
		keys.push(entry);
	}
	return keys;
}
