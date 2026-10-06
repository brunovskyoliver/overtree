import { describe, expect, it } from 'vitest';
import { scanBib, scanTex } from '../../src/lib/completion/scan.ts';

describe('scanTex', () => {
	it('finds labels, every command definition form and environments', () => {
		const text = String.raw`\section{A}\label{sec:a} text \label{eq:1}
\newcommand{\R}{\mathbb{R}}
\renewcommand\vec[1]{\mathbf{#1}}
\providecommand*{\half}{\frac12}
\newcommand*{\pair}[2][x]{(#1,#2)}
\DeclareMathOperator{\tr}{tr}
\DeclareMathOperator*{\argmax}{arg\,max}
\def\foo#1#2{#1#2}
\def \bar{b}
\newenvironment{proof2}{\begin{proof}}{\end{proof}}`;
		expect(scanTex(text)).toEqual({
			labels: ['sec:a', 'eq:1'],
			commands: [
				{ name: 'R', args: 0 },
				{ name: 'vec', args: 1 },
				{ name: 'half', args: 0 },
				{ name: 'pair', args: 2 },
				{ name: 'tr', args: 0 },
				{ name: 'argmax', args: 0 },
				{ name: 'foo', args: 2 },
				{ name: 'bar', args: 0 }
			],
			environments: ['proof2']
		});
	});

	it('ignores commented-out definitions but not escaped percent signs', () => {
		const text = '% \\newcommand{\\gone}{x}\n\\label{a} % \\label{b}\n50\\% \\newcommand{\\kept}{y}';
		expect(scanTex(text)).toEqual({ labels: ['a'], commands: [{ name: 'kept', args: 0 }], environments: [] });
	});
});

describe('scanBib', () => {
	it('reads keys with title and author, braces and quotes', () => {
		const bib = String.raw`@string{acm = "ACM"}
@comment{@article{hidden, title={No}}}
@preamble{"\newcommand{\x}{}"}
% @book{commented, title={No}}
@article{knuth84,
  author = {Donald E. Knuth},
  title  = {Literate {Programming}},
  year = 1984
}
@Book{ lamport94 ,
  title = "{\LaTeX}: A Document Preparation System, {"}quoted{"}",
  author = "Leslie Lamport"
}
@misc{nofields, url = {http://x.org/a%20b}}`;
		expect(scanBib(bib)).toEqual([
			{ key: 'knuth84', author: 'Donald E. Knuth', title: 'Literate Programming' },
			{ key: 'lamport94', title: String.raw`\LaTeX: A Document Preparation System, "quoted"`, author: 'Leslie Lamport' },
			{ key: 'nofields' }
		]);
	});
});
