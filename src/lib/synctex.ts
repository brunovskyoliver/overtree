// Client side of SyncTeX navigation (contracts/http-api.md "Compile additions"). Plain functions so the project page
// and the separate PDF window can share them; null when the server has no mapping (404) or the request failed.

/** A rectangle in PDF points from the page's top-left. */
export type SyncBox = { x: number; y: number; width: number; height: number };
/** Source → PDF answer. */
export type SyncPdf = { page: number; boxes: SyncBox[] };
/** PDF → source answer. */
export type SyncCode = { fileId: string; line: number };

async function get<T>(url: string): Promise<T | null> {
	const res = await fetch(url).catch(() => undefined);
	return res?.ok ? res.json() : null;
}

/** Where `line` of `fileId` is in the PDF `pdfId` (the last compile's). */
export function syncToPdf(projectId: string, pdfId: string, fileId: string, line: number) {
	const q = new URLSearchParams({ pdfId, fileId, line: String(line) });
	return get<SyncPdf>(`/api/projects/${projectId}/compile/sync/code?${q}`);
}

/** Which project file and line produced the point (x, y) of `page` in the PDF `pdfId`. */
export function syncToCode(projectId: string, pdfId: string, page: number, x: number, y: number) {
	const q = new URLSearchParams({ pdfId, page: String(page), x: String(x), y: String(y) });
	return get<SyncCode>(`/api/projects/${projectId}/compile/sync/pdf?${q}`);
}
