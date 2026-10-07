import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import picomatch from 'picomatch';
import type { FileKind } from '../../files.ts';
import { getServer } from '../collab.ts';
import { putBlob, readBlob } from '../files.ts';
import { currentText, manifestPaths } from '../history.ts';
import { files, githubLinks } from '../schema.ts';

// Project paths as git sees them (research R7, R8): git blob SHAs, the "not pulled" filter and the stored base map.
// Loaded unbundled by server.ts in production: no SvelteKit imports here.

const db = () => getServer().db;

/** git's blob id: sha1("blob <len>\0" + bytes). */
export function gitBlobSha(bytes: Uint8Array): string {
	return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

// Binary rows carry their sha256 content hash: their git SHA is computed once per content and remembered.
// ponytail: bounded by dropping the whole cache at SHA_CACHE_MAX entries, no LRU.
const SHA_CACHE_MAX = 20_000;
const shaByHash = new Map<string, string>();
function binarySha(hash: string): string {
	let sha = shaByHash.get(hash);
	if (!sha) {
		if (shaByHash.size >= SHA_CACHE_MAX) shaByHash.clear();
		sha = gitBlobSha(readBlob(hash));
		shaByHash.set(hash, sha);
	}
	return sha;
}

export type ProjectFile = {
	id: string;
	kind: Exclude<FileKind, 'folder'>;
	/** Content hash of a binary (Overtree blob); null for texts. */
	hash: string | null;
	bytes(): Buffer;
	sha(): string;
};

/** The project's files by path (folders omitted: git has none, R8). Contents and SHAs are read on first use: a text
 *  from its live document or stored state, a binary from the blob store (its SHA cached by content hash). */
export function projectFiles(pid: string): Map<string, ProjectFile> {
	const rows = db()
		.select({ id: files.id, parentId: files.parentId, name: files.name, kind: files.kind, hash: files.hash })
		.from(files)
		.where(eq(files.projectId, pid))
		.all();
	const paths = manifestPaths(rows);
	const out = new Map<string, ProjectFile>();
	for (const r of rows) {
		if (r.kind === 'folder') continue;
		if (r.kind === 'binary') {
			const hash = r.hash!;
			out.set(paths.get(r.id)!, { id: r.id, kind: 'binary', hash, bytes: () => readBlob(hash), sha: () => binarySha(hash) });
			continue;
		}
		let bytes: Buffer | undefined;
		let sha: string | undefined;
		const read = () => (bytes ??= Buffer.from(currentText(r.id), 'utf8'));
		out.set(paths.get(r.id)!, { id: r.id, kind: 'text', hash: null, bytes: read, sha: () => (sha ??= gitBlobSha(read())) });
	}
	return out;
}

// --- filters (research R8) ------------------------------------------------------------------------------------------

/** "`X.pdf` when `X.tex` is in the same folder": the CI workflow's output (R8). */
export const COMPILE_OUTPUT_PDF = '<compile-output-pdf>';

export const DEFAULT_IGNORE = [
	'.github/**',
	'**/*.aux',
	'**/*.log',
	'**/*.out',
	'**/*.toc',
	'**/*.fls',
	'**/*.fdb_latexmk',
	'**/*.synctex.gz',
	'**/*.bbl',
	'**/*.blg',
	COMPILE_OUTPUT_PDF
];

// picomatch rather than node:path matchesGlob: matchesGlob has no `dot` option, so `**/*.aux` misses `.x/a.aux`,
// and it was still experimental on some Node 24 releases (the image's runtime).
const matchers = new Map<string, (path: string) => boolean>();
function globMatcher(patterns: string[]) {
	const key = JSON.stringify(patterns);
	let m = matchers.get(key);
	if (!m) {
		const globs = patterns.filter((p) => p !== COMPILE_OUTPUT_PDF && p.trim());
		m = globs.length ? picomatch(globs, { dot: true }) : () => false;
		if (matchers.size > 200) matchers.clear(); // one entry per distinct pattern list
		matchers.set(key, m);
	}
	return m;
}

/** A filter over `patterns` for one comparison; `allPaths` is the union of both sides (project and GitHub tree, or
 *  base map), against which `<compile-output-pdf>` looks for the `.tex` next to a PDF. */
export function ignoreFilter(patterns: string[], allPaths: Iterable<string>): (path: string) => boolean {
	const glob = globMatcher(patterns);
	const pdfRule = patterns.includes(COMPILE_OUTPUT_PDF);
	const all = pdfRule ? new Set(allPaths) : null;
	return (path) => glob(path) || (!!all && /\.pdf$/i.test(path) && all.has(`${path.slice(0, -4)}.tex`));
}

/** Whether `path` is "not pulled" (and never pushed): one-off form of `ignoreFilter`. */
export const isIgnored = (path: string, patterns: string[], allPaths: Iterable<string>) => ignoreFilter(patterns, allPaths)(path);

// --- base map (research R7) -----------------------------------------------------------------------------------------

/** The synced state at `base_commit`: path → git blob SHA, plus the Overtree blob of the text for diff3 (`hash`,
 *  absent for entries of the first sync). */
export type BaseMap = Record<string, { sha: string; hash?: string }>;

/** The link's base map; empty before the first sync. */
export function readBase(link: Pick<typeof githubLinks.$inferSelect, 'baseFiles'>): BaseMap {
	return link.baseFiles ? (JSON.parse(readBlob(link.baseFiles).toString('utf8')) as BaseMap) : {};
}

/** Stores `map` as a blob (content-addressed, keys sorted) and returns its hash for `github_links.base_files`. */
export function writeBase(map: BaseMap): string {
	const sorted = Object.fromEntries(Object.keys(map).sort().map((k) => [k, map[k]]));
	return putBlob(Buffer.from(JSON.stringify(sorted), 'utf8'));
}
