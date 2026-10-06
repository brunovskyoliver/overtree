import { error } from '@sveltejs/kit';
import type { Compiler } from '#lib/compile-types.ts';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { setCompiler } from '#lib/server/compile.ts';
import type { RequestHandler } from './$types';

const COMPILERS: Compiler[] = ['pdflatex', 'xelatex', 'lualatex'];

// Edit access on the project root (contracts/http-api.md).
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	api(() => requireProject(locals, params.pid, 'edit'));
	const body = await request.json().catch(() => null);
	if (!COMPILERS.includes(body?.compiler)) error(400, `expected { compiler: ${COMPILERS.join(' | ')} }`);
	setCompiler(params.pid, body.compiler);
	return new Response(null, { status: 204 });
};
