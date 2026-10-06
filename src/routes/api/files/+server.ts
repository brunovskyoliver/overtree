import { error, json } from '@sveltejs/kit';
import type { ProjectInfo } from '#lib/files.ts';
import { api } from '#lib/server/api.ts';
import { createEntry, getMainFileId, listFiles } from '#lib/server/files.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json({ files: listFiles(), mainFileId: getMainFileId() } satisfies ProjectInfo);

// JSON create of a folder or an empty text file; multipart upload comes with US4
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const parentId = body?.parentId ?? null;
	if (!['folder', 'text'].includes(body?.kind) || typeof body.name !== 'string' || !(parentId === null || typeof parentId === 'string'))
		error(400, 'expected { kind: "folder" | "text", name: string, parentId: string | null }');
	return json(
		api(() => createEntry({ kind: body.kind, name: body.name, parentId })),
		{ status: 201 }
	);
};
