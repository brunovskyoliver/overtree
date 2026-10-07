import { json } from '@sveltejs/kit';
import { colorFor } from '#lib/presence.ts';
import { requireUser } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { githubConfig } from '#lib/server/github/config.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => {
	const { id, email, name, avatarUrl, role } = api(() => requireUser(locals));
	// 012 FR-004: the UI hides GitHub entirely when the integration isn't configured
	return json({ id, email, name, avatarUrl, role, color: colorFor(id), github: githubConfig() ? { configured: true } : null });
};
