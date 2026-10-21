import { error, json } from '@sveltejs/kit';
import { requireUser } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { connectZotero, disconnectZotero, zoteroAccount } from '#lib/server/references/zotero.ts';
import type { RequestHandler } from './$types';

// The signed-in user's Zotero connection (017 US2): never the API key.
export const GET: RequestHandler = ({ locals }) => {
	const user = api(() => requireUser(locals));
	return json(zoteroAccount(user.id));
};

/** `{ userId, apiKey }`: checked with Zotero, then stored sealed. */
export const PUT: RequestHandler = async ({ locals, request }) => {
	const user = api(() => requireUser(locals));
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') error(400, 'expected { userId, apiKey }');
	return json(await api(() => connectZotero(user.id, body)));
};

export const DELETE: RequestHandler = ({ locals }) => {
	const user = api(() => requireUser(locals));
	disconnectZotero(user.id);
	return new Response(null, { status: 204 });
};
