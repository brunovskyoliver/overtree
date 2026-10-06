import { json } from '@sveltejs/kit';
import { api } from '#lib/server/api.ts';
import { SEED } from '#lib/server/collab.ts';
import { createProject, listProjects } from '#lib/server/projects.ts';
import type { RequestHandler } from './$types';

// hooks.server.ts guarantees a user on /api/*
export const GET: RequestHandler = ({ locals }) => json({ projects: listProjects(locals.user!.id) });

// ponytail: blank projects only; US2 (T028/T029) adds templates
export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json().catch(() => null);
	const id = api(() => createProject({ ownerId: locals.user!.id, title: body?.title, mainText: SEED }));
	return json({ id }, { status: 201 });
};
