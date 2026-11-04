import { describe, expect, it } from 'vitest';
import { languageOf, prose, proseWords } from '../../src/lib/spelling/words.ts';

// The spell checker's reading of LaTeX: which words are prose, and which language the document is in.
const words = (text: string) => proseWords(text).map((w) => w.word);

describe('proseWords', () => {
	it('reads prose and the text of formatting commands, not commands, math, comments or keys', () => {
		const doc = String.raw`\section{Introduction}
Some teh text in \textbf{bold wrod} and $x_i + \alpha$ inline, \(a b\) too.
% a comment wrod
See \ref{sec:intro} and \cite{knuth84}, \href{https://example.org/page}{the site}.
\[ display math \]
\begin{equation} y = mx \end{equation}
\begin{figure}[htbp]
\includegraphics[width=0.8\linewidth]{figs/plot.png}
\caption{A plott}
\end{figure}
\begin{tabular}{lcc} Name & Age \\ \end{tabular}
\verb|code wrod| It's well-known.`;
		expect(words(doc)).toEqual([
			'Introduction', 'Some', 'teh', 'text', 'in', 'bold', 'wrod', 'and', 'inline', 'too',
			'See', 'and', 'the', 'site', 'plott', 'Name', 'Age', "It's", 'well', 'known'
		]);
	});

	it('keeps offsets: the text at each word’s range is the word', () => {
		const doc = '\\documentclass{article}\n\\begin{document}\nÆble og blåbær, \\emph{smørrebrød}.\n\\end{document}';
		for (const w of proseWords(doc)) expect(doc.slice(w.from, w.to)).toBe(w.word);
		expect(prose(doc)).toHaveLength(doc.length);
		expect(words(doc)).toEqual(['Æble', 'og', 'blåbær', 'smørrebrød']);
	});

	it('skips acronyms, single letters, words glued to digits, paths and accent commands', () => {
		expect(words('The NASA and PhD a 2nd file.tex caf\\\'e ok')).toEqual(['The', 'and', 'file', 'ok']);
	});

	it('skips the arguments of definitions and settings', () => {
		expect(words('\\newcommand{\\foo}[1]{\\textbf{#1} wrod}\\setlength{\\parindent}{0pt}\\usepackage[danish]{babel} text')).toEqual(['text']);
	});
});

describe('languageOf', () => {
	const doc = (preamble: string) => `\\documentclass${preamble}\n\\begin{document}\nx\n\\end{document}`;
	it('US or British English from babel’s main language, polyglossia or the class options; English when none is named', () => {
		expect(languageOf(doc('{article}'))).toBe('en');
		expect(languageOf(doc('{article}\n\\usepackage[british]{babel}'))).toBe('en-GB');
		expect(languageOf(doc('{article}\n\\usepackage[danish,english]{babel}'))).toBe('en');
		expect(languageOf(doc('{article}\n\\usepackage[danish,main=british]{babel}'))).toBe('en-GB');
		expect(languageOf(doc('[a4paper,british]{article}\n\\usepackage{babel}'))).toBe('en-GB');
		expect(languageOf(doc('{article}\n\\usepackage{polyglossia}\n\\setdefaultlanguage[variant=uk]{english}'))).toBe('en');
		expect(languageOf(doc('{article}\n% \\usepackage[danish]{babel}'))).toBe('en'); // commented out
	});

	it('null for a language other than English; undefined without a preamble (a chapter)', () => {
		expect(languageOf(doc('{article}\n\\usepackage[danish]{babel}'))).toBeNull();
		expect(languageOf(doc('{article}\n\\usepackage[english,ngerman]{babel}'))).toBeNull();
		expect(languageOf('\\section{Chapter}\nText.')).toBeUndefined();
	});
});
