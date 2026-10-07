import { error, json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { compileRoot } from '#lib/server/compile.ts';
import { loadIndex, reverseSearch } from '#lib/server/synctex.ts';
import { STALE_PDF } from '#lib/synctex.ts';
import type { RequestHandler } from './$types';

// PDF → source (contracts/http-api.md): x, y in PDF points from the page's top-left. 404 when the spot comes from no
// project file (a TeX Live package, the .bbl): the client then does nothing (US3 #6);
// a stale `pdfId` or no synctex is a 404 with STALE_PDF.
export const GET: RequestHandler = async ({ locals, params, url }) => {
	const root = api(() => (requireProject(locals, params.pid, 'read'), compileRoot(params.pid, url.searchParams.get('root'))));
	const q = url.searchParams;
	const [page, x, y] = ['page', 'x', 'y'].map((k) => Number(q.get(k) ?? NaN));
	if (!q.get('pdfId') || !Number.isInteger(page) || page < 1 || !Number.isFinite(x) || !Number.isFinite(y)) error(400, 'expected ?pdfId&page&x&y');
	const index = await loadIndex(params.pid, q.get('pdfId')!, root);
	if (!index) error(404, STALE_PDF);
	const r = reverseSearch(index, page, x, y);
	if (!r) error(404, 'nothing in the project maps to this spot');
	return json(r);
};
