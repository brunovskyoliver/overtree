import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { projectRole } from '../../src/lib/server/access.ts';
import { createEntry, getMainFileId, getText } from '../../src/lib/server/files.ts';
import {
	getProject,
	inviteMember,
	joinByLink,
	listMembers,
	removeMember,
	setLink,
	setMemberRole,
	transferOwnership,
	withdrawInvite
} from '../../src/lib/server/projects.ts';
import { invites, memberships, overrides, projects, type MemberRole } from '../../src/lib/server/schema.ts';
import * as projectRoute from '../../src/routes/api/projects/[pid]/+server.ts';
import * as compileRoute from '../../src/routes/api/projects/[pid]/compile/+server.ts';
import * as logRoute from '../../src/routes/api/projects/[pid]/compile/output.log/+server.ts';
import * as pdfRoute from '../../src/routes/api/projects/[pid]/compile/output.pdf/+server.ts';
import * as compileSettingsRoute from '../../src/routes/api/projects/[pid]/compile/settings/+server.ts';
import * as duplicateRoute from '../../src/routes/api/projects/[pid]/duplicate/+server.ts';
import * as filesRoute from '../../src/routes/api/projects/[pid]/files/+server.ts';
import * as fileRoute from '../../src/routes/api/projects/[pid]/files/[id]/+server.ts';
import * as rawRoute from '../../src/routes/api/projects/[pid]/files/[id]/raw/+server.ts';
import * as inviteRoute from '../../src/routes/api/projects/[pid]/invites/[email]/+server.ts';
import * as leaveRoute from '../../src/routes/api/projects/[pid]/leave/+server.ts';
import * as linkRoute from '../../src/routes/api/projects/[pid]/link/+server.ts';
import * as mainRoute from '../../src/routes/api/projects/[pid]/main/+server.ts';
import * as membersRoute from '../../src/routes/api/projects/[pid]/members/+server.ts';
import * as memberRoute from '../../src/routes/api/projects/[pid]/members/[userId]/+server.ts';
import * as symbolsRoute from '../../src/routes/api/projects/[pid]/symbols/+server.ts';
import * as transferRoute from '../../src/routes/api/projects/[pid]/transfer/+server.ts';
import * as zipRoute from '../../src/routes/api/projects/[pid]/zip/+server.ts';
import { connect, OWNER, project, start, status, user, waitFor, type Started } from './helpers.ts';

// Sharing (005 US3, SC-002): roles enforced on the server, bypassing the UI.

const B = 'b@test.local';
const C = 'c@test.local';
const D = 'd@test.local';

function member(server: Started, pid: string, email: string, role: MemberRole) {
	server.db.insert(memberships).values({ projectId: pid, userId: user(email).id, role, viaLink: false, createdAt: Date.now() }).run();
}

/** A route handler's response (status and JSON body), or the status of the error it throws. */
async function hit(handler: (event: never) => Response | Promise<Response>, event: object) {
	try {
		const res = await handler(event as never);
		const type = res.headers.get('content-type') ?? '';
		return { status: res.status, body: type.includes('json') ? await res.json() : null };
	} catch (e) {
		return { status: (e as { status: number }).status, body: null };
	}
}

