import { json } from '@sveltejs/kit';
import { requireAdmin } from '#lib/server/access.ts';
import { updateUser } from '#lib/server/admin.ts';
import { api } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	api(() => requireAdmin(locals));
	const body = await request.json().catch(() => null);
	return json(api(() => updateUser(params.id, { role: body?.role, disabled: body?.disabled })));
};
