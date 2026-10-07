import { error, json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { forward } from '#lib/server/synctex.ts';
import type { RequestHandler } from './$types';

// Source → PDF (contracts/http-api.md); read-only, so readers navigate too (FR-024).
export const GET: RequestHandler = async ({ locals, params, url }) => {
	api(() => requireProject(locals, params.pid, 'read'));
	const q = url.searchParams;
	const line = Number(q.get('line'));
	if (!q.get('pdfId') || !q.get('fileId') || !Number.isInteger(line) || line < 1) error(400, 'expected ?pdfId&fileId&line');
	const r = await forward(params.pid, q.get('pdfId')!, q.get('fileId')!, line);
	if (!r) error(404, 'no mapping for this line; recompile to sync');
	return json(r);
};
