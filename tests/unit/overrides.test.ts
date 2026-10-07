import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { canEditFiles, fileRole } from '../../src/lib/server/access.ts';
import { createEntry, getMainFileId, getText } from '../../src/lib/server/files.ts';
import { joinByLink, setLink } from '../../src/lib/server/projects.ts';
import { memberships, overrides, type MemberRole } from '../../src/lib/server/schema.ts';
import * as filesRoute from '../../src/routes/api/projects/[pid]/files/+server.ts';
import * as fileRoute from '../../src/routes/api/projects/[pid]/files/[id]/+server.ts';
import * as overridesRoute from '../../src/routes/api/projects/[pid]/overrides/+server.ts';
import { connect, ev, hit, json, OWNER, project, start, user, waitFor, type Started } from './helpers.ts';

// Per-file and per-folder permissions (005 US6, FR-040–FR-043): resolution, the overrides route and enforcement
// on Yjs and tree operations.

const B = 'b@test.local';

function member(server: Started, pid: string, email: string, role: MemberRole) {
	server.db.insert(memberships).values({ projectId: pid, userId: user(email).id, role, viaLink: false, createdAt: Date.now() }).run();
}

/** PUT /overrides as `email`; the response status. */
const put = async (pid: string, body: object, email = OWNER) => (await hit(overridesRoute.PUT, ev(email, { pid }, json('PUT', body)))).status;

const tree = (pid: string) => {
	const chapters = createEntry(pid, { kind: 'folder', name: 'chapters', parentId: null }, user().id);
	const intro = createEntry(pid, { kind: 'text', name: 'intro.tex', parentId: chapters.id }, user().id);
	const other = createEntry(pid, { kind: 'folder', name: 'other', parentId: null }, user().id);
	return { chapters: chapters.id, intro: intro.id, other: other.id, main: getMainFileId(pid)! };
};

describe('resolution', () => {
	it('nearest override wins; overrides raise and lower; the owner is never restricted', async () => {
		const server = await start();
		const pid = project();
		const b = user(B).id;
		const t = tree(pid);
		member(server, pid, B, 'editor');
		expect(await put(pid, { userId: b, fileId: t.chapters, role: 'reader' })).toBe(200);
		expect(fileRole(pid, b, t.intro)).toBe('reader');
		expect(await put(pid, { userId: b, fileId: t.intro, role: 'editor' })).toBe(200);
		expect(fileRole(pid, b, t.intro)).toBe('editor');
		expect(fileRole(pid, b, t.chapters)).toBe('reader');
		expect(fileRole(pid, b, t.main)).toBe('editor');

		// raising: a project Reader with Editor on chapters/
		server.db.update(memberships).set({ role: 'reader' }).where(eq(memberships.userId, b)).run();
		server.db.delete(overrides).run();
		expect(await put(pid, { userId: b, fileId: t.chapters, role: 'editor' })).toBe(200);
		expect(fileRole(pid, b, t.intro)).toBe('editor');
		expect(fileRole(pid, b, t.main)).toBe('reader');
		const listed = (await hit(filesRoute.GET, ev(B, { pid }))).body.files as { id: string; canEdit: boolean }[];
		expect(listed.filter((f) => f.canEdit).map((f) => f.id).sort()).toEqual([t.chapters, t.intro].sort());
		// can create inside chapters/, not at the root
		const create = (parentId: string | null) => hit(filesRoute.POST, ev(B, { pid }, json('POST', { kind: 'text', name: 'n.tex', parentId })));
		expect((await create(t.chapters)).status).toBe(201);
		expect((await create(null)).status).toBe(403);

		// the owner can't get an override and none limits them
		expect(await put(pid, { userId: user().id, fileId: t.main, role: 'reader' })).toBe(422);
		expect(canEditFiles(pid, user().id, [t.chapters, t.main])).toBe(true);

		// removing restores the project role
		expect(await put(pid, { userId: b, fileId: t.chapters, role: null })).toBe(200);
		expect(fileRole(pid, b, t.intro)).toBe('reader');
	});

	it('a moved file keeps its own override and takes the new folder’s otherwise', async () => {
		const server = await start();
		const pid = project();
		const b = user(B).id;
		const t = tree(pid);
		const loose = createEntry(pid, { kind: 'text', name: 'loose.tex', parentId: null }, user().id).id;
		member(server, pid, B, 'editor');
		await put(pid, { userId: b, fileId: t.other, role: 'reader' });
		await put(pid, { userId: b, fileId: t.intro, role: 'editor' });
		const move = (id: string) => hit(fileRoute.PATCH, ev(OWNER, { pid, id }, json('PATCH', { parentId: t.other })));
		expect((await move(t.intro)).status).toBe(200);
		expect((await move(loose)).status).toBe(200);
		expect(fileRole(pid, b, t.intro)).toBe('editor');
		expect(fileRole(pid, b, loose)).toBe('reader');
	});
});

