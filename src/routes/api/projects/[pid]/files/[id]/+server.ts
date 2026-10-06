import { error, json } from '@sveltejs/kit';
import { broadcast, requireEditFiles, requireEditFolder, requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { deleteEntry, renameOrMove } from '#lib/server/files.ts';
import { kickOverridden } from '#lib/server/projects.ts';
import type { RequestHandler } from './$types';

// Rename and move need edit access on the item and its descendants, a move also on the destination (research R10).
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const { pid, id } = params;
	const { user } = api(() => requireProject(locals, pid, 'read'));
	const body = await request.json().catch(() => null);
	const { name, parentId } = body ?? {};
	if (
		!body ||
		(name !== undefined && typeof name !== 'string') ||
		(parentId !== undefined && parentId !== null && typeof parentId !== 'string')
	)
		error(400, 'expected { name?: string, parentId?: string | null }');
	api(() => requireEditFiles(pid, user.id, [id]));
	if (parentId !== undefined) api(() => requireEditFolder(pid, user.id, parentId));
	const entry = api(() => renameOrMove(pid, id, { name, parentId }));
	broadcast(pid, { type: 'tree' });
	// ponytail: any move re-authenticates everyone with overrides; per-file diffing if moves get frequent
	if (parentId !== undefined) kickOverridden(pid);
	return json(entry);
};

export const DELETE: RequestHandler = ({ locals, params }) => {
	const { pid, id } = params;
	const { user } = api(() => requireProject(locals, pid, 'read'));
	api(() => requireEditFiles(pid, user.id, [id]));
	api(() => deleteEntry(pid, id));
	broadcast(pid, { type: 'tree' });
	return new Response(null, { status: 204 });
};
