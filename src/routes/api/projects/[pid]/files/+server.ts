import { error, json } from '@sveltejs/kit';
import type { ProjectInfo } from '#lib/files.ts';
import { broadcast, canEdit, fileRoles, requireEditFiles, requireEditFolder, requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { createEntry, getMainFileId, listFiles, uploadFile } from '#lib/server/files.ts';
import type { RequestHandler } from './$types';

// Each entry says whether the caller may edit it (lock icons, read-only editors: research R10).
export const GET: RequestHandler = ({ locals, params }) => {
	const { user } = api(() => requireProject(locals, params.pid, 'read'));
	const { roleOf } = fileRoles(params.pid, user.id);
	const files = listFiles(params.pid).map((f) => ({ ...f, canEdit: canEdit(roleOf(f.id)) }));
	return json({ files, mainFileId: getMainFileId(params.pid) } satisfies ProjectInfo);
};

// JSON: create a folder or an empty text file. Multipart: upload one file (contracts/files-api.md).
// Edit access on the target folder; replacing a file also needs edit access on that file.
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const { pid } = params;
	const { user } = api(() => requireProject(locals, pid, 'read'));
	if (request.headers.get('content-type')?.startsWith('multipart/form-data')) {
		const form = await request.formData().catch(() => error(400, 'expected multipart form data'));
		const file = form.get('file');
		const parentId = form.get('parentId') || null;
		if (!(file instanceof File) || !(parentId === null || typeof parentId === 'string'))
			error(400, 'expected fields file, parentId and replace');
		const replace = form.get('replace') === '1';
		api(() => requireEditFolder(pid, user.id, parentId));
		const existing = replace && listFiles(pid).find((f) => f.parentId === parentId && f.name.toLowerCase() === file.name.toLowerCase());
		if (existing) api(() => requireEditFiles(pid, user.id, [existing.id]));
		const bytes = new Uint8Array(await file.arrayBuffer());
		const { entry, replaced } = await api(() => uploadFile(pid, parentId, file.name, bytes, replace, user.id));
		broadcast(pid, { type: 'tree' });
		return json(entry, { status: replaced ? 200 : 201 });
	}
	const body = await request.json().catch(() => null);
	const parentId = body?.parentId ?? null;
	if (!['folder', 'text'].includes(body?.kind) || typeof body.name !== 'string' || !(parentId === null || typeof parentId === 'string'))
		error(400, 'expected { kind: "folder" | "text", name: string, parentId: string | null }');
	api(() => requireEditFolder(pid, user.id, parentId));
	const entry = api(() => createEntry(pid, { kind: body.kind, name: body.name, parentId }, user.id));
	broadcast(pid, { type: 'tree' });
	return json(entry, { status: 201 });
};
