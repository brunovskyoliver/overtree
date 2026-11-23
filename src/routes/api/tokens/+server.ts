import { error, json } from '@sveltejs/kit';
import { requireUser } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { createToken, listTokens } from '#lib/server/tokens.ts';
import type { RequestHandler } from './$types';

// The signed-in user's agent access tokens (MCP): never the token text or its hash, except once on creation.
export const GET: RequestHandler = ({ locals }) => json({ tokens: listTokens(api(() => requireUser(locals)).id) });

/** `{ name, projectId? }` → 201 `{ token, info }`; 422 bad name, 404 project out of reach, 409 at the cap. */
export const POST: RequestHandler = async ({ locals, request }) => {
	const user = api(() => requireUser(locals));
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') error(400, 'expected { name, projectId? }');
	return json(api(() => createToken(user.id, body)), { status: 201 });
};
