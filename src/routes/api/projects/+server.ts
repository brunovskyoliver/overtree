import { error, json } from '@sveltejs/kit';
import { api } from '#lib/server/api.ts';
import { createProject, listProjects } from '#lib/server/projects.ts';
import { isTemplate, templateText } from '#lib/server/templates.ts';
import type { RequestHandler } from './$types';

// hooks.server.ts guarantees a user on /api/*
export const GET: RequestHandler = ({ locals }) => json({ projects: listProjects(locals.user!.id) });

/** `{ title, template }` (template defaults to blank) → 201 `{ id }`; 422 for a bad title. */
export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json().catch(() => null);
	const template = body?.template ?? 'blank';
	if (!isTemplate(template)) error(400, 'expected template: blank, article, report, beamer or letter');
	const title = typeof body?.title === 'string' ? body.title.trim() : '';
	const id = api(() => createProject({ ownerId: locals.user!.id, title, mainText: templateText(template, title) }));
	return json({ id }, { status: 201 });
};
