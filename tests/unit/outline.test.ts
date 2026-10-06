import { describe, expect, it } from 'vitest';
import { parseOutline } from '../../src/lib/outline.ts';

describe('parseOutline', () => {
	it('lists three levels in order (US3-1)', () => {
		const text = 'x\n\\section{Intro}\n\\subsection{Background}\n\n\\subsubsection{Details}\n';
		expect(parseOutline(text)).toEqual([
			{ level: 1, title: 'Intro', line: 2 },
			{ level: 2, title: 'Background', line: 3 },
			{ level: 3, title: 'Details', line: 5 }
		]);
	});

	it('skips commented headings but not escaped percent signs (US3-4)', () => {
		const text = '% \\section{Old}\n  %\\subsection{Gone}\n\\section{50\\% done} % note\n\\\\% \\section{Also gone}';
		expect(parseOutline(text)).toEqual([{ level: 1, title: '50% done', line: 3 }]);
	});

	it('handles starred, short-title and nested-command forms', () => {
		const text = '\\section*{Preface}\n\\section[Short]{Long title}\n\\section{The \\emph{best}   way}';
		expect(parseOutline(text).map((e) => e.title)).toEqual(['Preface', 'Long title', 'The best way']);
	});

	it('skips headings after an escaped backslash and keeps bare commands as text', () => {
		const text = 'a\\\\section{Not a heading}\n\\section{The \\LaTeX{} and \\TeX way}\nb\\\\\\\\\\section{Real}';
		expect(parseOutline(text)).toEqual([
			{ level: 1, title: 'The LaTeX and TeX way', line: 2 },
			{ level: 1, title: 'Real', line: 3 }
		]);
	});

	it('returns [] for empty text', () => {
		expect(parseOutline('')).toEqual([]);
	});

	it('parses 5,000 lines in under 16 ms', () => {
		const text = Array.from({ length: 5000 }, (_, i) =>
			i % 50 === 0 ? `\\subsection{Part \\textbf{${i}}}` : `Some text with $x^${i}$ and a % comment`
		).join('\n');
		parseOutline(text); // warm up
		const t0 = performance.now();
		const entries = parseOutline(text);
		expect(performance.now() - t0).toBeLessThan(16);
		expect(entries).toHaveLength(100);
		expect(entries[1]).toEqual({ level: 2, title: 'Part 50', line: 51 });
	});
});
