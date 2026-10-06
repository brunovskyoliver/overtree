import { error } from '@sveltejs/kit';
import type { Compiler } from '#lib/compile-types.ts';
import { setCompiler } from '#lib/server/compile.ts';
import type { RequestHandler } from './$types';

const COMPILERS: Compiler[] = ['pdflatex', 'xelatex', 'lualatex'];

export const PUT: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!COMPILERS.includes(body?.compiler)) error(400, `expected { compiler: ${COMPILERS.join(' | ')} }`);
	setCompiler(body.compiler);
	return new Response(null, { status: 204 });
};
