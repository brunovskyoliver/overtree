import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { canEditFiles, fileRole, kick, projectRole, requireEditFiles, requireEditFolder, requireProject } from '../../src/lib/server/access.ts';
import { createEntry, getMainFileId } from '../../src/lib/server/files.ts';
import { memberships, overrides, projects, users, type MemberRole } from '../../src/lib/server/schema.ts';
import { connect, OWNER, project, start, status, user, waitFor, type Started } from './helpers.ts';

// Effective role (005 data-model.md), route guards and Hocuspocus authentication (research R3, R6, R7, R10).

const B = 'b@test.local';

function member(server: Started, pid: string, email: string, role: MemberRole | null, viaLink = false) {
	server.db.insert(memberships).values({ projectId: pid, userId: user(email).id, role, viaLink, createdAt: Date.now() }).run();
}

function override(server: Started, pid: string, email: string, fileId: string, role: MemberRole) {
	server.db.insert(overrides).values({ projectId: pid, userId: user(email).id, fileId, role }).run();
}

const setLink = (server: Started, pid: string, role: MemberRole | null) =>
	server.db
		.update(projects)
		.set({ linkToken: role && 'token', linkRole: role })
		.where(eq(projects.id, pid))
		.run();

describe('effective role', () => {
	it('owner, invited member, link member, none and disabled', async () => {
		const server = await start();
		const pid = project();
		const owner = user().id;
		expect(projectRole(pid, owner)).toBe('owner');
		expect(projectRole(pid, user(B).id)).toBeNull();
		expect(projectRole('nope', owner)).toBeNull();

		member(server, pid, B, 'reader');
		expect(projectRole(pid, user(B).id)).toBe('reader');

		// link membership counts only while the link is on; the higher of invited and link role wins
		member(server, pid, 'c@test.local', null, true);
		expect(projectRole(pid, user('c@test.local').id)).toBeNull();
		server.db.update(memberships).set({ viaLink: true }).where(eq(memberships.userId, user(B).id)).run();
		setLink(server, pid, 'editor');
		expect(projectRole(pid, user('c@test.local').id)).toBe('editor');
		expect(projectRole(pid, user(B).id)).toBe('editor');
		setLink(server, pid, 'reader');
		expect(projectRole(pid, user(B).id)).toBe('reader');

		server.db.update(users).set({ disabled: true }).where(eq(users.id, owner)).run();
		expect(projectRole(pid, owner)).toBeNull();
	});

	it('requireProject: 401 signed out, 404 for non-members, 403 for a too-low role', async () => {
		const server = await start();
		const pid = project();
		expect(status(() => requireProject({ user: null }, pid, 'read'))).toBe(401);
		expect(status(() => requireProject({ user: user(B) }, pid, 'read'))).toBe(404);
		expect(status(() => requireProject({ user: user(B) }, 'missing', 'read'))).toBe(404);
		member(server, pid, B, 'reader');
		expect(requireProject({ user: user(B) }, pid, 'read').role).toBe('reader');
		expect(status(() => requireProject({ user: user(B) }, pid, 'edit'))).toBe(403);
		server.db.update(memberships).set({ role: 'editor' }).where(eq(memberships.userId, user(B).id)).run();
		expect(requireProject({ user: user(B) }, pid, 'edit').role).toBe('editor');
		expect(status(() => requireProject({ user: user(B) }, pid, 'owner'))).toBe(403);
		expect(requireProject({ user: user() }, pid, 'owner').role).toBe('owner');
	});

	it('tree edits need edit access on the item, every descendant and the destination', async () => {
		const server = await start();
		const pid = project();
		const b = user(B).id;
		member(server, pid, B, 'editor');
		const chapters = createEntry(pid, { kind: 'folder', name: 'chapters', parentId: null });
		const intro = createEntry(pid, { kind: 'text', name: 'intro.tex', parentId: chapters.id });
		const locked = createEntry(pid, { kind: 'folder', name: 'locked', parentId: null });
		override(server, pid, B, intro.id, 'reader');
		override(server, pid, B, locked.id, 'reader');

		expect(fileRole(pid, b, intro.id)).toBe('reader');
		expect(fileRole(pid, b, chapters.id)).toBe('editor');
		expect(canEditFiles(pid, b, [chapters.id])).toBe(false); // a descendant is read-only
		expect(canEditFiles(pid, b, [getMainFileId(pid)!])).toBe(true);
		expect(status(() => requireEditFiles(pid, b, [chapters.id]))).toBe(403);
		expect(status(() => requireEditFolder(pid, b, locked.id))).toBe(403); // move or create into it
		requireEditFolder(pid, b, null); // the root: project role

		// the nearest override wins: an editor override inside a reader folder
		const inner = createEntry(pid, { kind: 'text', name: 'inner.tex', parentId: locked.id });
		expect(fileRole(pid, b, inner.id)).toBe('reader');
		override(server, pid, B, inner.id, 'editor');
		expect(fileRole(pid, b, inner.id)).toBe('editor');
		// the owner is never limited by overrides
		expect(canEditFiles(pid, user().id, [chapters.id, locked.id])).toBe(true);
		// overrides go with their file
		server.db.delete(overrides).where(and(eq(overrides.fileId, intro.id))).run();
		expect(canEditFiles(pid, b, [chapters.id])).toBe(true);
	});
});

describe('collab authentication', () => {
	it('refuses a missing token, a non-member and a disabled user; members connect, readers read-only', async () => {
		const server = await start();
		const pid = project();
		const main = getMainFileId(pid)!;
		await expect(connect(server.url, main, null)).rejects.toThrow('forbidden');
		await expect(connect(server.url, main, B)).rejects.toThrow('forbidden');

		member(server, pid, B, 'reader');
		const reader = await connect(server.url, main, B);
		const owner = await connect(server.url, main, OWNER);
		expect(reader.provider.authorizedScope).toBe('readonly');
		expect(owner.provider.authorizedScope).toBe('read-write');

		// a reader's edit never reaches the document
		reader.text.insert(0, 'from a reader ');
		owner.text.insert(0, 'from the owner ');
		await waitFor(() => reader.text.toString().includes('from the owner'));
		await new Promise((r) => setTimeout(r, 200));
		expect(owner.text.toString()).not.toContain('from a reader');

		server.db.update(users).set({ disabled: true }).where(eq(users.id, user(B).id)).run();
		await expect(connect(server.url, main, B)).rejects.toThrow('forbidden');
	});

	it('the presence document admits members read-only and nobody else', async () => {
		const server = await start();
		const pid = project();
		await expect(connect(server.url, `project:${pid}`, B)).rejects.toThrow('forbidden');
		await expect(connect(server.url, 'project:nope')).rejects.toThrow('forbidden');
		const owner = await connect(server.url, `project:${pid}`);
		expect(owner.provider.authorizedScope).toBe('readonly');
	});

	it('kick closes the matching connections and the reconnect gets the current role', async () => {
		const server = await start();
		const pid = project();
		const main = getMainFileId(pid)!;
		member(server, pid, B, 'editor');
		const b = await connect(server.url, main, B);
		const owner = await connect(server.url, main, OWNER);
		expect(b.provider.authorizedScope).toBe('read-write');

		server.db.update(memberships).set({ role: 'reader' }).where(eq(memberships.userId, user(B).id)).run();
		let closed = false;
		b.provider.on('close', () => (closed = true));
		kick({ userId: user(B).id, projectId: pid });
		await waitFor(() => closed);
		await waitFor(() => b.provider.authorizedScope === 'readonly');
		expect(owner.provider.authorizedScope).toBe('read-write'); // not kicked
	});
});
