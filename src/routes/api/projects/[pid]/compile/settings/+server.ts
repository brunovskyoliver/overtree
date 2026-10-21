import { error } from '@sveltejs/kit';
import type { Compiler } from '#lib/compile-types.ts';
import { requireProject } from '#lib/server/access.ts';
import { api } from '#lib/server/api.ts';
import { setChktex, setCompiler } from '#lib/server/compile.ts';
import type { RequestHandler } from './$types';

const COMPILERS: Compiler[] = ['pdflatex', 'xelatex', 'lualatex'];

// Edit access on the project root (contracts/http-api.md).
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	api(() => requireProject(locals, params.pid, 'edit'));
	const body = await request.json().catch(() => null);
	// either or both: { compiler?, chktex? } (016)
	const compiler = body?.compiler;
	const chktex = body?.chktex;
	if ((compiler === undefined && chktex === undefined) || (compiler !== undefined && !COMPILERS.includes(compiler)) || (chktex !== undefined && typeof chktex !== 'boolean'))
		error(400, `expected { compiler?: ${COMPILERS.join(' | ')}, chktex?: boolean }`);
	if (compiler !== undefined) setCompiler(params.pid, compiler);
	if (chktex !== undefined) setChktex(params.pid, chktex);
	return new Response(null, { status: 204 });
};
