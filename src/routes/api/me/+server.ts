import { json } from '@sveltejs/kit';
import { colorFor } from '#lib/presence.ts';
import { requireUser } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	const { id, email, name, avatarUrl, role } = api(() => requireUser(locals));
	return json({ id, email, name, avatarUrl, role, color: colorFor(id) });
};
