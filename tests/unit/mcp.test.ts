import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createEntry, getMainFileId, getText, listFiles, setText, uploadFile } from '../../src/lib/server/files.ts';
import { closeVersion, listVersions } from '../../src/lib/server/history.ts';
import { listProjects } from '../../src/lib/server/projects.ts';
import { memberships, overrides, users, type MemberRole } from '../../src/lib/server/schema.ts';
import { authenticateBearer, createToken, revokeToken, type TokenScope } from '../../src/lib/server/tokens.ts';
import { handle } from '../../src/hooks.server.ts';
import * as route from '../../src/routes/mcp/+server.ts';
import { connect, OWNER, project, start, user, waitFor, type Started } from './helpers.ts';

// The MCP server (src/lib/server/mcp.ts): JSON-RPC over one POST, every tool through the route handler with
// `locals: { user, token }` as hooks.server.ts sets them, and the bearer tokens that sign agents in.

const B = 'b@test.local';
const R = 'r@test.local';

function member(server: Started, pid: string, email: string, role: MemberRole) {
	server.db.insert(memberships).values({ projectId: pid, userId: user(email).id, role, viaLink: false, createdAt: Date.now() }).run();
}

async function setup() {
	const server = await start();
	const pid = project();
	const main = getMainFileId(pid)!;
	const owner = user().id;
	const chapters = createEntry(pid, { kind: 'folder', name: 'chapters', parentId: null }, owner);
	const intro = createEntry(pid, { kind: 'text', name: 'intro.tex', parentId: chapters.id }, owner).id;
	await setText(main, '\\documentclass{article}\n\\begin{document}\nHello alpha.\n\\input{chapters/intro}\n\\end{document}\n', { userId: owner, projectId: pid });
	await setText(intro, 'Intro: alpha and alpha.\n', { userId: owner, projectId: pid });
	member(server, pid, B, 'editor');
	member(server, pid, R, 'reader');
	return { server, pid, main, intro, chapters: chapters.id };
}

let nextId = 1;
/** POST one message as `email` (scope: the token's project) → HTTP status and JSON body. */
async function post(email: string, message: unknown, projectId: string | null = null) {
	const token: TokenScope = { tokenId: 't', projectId };
	const request = new Request('http://x/mcp', { method: 'POST', body: typeof message === 'string' ? message : JSON.stringify(message) });
	const res = await route.POST({ locals: { user: user(email), token }, request } as never);
	const text = await res.text();
	return { status: res.status, body: text ? JSON.parse(text) : null };
}
const rpc = async (email: string, method: string, params?: unknown, projectId: string | null = null) =>
	(await post(email, { jsonrpc: '2.0', id: nextId++, method, params }, projectId)).body;
/** tools/call → { text, isError } */
async function tool(email: string, name: string, args: object, projectId: string | null = null) {
	const r = await rpc(email, 'tools/call', { name, arguments: args }, projectId);
	if (r.error) throw new Error(r.error.message);
	return { text: r.result.content[0].text as string, isError: r.result.isError === true };
}

