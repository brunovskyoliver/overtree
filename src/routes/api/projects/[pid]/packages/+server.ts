import { error, json } from '@sveltejs/kit';
import { requireEditFiles, requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { addPackages, getMainFileId } from '#lib/server/files.ts';
import type { RequestHandler } from './$types';

// 015: make sure the main document loads these packages (graphicx for a figure, booktabs for a table). Edit
// access on the main document; the edit goes through Yjs like any other. Responds { added: string[] }.
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const { user } = api(() => requireProject(locals, params.pid, 'read'));
	const body = await request.json().catch(() => null);
	const packages: unknown = body?.packages;
	if (!Array.isArray(packages) || !packages.every((p) => typeof p === 'string' && /^[A-Za-z0-9-]+$/.test(p)))
		error(400, 'expected { packages: string[] }');
	const main = getMainFileId(params.pid);
	if (!main) return json({ added: [] });
	api(() => requireEditFiles(params.pid, user.id, [main]));
	return json({ added: await addPackages(params.pid, packages, { userId: user.id, projectId: params.pid }) });
};
