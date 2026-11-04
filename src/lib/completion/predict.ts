// As-you-type predictions (the editor's ghost text, Tab accepts) from patterns in the document itself: nothing
// leaves the browser. Three patterns, for a cursor at the end of its line:
// - a blank line after a line seen before: what followed it then (\begin{figure} → \centering → \includegraphics…)
// - a table row: the next ` & ` until the row has the columns of the one above, then ` \\`
// - a command line: the rest of the earlier lines starting the same way (\includegraphics[ → width=0.8\linewidth]{)
// Several earlier examples give their common start; a single one stops before its last argument's content, since
// that part (a file name, a caption) is the one that changes.
import type { Text } from '@codemirror/state';

/** At least this much text, or no prediction. */
const MIN = 2;
/** Table rule lines between rows (no cells of their own). */
const RULE = /^\\(?:hline|midrule|toprule|bottomrule|cmidrule|cline|addlinespace)\b/;

/** What to type next at `pos`, or null. */
export function predict(doc: Text, pos: number): string | null {
	const line = doc.lineAt(pos);
	if (pos !== line.to) return null; // mid-line: the text after the cursor would be in the way
	const before = line.text;
	if (!before.trim()) return nextLine(doc, line.number);
	return tableCell(doc, line.number, before) ?? sameStart(doc, line.number, before.trimStart());
}

function nextLine(doc: Text, n: number): string | null {
	const prev = n > 1 ? doc.line(n - 1).text.trim() : '';
	if (prev.length < 3) return null; // `}` or `\\` say nothing about what comes next
	const seen: string[] = [];
	for (let k = 1; k < doc.lines; k++) {
		if (k === n - 1 || doc.line(k).text.trim() !== prev) continue;
		const next = doc.line(k + 1).text.trim();
		if (next && k + 1 !== n) seen.push(next);
	}
	return choose(seen, '');
}

function tableCell(doc: Text, n: number, before: string): string | null {
	if (before.includes('\\\\') || /&\s*$/.test(before)) return null;
	const want = columns(doc, n);
	if (want === null) return null;
	const have = cells(before);
	const gap = before.endsWith(' ') ? '' : ' ';
	return have < want ? `${gap}& ` : have === want ? `${gap}\\\\` : null;
}

/** The `&`s a row of the table at line `n` has: from the nearest row above, else from the tabular's column spec. */
function columns(doc: Text, n: number): number | null {
	for (let k = n - 1; k >= Math.max(1, n - 20); k--) {
		const t = doc.line(k).text.trim();
		if (!t || RULE.test(t)) continue;
		if (t.includes('&') && /\\\\(\s*\\(hline|midrule)\b.*)?$/.test(t)) return cells(t);
		// tabular* and tabularx take a width first
		const spec = t.match(/^\\begin\{(?:tabular|longtable|array|(?:tabular\*|tabularx)\}\{[^}]*)\}(?:\[[^\]]*\])?\{(.*)\}\s*$/);
		if (spec) return specColumns(spec[1]) - 1;
		return null; // something else between: not a table row we can tell
	}
	return null;
}

/** Unescaped `&`s. */
const cells = (row: string) => row.match(/(?<!\\)&/g)?.length ?? 0;

/** Columns of a tabular spec: `l|c|r`, `p{3cm}`, `*{3}{c}`, `@{}`, `>{\bfseries}`. */
function specColumns(spec: string): number {
	const s = spec
		.replace(/\*\{(\d+)\}\{([^}]*)\}/g, (_, k, c) => c.repeat(Number(k)))
		.replace(/[@!<>]\{[^}]*\}/g, '')
		.replace(/\{[^}]*\}/g, '');
	return s.match(/[lcrpmbXSs]/g)?.length ?? 0;
}

function sameStart(doc: Text, n: number, typed: string): string | null {
	if (typed.length < 4 || !typed.startsWith('\\')) return null;
	const rests: string[] = [];
	for (let k = 1; k <= doc.lines; k++) {
		if (k === n) continue;
		const t = doc.line(k).text.trimStart();
		if (t.length > typed.length && t.startsWith(typed)) rests.push(t.slice(typed.length).trimEnd());
	}
	return choose(rests, typed);
}

/** Several examples: their common start; one: up to its last argument's `{` (none inside an open argument). */
function choose(examples: string[], typed: string): string | null {
	if (!examples.length) return null;
	let out: string;
	if (examples.length > 1) {
		out = examples.reduce((a, b) => {
			let i = 0;
			while (i < a.length && a[i] === b[i]) i++;
			return a.slice(0, i);
		});
	} else {
		if (count(typed, '{') > count(typed, '}')) return null;
		out = examples[0];
		const open = out.lastIndexOf('{');
		if (open >= 0 && out.endsWith('}')) out = out.slice(0, open + 1);
	}
	return out.trim().length >= MIN ? out : null;
}

const count = (s: string, c: string) => s.split(c).length - 1;