describe('protocol', () => {
	it('negotiates the version and answers ping', async () => {
		await start();
		const init = await rpc(OWNER, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } });
		expect(init.result).toMatchObject({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'overtree', version: '1.0.0' } });
		expect(init.result.instructions).toMatch(/list_projects/);
		expect((await rpc(OWNER, 'initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion).toBe('2025-06-18');
		expect((await rpc(OWNER, 'ping')).result).toEqual({});
	});

	it('202 for notifications and responses, JSON-RPC errors for bad messages', async () => {
		await start();
		expect(await post(OWNER, { jsonrpc: '2.0', method: 'notifications/initialized' })).toEqual({ status: 202, body: null });
		expect((await post(OWNER, { jsonrpc: '2.0', id: 5, result: {} })).status).toBe(202);
		expect(await post(OWNER, '{oops')).toMatchObject({ status: 400, body: { id: null, error: { code: -32700 } } });
		expect((await post(OWNER, [1])).body.error.code).toBe(-32600);
		expect((await post(OWNER, { jsonrpc: '2.0', id: 1 })).body.error.code).toBe(-32600);
		expect((await rpc(OWNER, 'resources/list')).error.code).toBe(-32601);
		expect((await rpc(OWNER, 'tools/call', { name: 'nope' })).error.code).toBe(-32602);
		expect((await rpc(OWNER, 'tools/call', { name: 'list_projects', arguments: 'x' })).error.code).toBe(-32602);
		expect((await route.GET({} as never)).status).toBe(405);
		expect((await route.DELETE({} as never)).headers.get('allow')).toBe('POST');
	});

	it('lists tools with schemas and annotations', async () => {
		await start();
		const { tools } = (await rpc(OWNER, 'tools/list')).result;
		expect(tools.map((t: { name: string }) => t.name)).toEqual([
			'list_projects', 'create_project', 'list_files', 'read_file', 'write_file', 'edit_file',
			'delete_file', 'move_file', 'set_main_file', 'search', 'compile'
		]);
		const edit = tools.find((t: { name: string }) => t.name === 'edit_file');
		expect(edit.inputSchema).toMatchObject({ type: 'object', required: ['project', 'path', 'old_string', 'new_string'] });
		expect(tools.find((t: { name: string }) => t.name === 'read_file').annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
	});
});

describe('tools', () => {
	it('list_projects and create_project', async () => {
		const { pid } = await setup();
		const list = JSON.parse((await tool(B, 'list_projects', {})).text);
		expect(list).toEqual([expect.objectContaining({ id: pid, role: 'editor', title: 'Untitled project' })]);
		expect(list[0].updated).toMatch(/^\d{4}-\d\d-\d\dT/);
		const { id } = JSON.parse((await tool(B, 'create_project', { title: 'Thesis', template: 'article' })).text);
		expect(listProjects(user(B).id).find((p) => p.id === id)).toMatchObject({ title: 'Thesis', role: 'owner' });
		expect((await tool(B, 'create_project', { title: 'x', template: 'poster' })).isError).toBe(true);
		expect(await tool(B, 'create_project', { title: '' })).toMatchObject({ isError: true, text: expect.stringMatching(/title/) });
	});

	it('list_files and read_file', async () => {
		const { pid } = await setup();
		await uploadFile(pid, null, 'fig.png', new Uint8Array([1, 2, 3]), false, user().id);
		const { main, files } = JSON.parse((await tool(R, 'list_files', { project: pid })).text);
		expect(main).toBe('main.tex');
		expect(files).toEqual([
			{ path: 'chapters', kind: 'folder', can_edit: false },
			{ path: 'chapters/intro.tex', kind: 'text', can_edit: false },
			{ path: 'fig.png', kind: 'binary', size: 3, can_edit: false },
			{ path: 'main.tex', kind: 'text', can_edit: false }
		]);
		expect((await tool(R, 'read_file', { project: pid, path: '/chapters/intro.tex' })).text).toBe('Intro: alpha and alpha.\n');
		expect((await tool(R, 'read_file', { project: pid, path: './main.tex' })).text).toContain('Hello alpha.');
		expect(await tool(R, 'read_file', { project: pid, path: 'fig.png' })).toEqual({ isError: true, text: expect.stringMatching(/binary file \(3 bytes\)/) });
		expect(await tool(R, 'read_file', { project: pid, path: 'chapters' })).toMatchObject({ isError: true, text: 'chapters is a folder.' });
		expect((await tool(R, 'read_file', { project: pid, path: 'Main.tex' })).isError).toBe(true); // case-sensitive
	});

	it('refuses path traversal', async () => {
		const { pid } = await setup();
		for (const path of ['../main.tex', 'chapters/../main.tex', 'chapters/./intro.tex', '/', ''])
			expect((await tool(OWNER, 'read_file', { project: pid, path })).isError).toBe(true);
	});

	it('write_file creates with folders and replaces, live and in history', async () => {
		const { pid } = await setup();
		const created = await tool(B, 'write_file', { project: pid, path: 'parts/one/a.tex', content: 'A\n' });
		expect(created).toEqual({ isError: false, text: 'Created parts/one/a.tex (2 characters).' });
		const a = listFiles(pid).find((f) => f.name === 'a.tex')!;
		expect(await getText(a.id)).toBe('A\n');
		expect((await tool(B, 'write_file', { project: pid, path: 'parts/one/a.tex', content: 'B\n' })).text).toMatch(/^Replaced/);
		expect(await getText(a.id)).toBe('B\n');
		expect((await tool(B, 'write_file', { project: pid, path: 'x.png', content: '' })).isError).toBe(true);
		expect((await tool(B, 'write_file', { project: pid, path: 'chapters', content: '' })).isError).toBe(true);
	});

	it('edit_file replaces exactly, live to an open editor, credited in history', async () => {
		const { server, pid, main, intro } = await setup();
		closeVersion(pid, 'edit'); // the setup's edits by the owner
		const open = await connect(server.url, main, B);
		expect((await tool(B, 'edit_file', { project: pid, path: 'main.tex', old_string: 'Hello', new_string: 'Hi' })).text).toBe('Replaced 1 occurrence in main.tex.');
		await waitFor(() => open.text.toString().includes('Hi alpha.'));
		const ambiguous = await tool(B, 'edit_file', { project: pid, path: 'chapters/intro.tex', old_string: 'alpha', new_string: 'beta' });
		expect(ambiguous).toEqual({ isError: true, text: expect.stringMatching(/matches 2 times/) });
		expect(await getText(intro)).toBe('Intro: alpha and alpha.\n');
		expect((await tool(B, 'edit_file', { project: pid, path: 'chapters/intro.tex', old_string: 'gamma', new_string: 'x' })).text).toMatch(/not found/);
		const all = await tool(B, 'edit_file', { project: pid, path: 'chapters/intro.tex', old_string: 'alpha', new_string: 'beta', replace_all: true });
		expect(all.text).toBe('Replaced 2 occurrences in chapters/intro.tex.');
		expect(await getText(intro)).toBe('Intro: beta and beta.\n');
		closeVersion(pid, 'edit');
		expect(listVersions(pid, user(B).id).versions[0].authors.map((a) => a.id)).toEqual([user(B).id]);
	});

	it('move_file, set_main_file, delete_file', async () => {
		const { pid, main, intro } = await setup();
		expect((await tool(B, 'move_file', { project: pid, path: 'chapters/intro.tex', new_path: 'body/start.tex' })).text).toBe(
			'Moved chapters/intro.tex to body/start.tex.'
		);
		const all = listFiles(pid);
		const moved = all.find((f) => f.id === intro)!;
		expect(moved.name).toBe('start.tex');
		expect(all.find((f) => f.id === moved.parentId)?.name).toBe('body');
		expect((await tool(B, 'move_file', { project: pid, path: 'body/start.tex', new_path: 'body/s.tex' })).isError).toBe(false);
		expect((await tool(B, 'set_main_file', { project: pid, path: 'body/s.tex' })).isError).toBe(false);
		expect(getMainFileId(pid)).toBe(intro);
		expect((await tool(B, 'set_main_file', { project: pid, path: 'body' })).isError).toBe(true);
		expect((await tool(B, 'delete_file', { project: pid, path: 'body' })).text).toBe('Deleted body.');
		expect(listFiles(pid).some((f) => f.id === intro)).toBe(false);
		expect(getMainFileId(pid)).toBe(null);
		expect(listFiles(pid).some((f) => f.id === main)).toBe(true);
	});

	it('search renders path:line: excerpt', async () => {
		const { pid } = await setup();
		const r = await tool(R, 'search', { project: pid, query: 'alpha' });
		expect(r.text.split('\n')).toEqual(['3 matches in 2 files:', 'chapters/intro.tex:1: Intro: alpha and alpha.', 'chapters/intro.tex:1: Intro: alpha and alpha.', 'main.tex:3: Hello alpha.']);
		expect((await tool(R, 'search', { project: pid, query: 'ALPHA', case_sensitive: true })).text).toBe('No matches.');
		expect((await tool(R, 'search', { project: pid, query: '(', regex: true })).isError).toBe(true);
	});

	it('compile reports the missing main document and an unavailable compiler', async () => {
		const { pid } = await setup();
		const saved = process.env.DOCKER_HOST;
		process.env.DOCKER_HOST = 'unix:///nonexistent.sock';
		try {
			const r = JSON.parse((await tool(R, 'compile', { project: pid })).text);
			expect(r).toMatchObject({ status: 'unavailable', message: expect.stringMatching(/^Compiler unavailable/), entries: [] });
		} finally {
			if (saved === undefined) delete process.env.DOCKER_HOST;
			else process.env.DOCKER_HOST = saved;
		}
		await tool(OWNER, 'delete_file', { project: pid, path: 'main.tex' });
		expect(getMainFileId(pid)).toBe(null);
		expect(JSON.parse((await tool(R, 'compile', { project: pid })).text)).toMatchObject({ status: 'failure', message: expect.stringMatching(/No main document/) });
		expect(await tool(R, 'compile', { project: pid, path: 'chapters' })).toEqual({ isError: true, text: 'Not a .tex file.' });
	});
});

describe('permissions', () => {
	it('a reader can read but not change anything', async () => {
		const { pid, intro } = await setup();
		const refused = [
			['write_file', { path: 'new.tex', content: 'x' }],
			['write_file', { path: 'main.tex', content: 'x' }],
			['edit_file', { path: 'main.tex', old_string: 'Hello', new_string: 'Hi' }],
			['delete_file', { path: 'main.tex' }],
			['move_file', { path: 'main.tex', new_path: 'm.tex' }],
			['move_file', { path: 'main.tex', new_path: 'sub/main.tex' }],
			['set_main_file', { path: 'chapters/intro.tex' }]
		] as const;
		for (const [name, args] of refused) expect(await tool(R, name, { project: pid, ...args })).toMatchObject({ isError: true });
		expect(listFiles(pid).map((f) => f.name).sort()).toEqual(['chapters', 'intro.tex', 'main.tex']);
		expect(await getText(intro)).toBe('Intro: alpha and alpha.\n');
	});

	it('a per-file reader override is refused like in the editor', async () => {
		const { server, pid, intro } = await setup();
		server.db.insert(overrides).values({ projectId: pid, userId: user(B).id, fileId: intro, role: 'reader' }).run();
		const r = await tool(B, 'edit_file', { project: pid, path: 'chapters/intro.tex', old_string: 'Intro', new_string: 'X' });
		expect(r).toEqual({ isError: true, text: 'You don’t have edit access to this file.' });
		expect((await tool(B, 'write_file', { project: pid, path: 'chapters/intro.tex', content: 'x' })).isError).toBe(true);
		expect((await tool(B, 'edit_file', { project: pid, path: 'main.tex', old_string: 'Hello', new_string: 'Hi' })).isError).toBe(false);
	});

	it('a non-member and a project-scoped token get "Project not found."', async () => {
		const { pid } = await setup();
		const other = project(B, 'B’s own');
		expect(await tool('c@test.local', 'list_files', { project: pid })).toEqual({ isError: true, text: 'Project not found.' });
		expect(await tool(B, 'list_files', { project: pid }, other)).toEqual({ isError: true, text: 'Project not found.' });
		expect((await tool(B, 'list_files', { project: other }, other)).isError).toBe(false);
		expect(JSON.parse((await tool(B, 'list_projects', {}, other)).text).map((p: { id: string }) => p.id)).toEqual([other]);
		expect(await tool(B, 'create_project', { title: 'x' }, other)).toMatchObject({ isError: true, text: expect.stringMatching(/limited to one project/) });
	});
});

describe('bearer tokens', () => {
	it('authenticate the enabled user until revoked', async () => {
		const server = await start();
		const pid = project();
		const owner = user();
		const { token, info } = createToken(owner.id, { name: 'Claude Code' });
		expect(authenticateBearer(`Bearer ${token}`)).toMatchObject({ user: { id: owner.id }, scope: { tokenId: info.id, projectId: null } });
		expect(authenticateBearer(`Bearer ${token}x`)).toBe(null);
		expect(authenticateBearer(token)).toBe(null);
		expect(authenticateBearer(null)).toBe(null);
		expect(authenticateBearer('Bearer abc')).toBe(null);

		const scoped = createToken(owner.id, { name: 'Codex', projectId: pid });
		expect(authenticateBearer(`Bearer ${scoped.token}`)?.scope.projectId).toBe(pid);

		revokeToken(owner.id, info.id);
		expect(authenticateBearer(`Bearer ${token}`)).toBe(null);

		server.db.update(users).set({ disabled: true }).where(eq(users.id, owner.id)).run();
		expect(authenticateBearer(`Bearer ${scoped.token}`)).toBe(null);
	});

	it('hooks.server.ts answers 401 on /mcp without a valid token', async () => {
		await start();
		const event = { url: new URL('http://x/mcp'), request: new Request('http://x/mcp', { method: 'POST' }), locals: {} };
		const res = await handle({ event, resolve: () => new Response('ok') } as never);
		expect(res.status).toBe(401);
		expect((await res.json()).error.code).toBe(-32001);
		const { token } = createToken(user().id, { name: 't' });
		const ok = { ...event, request: new Request('http://x/mcp', { method: 'POST', headers: { authorization: `Bearer ${token}` } }), locals: {} as App.Locals };
		expect((await handle({ event: ok, resolve: () => new Response('ok') } as never)).status).toBe(200);
		expect(ok.locals.user?.id).toBe(user().id);
	});
});
