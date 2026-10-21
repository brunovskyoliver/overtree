// Is a position in math mode? A forward scan of the text before it (feature 015, symbol palette).
//
// Rule: from the start of the document, skipping comments and escaped characters (`\$`, `\%`), math opens at
// `$`, `$$`, `\(`, `\[` and `\begin{…}` of a math environment, and closes at the matching `$`, `$$`, `\)`, `\]`
// or `\end{…}`. Inside math, the argument of `\text{…}`, `\mbox{…}` and friends is text again.
// ponytail: a scan, not a parser; a `$` inside a verbatim block or a macro definition can flip it. The upgrade is
// a LaTeX grammar (Lezer) that marks math nodes.

const MATH_ENVS = new Set(
	['equation', 'align', 'gather', 'multline', 'flalign', 'alignat', 'eqnarray', 'math', 'displaymath'].flatMap((e) => [e, `${e}*`])
);
const TEXT_IN_MATH = new Set(['text', 'textrm', 'textit', 'textbf', 'textsf', 'texttt', 'textnormal', 'mbox', 'intertext']);

export function inMath(doc: string, pos: number): boolean {
	let math = false;
	// brace depth at which a `\text{` inside math started; -1: not in one
	let textAt = -1;
	let depth = 0;
	for (let i = 0; i < pos; i++) {
		const c = doc[i];
		if (c === '%') {
			const eol = doc.indexOf('\n', i);
			if (eol < 0 || eol >= pos) return math && textAt < 0;
			i = eol;
		} else if (c === '{') depth++;
		else if (c === '}') {
			depth--;
			if (textAt >= 0 && depth <= textAt) textAt = -1;
		} else if (textAt >= 0) continue;
		else if (c === '$') {
			if (doc[i + 1] === '$' && i + 1 < pos) i++;
			math = !math;
		} else if (c === '\\') {
			const next = doc[i + 1];
			if (next === '(' || next === '[') math = true;
			else if (next === ')' || next === ']') math = false;
			const name = /^[A-Za-z]+\*?/.exec(doc.slice(i + 1, i + 40))?.[0];
			if (!name) {
				i++; // `\$`, `\%`, `\{`, `\(` …
				continue;
			}
			const env = /^\s*\{([^}]*)\}/.exec(doc.slice(i + 1 + name.length, i + 80));
			if ((name === 'begin' || name === 'end') && env && MATH_ENVS.has(env[1])) {
				math = name === 'begin';
				i += name.length + env[0].length;
				continue;
			}
			if (math && TEXT_IN_MATH.has(name) && doc[i + 1 + name.length] === '{') {
				textAt = depth;
				depth++;
				i += name.length + 1;
				continue;
			}
			i += name.length;
		}
	}
	return math && textAt < 0;
}
