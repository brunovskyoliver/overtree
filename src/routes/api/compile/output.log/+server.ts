import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { error } from '@sveltejs/kit';
import { compileDir } from '#lib/server/compile.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const log = await readFile(join(compileDir(), 'output.log'), 'utf8').catch(() => error(404, 'no log yet'));
	return new Response(log, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
