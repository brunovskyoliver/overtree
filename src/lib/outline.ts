export type OutlineEntry = { level: 1 | 2 | 3; title: string; line: number };

const HEADING = /\\((?:sub){0,2})section\*?\s*(?:\[[^\]]*\])?\s*\{/g;

/** Cut a line at its first unescaped `%` (`\%` is a literal percent, `\\%` starts a comment). */
function stripComment(line: string) {
	for (let i = 0; i < line.length; i++) {
		if (line[i] === '\\') i++;
		else if (line[i] === '%') return line.slice(0, i);
	}
	return line;
}

/** The balanced-brace argument starting right after the `{` at `start`. */
function braced(line: string, start: number) {
	let depth = 1;
	for (let i = start; i < line.length; i++) {
		if (line[i] === '\\') i++;
		else if (line[i] === '{') depth++;
		else if (line[i] === '}' && --depth === 0) return line.slice(start, i);
	}
	// ponytail: titles spanning lines are cut at the line end
	return line.slice(start);
}

/** `The \emph{best} way` → `The best way`. */
const plain = (tex: string) =>
	tex
		.replace(/\\[a-zA-Z]+\*?/g, '')
		.replace(/\\(.)/g, '$1')
		.replace(/[{}]/g, '')
		.replace(/\s+/g, ' ')
		.trim();

/** Section headings of a LaTeX source, in order (contracts/ui.md, outline rules). */
export function parseOutline(text: string): OutlineEntry[] {
	const entries: OutlineEntry[] = [];
	const lines = text.split('\n');
	for (let n = 0; n < lines.length; n++) {
		const line = lines[n];
		if (!line.includes('section')) continue;
		const code = stripComment(line);
		for (const m of code.matchAll(HEADING)) {
			const level = (m[1].length / 3 + 1) as 1 | 2 | 3;
			entries.push({ level, title: plain(braced(code, m.index + m[0].length)), line: n + 1 });
		}
	}
	return entries;
}
