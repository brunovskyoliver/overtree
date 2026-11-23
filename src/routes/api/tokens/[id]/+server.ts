import { requireUser } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { revokeToken } from '#lib/server/tokens.ts';
import type { RequestHandler } from './$types';

/** Revokes one of the user's tokens; 404 for anyone else's. */
export const DELETE: RequestHandler = ({ locals, params }) => {
	const user = api(() => requireUser(locals));
	api(() => revokeToken(user.id, params.id));
	return new Response(null, { status: 204 });
};