const json = (method: string, body: unknown) =>
	new Request('http://x/', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const ev = (email: string, params: Record<string, string>, request?: Request) => ({
	locals: { user: user(email) },
	params,
	request,
	url: new URL('http://x/')
});

/** The last id ever given to an `updates` row (compaction deletes rows, never this). */
const lastUpdateId = (server: Started) =>
	(server.db.$client.prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'updates'`).get() as { seq: number } | undefined)?.seq ?? 0;
const settle = () => new Promise((r) => setTimeout(r, 300));

/** Resolves on the provider's next close; `failed` turns true once a re-authentication is refused. */
function watch(provider: Awaited<ReturnType<typeof connect>>['provider']) {
	const state = { closed: false, failed: false };
	provider.on('close', () => (state.closed = true));
	provider.on('authenticationFailed', () => (state.failed = true));
	return state;
}

describe('reader', () => {
	it('a Yjs update from a raw provider never reaches the stored text', async () => {
		const server = await start();
		const pid = project();
		const main = getMainFileId(pid)!;
		member(server, pid, B, 'reader');
		const before = await getText(main);
		const rows = lastUpdateId(server);

		const reader = await connect(server.url, main, B);
		expect(reader.provider.authorizedScope).toBe('readonly');
		reader.text.insert(0, 'from a reader ');
		await settle();

		expect(await getText(main)).toBe(before);
		expect(lastUpdateId(server)).toBe(rows);
		const fresh = await connect(server.url, main, OWNER);
		expect(fresh.text.toString()).toBe(before);
	});

	it('cannot change files, main or compile settings; may compile', async () => {
		const server = await start();
		const pid = project();
		const main = getMainFileId(pid)!;
		member(server, pid, B, 'reader');
		const file = { pid, id: main };
		expect((await hit(filesRoute.POST, ev(B, { pid }, json('POST', { kind: 'text', name: 'x.tex', parentId: null })))).status).toBe(403);
		const form = new FormData();
		form.set('file', new File(['x'], 'up.tex'));
		expect((await hit(filesRoute.POST, ev(B, { pid }, new Request('http://x/', { method: 'POST', body: form })))).status).toBe(403);
		expect((await hit(fileRoute.PATCH, ev(B, file, json('PATCH', { name: 'renamed.tex' })))).status).toBe(403);
		expect((await hit(fileRoute.DELETE, ev(B, file))).status).toBe(403);
		expect((await hit(mainRoute.PUT, ev(B, { pid }, json('PUT', { fileId: main })))).status).toBe(403);
		expect((await hit(compileSettingsRoute.PUT, ev(B, { pid }, json('PUT', { compiler: 'xelatex' })))).status).toBe(403);
		// past the role check: an invalid body gets 400, so no compile runs
		expect((await hit(compileRoute.POST, ev(B, { pid }, json('POST', {})))).status).toBe(400);
		expect((await hit(compileRoute.GET, ev(B, { pid }))).status).toBe(200);
		expect((await hit(filesRoute.GET, ev(B, { pid }))).body.files.every((f: { canEdit: boolean }) => !f.canEdit)).toBe(true);
	});
});

describe('non-member', () => {
	it('gets 404 on every project route', async () => {
		await start();
		const pid = project();
		const main = getMainFileId(pid)!;
		const file = { pid, id: main };
		const cases: [string, (e: never) => Response | Promise<Response>, Record<string, string>, Request?][] = [
			['GET project', projectRoute.GET, { pid }],
			['PATCH project', projectRoute.PATCH, { pid }, json('PATCH', { title: 'x' })],
			['DELETE project', projectRoute.DELETE, { pid }],
			['GET files', filesRoute.GET, { pid }],
			['POST files', filesRoute.POST, { pid }, json('POST', { kind: 'text', name: 'x.tex', parentId: null })],
			['PATCH file', fileRoute.PATCH, file, json('PATCH', { name: 'y.tex' })],
			['DELETE file', fileRoute.DELETE, file],
			['GET raw', rawRoute.GET, file],
			['PUT main', mainRoute.PUT, { pid }, json('PUT', { fileId: main })],
			['GET compile', compileRoute.GET, { pid }],
			['POST compile', compileRoute.POST, { pid }, json('POST', { stopOnFirstError: false })],
			['PUT compile settings', compileSettingsRoute.PUT, { pid }, json('PUT', { compiler: 'xelatex' })],
			['GET log', logRoute.GET, { pid }],
			['GET pdf', pdfRoute.GET, { pid }],
			['GET zip', zipRoute.GET, { pid }],
			['GET symbols', symbolsRoute.GET, { pid }],
			['POST duplicate', duplicateRoute.POST, { pid }],
			['POST leave', leaveRoute.POST, { pid }],
			['GET members', membersRoute.GET, { pid }],
			['POST members', membersRoute.POST, { pid }, json('POST', { email: D, role: 'reader' })],
			['PATCH member', memberRoute.PATCH, { pid, userId: user().id }, json('PATCH', { role: 'reader' })],
			['DELETE member', memberRoute.DELETE, { pid, userId: user().id }],
			['DELETE invite', inviteRoute.DELETE, { pid, email: D }],
			['PUT link', linkRoute.PUT, { pid }, json('PUT', { role: 'reader' })],
			['POST transfer', transferRoute.POST, { pid }, json('POST', { userId: user(C).id })]
		];
		for (const [name, handler, params, request] of cases) {
			expect([name, (await hit(handler, ev(C, params, request))).status]).toEqual([name, 404]);
		}
		expect(getProject(pid)?.title).toBe('Untitled project');
	});
});

describe('editor', () => {
	it('cannot manage sharing, rename or delete; sees members without invites and overrides', async () => {
		const server = await start();
		const pid = project();
		member(server, pid, B, 'editor');
		member(server, pid, C, 'reader');
		inviteMember(pid, 'pending@test.local', 'reader');
		server.db.insert(overrides).values({ projectId: pid, userId: user(C).id, fileId: getMainFileId(pid)!, role: 'editor' }).run();

		const denied: [string, (e: never) => Response | Promise<Response>, Record<string, string>, Request?][] = [
			['POST members', membersRoute.POST, { pid }, json('POST', { email: D, role: 'reader' })],
			['PATCH member', memberRoute.PATCH, { pid, userId: user(C).id }, json('PATCH', { role: 'editor' })],
			['DELETE member', memberRoute.DELETE, { pid, userId: user(C).id }],
			['DELETE invite', inviteRoute.DELETE, { pid, email: 'pending@test.local' }],
			['PUT link', linkRoute.PUT, { pid }, json('PUT', { role: 'editor' })],
			['POST transfer', transferRoute.POST, { pid }, json('POST', { userId: user(B).id })],
			['PATCH title', projectRoute.PATCH, { pid }, json('PATCH', { title: 'Mine' })],
			['DELETE project', projectRoute.DELETE, { pid }]
		];
		for (const [name, handler, params, request] of denied) {
			expect([name, (await hit(handler, ev(B, params, request))).status]).toEqual([name, 403]);
		}

		const { status: s, body } = await hit(membersRoute.GET, ev(B, { pid }));
		expect(s).toBe(200);
		expect(body.owner.email).toBe(OWNER);
		expect(body.members.map((m: { user: { email: string }; role: string }) => [m.user.email, m.role])).toEqual([
			[B, 'editor'],
			[C, 'reader']
		]);
		expect(body.invites).toEqual([]);
		expect(body.overrides).toEqual([]);
		// the owner sees both
		const owner = await hit(membersRoute.GET, ev(OWNER, { pid }));
		expect(owner.body.invites).toEqual([{ email: 'pending@test.local', role: 'reader' }]);
		expect(owner.body.overrides).toHaveLength(1);
		expect(getProject(pid)).toMatchObject({ title: 'Untitled project', linkToken: null, ownerId: user().id });
	});
});

describe('invites', () => {
	it('an unknown email becomes a membership with that role on first sign-in', async () => {
		await start();
		const pid = project();
		const { status: s, body } = await hit(membersRoute.POST, ev(OWNER, { pid }, json('POST', { email: ' New@Test.local ', role: 'editor' })));
		expect([s, body]).toEqual([201, { status: 'invited' }]);
		expect(listMembers(pid, true).invites).toEqual([{ email: 'new@test.local', role: 'editor' }]);
		const n = user('new@test.local');
		expect(projectRole(pid, n.id)).toBe('editor');
		expect(listMembers(pid, true).invites).toEqual([]);
	});

	it('a withdrawn invite gives nothing on sign-up', async () => {
		const server = await start();
		const pid = project();
		expect(inviteMember(pid, 'gone@test.local', 'editor')).toBe('invited');
		expect((await hit(inviteRoute.DELETE, ev(OWNER, { pid, email: 'gone@test.local' }))).status).toBe(204);
		expect((await hit(inviteRoute.DELETE, ev(OWNER, { pid, email: 'gone@test.local' }))).status).toBe(404);
		const g = user('gone@test.local');
		expect(projectRole(pid, g.id)).toBeNull();
		expect(server.db.select().from(memberships).where(eq(memberships.projectId, pid)).all()).toEqual([]);
	});

	it('own email 422; an existing member gets the new role', async () => {
		const server = await start();
		const pid = project();
		expect(status(() => inviteMember(pid, OWNER.toUpperCase(), 'reader'))).toBe(422);
		expect((await hit(membersRoute.POST, ev(OWNER, { pid }, json('POST', { email: OWNER, role: 'editor' })))).status).toBe(422);
		expect(status(() => inviteMember(pid, B, 'owner'))).toBe(422);
		expect(status(() => inviteMember(pid, 'not-an-email', 'reader'))).toBe(422);

		member(server, pid, B, 'reader');
		expect(inviteMember(pid, B, 'editor')).toBe('member');
		expect(projectRole(pid, user(B).id)).toBe('editor');
		expect(server.db.select().from(memberships).where(eq(memberships.projectId, pid)).all()).toHaveLength(1);
		expect(server.db.select().from(invites).all()).toEqual([]);
	});

	it('removing a member deletes their overrides', async () => {
		const server = await start();
		const pid = project();
		member(server, pid, B, 'editor');
		member(server, pid, C, 'editor');
		const ch = createEntry(pid, { kind: 'folder', name: 'ch', parentId: null });
		for (const email of [B, C]) server.db.insert(overrides).values({ projectId: pid, userId: user(email).id, fileId: ch.id, role: 'reader' }).run();

		expect((await hit(memberRoute.DELETE, ev(OWNER, { pid, userId: user(B).id }))).status).toBe(204);
		expect(projectRole(pid, user(B).id)).toBeNull();
		const left = server.db.select().from(overrides).where(eq(overrides.projectId, pid)).all();
		expect(left.map((o) => o.userId)).toEqual([user(C).id]);
		expect(status(() => removeMember(pid, user(B).id))).toBe(404);
	});
});

describe('link', () => {
	it('joining gives the link role; regenerate drops link members, old token joins nothing, link members are kicked', async () => {
		const server = await start();
		const pid = project();
		const main = getMainFileId(pid)!;
		const old = setLink(pid, 'editor')!;
		expect(old.role).toBe('editor');

		const c = user(C).id;
		expect(joinByLink(old.token, c)).toBe(pid);
		expect(projectRole(pid, c)).toBe('editor');
		// an invited reader who joined through the editor link
		user(B);
		inviteMember(pid, B, 'reader');
		joinByLink(old.token, user(B).id);
		expect(projectRole(pid, user(B).id)).toBe('editor');

		const cDoc = await connect(server.url, main, C);
		expect(cDoc.provider.authorizedScope).toBe('read-write');
		const cState = watch(cDoc.provider);

		const { status: s, body: fresh } = await hit(linkRoute.PUT, ev(OWNER, { pid }, json('PUT', { role: 'editor', regenerate: true })));
		expect(s).toBe(200);
		expect(fresh.token).not.toBe(old.token);
		await waitFor(() => cState.closed);
		await waitFor(() => cState.failed);

		expect(projectRole(pid, c)).toBeNull();
		expect(server.db.select().from(memberships).where(and(eq(memberships.projectId, pid), eq(memberships.userId, c))).get()).toBeUndefined();
		expect(projectRole(pid, user(B).id)).toBe('reader');
		expect(server.db.select().from(memberships).where(eq(memberships.projectId, pid)).all()).toMatchObject([{ role: 'reader', viaLink: false }]);

		const d = user(D).id;
		expect(joinByLink(old.token, d)).toBeNull();
		expect(projectRole(pid, d)).toBeNull();
		expect(joinByLink(fresh.token, d)).toBe(pid);
		expect(projectRole(pid, d)).toBe('editor');

		// turning it off: the token is gone too
		expect(setLink(pid, null)).toBeNull();
		expect(projectRole(pid, d)).toBeNull();
		expect(server.db.select({ t: projects.linkToken }).from(projects).where(eq(projects.id, pid)).get()!.t).toBeNull();
	});
});

describe('transfer', () => {
	it('leaves one owner and the old owner as editor; a non-member target is 422', async () => {
		const server = await start();
		const pid = project();
		const owner = user().id;
		const b = user(B).id;
		member(server, pid, B, 'reader');
		member(server, pid, C, 'editor');
		server.db.insert(overrides).values({ projectId: pid, userId: b, fileId: getMainFileId(pid)!, role: 'editor' }).run();

		expect((await hit(transferRoute.POST, ev(OWNER, { pid }, json('POST', { userId: user(D).id })))).status).toBe(422);
		expect(getProject(pid)!.ownerId).toBe(owner);

		expect((await hit(transferRoute.POST, ev(OWNER, { pid }, json('POST', { userId: b })))).status).toBe(200);
		expect(getProject(pid)!.ownerId).toBe(b);
		const roles = [OWNER, B, C, D].map((e) => projectRole(pid, user(e).id));
		expect(roles).toEqual(['editor', 'owner', 'editor', null]);
		expect(roles.filter((r) => r === 'owner')).toHaveLength(1);
		expect(server.db.select().from(memberships).where(and(eq(memberships.projectId, pid), eq(memberships.userId, b))).get()).toBeUndefined();
		expect(server.db.select().from(overrides).where(eq(overrides.userId, b)).all()).toEqual([]);

		// the old owner can't transfer again; the new one can't hand it to a stranger
		expect(status(() => transferOwnership(pid, owner, user(C).id))).toBe(403);
		expect(status(() => transferOwnership(pid, b, user(D).id))).toBe(422);
	});
});

describe('role change', () => {
	it('a downgrade kicks the connection and the reconnect is read-only', async () => {
		const server = await start();
		const pid = project();
		const main = getMainFileId(pid)!;
		member(server, pid, B, 'editor');
		const b = await connect(server.url, main, B);
		expect(b.provider.authorizedScope).toBe('read-write');
		b.text.insert(0, 'as editor ');
		await waitFor(() => server.hocuspocus.documents.get(main)?.getText('content').toString().startsWith('as editor ') ?? false);

		const state = watch(b.provider);
		const { status: s } = await hit(memberRoute.PATCH, ev(OWNER, { pid, userId: user(B).id }, json('PATCH', { role: 'reader' })));
		expect(s).toBe(200);
		await waitFor(() => state.closed);
		await waitFor(() => b.provider.authorizedScope === 'readonly' && b.provider.isSynced);

		const rows = lastUpdateId(server);
		b.text.insert(0, 'as reader ');
		await settle();
		const text = await getText(main);
		expect(text.startsWith('as editor ')).toBe(true);
		expect(text).not.toContain('as reader');
		expect(lastUpdateId(server)).toBe(rows);

		// and back up through the function
		setMemberRole(pid, user(B).id, 'editor');
		await waitFor(() => b.provider.authorizedScope === 'read-write');
		expect(status(() => setMemberRole(pid, user(D).id, 'reader'))).toBe(404);
	});
});
