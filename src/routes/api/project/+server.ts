import { error, json } from '@sveltejs/kit';
import { api } from '#lib/server/api.ts';
import { getMainFileId, setMainFile } from '#lib/server/files.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json({ mainFileId: getMainFileId() });

export const PUT: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (typeof body?.mainFileId !== 'string') error(400, 'expected { mainFileId: string }');
	api(() => setMainFile(body.mainFileId));
	return new Response(null, { status: 204 });
};
