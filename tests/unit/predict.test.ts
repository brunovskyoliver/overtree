import { Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { predict } from '../../src/lib/completion/predict.ts';

// Ghost-text predictions from the document's own patterns. `‸` marks the cursor.
const at = (src: string) => {
	const pos = src.indexOf('‸');
	return predict(Text.of(src.replace('‸', '').split('\n')), pos);
};

const figure = (file: string, caption: string) =>
	['\\begin{figure}[htbp]', '  \\centering', `  \\includegraphics[width=0.8\\linewidth]{figs/${file}}`, `  \\caption{${caption}}`, '\\end{figure}'].join('\n');

describe('the next line, from what followed the same line before', () => {
	it('walks through a figure block seen once, stopping before the parts that change', () => {
		const doc = `${figure('a.png', 'A plot')}\n\n`;
		expect(at(`${doc}\\begin{figure}[htbp]\n  ‸`)).toBe('\\centering');
		expect(at(`${doc}\\begin{figure}[htbp]\n  \\centering\n  ‸`)).toBe('\\includegraphics[width=0.8\\linewidth]{');
	});

	it('several examples give what they share', () => {
		const doc = `${figure('a.png', 'A')}\n${figure('b.png', 'B')}\n`;
		expect(at(`${doc}\\begin{figure}[htbp]\n  \\centering\n  ‸`)).toBe('\\includegraphics[width=0.8\\linewidth]{figs/');
	});

	it('nothing after a line seen only here, or one too short to mean anything', () => {
		expect(at('\\section{Intro}\nSome text.\n‸')).toBeNull();
		expect(at('a\n}\nb\n}\n‸')).toBeNull();
	});
});

describe('table rows', () => {
	const table = '\\begin{tabular}{l|cc}\n\\hline\nName & Age & City \\\\\n\\hline\n';
	it('the next & until the row has the columns of the one above, then \\\\', () => {
		expect(at(`${table}Ann‸`)).toBe(' & ');
		expect(at(`${table}Ann & 31‸`)).toBe(' & ');
		expect(at(`${table}Ann & 31 & Oslo‸`)).toBe(' \\\\');
		expect(at(`${table}Ann & 31 & Oslo ‸`)).toBe('\\\\');
		expect(at(`${table}Ann & ‸`)).toBeNull(); // a cell to type first
		expect(at(`${table}Ann & 31 & Oslo \\\\‸`)).toBeNull();
	});

	it('the first row counts from the column spec', () => {
		expect(at('\\begin{tabular}{@{}lrr@{}}\nItem‸')).toBe(' & ');
		expect(at('\\begin{tabular}{*{3}{c}}\na & b & c‸')).toBe(' \\\\');
		expect(at('\\begin{tabularx}{\\linewidth}{lX}\nKey‸')).toBe(' & ');
	});

	it('not below the table', () => {
		expect(at(`${table}Ann & 31 & Oslo \\\\\n\\end{tabular}\nAfter the table‸`)).toBeNull();
	});
});

describe('the rest of a command line typed before', () => {
	it('completes up to the argument that changes', () => {
		const doc = '\\includegraphics[width=0.8\\linewidth]{figs/a.png}\n\n';
		expect(at(`${doc}\\includegraphics[‸`)).toBe('width=0.8\\linewidth]{');
	});

	it('not inside an open argument, not for prose, not mid-line', () => {
		expect(at('\\section{Introduction}\n\\section{Int‸')).toBeNull();
		expect(at('The quick brown fox\nThe quick‸')).toBeNull();
		expect(at('\\includegraphics[width=1cm]{a}\n\\includegraphics[‸]{b}')).toBeNull();
	});
});
