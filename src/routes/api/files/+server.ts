import { error, json } from '@sveltejs/kit';
import type { ProjectInfo } from '#lib/files.ts';
import { api } from '#lib/server/api.ts';
import { createEntry, getMainFileId, listFiles, uploadFile } from '#lib/server/files.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json({ files: listFiles(), mainFileId: getMainFileId() } satisfies ProjectInfo);

// JSON: create a folder or an empty text file. Multipart: upload one file (contracts/files-api.md).
export const POST: RequestHandler = async ({ request }) => {
	if (request.headers.get('content-type')?.startsWith('multipart/form-data')) {
		const form = await request.formData().catch(() => error(400, 'expected multipart form data'));
		const file = form.get('file');
		const parentId = form.get('parentId') || null;
		if (!(file instanceof File) || !(parentId === null || typeof parentId === 'string'))
			error(400, 'expected fields file, parentId and replace');
		const bytes = new Uint8Array(await file.arrayBuffer());
		const { entry, replaced } = await api(() => uploadFile(parentId, file.name, bytes, form.get('replace') === '1'));
		return json(entry, { status: replaced ? 200 : 201 });
	}
	const body = await request.json().catch(() => null);
	const parentId = body?.parentId ?? null;
	if (!['folder', 'text'].includes(body?.kind) || typeof body.name !== 'string' || !(parentId === null || typeof parentId === 'string'))
		error(400, 'expected { kind: "folder" | "text", name: string, parentId: string | null }');
	return json(
		api(() => createEntry({ kind: body.kind, name: body.name, parentId })),
		{ status: 201 }
	);
};
