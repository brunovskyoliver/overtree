import { json } from '@sveltejs/kit';
import { colorFor } from '#lib/presence.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	const { id, email, name, avatarUrl, role } = locals.user!;
	return json({ id, email, name, avatarUrl, role, color: colorFor(id) });
};
