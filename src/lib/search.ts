// Project search (014): the matcher shared by the browser (inline regex errors, finding a match again after a
// click) and the server (search and replace). Plain erasable TypeScript: no imports, no build step.

export type SearchOptions = { query: string; caseSensitive: boolean; wholeWord: boolean; regex: boolean };

/** One match of `POST /api/projects/:pid/search`: document offsets (UTF-16, as CodeMirror and Y.Text count) and
 *  the line it is on, cut to an excerpt around the match. */
export type SearchMatch = { from: number; to: number; line: number; before: string; match: string; after: string };
export type SearchFile = { fileId: string; path: string; canEdit: boolean; matches: SearchMatch[] };
export type SearchResult = { files: SearchFile[]; total: number; truncated: boolean };

/** Matches per search, all files together (FR-012). */
export const MATCH_CAP = 2000;
/** Characters of context before and after a match in the excerpt: little before, so the match shows in a narrow
 *  sidebar. */
const BEFORE = 24;
const AFTER = 80;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The search as a global RegExp, or the reason it can't be one. Whole word: no letter, digit or `_` right before
 *  or after the match, so `\section` matches whole too. */
export function buildRegExp(o: SearchOptions): RegExp | { error: string } {
	if (!o.query) return { error: 'Type something to search for.' };
	let source = o.regex ? o.query : escape(o.query);
	if (o.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
	try {
		return new RegExp(source, `gmu${o.caseSensitive ? '' : 'i'}`);
	} catch (e) {
		// V8: "Invalid regular expression: /al(pha/gimu: Unterminated group"; keep the reason only
		const msg = (e as Error).message;
		const reason = msg.startsWith('Invalid regular expression: /') ? msg.slice(msg.lastIndexOf(': ') + 2) : msg;
		return { error: `Invalid regular expression: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` };
	}
}

/** Every non-empty match of the global `re` in `text`, in order; at most `limit`. */
export function* matches(text: string, re: RegExp, limit = Infinity): Generator<RegExpExecArray> {
	re.lastIndex = 0;
	let n = 0;
	for (let m = re.exec(text); m && n < limit; m = re.exec(text)) {
		if (m[0] === '') {
			// `^`, `x*`: nothing to show or replace, step past it (a whole code point under the u flag)
			re.lastIndex += (text.codePointAt(re.lastIndex) ?? 0) > 0xffff ? 2 : 1;
			continue;
		}
		n++;
		yield m;
	}
}

/** The match with the line it is on, cut to an excerpt. `starts` are the offsets where lines begin. */
export function describe(text: string, m: RegExpExecArray, starts: number[]): SearchMatch {
	const from = m.index, to = from + m[0].length;
	let lo = 0, hi = starts.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (starts[mid] <= from) lo = mid;
		else hi = mid - 1;
	}
	const lineStart = starts[lo];
	const lineEnd = lo + 1 < starts.length ? starts[lo + 1] - 1 : text.length;
	const a = Math.max(lineStart, from - BEFORE);
	const matchEnd = Math.min(to, lineEnd); // a match across lines shows up to its first line's end
	const b = Math.min(lineEnd, matchEnd + AFTER);
	return {
		from,
		to,
		line: lo + 1,
		before: (a > lineStart ? '…' : '') + text.slice(a, from),
		match: matchEnd > from ? text.slice(from, matchEnd) : '↵', // a match that starts with the line break
		after: text.slice(matchEnd, b) + (b < lineEnd ? '…' : '')
	};
}

/** Offsets where each line of `text` starts. */
export function lineStarts(text: string): number[] {
	const starts = [0];
	for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
	return starts;
}

/** The replacement text for match `m`. Regex mode expands `$&`, `$1`…`$99`, `$<name>`, `` $` ``, `$'` and `$$` like
 *  String.prototype.replace; otherwise the replacement is taken literally. */
export function expand(replacement: string, m: RegExpExecArray, regex: boolean): string {
	if (!regex) return replacement;
	const text = m.input;
	return replacement.replace(/\$(\$|&|`|'|<([^>]*)>|(\d{1,2}))/g, (all, what: string, name?: string, num?: string) => {
		if (what === '$') return '$';
		if (what === '&') return m[0];
		if (what === '`') return text.slice(0, m.index);
		if (what === "'") return text.slice(m.index + m[0].length);
		if (name !== undefined) return m.groups ? (m.groups[name] ?? '') : all;
		// `$12` falls back to `$1` + "2" when there are fewer than 12 groups, like replace()
		let n = Number(num);
		let rest = '';
		if (n >= m.length && num!.length === 2) (n = Number(num![0])), (rest = num![1]);
		if (n < 1 || n >= m.length) return all;
		return (m[n] ?? '') + rest;
	});
}
