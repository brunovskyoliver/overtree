// Inserting figures and file references (feature 015), shared by the browser and the server.
// Plain erasable TypeScript like files.ts: the server loads it without a build step.

/** Images pdfLaTeX, XeLaTeX and LuaLaTeX include with `\includegraphics` (EPS through epstopdf). */
export const GRAPHIC_EXTENSIONS = ['png', 'jpg', 'jpeg', 'pdf', 'eps'];
export const FIGURES_FOLDER = 'figures';

const ext = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');
const stem = (name: string) => (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name);

export const isGraphicName = (name: string) => GRAPHIC_EXTENSIONS.includes(ext(name));

/** `name`, or `name-2.ext`, `name-3.ext`, … whichever is not in `taken` (case-insensitive, like sibling names). */
export function freeName(name: string, taken: string[]): string {
	const lower = new Set(taken.map((t) => t.toLowerCase()));
	if (!lower.has(name.toLowerCase())) return name;
	const dot = name.lastIndexOf('.');
	const [base, tail] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
	for (let n = 2; ; n++) if (!lower.has(`${base}-${n}${tail}`.toLowerCase())) return `${base}-${n}${tail}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `pasted-YYYYMMDD-HHMMSS.ext` in local time, for a clipboard image without a name of its own. */
export const pastedName = (at: Date, extension = 'png') =>
	`pasted-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}.${extension}`;

/** Extension for a clipboard image's MIME type; null when LaTeX can't include it. */
const TYPE_EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf' };
export const extensionForType = (type: string): string | null => TYPE_EXTENSIONS[type] ?? null;

/** `to` (a project path) relative to the folder `fromDir` ('' = the root), with `../` where needed. */
export function relativePath(fromDir: string, to: string): string {
	const from = fromDir ? fromDir.split('/') : [];
	const parts = to.split('/');
	let i = 0;
	while (i < from.length && i < parts.length - 1 && from[i] === parts[i]) i++;
	return [...from.slice(i).map(() => '..'), ...parts.slice(i)].join('/');
}

/** Folder part of a project path ('' at the root). */
export const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** A `\label` key from a file name: its stem with anything but letters, digits, `-` and `_` turned into `-`. */
export const labelFor = (name: string) => stem(name).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'figure';

/** What dropping project file `path` (relative to the main document) inserts; null for files LaTeX doesn't load
 *  by name. `biblatex`: the document uses biblatex, so a .bib becomes `\addbibresource` instead of `\bibliography`. */
export function referenceFor(path: string, biblatex = false): string | null {
	const e = ext(path);
	if (isGraphicName(path)) return `\\includegraphics{${path}}`;
	if (e === 'tex') return `\\input{${stem(path)}}`;
	if (e === 'bib') return biblatex ? `\\addbibresource{${path}}` : `\\bibliography{${stem(path)}}`;
	return null;
}

/** The document loads biblatex (comments ignored). */
export const usesBiblatex = (text: string) => loadedPackages(text).has('biblatex');

/** Packages loaded with `\usepackage` / `\RequirePackage`, outside comments. */
function loadedPackages(text: string): Set<string> {
	const out = new Set<string>();
	for (const m of stripComments(text).matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g))
		for (const p of m[1].split(',')) out.add(p.trim());
	return out;
}

/** `text` with every comment blanked (same length, so offsets stay valid). */
function stripComments(text: string) {
	return text
		.split('\n')
		.map((line) => {
			for (let i = 0; i < line.length; i++) {
				if (line[i] === '\\') i++;
				else if (line[i] === '%') return line.slice(0, i) + ' '.repeat(line.length - i);
			}
			return line;
		})
		.join('\n');
}

// classes that load graphicx themselves
const GRAPHICX_CLASSES = ['beamer'];

/** The edit that adds `\usepackage{…}` for each of `packages` the document doesn't load yet, on the line right
 *  after `\documentclass`; null when nothing is missing or the text has no `\documentclass`. */
export function packageEdit(text: string, packages: string[]): { at: number; insert: string; added: string[] } | null {
	const clean = stripComments(text);
	const cls = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(clean);
	if (!cls) return null;
	const loaded = loadedPackages(text);
	if (GRAPHICX_CLASSES.includes(cls[1].trim())) loaded.add('graphicx');
	const added = [...new Set(packages)].filter((p) => !loaded.has(p));
	if (!added.length) return null;
	const end = cls.index + cls[0].length;
	const eol = text.indexOf('\n', end);
	const at = eol < 0 ? text.length : eol;
	return { at, insert: added.map((p) => `\n\\usepackage{${p}}`).join(''), added };
}
