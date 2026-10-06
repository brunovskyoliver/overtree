// pdfTeX/XeTeX/LuaTeX log → entries (research R7). Expects -file-line-error and unwrapped lines (max_print_line).
import type { LogEntry } from './compile-types.ts';

const FILE_LINE = /^(.+?):(\d+): (.+)$/;
const BANG = /^! (.+)$/;
const L_LINE = /^l\.(\d+)/;
const WARNING = /^(?:LaTeX|Package (\S+)|Class (\S+)) Warning: (.+)$/;
const BOX = /^(?:Overfull|Underfull) \\[hv]box .*?(?:at lines? (\d+)(?:--\d+)?)?$/;
const INPUT_LINE = /^(.*?)(?: on input line (\d+))?\.?$/;

export function parseLog(log: string): LogEntry[] {
	const lines = log.split(/\r?\n/);
	const entries: LogEntry[] = [];
	let lineless: LogEntry | undefined; // a `!` error still waiting for its `l.<n>`
	// ponytail: no file-stack tracking; warnings and boxes after the .aux is read (document body) are
	// attributed to main.tex, earlier ones (package loading) get no file. Track `(file` / `)` for multi-file projects.
	let inBody = false;

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		let m: RegExpMatchArray | null;
		if (!inBody && raw.includes('main.aux')) inBody = true;

		if ((m = raw.match(FILE_LINE))) {
			lineless = undefined;
			// -halt-on-error's closing line, not an error of its own
			if (m[3].trim().startsWith('==> Fatal error occurred')) continue;
			entries.push({ level: 'error', file: m[1].replace(/^\.\//, ''), line: Number(m[2]), message: m[3].trim(), raw });
		} else if ((m = raw.match(BANG))) {
			const message = m[1].trim();
			if (entries.some((e) => e.level === 'error' && e.message === message)) continue;
			entries.push((lineless = { level: 'error', message, raw }));
		} else if ((m = raw.match(L_LINE))) {
			if (lineless) lineless.line = Number(m[1]);
			lineless = undefined;
		} else if ((m = raw.match(WARNING))) {
			// continuation lines are prefixed with `(pkg)`
			const pkg = m[1] ?? m[2];
			let text = m[3];
			let rawText = raw;
			while (pkg && lines[i + 1]?.startsWith(`(${pkg})`)) {
				rawText += '\n' + lines[++i];
				text += ' ' + lines[i].slice(pkg.length + 2).trim();
			}
			const [, message, line] = text.match(INPUT_LINE)!;
			entries.push({
				level: 'warning',
				message,
				...(inBody && { file: 'main.tex' }),
				...(line && { line: Number(line) }),
				raw: rawText
			});
		} else if ((m = raw.match(BOX))) {
			entries.push({
				level: 'typesetting',
				message: raw,
				...(inBody && { file: 'main.tex' }),
				...(m[1] && { line: Number(m[1]) }),
				raw
			});
		}
	}
	return entries;
}
