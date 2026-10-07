import { error, json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { forwardSearch, loadIndex } from '#lib/server/synctex.ts';
import { STALE_PDF } from '#lib/synctex.ts';
import type { RequestHandler } from './$types';

// Source → PDF (contracts/http-api.md); read-only, so readers navigate too (FR-024).
export const GET: RequestHandler = async ({ locals, params, url }) => {
	api(() => requireProject(locals, params.pid, 'read'));
	const q = url.searchParams;
	const line = Number(q.get('line'));
	if (!q.get('pdfId') || !q.get('fileId') || !Number.isInteger(line) || line < 1) error(400, 'expected ?pdfId&fileId&line');
	// a stale pdfId (someone compiled since) or no synctex: a message of its own, so the client can recompile (T052)
	const index = await loadIndex(params.pid, q.get('pdfId')!);
	if (!index) error(404, STALE_PDF);
	const r = forwardSearch(index, q.get('fileId')!, line);
	if (!r) error(404, 'no mapping for this line');
	return json(r);
};
