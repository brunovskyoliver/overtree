import { json } from '@sveltejs/kit';
import { requireAdmin } from '#lib/server/access.ts';
import { getSettings, putSettings } from '#lib/server/admin.ts';
import { api } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	api(() => requireAdmin(locals));
	return json(getSettings());
};

export const PUT: RequestHandler = async ({ locals, request }) => {
	api(() => requireAdmin(locals));
	const body = await request.json().catch(() => null);
	return json(api(() => putSettings(body)));
};
