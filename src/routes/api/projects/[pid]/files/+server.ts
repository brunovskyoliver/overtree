import { error, json } from '@sveltejs/kit';
import { limits, type ProjectInfo } from '#lib/files.ts';
import { broadcast, canEdit, fileRoles, requireEditFiles, requireEditFolder, requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { createEntry, ensureFolder, findFolder, getMainFileId, listFiles, uploadFile } from '#lib/server/files.ts';
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
// 015: `folder` names a subfolder of `parentId` to upload into, created when missing (edit access on `parentId`
// then); `replace=rename` picks a free name instead of a clash.
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const { pid } = params;
	const { user } = api(() => requireProject(locals, pid, 'read'));
	if (request.headers.get('content-type')?.startsWith('multipart/form-data')) {
		const form = await request.formData().catch(() => error(400, 'expected multipart form data'));
		const file = form.get('file');
		let parentId = form.get('parentId') || null;
		const folder = form.get('folder');
		if (!(file instanceof File) || !(parentId === null || typeof parentId === 'string') || !(folder === null || typeof folder === 'string'))
			error(400, 'expected fields file, parentId, folder and replace');
		const replace = form.get('replace') === 'rename' ? 'rename' : form.get('replace') === '1';
		if (folder) {
			// refused uploads (too big) shouldn't leave an empty folder behind
			if (file.size > limits.uploadMaxFileMb * 1024 * 1024) error(413, `A file can be at most ${limits.uploadMaxFileMb} MB.`);
			const into = parentId;
			const found = api(() => findFolder(pid, into, folder));
			api(() => requireEditFolder(pid, user.id, found?.id ?? into));
			parentId = found?.id ?? api(() => ensureFolder(pid, into, folder, user.id)).id;
		}
		api(() => requireEditFolder(pid, user.id, parentId));
		const existing = replace === true && listFiles(pid).find((f) => f.parentId === parentId && f.name.toLowerCase() === file.name.toLowerCase());
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
