import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { deleteProject } from '../../src/lib/server/projects.ts';
import { accessTokens } from '../../src/lib/server/schema.ts';
import { authenticateBearer } from '../../src/lib/server/tokens.ts';
import * as listRoute from '../../src/routes/api/tokens/+server.ts';
import * as tokenRoute from '../../src/routes/api/tokens/[id]/+server.ts';
import { ev, hit, json, OWNER, project, start, user } from './helpers.ts';

// Agent access tokens (MCP): the /api/tokens routes and bearer authentication.

const B = 'b@test.local';
const create = (email: string, body: unknown) => hit(listRoute.POST, ev(email, {}, json('POST', body)));
const list = (email: string) => hit(listRoute.GET, ev(email, {}));
const revoke = (email: string, id: string) => hit(tokenRoute.DELETE, ev(email, { id }));

describe('/api/tokens', () => {
	it('creates an all-projects token and a project-scoped one; the text is returned once', async () => {
		await start();
		const pid = project(OWNER, 'Thesis');
		const all = await create(OWNER, { name: ' Claude Code ' });
		expect(all.status).toBe(201);
		expect(all.body.token).toMatch(/^otk_/);
		expect(all.body.info).toMatchObject({ name: 'Claude Code', project: null, lastUsedAt: null, prefix: all.body.token.slice(0, 10) });
		const one = await create(OWNER, { name: 'Codex', projectId: pid });
		expect(one.status).toBe(201);
		expect(one.body.info.project).toEqual({ id: pid, title: 'Thesis' });
	});

	it('the list has neither the hash nor the token text', async () => {
		await start();
		const { body } = await create(OWNER, { name: 'Claude Code' });
		const r = await list(OWNER);
		expect(r.status).toBe(200);
		expect(r.body.tokens).toHaveLength(1);
		expect(Object.keys(r.body.tokens[0]).sort()).toEqual(['createdAt', 'id', 'lastUsedAt', 'name', 'prefix', 'project']);
		expect(JSON.stringify(r.body)).not.toContain(body.token);
		expect(await list(B)).toMatchObject({ status: 200, body: { tokens: [] } });
	});

	it('refuses a bad name (422), a project you cannot open (404) and a 21st token (409)', async () => {
		await start();
		expect((await create(OWNER, { name: '  ' })).status).toBe(422);
		expect((await create(OWNER, { name: 'x'.repeat(61) })).status).toBe(422);
		expect((await create(OWNER, { name: 'Bad', projectId: project(B) })).status).toBe(404);
		expect((await create(OWNER, { name: 'Bad', projectId: 'no-such-project' })).status).toBe(404);
		for (let i = 0; i < 20; i++) expect((await create(OWNER, { name: `t${i}` })).status).toBe(201);
		expect((await create(OWNER, { name: 'one too many' })).status).toBe(409);
	});

	it('revokes your own token (204) but not someone else’s (404)', async () => {
		await start();
		const { body } = await create(OWNER, { name: 'Claude Code' });
		expect((await revoke(B, body.info.id)).status).toBe(404);
		expect((await revoke(OWNER, body.info.id)).status).toBe(204);
		expect((await revoke(OWNER, body.info.id)).status).toBe(404);
		expect((await list(OWNER)).body.tokens).toEqual([]);
	});

	it('is 401 signed out', async () => {
		await start();
		const out = (request?: Request, params = {}) => ({ locals: { user: null }, params, request, url: new URL('http://x/') });
		expect((await hit(listRoute.GET, out())).status).toBe(401);
		expect((await hit(listRoute.POST, out(json('POST', { name: 'x' })))).status).toBe(401);
		expect((await hit(tokenRoute.DELETE, out(undefined, { id: 'x' }))).status).toBe(401);
	});
});

describe('authenticateBearer', () => {
	it('accepts a created token with its scope and refuses it after revoke', async () => {
		await start();
		const pid = project(OWNER);
		const { body } = await create(OWNER, { name: 'Codex', projectId: pid });
		const auth = authenticateBearer(`Bearer ${body.token}`);
		expect(auth?.user.id).toBe(user(OWNER).id);
		expect(auth?.scope).toEqual({ tokenId: body.info.id, projectId: pid });
		expect((await list(OWNER)).body.tokens[0].lastUsedAt).toBeTypeOf('number');
		expect(authenticateBearer(`Bearer ${body.token}x`)).toBeNull();
		await revoke(OWNER, body.info.id);
		expect(authenticateBearer(`Bearer ${body.token}`)).toBeNull();
	});

	it('deleting a project removes the tokens scoped to it, not the all-projects ones', async () => {
		const server = await start();
		const pid = project(OWNER);
		const scoped = await create(OWNER, { name: 'Scoped', projectId: pid });
		await create(OWNER, { name: 'All' });
		deleteProject(pid);
		expect(server.db.select().from(accessTokens).where(eq(accessTokens.projectId, pid)).all()).toEqual([]);
		expect((await list(OWNER)).body.tokens.map((t: { name: string }) => t.name)).toEqual(['All']);
		expect(authenticateBearer(`Bearer ${scoped.body.token}`)).toBeNull();
	});
});
