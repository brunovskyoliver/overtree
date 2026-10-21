// Plain-language hints for common TeX errors and warnings (016). One table of rules, tried in order against a log
// entry's message; the first match writes the hint. Shared by the server (it attaches hints to compile results) and tests.
import type { Hint, LogEntry } from './compile-types.ts';

/** Well-known commands and the package that defines them (first: the one to suggest). */
export const COMMAND_PACKAGES: Record<string, string[]> = {
	includegraphics: ['graphicx'],
	graphicspath: ['graphicx'],
	rotatebox: ['graphicx'],
	scalebox: ['graphicx'],
	resizebox: ['graphicx'],
	url: ['url', 'hyperref'],
	href: ['hyperref'],
	hyperref: ['hyperref'],
	autoref: ['hyperref'],
	nolinkurl: ['hyperref'],
	SI: ['siunitx'],
	si: ['siunitx'],
	qty: ['siunitx'],
	unit: ['siunitx'],
	num: ['siunitx'],
	ang: ['siunitx'],
	toprule: ['booktabs'],
	midrule: ['booktabs'],
	bottomrule: ['booktabs'],
	cmidrule: ['booktabs'],
	textcolor: ['xcolor'],
	color: ['xcolor'],
	colorbox: ['xcolor'],
	definecolor: ['xcolor'],
	rowcolor: ['xcolor (with the table option)'],
	mathbb: ['amssymb'],
	mathfrak: ['amssymb'],
	checkmark: ['amssymb'],
	text: ['amsmath'],
	eqref: ['amsmath'],
	DeclareMathOperator: ['amsmath'],
	numberwithin: ['amsmath'],
	tag: ['amsmath'],
	dfrac: ['amsmath'],
	tfrac: ['amsmath'],
	binom: ['amsmath'],
	boldsymbol: ['amsmath'],
	bm: ['bm'],
	mathscr: ['mathrsfs'],
	degree: ['gensymb'],
	celsius: ['gensymb'],
	multirow: ['multirow'],
	multicolumn: [], // built in: listed so a typo of it is caught
	citep: ['natbib'],
	citet: ['natbib'],
	citeauthor: ['natbib'],
	cref: ['cleveref'],
	Cref: ['cleveref'],
	addbibresource: ['biblatex'],
	printbibliography: ['biblatex'],
	parencite: ['biblatex'],
	textcite: ['biblatex'],
	autocite: ['biblatex'],
	lipsum: ['lipsum'],
	blindtext: ['blindtext'],
	tikz: ['tikz'],
	usetikzlibrary: ['tikz'],
	lstinputlisting: ['listings'],
	lstset: ['listings'],
	inputminted: ['minted'],
	includepdf: ['pdfpages'],
	todo: ['todonotes'],
	listoftodos: ['todonotes'],
	hl: ['soul'],
	sout: ['ulem'],
	uline: ['ulem'],
	xspace: ['xspace'],
	newgeometry: ['geometry'],
	geometry: ['geometry'],
	captionof: ['caption'],
	subcaption: ['subcaption'],
	FloatBarrier: ['placeins'],
	singlespacing: ['setspace'],
	onehalfspacing: ['setspace'],
	doublespacing: ['setspace'],
	ifthenelse: ['ifthen'],
	newtheorem: [], // built in
	theoremstyle: ['amsthm'],
	qedhere: ['amsthm'],
	fancyhead: ['fancyhdr'],
	fancyfoot: ['fancyhdr'],
	pagestyle: [],
	enquote: ['csquotes'],
	euro: ['eurosym'],
	textdegree: ['textcomp'],
	ce: ['mhchem'],
	pgfplotsset: ['pgfplots'],
	algorithmic: ['algorithmic'],
	State: ['algpseudocode'],
	Require: ['algpseudocode']
};

