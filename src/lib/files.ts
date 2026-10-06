// File rules shared by the browser and the server (data-model.md, research R5).
// Plain erasable TypeScript: server.ts loads this through src/lib/server/files.ts without a build step.

export type FileKind = 'folder' | 'text' | 'binary';
export type FileEntry = {
	id: string;
	parentId: string | null;
	name: string;
	kind: FileKind;
	size?: number;
	updatedAt: number;
	/** from `GET /api/projects/:pid/files`: the caller may edit this entry (005 research R10) */
	canEdit?: boolean;
};
export type ProjectInfo = { files: FileEntry[]; mainFileId: string | null };

// spec FR-006
export const TEXT_EXTENSIONS = [
	'tex', 'bib', 'cls', 'sty', 'md', 'txt', 'bst', 'bbx', 'cbx', 'lbx', 'clo', 'def', 'cfg', 'dtx', 'ins',
	'tikz', 'pgf', 'csv', 'tsv', 'dat', 'ltx', 'latex', 'bbl', 'json', 'yaml', 'yml', 'lua', 'py', 'r'
];
export const PREVIEW_IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];

const ext = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');

export const kindForName = (name: string): 'text' | 'binary' => (TEXT_EXTENSIONS.includes(ext(name)) ? 'text' : 'binary');

export const isLatexName = (name: string) => ['tex', 'cls', 'sty'].includes(ext(name));

/** What the tree icon and the tab show for an entry. */
export type FileType = 'folder' | 'text' | 'image' | 'pdf' | 'other';
export const fileType = (f: Pick<FileEntry, 'name' | 'kind'>): FileType =>
	f.kind !== 'binary' ? f.kind : PREVIEW_IMAGE.includes(ext(f.name)) ? 'image' : ext(f.name) === 'pdf' ? 'pdf' : 'other';

/** The user-facing problem with `name` among `siblings`, or null when it's fine. */
export function validateName(name: string, siblings: string[]): string | null {
	if (!name) return 'Name must not be empty.';
	if (name.length > 255) return 'Name must be at most 255 characters.';
	if (/[/\\]/.test(name)) return 'Name must not contain / or \\.';
	if (/[\x00-\x1f\x7f]/.test(name)) return 'Name must not contain control characters.';
	if (name === '.' || name === '..') return 'Name must not be . or ..';
	const lower = name.toLowerCase();
	if (siblings.some((s) => s.toLowerCase() === lower)) return `"${name}" already exists here.`;
	return null;
}

/** Slash-separated path from the root, e.g. 'chapters/intro.tex'. */
export function pathOf(id: string, files: FileEntry[]): string {
	const byId = new Map(files.map((f) => [f.id, f]));
	const parts: string[] = [];
	for (let f = byId.get(id); f; f = f.parentId ? byId.get(f.parentId) : undefined) parts.unshift(f.name);
	return parts.join('/');
}

/** Folders first, then by name, locale-aware and case-insensitive. */
export const sortEntries = (a: FileEntry, b: FileEntry) =>
	(a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

// Read on the server only; in the browser `process` doesn't exist and nothing reads these.
const envNumber = (name: string, fallback: number) => Number(globalThis.process?.env[name] || fallback);
export const limits = {
	get uploadMaxFileMb() {
		return envNumber('UPLOAD_MAX_FILE_MB', 50);
	},
	get importMaxMb() {
		return envNumber('IMPORT_MAX_MB', 200);
	},
	get projectMaxFiles() {
		return envNumber('PROJECT_MAX_FILES', 2000);
	}
};
