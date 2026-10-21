import { json } from '@sveltejs/kit';
import type { ZoteroItem } from '#lib/reference-types.ts';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { prepareEntries } from '#lib/server/references/project.ts';
import { searchZotero } from '#lib/server/references/zotero.ts';
import type { RequestHandler } from './$types';

/** `?q=`: matching items of the caller's Zotero library, prepared against this project like a lookup. */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	const { user } = api(() => requireProject(locals, params.pid, 'edit'));
	const hits = await api(() => searchZotero(user.id, url.searchParams.get('q') ?? ''));
	const prepared = await api(() => prepareEntries(params.pid, hits.map((h) => h.entry)));
	const items: ZoteroItem[] = hits.map((h, i) => ({ ...prepared[i], id: h.id, itemType: h.itemType }));
	return json({ items });
};
