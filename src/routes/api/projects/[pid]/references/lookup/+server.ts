import { json } from '@sveltejs/kit';
import type { LookupResult } from '#lib/reference-types.ts';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { lookup } from '#lib/server/references/lookup.ts';
import { prepareEntries } from '#lib/server/references/project.ts';
import type { RequestHandler } from './$types';

/** `?id=` a DOI or arXiv id or link: its entry under a free default key, or the key it already has here. */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	api(() => requireProject(locals, params.pid, 'edit'));
	const { entry, source } = await api(() => lookup(url.searchParams.get('id') ?? ''));
	const [prepared] = await api(() => prepareEntries(params.pid, [entry]));
	return json({ entry: prepared, source } satisfies LookupResult);
};
