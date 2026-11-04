// What the spell checker reads in a LaTeX file (editor/spelling.ts): the prose words, not commands, math, comments,
// keys, file names or verbatim text; and which language the document is in, from babel or polyglossia.

/** Languages with a dictionary (editor/spelling.ts loads it): English only. */
export type Lang = 'en' | 'en-GB';
export const LANG_NAMES: Record<Lang, string> = { en: 'English', 'en-GB': 'British English' };

const BABEL: Record<string, Lang | null> = {
	english: 'en', american: 'en', usenglish: 'en', canadian: 'en',
	british: 'en-GB', ukenglish: 'en-GB', australian: 'en-GB', newzealand: 'en-GB',
	// not English: the browser's own spell check stays on for these
	...Object.fromEntries(
		('danish slovak czech german ngerman austrian naustrian swissgerman french spanish italian portuguese brazil brazilian dutch ' +
			'swedish norsk nynorsk norwegian finnish polish russian ukrainian greek hungarian romanian croatian slovene ' +
			'serbian turkish catalan estonian latvian lithuanian icelandic irish welsh hebrew arabic japanese chinese ' +
			'korean vietnamese indonesian latin bulgarian macedonian albanian basque galician')
			.split(' ')
			.map((l) => [l, null])
	)
};

/** The document's language: US or British English, null for another one, undefined when `text` has no preamble
 *  (a chapter: ask the main document). A preamble that names no language is English. */
export function languageOf(text: string): Lang | null | undefined {
	const begin = text.indexOf('\\begin{document}');
	if (begin < 0 || !/\\documentclass\b/.test(text.slice(0, begin))) return;
	const preamble = text.slice(0, begin).replace(/(?<!\\)%.*$/gm, '');
	const poly = preamble.match(/\\set(?:default|main)language(?:\[[^\]]*\])?\{(\w+)\}/);
	if (poly) return language(poly[1]);
	const options = (re: RegExp) => preamble.match(re)?.[1].split(',').map((o) => o.trim()) ?? [];
	const babel = options(/\\usepackage\s*\[([^\]]*)\]\s*\{babel\}/);
	// babel's main language: main=…, else the last language among the class's and its own options
	const main = babel.find((o) => o.startsWith('main='))?.slice(5);
	const all = [...options(/\\documentclass\s*\[([^\]]*)\]/), ...babel].filter((o) => o.toLowerCase() in BABEL);
	return main ? language(main) : all.length ? language(all.at(-1)!) : 'en';
}

const language = (name: string): Lang | null => BABEL[name.toLowerCase()] ?? null;

/** Commands whose arguments aren't prose, and how many of them (the rest of `\href{url}{text}` is). */
const CODE_ARGS: Record<string, number> = {
	label: 1, ref: 1, eqref: 1, pageref: 1, autoref: 1, nameref: 1, cref: 1, Cref: 1, vref: 1,
	cite: 1, citep: 1, citet: 1, citeauthor: 1, citeyear: 1, parencite: 1, textcite: 1, autocite: 1, footcite: 1, nocite: 1,
	usepackage: 1, RequirePackage: 1, documentclass: 1, input: 1, include: 1, includeonly: 1, includegraphics: 1,
	includepdf: 1, bibliography: 1, bibliographystyle: 1, addbibresource: 1, graphicspath: 1, lstinputlisting: 1,
	inputminted: 2, url: 1, href: 1, hyperref: 1, path: 1, usetikzlibrary: 1, pgfplotsset: 1, tikzset: 1,
	newcommand: 9, renewcommand: 9, providecommand: 9, newenvironment: 9, renewenvironment: 9, DeclareMathOperator: 9,
	def: 9, let: 9, setlength: 2, addtolength: 2, settowidth: 2, setcounter: 2, addtocounter: 2, newcounter: 1,
	definecolor: 3, textcolor: 1, color: 1, colorbox: 1, pagestyle: 1, thispagestyle: 1, pagenumbering: 1,
	hspace: 1, vspace: 1, rule: 2, setdefaultlanguage: 1, setmainlanguage: 1, setotherlanguage: 1,
	selectlanguage: 1, foreignlanguage: 1, lstset: 1, hypersetup: 1, geometry: 1, captionsetup: 1, sisetup: 1,
	SI: 2, si: 1, num: 1, qty: 2, unit: 1, ang: 1, multicolumn: 2, multirow: 2, cline: 1, cmidrule: 1
};

/** Environments whose content isn't prose. */
const CODE_ENVS =
	'equation|align|alignat|flalign|gather|multline|eqnarray|math|displaymath|split|verbatim|Verbatim|lstlisting|minted|comment|tikzpicture|axis|filecontents';

const blank = (s: string) => s.replace(/[^\n]/g, ' ');

/** `text` with everything but prose blanked out (same length, line breaks kept). */
export function prose(text: string): string {
	let t = text
		.replace(new RegExp(`\\\\begin\\{(${CODE_ENVS})(\\*?)\\}[\\s\\S]*?\\\\end\\{\\1\\2\\}`, 'g'), blank)
		.replace(/(?<!\\)%.*$/gm, blank)
		.replace(/\\verb\*?(.)[^\n]*?\1/g, blank)
		.replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|(?<!\\)\$(?:\\\$|[^$])*?(?<!\\)\$/g, blank);
	// a command with its options; for the ones above, also its code arguments
	const spans: [number, number][] = [];
	const command = /\\(?:([A-Za-z@]+)\*?|.)/g;
	for (let m; (m = command.exec(t)); ) {
		const name = m[1];
		let end = m.index + m[0].length;
		let args = name === 'begin' || name === 'end' ? 1 : name ? (CODE_ARGS[name] ?? 0) : 0;
		const all = name === 'begin'; // \begin{tabular}{lcc}, \begin{minipage}{…}: every group after it
		for (;;) {
			let at = end;
			while (t[at] === ' ' || t[at] === '\t') at++;
			const close = t[at] === '[' ? matching(t, at, '[', ']') : t[at] === '{' && (args-- > 0 || all) ? matching(t, at, '{', '}') : -1;
			if (close < 0) break;
			end = close + 1;
		}
		spans.push([m.index, end]);
		command.lastIndex = end;
	}
	let out = '';
	let last = 0;
	for (const [from, to] of spans) out += t.slice(last, from) + blank(t.slice(from, to)), (last = to);
	return out + t.slice(last);
}

/** The index of the bracket closing the one at `at`, or -1. */
function matching(t: string, at: number, open: string, close: string): number {
	let depth = 0;
	for (let i = at; i < t.length && i < at + 2000; i++) {
		if (t[i] === '\\') i++;
		else if (t[i] === open) depth++;
		else if (t[i] === close && --depth === 0) return i;
	}
	return -1;
}

/** The words to check, at their offsets in `text`. Left out: one letter, all caps (acronyms), capitals inside a word,
 *  words glued to digits, paths, keys and accent commands (`caf\'e`; ponytail: not checked). */
export function proseWords(text: string): { from: number; to: number; word: string }[] {
	const t = prose(text);
	const out: { from: number; to: number; word: string }[] = [];
	for (const m of t.matchAll(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu)) {
		const word = m[0];
		const from = m.index;
		const to = from + word.length;
		if ([...word].length < 2 || /\p{Lu}/u.test(word.slice(1))) continue;
		const before = text[from - 1] ?? ' ';
		const after = text[to] ?? ' ';
		if (/[\d_@/.:\\]/.test(before) || /[\d_@/:\\]/.test(after) || text[from - 2] === '\\') continue;
		out.push({ from, to, word });
	}
	return out;
}