/** Built-in commands, only to catch typos of them ("\txtbf" → "\textbf"). */
const BUILTIN_COMMANDS = [
	'textbf', 'textit', 'texttt', 'textsc', 'emph', 'underline', 'section', 'subsection', 'subsubsection', 'chapter',
	'paragraph', 'part', 'label', 'ref', 'pageref', 'cite', 'caption', 'centering', 'footnote', 'maketitle',
	'tableofcontents', 'listoffigures', 'listoftables', 'newpage', 'clearpage', 'vspace', 'hspace', 'title', 'author',
	'date', 'item', 'begin', 'end', 'documentclass', 'usepackage', 'newcommand', 'renewcommand', 'input', 'include',
	'bibliography', 'bibliographystyle', 'frac', 'sqrt', 'sum', 'int', 'alpha', 'beta', 'gamma', 'delta', 'epsilon',
	'lambda', 'sigma', 'infty', 'cdot', 'times', 'left', 'right', 'hline', 'noindent', 'smallskip', 'medskip',
	'bigskip', 'linewidth', 'textwidth', 'small', 'large', 'Large', 'huge', 'tiny', 'footnotesize', 'normalsize',
	'appendix', 'thanks', 'today', 'LaTeX', 'TeX', 'ldots', 'dots', 'quad', 'qquad', 'mathrm', 'mathbf', 'mathcal'
];

/** Well-known environments and their package. */
export const ENVIRONMENT_PACKAGES: Record<string, string> = {
	align: 'amsmath',
	'align*': 'amsmath',
	gather: 'amsmath',
	'gather*': 'amsmath',
	multline: 'amsmath',
	'multline*': 'amsmath',
	'equation*': 'amsmath',
	split: 'amsmath',
	cases: 'amsmath',
	pmatrix: 'amsmath',
	bmatrix: 'amsmath',
	vmatrix: 'amsmath',
	matrix: 'amsmath',
	proof: 'amsthm',
	tikzpicture: 'tikz',
	axis: 'pgfplots',
	lstlisting: 'listings',
	minted: 'minted',
	tabularx: 'tabularx',
	longtable: 'longtable',
	subfigure: 'subcaption',
	subtable: 'subcaption',
	algorithm: 'algorithm',
	algorithmic: 'algpseudocode',
	wrapfigure: 'wrapfig',
	multicols: 'multicol',
	landscape: 'pdflscape',
	comment: 'comment',
	Verbatim: 'fancyvrb',
	frame: 'beamer (a document class: \\documentclass{beamer})',
	tcolorbox: 'tcolorbox',
	mdframed: 'mdframed',
	spacing: 'setspace',
	appendices: 'appendix',
	dedication: '' // a class-specific one: no package to suggest
};

/** Package names a typo is checked against: the ones above plus other common ones. */
const KNOWN_PACKAGES = [
	...new Set([
		...Object.values(COMMAND_PACKAGES).flat(),
		...Object.values(ENVIRONMENT_PACKAGES),
		'amsmath', 'amssymb', 'amsthm', 'babel', 'inputenc', 'fontenc', 'lmodern', 'microtype', 'fontspec', 'float',
		'caption', 'enumitem', 'array', 'tabularx', 'xcolor', 'graphicx', 'hyperref', 'geometry', 'fancyhdr', 'titlesec',
		'natbib', 'biblatex', 'csquotes', 'parskip', 'setspace', 'mathtools', 'physics', 'tocbibind', 'appendix',
		'subcaption', 'booktabs', 'siunitx', 'cleveref', 'listings', 'xparse', 'etoolbox', 'pgfplots', 'tikz', 'url',
		'textcomp', 'upgreek', 'bm', 'multirow', 'makecell', 'longtable', 'pdfpages', 'lipsum', 'standalone'
	])
].filter((p) => /^[a-z]+$/i.test(p));

export type HintContext = {
	/** the project's file paths, relative to the main document's folder (TeX resolves names from there) */
	paths: string[];
};

type Rule = { test: RegExp; hint: (m: RegExpMatchArray, e: LogEntry, ctx: HintContext) => Hint };

const code = (s: string) => `\`${s}\``;

