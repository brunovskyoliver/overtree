import { error } from '@sveltejs/kit';
import { requireProject } from '#lib/server/access.ts';
import { api, attrChars } from '#lib/server/api.ts';
import { getVersion, readManifest, versionRow } from '#lib/server/history.ts';
import { getProject } from '#lib/server/projects.ts';
import { manifestZip } from '#lib/server/zip.ts';
import type { RequestHandler } from './$types';

/** The project at version `vid` as a zip (research R7), `<title>-<first label or UTC date>.zip`; every member. */
export const GET: RequestHandler = ({ locals, params }) => {
	const { user } = api(() => requireProject(locals, params.pid, 'read'));
	const v = versionRow(params.pid, Number(params.vid));
	if (!v) error(404, 'Version not found.');
	const when =
		getVersion(params.pid, v, user.id).labels[0]?.name ??
		new Date(v.createdAt).toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
	const name = `${getProject(params.pid)!.title}-${when}.zip`.replace(/[/\\]/g, '-');
	return new Response(Buffer.from(manifestZip(readManifest(v.manifestHash))), {
		headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename*=UTF-8''${attrChars(name)}` }
	});
};
