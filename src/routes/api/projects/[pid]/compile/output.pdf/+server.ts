import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { error } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api, attrChars } from '#lib/server/api.ts';
import { compileDir, pdfName } from '#lib/server/compile.ts';
import type { RequestHandler } from './$types';

// `?id=` only busts caches; there is one stored PDF per project.
export const GET: RequestHandler = async ({ locals, params, url }) => {
	api(() => requireProject(locals, params.pid, 'read'));
	const pdf = await readFile(join(compileDir(params.pid), 'output.pdf')).catch(() => error(404, 'no PDF yet'));
	const headers: Record<string, string> = { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-cache' };
	if (url.searchParams.has('download')) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${attrChars(pdfName(params.pid))}`;
	return new Response(pdf, { headers });
};
