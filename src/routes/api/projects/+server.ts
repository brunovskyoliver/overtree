import { error, json } from '@sveltejs/kit';
import { requireUser } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { createProject, listProjects } from '#lib/server/projects.ts';
import { isTemplate, templateText } from '#lib/server/templates.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) => json({ projects: listProjects(api(() => requireUser(locals)).id) });

/** `{ title, template }` (template defaults to blank) → 201 `{ id }`; 422 for a bad title. */
export const POST: RequestHandler = async ({ locals, request }) => {
	const user = api(() => requireUser(locals));
	const body = await request.json().catch(() => null);
	const template = body?.template ?? 'blank';
	if (!isTemplate(template)) error(400, 'expected template: blank, article, report, beamer or letter');
	const title = typeof body?.title === 'string' ? body.title.trim() : '';
	const id = api(() => createProject({ ownerId: user.id, title, mainText: templateText(template, title) }));
	return json({ id }, { status: 201 });
};
