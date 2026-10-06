import { error, json } from '@sveltejs/kit';
import { compileProject, getCompiler, getLastResult } from '#lib/server/compile.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json({ compiler: getCompiler(), last: getLastResult() });

// Blocks until the compile (or the queued one it joined) finishes; compile problems are statuses, not 5xx.
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (typeof body?.stopOnFirstError !== 'boolean') error(400, 'expected { stopOnFirstError: boolean }');
	return json(await compileProject({ stopOnFirstError: body.stopOnFirstError }));
};
