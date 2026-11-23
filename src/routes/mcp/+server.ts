import { json } from '@sveltejs/kit';
import { handleMcp } from '#lib/server/mcp.ts';
import type { RequestHandler } from './$types';

// MCP over Streamable HTTP for coding agents (src/lib/server/mcp.ts); hooks.server.ts signs the token in. Stateless:
// one JSON-RPC message per POST, no SSE stream to GET and no session to DELETE. An error without an id means the
// message itself was unreadable: 400.
export const POST: RequestHandler = async ({ locals, request }) => {
	const reply = await handleMcp(locals, await request.text());
	if (!reply) return new Response(null, { status: 202 });
	return json(reply, { status: reply.id === null ? 400 : 200 });
};

const notAllowed: RequestHandler = () => new Response(null, { status: 405, headers: { allow: 'POST' } });
export const GET = notAllowed;
export const DELETE = notAllowed;