const RULES: Rule[] = [
	{
		test: /^Undefined control sequence\.?$/,
		hint: (_, e) => {
			// the l.<n> text ends at the command TeX didn't know
			const name = e.context?.match(/\\([A-Za-z@]+|.)\s*$/)?.[1];
			if (!name)
				return {
					explanation: 'LaTeX found a command it doesn’t know on this line.',
					fix: 'Check the spelling of the commands on this line. If one comes from a package, load it with \\usepackage in the preamble.'
				};
			const cmd = `\\${name}`;
			const packages = COMMAND_PACKAGES[name];
			if (packages?.length) {
				const [first, ...others] = packages;
				return {
					explanation: `${code(cmd)} comes from the ${first} package${others.length ? ` (${others.join(', ')} also provides it)` : ''}, which this document doesn’t load.`,
					fix: `Add ${code(`\\usepackage{${first.split(' ')[0]}}`)} to the preamble, before \\begin{document}.`,
					token: cmd
				};
			}
			const near = closest(name, [...Object.keys(COMMAND_PACKAGES), ...BUILTIN_COMMANDS]);
			return {
				explanation: `LaTeX doesn’t know the command ${code(cmd)}: it is misspelled, or it comes from a package or definition this document doesn’t load.`,
				fix: near
					? `Did you mean ${code(`\\${near}`)}?`
					: `Check the spelling. If ${code(cmd)} comes from a package, load it with \\usepackage; if it is your own, define it with \\newcommand before using it.`,
				token: cmd
			};
		}
	},
	{
		test: /^LaTeX Error: Environment (\S+) undefined\.?$/,
		hint: ([, env]) => {
			const pkg = ENVIRONMENT_PACKAGES[env];
			const token = `\\begin{${env}}`;
			if (pkg)
				return {
					explanation: `The ${code(env)} environment comes from ${pkg.includes(' ') ? pkg : `the ${pkg} package`}, which this document doesn’t load.`,
					fix: pkg.includes(' ') ? `Use ${pkg}.` : `Add ${code(`\\usepackage{${pkg}}`)} to the preamble.`,
					token
				};
			const near = closest(env, [...Object.keys(ENVIRONMENT_PACKAGES), 'itemize', 'enumerate', 'description', 'figure', 'table', 'tabular', 'equation', 'center', 'quote', 'verbatim', 'abstract', 'document', 'minipage', 'thebibliography']);
			return {
				explanation: `There is no environment called ${code(env)}: it is misspelled, or it comes from a package this document doesn’t load.`,
				fix: near ? `Did you mean ${code(near)}?` : `Check the name, load the package that defines it, or define it with \\newenvironment.`,
				token
			};
		}
	},
	{
		// `! LaTeX Error: File `x' not found.`, graphicx's `File `x' not found: using draft setting`, the matching warning
		test: /File `([^']+)' not found/,
		hint: ([, name], _, ctx) => (/\.(sty|cls)$/.test(name) ? packageHint(name, ctx) : fileHint(name, ctx))
	},
	{
		test: /^LaTeX Error: Missing \\begin\{document\}/,
		hint: () => ({
			explanation: 'Something before \\begin{document} produces text, or the file has no \\begin{document} at all.',
			fix: 'Move text out of the preamble (stray characters count too) and check \\begin{document} is there. If this file is a chapter, compile the main document instead.'
		})
	},
	{
		test: /^(?:Paragraph ended before|File ended while scanning use of) (\\\S+?)(?: was complete)?\s*\.?$/,
		hint: ([, cmd]) => ({
			explanation: `The argument of ${code(cmd)} is never closed: TeX reached a blank line or the end of the file before its ${code('}')}.`,
			fix: `Add the missing ${code('}')} after the argument of ${code(cmd)}.`,
			token: cmd
		})
	},
	{
		test: /^Runaway argument/,
		hint: () => ({
			explanation: 'A command’s argument is never closed: a `}` is missing.',
			fix: 'Find the `{` without its `}` on or before this line and close it.'
		})
	},
	{
		test: /^(?:Too many \}'s|Extra \}, or forgotten \\endgroup)/,
		hint: () => ({
			explanation: 'There is a `}` on this line with no `{` to match it.',
			fix: 'Remove the extra `}`, or add the `{` it was meant to close.',
			token: '}'
		})
	},
	{
		test: /^Extra \}, or forgotten \$/,
		hint: () => ({
			explanation: 'A `}` inside math closes a group that was opened outside it, or a `$` is missing.',
			fix: 'Check the braces and `$` signs on this line pair up; braces opened inside math must close inside it.',
			token: '}'
		})
	},
	{
		test: /^Missing \} inserted/,
		hint: () => ({
			explanation: 'A group was still open where TeX needed it closed: a `}` is missing, often inside math.',
			fix: 'Add the missing `}`, and check `\\left` has its `\\right`.'
		})
	},
	{
		test: /^Missing \$ inserted/,
		hint: (_, e) => {
			const token = e.context?.match(/(\\[A-Za-z]+|[_^])\s*$/)?.[1];
			return {
				explanation: 'Something that only works in math (like `^`, `_` or `\\alpha`) is outside math, or a blank line interrupts a formula.',
				fix: 'Put the formula between `$…$`. For a literal underscore or caret in text write `\\_` or `\\^{}`; remove blank lines inside equations.',
				...(token && { token })
			};
		}
	},
	{
		test: /^LaTeX Error: \\begin\{([^}]+)\} on input line (\d+) ended by \\end\{([^}]+)\}/,
		hint: ([, begin, line, end]) => ({
			explanation: `${code(`\\begin{${begin}}`)} on line ${line} is closed by ${code(`\\end{${end}}`)}.`,
			fix: `Make them match: ${code(`\\end{${begin}}`)} here, or add the missing ${code(`\\end{${begin}}`)} before it.`,
			token: `\\end{${end}}`
		})
	},
	{
		test: /^LaTeX Error: \\begin\{document\} ended by \\end\{([^}]+)\}/,
		hint: ([, end]) => ({
			explanation: `${code(`\\end{${end}}`)} has no ${code(`\\begin{${end}}`)} before it.`,
			fix: `Remove it, or add ${code(`\\begin{${end}}`)} where it starts.`,
			token: `\\end{${end}}`
		})
	},
	{
		test: /^Misplaced alignment tab character &/,
		hint: () => ({
			explanation: 'An `&` outside a table or alignment: TeX uses it to separate columns.',
			fix: 'Write `\\&` for a literal ampersand. In a table, check its environment (tabular, align) is open here.',
			token: '&'
		})
	},
	{
		test: /^Extra alignment tab has been changed to \\cr/,
		hint: () => ({
			explanation: 'This row has more `&` cells than the table has columns.',
			fix: 'Add a column to the column spec (e.g. {lll}) or remove an `&`.',
			token: '&'
		})
	},
	{
		test: /^LaTeX Error: Can be used only in preamble/,
		hint: () => ({
			explanation: 'A command that must come before \\begin{document} (like \\usepackage) is in the document body.',
			fix: 'Move it up into the preamble.'
		})
	},
	{
		test: /^LaTeX Error: There's no line here to end/,
		hint: () => ({
			explanation: '`\\\\` (a line break) where there is no line to break, e.g. at the start of a paragraph or after a blank line.',
			fix: 'Remove the `\\\\`; for space between paragraphs use a blank line or \\vspace{…}.',
			token: '\\\\'
		})
	},
	{
		test: /^LaTeX Error: Lonely \\item/,
		hint: () => ({
			explanation: '`\\item` outside a list.',
			fix: 'Put the items inside \\begin{itemize} … \\end{itemize} (or enumerate).',
			token: '\\item'
		})
	},
	{
		test: /^LaTeX Error: Something's wrong--perhaps a missing \\item/,
		hint: () => ({
			explanation: 'A list has text before its first \\item, or a command that needs a paragraph (like \\\\) has none.',
			fix: 'Start each list with \\item; remove a `\\\\` on an otherwise empty line.'
		})
	},
	{
		test: /^Double (superscript|subscript)/,
		hint: ([, kind]) => ({
			explanation: `Two ${kind}s in a row (like ${kind === 'superscript' ? '`x^2^3`' : '`x_1_2`'}) are ambiguous.`,
			fix: `Group them with braces: ${kind === 'superscript' ? '`x^{2^3}` or `{x^2}^3`' : '`x_{1_2}` or `x_{12}`'}.`
		})
	},
	{
		test: /^Illegal unit of measure/,
		hint: () => ({
			explanation: 'A length is missing its unit.',
			fix: 'Add a unit such as pt, cm, mm, em or \\textwidth (e.g. `0.5\\textwidth`, `2cm`).'
		})
	},
	{
		test: /^LaTeX Error: Option clash for package (\S+?)\.?$/,
		hint: ([, pkg]) => ({
			explanation: `The ${pkg} package is loaded twice with different options (perhaps once by the document class or another package).`,
			fix: `Load it once with all the options, or pass them earlier with \\PassOptionsToPackage{…}{${pkg}}.`
		})
	},
	{
		test: /The font "([^"]+)" cannot be found/,
		hint: ([, font]) => ({
			explanation: `The font “${font}” isn’t installed in this TeX image.`,
			fix: 'Pick a font the image has (e.g. Latin Modern, TeX Gyre), upload the font files into the project, or use the full TeX Live image (see the README).'
		})
	},
	{
		test: /^Reference `([^']+)' on page \d+ undefined/,
		hint: ([, key]) => ({
			explanation: `No \\label{${key}} defines this reference (or it was added since the last full compile).`,
			fix: `Check the key for typos or add \\label{${key}} where it should point. Fresh labels show after one more compile.`,
			token: key
		})
	},
	{
		test: /^Citation `([^']+)' on page \d+ undefined/,
		hint: ([, key]) => citationHint(key)
	},
	{
		test: /^The following entry could not be found in the database: (\S+)/,
		hint: ([, key]) => citationHint(key)
	},
	{
		test: /^There were undefined (references|citations)/,
		hint: () => ({
			explanation: 'Some \\ref or \\cite targets don’t exist; the warnings above name them.',
			fix: 'Fix those keys. If you have just added the labels or bibliography entries, compile once more.'
		})
	},
	{
		test: /^Label\(s\) may have changed/,
		hint: () => ({
			explanation: 'Cross-references changed in this run, so page numbers or references may be stale.',
			fix: 'Compile again.'
		})
	},
	{
		test: /^(?:There were multiply-defined labels|Label `([^']+)' multiply defined)/,
		hint: ([, key]) => ({
			explanation: key ? `The label ${code(key)} is defined more than once.` : 'Some labels are defined more than once.',
			fix: 'Give each \\label a unique name; references go to the last one.',
			...(key && { token: key })
		})
	},
	{
		test: /^Overfull \\[hv]box \(([\d.]+)pt too (?:wide|high)\)/,
		hint: ([, pt]) => ({
			explanation: `A line sticks out by ${Math.round(Number(pt))}pt: TeX couldn’t find a good place to break it. Usually harmless.`,
			fix: 'Only if it shows in the PDF: rephrase, allow a hyphenation with `\\-`, or let long URLs break (url package).'
		})
	},
	{
		test: /^Underfull \\[hv]box/,
		hint: () => ({
			explanation: 'A line or page is spaced more loosely than TeX likes. Usually harmless.',
			fix: 'Often caused by `\\\\` at the end of a paragraph or a forced break; remove it if the spacing looks off.'
		})
	},
	{
		test: /^Emergency stop\.?$/,
		hint: (_, e) =>
			e.context?.includes('no legal \\end found')
				? {
						explanation: 'The document ends without \\end{document}, or a group (a `{` or an environment) is still open at the end.',
						fix: 'Add \\end{document} at the end of the main file and close any open `{` or \\begin before it.'
					}
				: {
						explanation: 'TeX stopped here and couldn’t go on, so there is no PDF (or only part of it).',
						fix: 'Fix the error listed just before this one; this one is its consequence.'
					}
	}
];

function citationHint(key: string): Hint {
	return {
		explanation: `The citation key ${code(key)} isn’t in the bibliography.`,
		fix: `Add an entry with the key ${code(key)} to your .bib file and make sure the file is loaded (\\bibliography{…} or \\addbibresource{…}), or fix the key. A new entry shows after the next compile.`,
		token: key
	};
}

function packageHint(name: string, ctx: HintContext): Hint {
	const kind = name.endsWith('.cls') ? 'class' : 'package';
	const base = name.replace(/\.\w+$/, '');
	const token = base;
	const near = kind === 'package' ? closest(base, KNOWN_PACKAGES) : closest(base, ['article', 'report', 'book', 'beamer', 'letter', 'memoir', 'scrartcl', 'scrreprt', 'scrbook', 'standalone']);
	if (near)
		return {
			explanation: `There is no ${kind} called ${code(base)}: it looks like a typo of ${code(near)}.`,
			fix: kind === 'package' ? `Change it to ${code(`\\usepackage{${near}}`)}.` : `Change it to ${code(`\\documentclass{${near}}`)}.`,
			token
		};
	const elsewhere = ctx.paths.find((p) => p.split('/').pop() === name);
	if (elsewhere)
		return {
			explanation: `The project has ${code(elsewhere)}, but TeX looks for ${code(name)} next to the main document.`,
			fix: `Move ${code(name)} into the main document’s folder.`,
			token
		};
	return {
		explanation: `The ${kind} ${code(name)} isn’t installed in this TeX image. If it is a real ${kind}, the full TeX Live image probably has it (this one may be the smaller medium image).`,
		fix: `Check the name for a typo. Otherwise upload ${code(name)} next to the main document, or ask whoever runs this server to use the full image (TEXLIVE_IMAGE=texlive/texlive:latest-full, see the README).`,
		token
	};
}

function fileHint(name: string, ctx: HintContext): Hint {
	const noExt = (p: string) => p.replace(/\.[^./]*$/, '');
	const base = (p: string) => p.split('/').pop()!;
	const paths = ctx.paths;
	// TeX adds `.tex` to an \input name; graphicx tries its extensions on a name without one: compare with and without
	const found =
		paths.find((p) => p.toLowerCase() === name.toLowerCase() || noExt(p).toLowerCase() === name.toLowerCase()) ??
		paths.find((p) => base(p) === base(name) || base(noExt(p)) === base(name)) ??
		closest(name, paths) ??
		closest(noExt(name), paths, noExt);
	// suggest it the way it was written: \input without `.tex`, an image without extension if it had none
	const suggest = (p: string) => (name.endsWith('.tex') ? p.replace(/\.tex$/, '') : /\.[^./]+$/.test(name) ? p : noExt(p));
	return {
		explanation: `The project has no file ${code(name)} at that path. Paths are relative to the main document’s folder and case-sensitive.`,
		fix: found ? `Did you mean ${code(suggest(found))}?` : `Upload ${code(base(name))} into the project, or fix the path.`,
		token: name.replace(/\.tex$/, '')
	};
}

/** The candidate closest to `name` by edit distance (of `key(candidate)`), when it is close enough to be a typo. */
function closest(name: string, candidates: string[], key = (c: string) => c): string | undefined {
	const max = name.length <= 4 ? 1 : name.length <= 8 ? 2 : 3;
	let best: string | undefined;
	let bestD = max + 1;
	for (const c of candidates) {
		const k = key(c);
		if (k === name || Math.abs(k.length - name.length) > max) continue;
		const d = distance(name.toLowerCase(), k.toLowerCase());
		if (d < bestD) [best, bestD] = [c, d];
	}
	return best;
}

/** Levenshtein distance. */
function distance(a: string, b: string): number {
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		prev = row;
	}
	return prev[b.length];
}

/** The hint for a log entry, if one of the rules knows it. ChkTeX warnings explain themselves. */
export function hintFor(entry: LogEntry, ctx: HintContext): Hint | undefined {
	if (entry.level === 'chktex') return;
	const message = entry.message.replace(/^(?:Package|Class) \S+ Error: /, '');
	for (const rule of RULES) {
		const m = message.match(rule.test) ?? entry.message.match(rule.test);
		if (m) return rule.hint(m, entry, ctx);
	}
}
