import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { CompletionContext, nextSnippetField, type Completion, type CompletionResult } from '@codemirror/autocomplete';
import { StreamLanguage } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { codePointAt, codePointSize, EditorState, fromCodePoint, Transaction, type TransactionSpec } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import { COMMANDS, ENVIRONMENTS, PACKAGES } from '../../src/lib/completion/data.ts';
import { closeEnvironment, environments } from '../../src/lib/completion/environments.ts';
import { scanTex, type ProjectSymbols } from '../../src/lib/completion/scan.ts';
import { latexSource } from '../../src/lib/completion/source.ts';
import { Symbols } from '../../src/lib/completion/symbols.svelte.ts';

// The popup's own matcher: @codemirror/autocomplete doesn't export FuzzyMatcher, so take the class from its
// bundle and rank like its sortOptions (score + boost, then label), as the popup does.
type Matcher = { match(word: string): { score: number; matched: number[] } | null };
const bundle = readFileSync(createRequire(import.meta.url).resolve('@codemirror/autocomplete').replace(/index\.cjs$/, 'index.js'), 'utf8');
const matcherSource = bundle.slice(bundle.indexOf('class FuzzyMatcher {'), bundle.indexOf('class StrictMatcher {'));
const FuzzyMatcher = new Function('codePointAt', 'codePointSize', 'fromCodePoint', `${matcherSource}; return FuzzyMatcher;`)(
	codePointAt,
	codePointSize,
	fromCodePoint
) as new (pattern: string) => Matcher;

function ranked(result: CompletionResult, pattern: string): Completion[] {
	const matcher = new FuzzyMatcher(pattern);
	return result.options
		.flatMap((o) => {
			const m = matcher.match(o.label);
			return m ? [{ o, score: m.score + (o.boost ?? 0) }] : [];
		})
		.sort((a, b) => b.score - a.score || a.o.label.localeCompare(b.o.label))
		.map((r) => r.o);
}

const stexLanguage = StreamLanguage.define(stex);

/** A LaTeX (or plain) state with the cursor at `|` (default: the end). */
function stateOf(doc: string, latex = true) {
	const at = doc.includes('|') ? doc.indexOf('|') : doc.length;
	return EditorState.create({ doc: doc.replace('|', ''), selection: { anchor: at }, extensions: latex ? [stexLanguage, environments] : [] });
}

const NONE: ProjectSymbols = { labels: [], commands: [], environments: [], bibKeys: [], files: [] };

function complete(doc: string, { latex = true, project = {} as Partial<ProjectSymbols>, explicit = false } = {}) {
	const state = stateOf(doc, latex);
	return latexSource({ ...NONE, ...project })(new CompletionContext(state, state.selection.main.head, explicit));
}

/** Enough of an EditorView for snippets and commands. */
function fakeView(state: EditorState) {
	const view = {
		state,
		dispatch(...specs: (Transaction | TransactionSpec)[]) {
			view.state = specs[0] instanceof Transaction ? specs[0].state : view.state.update(...(specs as TransactionSpec[])).state;
		}
	};
	return view;
}

function accept(doc: string, label: string) {
	const result = complete(doc)!;
	const option = result.options.find((o) => o.label === label)!;
	const view = fakeView(stateOf(doc));
	(option.apply as (...a: unknown[]) => void)(view, option, result.from, view.state.selection.main.head);
	return view;
}

/** Type like a user: one input transaction per character. */
function type(view: ReturnType<typeof fakeView>, text: string) {
	for (const ch of text) {
		const head = view.state.selection.main.head;
		view.dispatch({ changes: { from: head, insert: ch }, selection: { anchor: head + 1 }, userEvent: 'input.type' });
	}
}

