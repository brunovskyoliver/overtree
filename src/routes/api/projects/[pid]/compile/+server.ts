import { error, json } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { compileProject, compileRoot, getCompiler, getLastResult } from '#lib/server/compile.ts';
import { closeVersion } from '#lib/server/history.ts';
import type { RequestHandler } from './$types';

/** `?root=<file id>`: the last compile of that standalone document instead of the main one. */
export const GET: RequestHandler = ({ locals, params, url }) => {
	const root = api(() => (requireProject(locals, params.pid, 'read'), compileRoot(params.pid, url.searchParams.get('root'))));
	return json({ compiler: getCompiler(params.pid), last: getLastResult(params.pid, root) });
};

// Readers may compile too (FR-037). Blocks until the compile (or the queued one it joined) finishes; compile
// problems are statuses, not 5xx. Edits since the last version become a compile-point version first (FR-002); the
// requester isn't an author unless they changed something. `root`: a standalone .tex to compile instead of the main one.
export const POST: RequestHandler = async ({ locals, params, request }) => {
	api(() => requireProject(locals, params.pid, 'read'));
	const body = await request.json().catch(() => null);
	if (typeof body?.stopOnFirstError !== 'boolean') error(400, 'expected { stopOnFirstError: boolean, root?: string }');
	const root = api(() => compileRoot(params.pid, body.root));
	closeVersion(params.pid, 'compile');
	return json(await compileProject(params.pid, { stopOnFirstError: body.stopOnFirstError }, root));
};
