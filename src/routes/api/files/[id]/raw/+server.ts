import { error } from '@sveltejs/kit';
import { api } from '#lib/server/api.ts';
import { getFile, getText, readBlob } from '#lib/server/files.ts';
import type { RequestHandler } from './$types';

const MEDIA: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	svg: 'image/svg+xml',
	webp: 'image/webp',
	pdf: 'application/pdf'
};

// RFC 5987: encodeURIComponent leaves ' ( ) * as they are
const attrChars = (s: string) => encodeURIComponent(s).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// research R14: nosniff always, SVG sandboxed so scripts inside can't run
export const GET: RequestHandler = async ({ params, url }) => {
	const file = api(() => getFile(params.id));
	if (file.kind === 'folder') error(404, 'File not found.');
	const type =
		file.kind === 'text' ? 'text/plain; charset=utf-8' : (MEDIA[file.name.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream');
	const headers: Record<string, string> = { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' };
	if (type === 'image/svg+xml') headers['Content-Security-Policy'] = 'sandbox';
	if (url.searchParams.has('download')) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${attrChars(file.name)}`;
	const body = file.kind === 'text' ? await getText(file.id) : new Uint8Array(readBlob(file.hash!));
	return new Response(body, { headers });
};