describe('overrides route', () => {
	it('owner only, named collaborators only, files of this project only, valid roles only', async () => {
		const server = await start();
		const pid = project();
		const t = tree(pid);
		const b = user(B).id;
		member(server, pid, B, 'editor');
		expect(await put(pid, { userId: b, fileId: t.main, role: 'reader' }, B)).toBe(403);
		expect(await put(pid, { userId: user('stranger@test.local').id, fileId: t.main, role: 'reader' })).toBe(422);
		expect(await put(pid, { userId: b, fileId: getMainFileId(project())!, role: 'reader' })).toBe(404);
		expect(await put(pid, { userId: b, fileId: t.main, role: 'owner' })).toBe(422);
		expect(await put(pid, { userId: b, fileId: t.main })).toBe(422);
		// a link-only user has the link role everywhere
		const token = setLink(pid, 'editor')!.token;
		joinByLink(token, user('link@test.local').id);
		expect(await put(pid, { userId: user('link@test.local').id, fileId: t.main, role: 'reader' })).toBe(422);
		expect(server.db.select().from(overrides).all()).toEqual([]);
	});

	it('deleting a file or folder removes its overrides and those of its descendants', async () => {
		const server = await start();
		const pid = project();
		const t = tree(pid);
		const b = user(B).id;
		member(server, pid, B, 'editor');
		await put(pid, { userId: b, fileId: t.chapters, role: 'reader' });
		await put(pid, { userId: b, fileId: t.intro, role: 'editor' });
		await put(pid, { userId: b, fileId: t.main, role: 'reader' });
		expect((await hit(fileRoute.DELETE, ev(OWNER, { pid, id: t.chapters }))).status).toBe(204);
		expect(server.db.select({ fileId: overrides.fileId }).from(overrides).all()).toEqual([{ fileId: t.main }]);
	});
});

describe('enforcement', () => {
	it('a Yjs update to an overridden read-only file is rejected, other files accept it; a change kicks the open connection', async () => {
		const server = await start();
		const pid = project();
		const t = tree(pid);
		const b = user(B).id;
		member(server, pid, B, 'editor');
		await put(pid, { userId: b, fileId: t.main, role: 'reader' });
		const before = await getText(t.main);

		const locked = await connect(server.url, t.main, B);
		const open = await connect(server.url, t.intro, B);
		expect(locked.provider.authorizedScope).toBe('readonly');
		expect(open.provider.authorizedScope).toBe('read-write');
		locked.text.insert(0, 'nope ');
		open.text.insert(0, 'yes ');
		await waitFor(() => server.hocuspocus.documents.get(t.intro)?.getText('content').toString() === 'yes ');
		await new Promise((r) => setTimeout(r, 200));
		expect(await getText(t.main)).toBe(before);

		// lowering intro.tex: the open connection reconnects read-only
		await put(pid, { userId: b, fileId: t.intro, role: 'reader' });
		await waitFor(() => open.provider.authorizedScope === 'readonly');
	});

	it('tree ops need edit on the item, its descendants and the destination', async () => {
		const server = await start();
		const pid = project();
		const t = tree(pid);
		const b = user(B).id;
		member(server, pid, B, 'editor');
		await put(pid, { userId: b, fileId: t.intro, role: 'reader' });
		await put(pid, { userId: b, fileId: t.other, role: 'reader' });
		const patch = (id: string, body: object) => hit(fileRoute.PATCH, ev(B, { pid, id }, json('PATCH', body)));
		expect((await patch(t.chapters, { name: 'ch' })).status).toBe(403); // a descendant is read-only
		expect((await hit(fileRoute.DELETE, ev(B, { pid, id: t.chapters }))).status).toBe(403);
		expect((await patch(t.main, { parentId: t.other })).status).toBe(403); // read-only destination
		const form = new FormData();
		form.set('file', new File(['x'], 'up.tex'));
		form.set('parentId', t.other);
		expect((await hit(filesRoute.POST, ev(B, { pid }, new Request('http://x/', { method: 'POST', body: form })))).status).toBe(403);
		expect((await patch(t.main, { parentId: t.chapters })).status).toBe(200);
	});
});
