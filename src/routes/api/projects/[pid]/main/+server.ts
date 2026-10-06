import { error } from '@sveltejs/kit';
import { broadcast, requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { setMainFile } from '#lib/server/files.ts';
import type { RequestHandler } from './$types';

// Edit access on the project root (contracts/http-api.md).
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	api(() => requireProject(locals, params.pid, 'edit'));
	const body = await request.json().catch(() => null);
	if (typeof body?.fileId !== 'string') error(400, 'expected { fileId: string }');
	api(() => setMainFile(params.pid, body.fileId));
	broadcast(params.pid, { type: 'project' });
	return new Response(null, { status: 204 });
};
