import { describe, expect, it } from 'vitest';
import { wordCount } from '../../src/lib/editor/words.ts';

describe('wordCount', () => {
	it('counts the body only, without commands, comments or math', () => {
		const tex = `\\documentclass{article}
\\usepackage{graphicx}
\\title{Ignored preamble words}
\\begin{document}
\\section{Introduction}
The results don't lie. % a comment here
Energy is $E = mc^2$ and \\[ x + y \\] then 50\\% done.
\\begin{equation} a = b \\end{equation}
See \\ref{fig:one} and \\cite{knuth84}, \\textbf{bold words}.
\\begin{figure}[h] \\includegraphics[width=0.5\\linewidth]{img.png} \\end{figure}
\\end{document}`;
		// Introduction / The results don't lie / Energy is and then 50 done / See and bold words
		expect(wordCount(tex)).toBe(1 + 4 + 6 + 4);
	});

	it('counts a file without a document body as a whole', () => {
		expect(wordCount('\\chapter{Two words} and three more')).toBe(5);
		expect(wordCount('')).toBe(0);
	});
});
