// pdfTeX/XeTeX/LuaTeX log → entries (research R7). Expects -file-line-error and unwrapped lines (max_print_line).
import type { LogEntry } from './compile-types.ts';

const FILE_LINE = /^(.+?):(\d+): (.+)$/;
const BANG = /^! (.+)$/;
const L_LINE = /^l\.(\d+) ?(.*)$/;
const ABORT = /^\*\*\* \((.+)\)$/;
const WARNING = /^(?:LaTeX|Package (\S+)|Class (\S+)) Warning: (.+)$/;
const BOX = /^(?:Overfull|Underfull) \\[hv]box .*?(?:at lines? (\d+)(?:--\d+)?)?$/;
const INPUT_LINE = /^(.*?)(?: on input line (\d+))?\.?$/;
const CHKTEX = /^(.+?):(\d+):(\d+):(\d+):\w+:(\d+):(.*)$/;

/** `main`: the main document's file name, e.g. 'thesis.tex' (paths in the log are relative to its folder). */
export function parseLog(log: string, main = 'main.tex'): LogEntry[] {
	const aux = `${main.replace(/\.[^.]*$/, '')}.aux`;
	const lines = log.split(/\r?\n/);
	const entries: LogEntry[] = [];
	let lineless: LogEntry | undefined; // a `!` error still waiting for its `l.<n>`
	let last: LogEntry | undefined; // the latest error, for the `l.<n>` text (016) after it
	// ponytail: no file-stack tracking; warnings and boxes after the .aux is read (document body) are
	// attributed to the main document, earlier ones (package loading) get no file. Track `(file` / `)` for multi-file projects.
	let inBody = false;

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		let m: RegExpMatchArray | null;
		if (!inBody && raw.includes(aux)) inBody = true;

		if ((m = raw.match(FILE_LINE))) {
			// -halt-on-error's closing line, not an error of its own
			if (m[3].trim().startsWith('==> Fatal error occurred')) continue;
			const file = m[1].replace(/^\.\//, '');
			// a `! File … not found.` prompt has no l.<n>: nonstop mode stops right there, at this place
			if (lineless && m[3].trim() === 'Emergency stop.') Object.assign(lineless, { file, line: Number(m[2]) });
			lineless = undefined;
			entries.push((last = { level: 'error', file, line: Number(m[2]), message: m[3].trim(), raw }));
		} else if ((m = raw.match(BANG))) {
			const message = m[1].trim();
			if (message.startsWith('==> Fatal error occurred')) continue;
			if (entries.some((e) => e.level === 'error' && e.message === message)) continue;
			entries.push((lineless = last = { level: 'error', message, raw }));
		} else if ((m = raw.match(L_LINE))) {
			if (lineless) lineless.line = Number(m[1]);
			if (last && last.context === undefined) last.context = m[2];
			lineless = undefined;
		} else if ((m = raw.match(ABORT))) {
			if (last?.message === 'Emergency stop.') last.context = m[1];
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
				...(inBody && { file: main }),
				...(line && { line: Number(line) }),
				raw: rawText
			});
		} else if ((m = raw.match(BOX))) {
			entries.push({
				level: 'typesetting',
				message: raw,
				...(inBody && { file: main }),
				...(m[1] && { line: Number(m[1]) }),
				raw
			});
		}
	}
	return entries;
}

/** ChkTeX output in the job's `-f '%f:%l:%c:%d:%k:%n:%m\n'` format → entries (016). */
export function parseChktex(out: string): LogEntry[] {
	const entries: LogEntry[] = [];
	for (const raw of out.split(/\r?\n/)) {
		const m = raw.match(CHKTEX);
		if (!m) continue;
		entries.push({
			level: 'chktex',
			file: m[1].replace(/^\.\//, ''),
			line: Number(m[2]),
			column: Number(m[3]),
			length: Number(m[4]),
			message: `${m[6].trim()} (ChkTeX ${m[5]})`,
			raw
		});
	}
	return entries;
}
