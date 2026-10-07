import { error, json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { reverse } from '#lib/server/synctex.ts';
import type { RequestHandler } from './$types';

// PDF → source (contracts/http-api.md): x, y in PDF points from the page's top-left. 404 when the spot comes from no
// project file (a TeX Live package, the .bbl): the client then does nothing (US3 #6).
export const GET: RequestHandler = async ({ locals, params, url }) => {
	api(() => requireProject(locals, params.pid, 'read'));
	const q = url.searchParams;
	const [page, x, y] = ['page', 'x', 'y'].map((k) => Number(q.get(k) ?? NaN));
	if (!q.get('pdfId') || !Number.isInteger(page) || page < 1 || !Number.isFinite(x) || !Number.isFinite(y)) error(400, 'expected ?pdfId&page&x&y');
	const r = await reverse(params.pid, q.get('pdfId')!, page, x, y);
	if (!r) error(404, 'nothing in the project maps to this spot');
	return json(r);
};
