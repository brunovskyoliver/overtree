import { error, json } from '@sveltejs/kit';
import { api } from '#lib/server/api.ts';
import { deleteEntry, renameOrMove } from '#lib/server/files.ts';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = await request.json().catch(() => null);
	const { name, parentId } = body ?? {};
	if (
		!body ||
		(name !== undefined && typeof name !== 'string') ||
		(parentId !== undefined && parentId !== null && typeof parentId !== 'string')
	)
		error(400, 'expected { name?: string, parentId?: string | null }');
	return json(api(() => renameOrMove(params.id, { name, parentId })));
};

export const DELETE: RequestHandler = ({ params }) => {
	api(() => deleteEntry(params.id));
	return new Response(null, { status: 204 });
};
