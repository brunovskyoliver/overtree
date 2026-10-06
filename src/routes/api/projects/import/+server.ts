import { error, json } from '@sveltejs/kit';
import { api } from '#lib/server/api.ts';
import { importZipAsProject } from '#lib/server/zip.ts';
import type { RequestHandler } from './$types';

/** Multipart `file` (a zip) and optional `title` (default: the zip's name without `.zip`) → 201 `{ id }`. */
export const POST: RequestHandler = async ({ locals, request }) => {
	const form = await request.formData().catch(() => error(400, 'expected multipart form data'));
	const file = form.get('file');
	if (!(file instanceof File)) error(400, 'expected a field file');
	const given = form.get('title');
	const title =
		typeof given === 'string' && given.trim()
			? given
			: file.name
					.replace(/\.zip$/i, '')
					.slice(0, 120)
					.trim() || 'Untitled project';
	const bytes = new Uint8Array(await file.arrayBuffer());
	const id = api(() => importZipAsProject(locals.user!.id, title, bytes));
	return json({ id }, { status: 201 });
};