describe('bundled data', () => {
	it('has the counts of FR-028 and unique labels', () => {
		expect(COMMANDS.length).toBeGreaterThanOrEqual(300);
		expect(ENVIRONMENTS.length).toBeGreaterThanOrEqual(40);
		expect(PACKAGES.length).toBeGreaterThanOrEqual(200);
		expect(new Set(COMMANDS.map((c) => c.label)).size).toBe(COMMANDS.length);
		expect(new Set(ENVIRONMENTS.map((e) => e.name)).size).toBe(ENVIRONMENTS.length);
	});

	it('every snippet parses: balanced ${} and labels without tab stops', () => {
		for (const s of [...COMMANDS.map((c) => c.snippet), ...ENVIRONMENTS.map((e) => e.snippet)]) {
			expect(s).not.toMatch(/#\{/);
			const rest = s.replace(/\$\{\d*\}/g, '');
			expect(rest, s).not.toContain('${');
			let depth = 0;
			for (const c of rest.replace(/\\[{}]/g, '')) {
				depth += c === '{' ? 1 : c === '}' ? -1 : 0;
				expect(depth, s).toBeGreaterThanOrEqual(0);
			}
			expect(depth, s).toBe(0);
		}
		for (const c of COMMANDS) expect(c.label).not.toContain('$');
	});

	it('environment bodies: items in lists, centering and caption in floats', () => {
		const env = (name: string) => ENVIRONMENTS.find((e) => e.name === name)!.snippet;
		expect(env('itemize')).toContain('\\item ');
		expect(env('enumerate')).toContain('\\item ');
		for (const name of ['figure', 'table']) expect(env(name)).toMatch(/\\centering[\s\S]*\\caption\{/);
	});
});

describe('command completion', () => {
	it('\\sec lists \\section{} as cmd in the top 3 (US5-1)', () => {
		const result = complete('\\sec')!;
		expect(result.from).toBe(0);
		const top = ranked(result, '\\sec').slice(0, 3);
		expect(top.map((o) => o.label)).toContain('\\section{}');
		expect(top.find((o) => o.label === '\\section{}')!.type).toBe('cmd');
	});

	it('a bare \\ opens with kinds and the common entries first', () => {
		const top = ranked(complete('text \\')!, '\\').slice(0, 7);
		expect(top.map((o) => [o.label, o.type])).toEqual([
			['\\usepackage{}', 'pkg'],
			['\\begin{}', 'env'],
			['\\end{}', 'env'],
			['\\usepackage[]{}', 'pkg'],
			['\\item', 'cmd'],
			['\\item[]', 'cmd'],
			['\\section{}', 'cmd']
		]);
	});

	it('fuzzy sbsc finds \\subsection{} (US5-2)', () => {
		expect(ranked(complete('\\sbsc')!, '\\sbsc').slice(0, 3).map((o) => o.label)).toContain('\\subsection{}');
	});

	it('SC-006: 20 common commands by their first 3 letters, intended one in the top 3 for at least 18', () => {
		const table: [string, string][] = [
			['sec', '\\section{}'], ['sub', '\\subsection{}'], ['beg', '\\begin{}'], ['ite', '\\item'], ['tex', '\\textbf{}'],
			['emp', '\\emph{}'], ['fra', '\\frac{}{}'], ['use', '\\usepackage{}'], ['lab', '\\label{}'], ['ref', '\\ref{}'],
			['cit', '\\cite{}'], ['inc', '\\includegraphics{}'], ['doc', '\\documentclass{}'], ['cap', '\\caption{}'],
			['cen', '\\centering'], ['foo', '\\footnote{}'], ['tab', '\\tableofcontents'], ['mak', '\\maketitle'],
			['hsp', '\\hspace{}'], ['vsp', '\\vspace{}']
		];
		const misses = table.filter(([typed, want]) => !ranked(complete(`\\${typed}`)!, `\\${typed}`).slice(0, 3).some((o) => o.label === want));
		expect(misses.length, JSON.stringify(misses)).toBeLessThanOrEqual(2);
	});

	it('no completion in comments, after \\\\, without a backslash or outside LaTeX (US5-8)', () => {
		expect(complete('% \\sec')).toBeNull();
		expect(complete('a \\% b % c \\sec')).toBeNull();
		expect(complete('a\\\\sec')).toBeNull();
		expect(complete('section')).toBeNull();
		expect(complete('\\sec', { latex: false })).toBeNull();
		expect(complete('50\\% \\sec')).not.toBeNull();
	});

	it('Ctrl+Space after a partial command (US5-9)', () => {
		expect(complete('x \\fr', { explicit: true })!.from).toBe(2);
	});

	it('offers project commands from scanned text with a {} per argument (US5-7)', () => {
		const { commands } = scanTex('\\newcommand{\\R}{\\mathbb{R}}\n\\newcommand{\\pair}[2]{(#1,#2)}\n\\newcommand{\\section}{x}');
		const result = complete('\\R', { project: { commands } })!;
		const own = (label: string) => result.options.filter((o) => o.label === label);
		expect(ranked(result, '\\R')[0]).toMatchObject({ label: '\\R', type: 'cmd' });
		expect(own('\\pair{}{}')).toHaveLength(1);
		expect(own('\\section{}')).toHaveLength(1); // the bundled one, no duplicate
		const view = fakeView(stateOf('\\pa'));
		(own('\\pair{}{}')[0].apply as (...a: unknown[]) => void)(view, own('\\pair{}{}')[0], 0, 3);
		expect(view.state.doc.toString()).toBe('\\pair{}{}');
		expect(view.state.selection.main.head).toBe('\\pair{'.length);
	});
});

describe('snippets and environments', () => {
	it('\\begin{} mirrors the typed name into \\end{} and Tab goes into the body (US5-4)', () => {
		const view = accept('\\beg', '\\begin{}');
		expect(view.state.doc.toString()).toBe('\\begin{}\n  \n\\end{}');
		type(view, 'figure');
		expect(view.state.doc.toString()).toBe('\\begin{figure}\n  \n\\end{figure}');
		nextSnippetField(view);
		expect(view.state.selection.main.head).toBe('\\begin{figure}\n  '.length);
		type(view, 'x');
		expect(view.state.doc.toString()).toBe('\\begin{figure}\n  x\n\\end{figure}');
	});

	it('the mirror stops when the cursor leaves the name', () => {
		const view = accept('\\beg', '\\begin{}');
		type(view, 'ab');
		view.dispatch({ selection: { anchor: 0 } });
		view.dispatch({ changes: { from: '\\begin{'.length, insert: 'z' }, userEvent: 'input.type' });
		expect(view.state.doc.toString()).toBe('\\begin{zab}\n  \n\\end{ab}');
	});

	it('\\usepackage[]{} puts the cursor in {} first, Tab moves to [], Tab leaves (US5-5)', () => {
		const view = accept('\\usep', '\\usepackage[]{}');
		expect(view.state.doc.toString()).toBe('\\usepackage[]{}');
		expect(view.state.selection.main.head).toBe('\\usepackage[]{'.length);
		expect(nextSnippetField(view)).toBe(true);
		expect(view.state.selection.main.head).toBe('\\usepackage['.length);
		expect(nextSnippetField(view)).toBe(true);
		expect(view.state.selection.main.head).toBe('\\usepackage[]{}'.length);
		expect(nextSnippetField(view)).toBe(false);
	});

	it('Enter after \\begin{itemize} opens an indented line and closes it (US5-6)', () => {
		const view = fakeView(stateOf('  \\begin{itemize}'));
		expect(closeEnvironment(view)).toBe(true);
		expect(view.state.doc.toString()).toBe('  \\begin{itemize}\n    \n  \\end{itemize}');
		expect(view.state.selection.main.head).toBe('  \\begin{itemize}\n    '.length);
	});

	it('Enter adds no second \\end when a matching one follows', () => {
		expect(closeEnvironment(fakeView(stateOf('\\begin{itemize}|\n\\item a\n\\end{itemize}')))).toBe(false);
		// a nested pair below doesn't count as the match
		const view = fakeView(stateOf('\\begin{itemize}|\n\\begin{itemize}\\end{itemize}'));
		expect(closeEnvironment(view)).toBe(true);
	});

	it('Enter also closes after arguments, but not mid-line or in comments', () => {
		expect(closeEnvironment(fakeView(stateOf('\\begin{tabular}{ll}')))).toBe(true);
		expect(closeEnvironment(fakeView(stateOf('\\begin{figure}[htbp]')))).toBe(true);
		expect(closeEnvironment(fakeView(stateOf('\\begin{itemize}| x')))).toBe(false);
		expect(closeEnvironment(fakeView(stateOf('% \\begin{itemize}')))).toBe(false);
	});
});

describe('argument completion (US6)', () => {
	const project: Partial<ProjectSymbols> = {
		labels: ['sec:intro', 'fig:plot'],
		environments: ['proof2'],
		bibKeys: [{ key: 'knuth84', title: 'Literate Programming', author: 'Knuth' }, { key: 'lamport94', author: 'Lamport' }],
		files: [
			{ path: 'main.tex', kind: 'text' },
			{ path: 'chapters/intro.tex', kind: 'text' },
			{ path: 'figures/plot.png', kind: 'binary' },
			{ path: 'figures/plot.pdf', kind: 'binary' },
			{ path: 'refs.bib', kind: 'text' },
			{ path: 'notes.md', kind: 'text' }
		]
	};
	/** from, labels and kinds of the completion at the end of `doc` */
	const at = (doc: string) => {
		const r = complete(doc, { project })!;
		return { from: r.from, labels: r.options.map((o) => o.label), types: new Set(r.options.map((o) => o.type)) };
	};

	it('labels in \\ref and its variants, after commas in \\cref (US6-1)', () => {
		for (const cmd of ['ref', 'eqref', 'autoref', 'pageref', 'cref', 'Cref', 'nameref']) {
			expect(at(`see \\${cmd}{`)).toEqual({ from: `see \\${cmd}{`.length, labels: ['sec:intro', 'fig:plot'], types: new Set(['label']) });
		}
		expect(at('\\ref{sec:in').from).toBe('\\ref{'.length);
		expect(at('\\cref{sec:intro, fi').from).toBe('\\cref{sec:intro, '.length);
	});

	it('bib keys in \\cite variants with title or author as detail, after options and commas (US6-2)', () => {
		const r = complete('\\cite{kn', { project })!;
		expect(r.from).toBe('\\cite{'.length);
		expect(r.options).toEqual([
			{ label: 'knuth84', type: 'cite', detail: 'Literate Programming' },
			{ label: 'lamport94', type: 'cite', detail: 'Lamport' }
		]);
		expect(ranked(r, 'kn')[0].label).toBe('knuth84');
		for (const cmd of ['citep', 'citet', 'parencite', 'textcite', 'autocite', 'nocite', 'cite*']) expect(at(`\\${cmd}{`).types).toEqual(new Set(['cite']));
		expect(at('\\cite{a,').from).toBe('\\cite{a,'.length);
		expect(at('\\cite[p.~3]{a,kn').from).toBe('\\cite[p.~3]{a,'.length);
		expect(at('\\parencite[see][12]{kn').from).toBe('\\parencite[see][12]{'.length);
	});

	it('packages in \\usepackage and \\RequirePackage, after options and commas (US6-3)', () => {
		const r = complete('\\usepackage{amsmath,ams', { project })!;
		expect(r.from).toBe('\\usepackage{amsmath,'.length);
		expect(ranked(r, 'ams').slice(0, 4).map((o) => o.label)).toEqual(expect.arrayContaining(['amsmath', 'amssymb', 'amsthm']));
		expect(new Set(r.options.map((o) => o.type))).toEqual(new Set(['pkg']));
		expect(at('\\usepackage[utf8]{inp').from).toBe('\\usepackage[utf8]{'.length);
		expect(at('\\RequirePackage{').labels).toContain('geometry');
	});

	it('file paths by command, relative to the root (US6-4)', () => {
		expect(at('\\input{').labels).toEqual(['main', 'chapters/intro']);
		expect(at('\\include{chap')).toEqual({ from: '\\include{'.length, labels: ['main', 'chapters/intro'], types: new Set(['file']) });
		expect(at('\\includegraphics[width=\\linewidth]{fig').labels).toEqual(['figures/plot']);
		expect(at('\\bibliography{').labels).toEqual(['refs']);
		expect(at('\\addbibresource{').labels).toEqual(['refs.bib']);
	});

	it('bundled and project environments in \\begin{ and \\end{ (US5-7)', () => {
		const r = complete('\\begin{pro', { project })!;
		expect(r.from).toBe('\\begin{'.length);
		expect(ranked(r, 'pro').map((o) => [o.label, o.type])).toEqual(expect.arrayContaining([['proof2', 'env'], ['proof', 'env']]));
		expect(at('\\end{').labels).toContain('itemize');
	});

	it('no argument completion in comments or after \\\\', () => {
		expect(complete('% \\ref{', { project })).toBeNull();
		expect(complete('a\\\\ref{', { project })).toBeNull();
	});

	it('a label typed in an open tab shows up via Symbols without a refetch (US6-5)', () => {
		vi.useFakeTimers();
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		try {
			const symbols = new Symbols();
			symbols.scan('a', false, EditorState.create({ doc: '\\section{A}\\label{sec:new}' }));
			symbols.scan('b', true, EditorState.create({ doc: '@book{newkey, title={New}}' }));
			vi.advanceTimersByTime(300);
			const state = stateOf('\\ref{');
			const labels = latexSource(symbols)(new CompletionContext(state, state.doc.length, false))!.options.map((o) => o.label);
			expect(labels).toEqual(['sec:new']);
			expect(symbols.bibKeys).toEqual([{ key: 'newkey', title: 'New' }]);
			expect(fetch).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
			vi.unstubAllGlobals();
		}
	});

	it('a \\label removed from an open tab is no longer offered (FR-029)', async () => {
		vi.useFakeTimers();
		// the server still has the label in a's stored text unless a is excluded
		const fetch = vi.fn(async (url: string) => ({
			ok: true,
			json: async () => ({ ...NONE, labels: url.includes('exclude=a') ? [] : ['sec:old'] })
		}));
		vi.stubGlobal('fetch', fetch);
		try {
			const symbols = new Symbols();
			symbols.refresh();
			await vi.advanceTimersByTimeAsync(500);
			expect(symbols.labels).toEqual(['sec:old']);
			symbols.scan('a', false, EditorState.create({ doc: '\\section{A}' }));
			await vi.advanceTimersByTimeAsync(800);
			expect(symbols.labels).toEqual([]);
		} finally {
			vi.useRealTimers();
			vi.unstubAllGlobals();
		}
	});
});
