import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getSettings, listAllProjects, listUsers, putSettings, updateUser } from '../../src/lib/server/admin.ts';
import { mirrorUser, NotAllowed } from '../../src/lib/server/auth.ts';
import { getMainFileId } from '../../src/lib/server/files.ts';
import { compileSettings, documents, files, invites, memberships, overrides, projects, settings, updates } from '../../src/lib/server/schema.ts';
import * as adminProjects from '../../src/routes/api/admin/projects/+server.ts';
import * as adminSettings from '../../src/routes/api/admin/settings/+server.ts';
import * as adminUser from '../../src/routes/api/admin/users/[id]/+server.ts';
import * as adminUsers from '../../src/routes/api/admin/users/+server.ts';
import * as projectRoute from '../../src/routes/api/projects/[pid]/+server.ts';
import { connect, OWNER, project, start, status, user, waitFor, type Started } from './helpers.ts';

// Instance administration (005 US5): the last-admin rule, disabling with kick, the sign-up settings, admin-only
// routes and deleting a project.

const B = 'b@test.local';

/** A route handler's response status, or the status of the error it throws. */
async function hit(handler: (event: never) => Response | Promise<Response>, event: object) {
	try {
		return (await handler(event as never)).status;
	} catch (e) {
		return (e as { status: number }).status;
	}
}

function member(server: Started, pid: string, email: string, role: 'editor' | 'reader') {
	server.db.insert(memberships).values({ projectId: pid, userId: user(email).id, role, viaLink: false, createdAt: Date.now() }).run();
}

describe('users', () => {
	it('the last enabled admin can be neither demoted nor disabled', async () => {
		await start();
		const admin = user(OWNER); // the first user: admin
		const b = user(B);
		expect(status(() => updateUser(admin.id, { role: 'user' }))).toBe(409);
		expect(status(() => updateUser(admin.id, { disabled: true }))).toBe(409);

		expect(updateUser(b.id, { role: 'admin' })).toMatchObject({ role: 'admin', disabled: false });
		// a disabled admin doesn't count: B disabled, the owner is the last enabled admin again
		updateUser(b.id, { disabled: true });
		expect(status(() => updateUser(admin.id, { role: 'user' }))).toBe(409);
		updateUser(b.id, { disabled: false });
		expect(updateUser(admin.id, { role: 'user' })).toMatchObject({ role: 'user' });
		expect(status(() => updateUser(b.id, { disabled: true }))).toBe(409);

		expect(status(() => updateUser(b.id, { role: 'root' }))).toBe(422);
		expect(status(() => updateUser(b.id, { disabled: 'yes' }))).toBe(422);
		expect(status(() => updateUser('nobody', { disabled: true }))).toBe(404);
	});

	it('lists users with the number of projects they own', async () => {
		await start();
		project(OWNER);
		project(OWNER);
		project(B);
		expect(listUsers().map(({ email, role, projectCount }) => ({ email, role, projectCount }))).toEqual([
			{ email: B, role: 'user', projectCount: 1 },
			{ email: OWNER, role: 'admin', projectCount: 2 }
		]);
	});

	it('disabling kicks a connected provider within 2 s and its reconnect fails; enabling restores access', async () => {
		const server = await start();
		const pid = project();
		member(server, pid, B, 'editor');
		const main = getMainFileId(pid)!;
		const b = await connect(server.url, main, B);
		let refused = 0;
		b.provider.on('authenticationFailed', () => refused++);

		const t = Date.now();
		updateUser(user(B).id, { disabled: true });
		await waitFor(() => refused > 0, 2000);
		expect(Date.now() - t).toBeLessThan(2000);
		await expect(connect(server.url, main, B)).rejects.toThrow('forbidden');

		updateUser(user(B).id, { disabled: false });
		expect((await connect(server.url, main, B)).provider.authorizedScope).toBe('read-write');
	});
});

describe('sign-up settings', () => {
	it('invite-only by default refuses a new email and lets it in once its domain is allowlisted', async () => {
		const server = await start();
		server.db.update(settings).set({ signupMode: 'invite', allowlist: '[]' }).run(); // the defaults, not the helpers' @test.local allowlist
		user(OWNER); // the first user is let in regardless
		expect(getSettings()).toEqual({ signupMode: 'invite', allowlist: [] });
		const newcomer = { id: 'id_new', email: 'new@example.org' };
		expect(() => mirrorUser(newcomer)).toThrow(NotAllowed);

		expect(putSettings({ signupMode: 'invite', allowlist: ['  @Example.ORG ', '', 'one@x.io', 'one@x.io'] })).toEqual({
			signupMode: 'invite',
			allowlist: ['@example.org', 'one@x.io']
		});
		expect(mirrorUser(newcomer).role).toBe('user');
		expect(getSettings().allowlist).toEqual(['@example.org', 'one@x.io']);
	});

	it('rejects bad entries and modes with 422', async () => {
		await start();
		for (const bad of ['example.org', 'a@b@c', 'two words@x.org', '@']) expect(status(() => putSettings({ signupMode: 'invite', allowlist: [bad] })), bad).toBe(422);
		expect(status(() => putSettings({ signupMode: 'closed', allowlist: [] }))).toBe(422);
		expect(status(() => putSettings({ signupMode: 'open', allowlist: 'x@y.z' }))).toBe(422);
		expect(putSettings({ signupMode: 'open', allowlist: [] })).toEqual({ signupMode: 'open', allowlist: [] });
	});
});

