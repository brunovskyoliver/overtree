// Instant code check (016): structural mistakes found in the source while typing, without a compile. Unmatched
// \begin/\end, unbalanced braces and math left open; the editor shows each problem as a lint marker.
// ponytail: a lexical scan, not TeX: \iffalse blocks, catcode changes and macros that expand to \begin/\end outside a
// definition give false markers; the compile's own markers stay authoritative. Upgrade: honor % codecheck-off regions.

export type Problem = { from: number; to: number; message: string };

// environments whose body isn't LaTeX: skipped up to their \end
const VERBATIM = new Set(['verbatim', 'verbatim*', 'Verbatim', 'Verbatim*', 'lstlisting', 'minted', 'comment', 'alltt']);
// commands whose braced arguments are a definition: \begin/\end and $ inside them needn't balance there
const DEFINITIONS = new Set([
	'newcommand', 'renewcommand', 'providecommand', 'def', 'gdef', 'edef', 'xdef', 'newenvironment', 'renewenvironment',
	'NewDocumentCommand', 'RenewDocumentCommand', 'NewDocumentEnvironment', 'RenewDocumentEnvironment', 'DeclareRobustCommand'
]);
const COMMAND = /\\([A-Za-z@]+|.?)/y;
const ENV_ARG = /\s*\{([^{}\n]*)\}/y;
const BLANK_LINE = /\n[ \t]*\n/y;

type Math = { open: '$' | '$$' | '\\(' | '\\['; from: number };
const CLOSER: Record<Math['open'], string> = { $: '$', $$: '$$', '\\(': '\\)', '\\[': '\\]' };

export function codeCheck(text: string): Problem[] {
	const problems: Problem[] = [];
	const envs: { name: string; from: number; to: number }[] = [];
	const braces: number[] = [];
	let math: Math | null = null;
	// inside a definition's braces from this depth on (-1: none)
	let defDepth = -1;
	let defArmed = false;
	const inDef = () => defArmed && braces.length > defDepth;
	const line = (pos: number) => text.slice(0, pos).split('\n').length;
	const add = (from: number, to: number, message: string) => problems.push({ from, to, message });

	let i = 0;
	while (i < text.length) {
		const c = text[i];
		if (c === '%') {
			const nl = text.indexOf('\n', i);
			i = nl < 0 ? text.length : nl;
			continue;
		}
		if (c === '\n') {
			BLANK_LINE.lastIndex = i;
			if (BLANK_LINE.test(text) && math && !inDef()) {
				// TeX ends the paragraph here: math can't run past it
				add(math.from, math.from + math.open.length, `${math.open} opens math that is never closed (a blank line ends it)`);
				math = null;
			}
			i++;
			continue;
		}
		if (c === '\\') {
			COMMAND.lastIndex = i;
			const name = COMMAND.exec(text)![1];
			let end = i + 1 + name.length;
			if (name === 'begin' || name === 'end') {
				ENV_ARG.lastIndex = end;
				const arg = ENV_ARG.exec(text);
				if (arg && !inDef()) {
					end = ENV_ARG.lastIndex;
					const env = arg[1].trim();
					if (name === 'begin' && VERBATIM.has(env)) {
						const close = text.indexOf(`\\end{${env}}`, end);
						if (close < 0) add(i, end, `\\begin{${env}} is never closed (no \\end{${env}})`);
						i = close < 0 ? text.length : close + `\\end{${env}}`.length;
						continue;
					}
					if (name === 'begin') envs.push({ name: env, from: i, to: end });
					else closeEnv(env, i, end);
				} else if (arg) end = ENV_ARG.lastIndex;
			} else if (name === 'verb') {
				// \verb|…| (or \verb*): up to the same delimiter on this line
				if (text[end] === '*') end++;
				const delim = text[end];
				const close = delim && delim !== '\n' ? text.indexOf(delim, end + 1) : -1;
				const nl = text.indexOf('\n', end);
				end = close >= 0 && (nl < 0 || close < nl) ? close + 1 : end;
			} else if ((name === '(' || name === '[') && !inDef()) {
				if (!math) math = { open: `\\${name}` as Math['open'], from: i };
				else mathMismatch(i, end);
			} else if ((name === ')' || name === ']') && !inDef()) {
				if (math && CLOSER[math.open] === `\\${name}`) math = null;
				else mathMismatch(i, end);
			} else if (DEFINITIONS.has(name)) {
				defDepth = braces.length;
				defArmed = true;
			}
			i = end;
			continue;
		}
		if (c === '{') {
			braces.push(i);
		} else if (c === '}') {
			if (braces.pop() === undefined) add(i, i + 1, 'This } has no { to match it');
			else if (defArmed && braces.length === defDepth) {
				// the definition goes on while more arguments follow
				const next = text.slice(i + 1).match(/^\s*(.)/s)?.[1];
				if (next !== '{' && next !== '[') defArmed = false;
			}
		} else if (c === '$' && !inDef()) {
			const two = text[i + 1] === '$';
			if (!math) {
				math = { open: two ? '$$' : '$', from: i };
				i += two ? 2 : 1;
				continue;
			}
			if (math.open === '$$' && two) {
				math = null;
				i += 2;
				continue;
			}
			if (math.open === '$') math = null;
			else mathMismatch(i, i + (two ? 2 : 1));
			i++;
			continue;
		}
		i++;
	}

	for (const env of envs) add(env.from, env.to, `\\begin{${env.name}} is never closed (no \\end{${env.name}})`);
	for (const at of braces) add(at, at + 1, 'This { is never closed');
	if (math) add(math.from, math.from + math.open.length, `${math.open} opens math that is never closed`);
	return problems.sort((a, b) => a.from - b.from);

	function closeEnv(env: string, from: number, to: number) {
		const top = envs.at(-1);
		if (!top) return add(from, to, `\\end{${env}} has no \\begin{${env}} before it`);
		if (top.name === env) return void envs.pop();
		const deeper = envs.findLastIndex((e) => e.name === env);
		if (deeper >= 0) {
			// the ones opened after it were never closed
			for (const open of envs.splice(deeper + 1)) add(open.from, open.to, `\\begin{${open.name}} is never closed (no \\end{${open.name}})`);
			envs.pop();
			return;
		}
		// a wrong name: report both ends and take it as the close of the open one, so one slip makes one pair of markers
		envs.pop();
		add(top.from, top.to, `\\begin{${top.name}} is closed by \\end{${env}} on line ${line(from)}`);
		add(from, to, `\\end{${env}} doesn’t match \\begin{${top.name}} on line ${line(top.from)}`);
	}

	function mathMismatch(from: number, to: number) {
		const what = text.slice(from, to);
		add(from, to, math ? `${what} doesn’t close ${math.open} (opened on line ${line(math.from)})` : `${what} closes math that was never opened`);
		if (math) math = null;
	}
}
