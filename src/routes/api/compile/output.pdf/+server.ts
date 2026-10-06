import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { error } from '@sveltejs/kit';
import { attrChars } from '#lib/server/api.ts';
import { compileDir, pdfName } from '#lib/server/compile.ts';
import type { RequestHandler } from './$types';

// `?id=` only busts caches; there is one stored PDF.
export const GET: RequestHandler = async ({ url }) => {
	const pdf = await readFile(join(compileDir(), 'output.pdf')).catch(() => error(404, 'no PDF yet'));
	const headers: Record<string, string> = { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-cache' };
	if (url.searchParams.has('download')) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${attrChars(pdfName())}`;
	return new Response(pdf, { headers });
};
