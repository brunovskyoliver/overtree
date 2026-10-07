import { error, json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { restoreVersion } from '#lib/server/restore.ts';
import type { RequestHandler } from './$types';

/** `{ fileId?: string }` → `{ version, skipped }` (contracts/http-api.md): one file, or the whole project without
 *  `fileId`. Editors and the owner; per-file roles are checked by restoreVersion. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const { user } = api(() => requireProject(locals, params.pid, 'edit'));
	const body = await request.json().catch(() => ({}));
	const fileId = body?.fileId;
	if (fileId !== undefined && typeof fileId !== 'string') error(400, 'expected { fileId?: string }');
	// the new version's `history` event and the `tree` event come from restoreVersion
	return json(await api(() => restoreVersion(params.pid, Number(params.vid), user.id, fileId)));
};
