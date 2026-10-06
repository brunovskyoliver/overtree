import { error, json } from '@sveltejs/kit';
import { api } from '#lib/server/api.ts';
import { exportZip, importZip } from '#lib/server/zip.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () =>
	new Response(Buffer.from(await exportZip()), {
		headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="project.zip"' }
	});

// Replaces the whole project; the client asked for confirmation (contracts/files-api.md)
export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData().catch(() => error(400, 'expected multipart form data'));
	const file = form.get('file');
	if (!(file instanceof File)) error(400, 'expected a field file');
	const bytes = new Uint8Array(await file.arrayBuffer());
	return json(api(() => importZip(bytes)));
};
