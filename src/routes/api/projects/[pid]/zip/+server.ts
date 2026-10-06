import { requireProject } from '#lib/server/access.ts';
import { api, attrChars } from '#lib/server/api.ts';
import { getProject } from '#lib/server/projects.ts';
import { exportZip } from '#lib/server/zip.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	api(() => requireProject(locals, params.pid, 'read'));
	const name = `${getProject(params.pid)!.title.replace(/[/\\]/g, '-')}.zip`;
	return new Response(Buffer.from(await exportZip(params.pid)), {
		headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename*=UTF-8''${attrChars(name)}` }
	});
};