describe('admin routes', () => {
	it('refuse non-admins with 403 and signed-out callers with 401', async () => {
		await start();
		const admin = user(OWNER);
		const plain = user(B);
		const pid = project(B);
		const routes: [(event: never) => Response | Promise<Response>, object][] = [
			[adminUsers.GET, {}],
			[adminUser.PATCH, { params: { id: admin.id }, request: new Request('http://x', { method: 'PATCH', body: '{"role":"user"}' }) }],
			[adminSettings.GET, {}],
			[adminSettings.PUT, { request: new Request('http://x', { method: 'PUT', body: '{"signupMode":"open","allowlist":[]}' }) }],
			[adminProjects.GET, {}]
		];
		for (const [handler, event] of routes) {
			expect(await hit(handler, { ...event, locals: { user: plain } })).toBe(403);
			expect(await hit(handler, { ...event, locals: { user: null } })).toBe(401);
		}
		expect(getSettings().signupMode).toBe('invite');
		expect(listUsers().find((u) => u.id === admin.id)!.role).toBe('admin');

		expect(await hit(adminUsers.GET, { locals: { user: admin } })).toBe(200);
		expect(await hit(adminProjects.GET, { locals: { user: admin } })).toBe(200);
		// another user's project: the admin may delete it, a stranger gets 404 like any non-member
		const stranger = user('c@test.local');
		expect(await hit(projectRoute.DELETE, { params: { pid }, locals: { user: stranger } })).toBe(404);
		expect(await hit(projectRoute.DELETE, { params: { pid }, locals: { user: admin } })).toBe(204);
		expect(await hit(projectRoute.DELETE, { params: { pid }, locals: { user: admin } })).toBe(404);
	});

	it('the owner may delete their project, an editor may not', async () => {
		const server = await start();
		const pid = project(B);
		member(server, pid, 'c@test.local', 'editor');
		expect(await hit(projectRoute.DELETE, { params: { pid }, locals: { user: user('c@test.local') } })).toBe(403);
		expect(await hit(projectRoute.DELETE, { params: { pid }, locals: { user: user(B) } })).toBe(204);
	});
});

describe('deleting a project', () => {
	it('removes every row of the project and its compile dir, kicks its editors and leaves other projects alone', async () => {
		const server = await start();
		const pid = project();
		const other = project();
		const main = getMainFileId(pid)!;
		member(server, pid, B, 'editor');
		server.db.insert(invites).values({ projectId: pid, email: 'later@test.local', role: 'reader', createdAt: Date.now() }).run();
		server.db.insert(overrides).values({ projectId: pid, userId: user(B).id, fileId: main, role: 'reader' }).run();
		server.db.insert(compileSettings).values({ project: pid, compiler: 'xelatex' }).run();
		const dir = join(server.dataDir, 'compile', pid);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'output.pdf'), 'pdf');

		const b = await connect(server.url, main, B);
		let refused = false;
		b.provider.on('authenticationFailed', () => (refused = true));

		expect(listAllProjects().find((p) => p.id === pid)).toMatchObject({ collaborators: 1, owner: { email: OWNER } });
		await adminDelete(pid);

		expect(server.db.select().from(projects).where(eq(projects.id, pid)).all()).toEqual([]);
		expect(server.db.select().from(files).where(eq(files.projectId, pid)).all()).toEqual([]);
		for (const t of [memberships, invites, overrides]) expect(server.db.select().from(t).where(eq(t.projectId, pid)).all()).toEqual([]);
		expect(server.db.select().from(compileSettings).all()).toEqual([]);
		expect(server.db.select().from(documents).where(eq(documents.name, main)).all()).toEqual([]);
		expect(server.db.select().from(updates).where(eq(updates.docName, main)).all()).toEqual([]);
		expect(existsSync(dir)).toBe(false);
		await waitFor(() => refused, 2000);

		expect(getMainFileId(other)).toBeTruthy();
		expect(server.db.select().from(updates).where(eq(updates.docName, getMainFileId(other)!)).all().length).toBeGreaterThan(0);
	});
});

/** DELETE /api/projects/:pid as the instance's admin. */
async function adminDelete(pid: string) {
	expect(await hit(projectRoute.DELETE, { params: { pid }, locals: { user: user(OWNER) } })).toBe(204);
}
