import { redirect } from '@sveltejs/kit';
import { joinByLink, projectByLink } from '#lib/server/projects.ts';
import type { PageServerLoad } from './$types';

// Share-link landing page (contracts/http-api.md "Share link"): public; signed in → join and open the project.
// Signed out sees the title only, never file content.
export const load: PageServerLoad = ({ params, locals }) => {
	if (locals.user) {
		const pid = joinByLink(params.token, locals.user.id);
		if (pid) redirect(303, `/project/${pid}`);
		return { project: null };
	}
	const p = projectByLink(params.token);
	return { project: p && { title: p.title } };
};
