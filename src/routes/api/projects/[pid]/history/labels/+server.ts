import { error, json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { addLabel } from '#lib/server/history.ts';
import type { RequestHandler } from './$types';

/** `{ versionId?: number, name }` → 201 `Label`; without `versionId` the current state is labeled. Editors and the
 *  owner. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const { user } = api(() => requireProject(locals, params.pid, 'edit'));
	const body = await request.json().catch(() => ({}));
	const versionId = body?.versionId;
	if (versionId !== undefined && !Number.isInteger(versionId)) error(400, 'expected { versionId?: number, name: string }');
	return json(api(() => addLabel(params.pid, user.id, { versionId, name: body?.name })), { status: 201 });
};
