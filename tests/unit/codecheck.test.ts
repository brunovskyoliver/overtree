import { describe, expect, it } from 'vitest';
import { codeCheck } from '../../src/lib/editor/codecheck.ts';

// 016: the instant code check. Each problem as [marked text, message].
const check = (src: string) => codeCheck(src).map((p) => [src.slice(p.from, p.to), p.message]);
const doc = (body: string) => `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;

describe('codeCheck', () => {
	it('a clean document has no problems', () => {
		expect(check(doc('Hello $x^2$ and $$y$$, \\(a\\) \\[b\\].\n\\begin{itemize}\n\\item {one}\n\\end{itemize}'))).toEqual([]);
	});

	it('mismatched \\begin{itemize} / \\end{enumerate}: both ends, with lines', () => {
		expect(check(doc('\\begin{itemize}\n\\item one\n\\end{enumerate}'))).toEqual([
			['\\begin{itemize}', '\\begin{itemize} is closed by \\end{enumerate} on line 5'],
			['\\end{enumerate}', '\\end{enumerate} doesn’t match \\begin{itemize} on line 3']
		]);
	});

	it('\\end without \\begin', () => {
		expect(check('text\n\\end{center}\n')).toEqual([['\\end{center}', '\\end{center} has no \\begin{center} before it']]);
	});

	it('a \\begin never closed, also when an outer \\end closes past it', () => {
		expect(check(doc('\\begin{figure}\n\\begin{center}\nx\n\\end{figure}'))).toEqual([
			['\\begin{center}', '\\begin{center} is never closed (no \\end{center})']
		]);
		expect(check('\\begin{document}\n\\begin{quote}\n')).toEqual([
			['\\begin{document}', '\\begin{document} is never closed (no \\end{document})'],
			['\\begin{quote}', '\\begin{quote} is never closed (no \\end{quote})']
		]);
	});

	it('unbalanced braces', () => {
		expect(check(doc('\\textbf{bold'))).toEqual([['{', 'This { is never closed']]);
		expect(check(doc('\\textbf{bold}}'))).toEqual([['}', 'This } has no { to match it']]);
	});

	it('escaped braces and dollars, comments and \\verb are not counted', () => {
		expect(check(doc('\\{ \\} \\$ 5\\% % { $ \\begin{x}\n\\verb|{$| \\verb*+}+'))).toEqual([]);
	});

	it('inline math left open: at the blank line that ends the paragraph, or at the end', () => {
		expect(check('Cost $x + 1 here.\n\nNext paragraph.')).toEqual([['$', '$ opens math that is never closed (a blank line ends it)']]);
		expect(check('Cost $x')).toEqual([['$', '$ opens math that is never closed']]);
	});

	it('mixed math delimiters', () => {
		expect(check('\\(a$')).toEqual([['$', '$ doesn’t close \\( (opened on line 1)']]);
		expect(check('a\\]')).toEqual([['\\]', '\\] closes math that was never opened']]);
	});

	it('verbatim environments are skipped up to their \\end', () => {
		expect(check(doc('\\begin{verbatim}\n\\begin{itemize} { $\n\\end{verbatim}'))).toEqual([]);
		expect(check('\\begin{lstlisting}\ncode {')).toEqual([['\\begin{lstlisting}', '\\begin{lstlisting} is never closed (no \\end{lstlisting})']]);
	});

	it('\\begin/\\end and $ inside a definition need not balance', () => {
		const src = '\\newcommand{\\be}{\\begin{equation}}\n\\newcommand{\\ee}{\\end{equation}}\n\\def\\m{$}\n\\newenvironment{box}{\\begin{center}}{\\end{center}}\n';
		expect(check(src)).toEqual([]);
		// after the definition, checking goes on
		expect(check(`${src}\\end{itemize}`)).toEqual([['\\end{itemize}', '\\end{itemize} has no \\begin{itemize} before it']]);
	});

	it('a starred environment name', () => {
		expect(check('\\begin{align*}\na\n\\end{align*}')).toEqual([]);
	});
});
