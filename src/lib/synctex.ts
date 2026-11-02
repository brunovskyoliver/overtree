import type { CompileState } from './compile.svelte.ts';

// Client side of SyncTeX navigation (contracts/http-api.md "Compile additions"). Plain functions so the project page
// and the separate PDF window can share them; null when the server has no mapping (404) or the request failed,
// 'stale' when `pdfId` isn't the server's last PDF (a collaborator compiled) or that PDF has no synctex.

/** A rectangle in PDF points from the page's top-left. */
export type SyncBox = { x: number; y: number; width: number; height: number };
/** Source → PDF answer. */
export type SyncPdf = { page: number; boxes: SyncBox[] };
/** PDF → source answer. */
export type SyncCode = { fileId: string; line: number };

/** The 404 message of the sync routes for a `pdfId` that isn't the last PDF, or a PDF without synctex. */
export const STALE_PDF = 'stale pdfId; recompile to sync';
/** Shown when the PDF still can't be mapped after reloading the compile state. */
export const RECOMPILE_TO_SYNC = 'Recompile to sync';

type Answer<T> = T | 'stale' | null;

async function get<T>(url: string): Promise<Answer<T>> {
	const res = await fetch(url).catch(() => undefined);
	if (res?.ok) return res.json();
	if (res?.status !== 404) return null;
	const body: { message?: string } | null = await res.json().catch(() => null);
	return body?.message === STALE_PDF ? 'stale' : null;
}

/** Ask against the last compile's PDF; when that is stale, reload the compile state (a collaborator's newer PDF
 *  shows up) and ask once more. 'stale' when it still has no mapping: the caller says "Recompile to sync". */
export async function syncWith<T>(compile: CompileState, ask: (pdfId: string) => Promise<Answer<T>>): Promise<Answer<T>> {
	const pdfId = compile.last?.pdfId;
	if (!pdfId) return null;
	const r = await ask(pdfId);
	if (r !== 'stale') return r;
	await compile.load().catch(() => {});
	const next = compile.last?.pdfId;
	return next && next !== pdfId ? ask(next) : 'stale';
}

/** Where `line` of `fileId` is in the PDF `pdfId` (the last compile's; `root`: a standalone document's). */
export function syncToPdf(projectId: string, pdfId: string, fileId: string, line: number, root?: string | null) {
	const q = new URLSearchParams({ pdfId, fileId, line: String(line), ...(root && { root }) });
	return get<SyncPdf>(`/api/projects/${projectId}/compile/sync/code?${q}`);
}

/** Where `word` (double-clicked in the PDF) is in `text` near its 1-based `line`: SyncTeX only knows the line, and a
 *  paragraph's words can sit a few lines from the one it reports. Nearest line first, then below before above.
 *  ponytail: the first match in a line; a word twice in one line gets the first. Offsets into `text`. */
export function wordNear(text: string, line: number, word: string): { from: number; to: number } | undefined {
	word = word.normalize('NFKC').replace(/-$/, ''); // a ligature or a word hyphenated at the line end
	if (!word) return;
	const re = new RegExp(`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u');
	const lines = text.split('\n');
	const starts = [0];
	for (const l of lines) starts.push(starts.at(-1)! + l.length + 1);
	for (const d of [0, 1, -1, 2, -2, 3, -3]) {
		const i = line - 1 + d;
		const m = i >= 0 && i < lines.length ? re.exec(lines[i]) : null;
		if (m) return { from: starts[i] + m.index, to: starts[i] + m.index + word.length };
	}
}

/** Which project file and line produced the point (x, y) of `page` in the PDF `pdfId`. */
export function syncToCode(projectId: string, pdfId: string, page: number, x: number, y: number, root?: string | null) {
	const q = new URLSearchParams({ pdfId, page: String(page), x: String(x), y: String(y), ...(root && { root }) });
	return get<SyncCode>(`/api/projects/${projectId}/compile/sync/pdf?${q}`);
}
