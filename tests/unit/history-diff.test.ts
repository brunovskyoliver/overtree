import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { SEED } from '../../src/lib/server/collab.ts';
import { createEntry, deleteEntry, getMainFileId, renameOrMove, setText, uploadFile } from '../../src/lib/server/files.ts';
import type { FileDiff, Segment } from '../../src/lib/history-types.ts';
import { diffVersion } from '../../src/lib/server/history-diff.ts';
import { closeVersion, lastVersion, listVersions, userRefs } from '../../src/lib/server/history.ts';
import { historyLog, memberships, overrides } from '../../src/lib/server/schema.ts';
import * as listRoute from '../../src/routes/api/projects/[pid]/history/+server.ts';
import * as diffRoute from '../../src/routes/api/projects/[pid]/history/[vid]/+server.ts';
import { connect, ev, hit, OWNER, project, start, user, waitFor, type Started } from './helpers.ts';

// Per-author diffs (008 US1, research R4) and the history read routes.

const B = 'b@test.local';
const R = 'r@test.local';

async function setup() {
	const server = await start();
	const pid = project();
	const now = Date.now();
	server.db
		.insert(memberships)
		.values({ projectId: pid, userId: user(B).id, role: 'editor', viaLink: false, createdAt: now })
		.run();
	server.db
		.insert(memberships)
		.values({ projectId: pid, userId: user(R).id, role: 'reader', viaLink: false, createdAt: now })
		.run();
	return { server, pid, main: getMainFileId(pid)! };
}

const logged = (s: Started, pid: string) => s.db.select().from(historyLog).where(eq(historyLog.projectId, pid)).all().length;

/** Waits until the server has logged whatever `edit` sends. */
async function edit(s: Started, pid: string, fn: () => void) {
	const n = logged(s, pid);
	fn();
	await waitFor(() => logged(s, pid) > n);
}

const file = (files: FileDiff[], path: string) => files.find((f) => f.path === path)!;
const changes = (segments: Segment[]) => segments.filter((s) => s.op !== '=').map((s) => [s.op, s.text, s.userId]);

describe('diffVersion', () => {
	it('attributes each insert and delete to the user who made it', async () => {
		const { server, pid, main } = await setup();
		const a = await connect(server.url, main, OWNER);
		const b = await connect(server.url, main, B);
		await edit(server, pid, () => a.text.insert(0, '% alpha\n'));
		await waitFor(() => b.text.toString().startsWith('% alpha'));
		await edit(server, pid, () => b.text.insert(b.text.length, '% beta\n'));
		const at = b.text.toString().indexOf('\\maketitle');
		await edit(server, pid, () => b.text.delete(at, '\\maketitle'.length));
		const v = closeVersion(pid, 'edit')!;

		const { files, users, version } = diffVersion(pid, v.id, 'previous', user(R).id);
		expect(version.authors.map((u) => u.id).sort()).toEqual([user(B).id, user().id].sort());
		expect(changes(file(files, 'main.tex').segments!)).toEqual([
			['+', '% alpha\n', user().id],
			['-', '\\maketitle', user(B).id],
			['+', '% beta\n', user(B).id]
		]);
		expect(users.map((u) => u.id).sort()).toEqual([user(B).id, user().id].sort());
	});

	it('vs previous shows the version’s own changes, vs current everything since', async () => {
		const { server, pid, main } = await setup();
		const a = await connect(server.url, main, OWNER);
		await edit(server, pid, () => a.text.insert(0, 'one\n'));
		const v1 = closeVersion(pid, 'edit')!;
		const b = await connect(server.url, main, B);
		await edit(server, pid, () => b.text.insert(0, 'two\n'));
		closeVersion(pid, 'edit');

		expect(changes(file(diffVersion(pid, v1.id, 'previous', user().id).files, 'main.tex').segments!)).toEqual([['+', 'one\n', user().id]]);
		expect(changes(file(diffVersion(pid, v1.id, 'current', user().id).files, 'main.tex').segments!)).toEqual([['+', 'two\n', user(B).id]]);
		// still open (not in a version yet): current shows it too
		await edit(server, pid, () => b.text.insert(b.text.length, 'three\n'));
		expect(changes(file(diffVersion(pid, v1.id, 'current', user().id).files, 'main.tex').segments!)).toEqual([
			['+', 'two\n', user(B).id],
			['+', 'three\n', user(B).id]
		]);
		// nothing since the newest version: no differences
		const last = closeVersion(pid, 'edit')!;
		expect(diffVersion(pid, last.id, 'current', user().id).files).toEqual([]);
	});

	it('a write without a user has no author; unknown accounts are “Unknown user”', async () => {
		const { pid, main } = await setup();
		await setText(main, `${SEED}% system\n`, {});
		const v = closeVersion(pid, 'edit')!;
		expect(changes(file(diffVersion(pid, v.id, 'previous', user().id).files, 'main.tex').segments!)).toEqual([['+', '% system\n', null]]);
		expect(userRefs(['test_gone@test.local']).get('test_gone@test.local')).toMatchObject({ name: 'Unknown user', avatarUrl: null });
	});

	it('lists added, deleted, renamed and binary files', async () => {
		const { pid, main } = await setup();
		const base = lastVersion(pid)!;
		const b = user(B).id;
		const notes = createEntry(pid, { kind: 'text', name: 'notes.tex', parentId: null }, b);
		await setText(notes.id, 'hello\n', { userId: b, projectId: pid });
		await uploadFile(pid, null, 'dot.png', new Uint8Array([1, 2, 3]), false, b);
		renameOrMove(pid, main, { name: 'paper.tex' }, b);
		const v1 = closeVersion(pid, 'edit')!;
		await uploadFile(pid, null, 'dot.png', new Uint8Array([1, 2, 3, 4, 5]), true, b);
		deleteEntry(pid, notes.id, b);

		const now = diffVersion(pid, base.id, 'current', user().id).files;
		expect(now.map((f) => [f.change, f.path, f.oldPath, f.kind])).toEqual([
			['added', 'dot.png', undefined, 'binary'],
			['renamed', 'paper.tex', 'main.tex', 'text']
		]);
		expect(file(now, 'paper.tex').segments).toEqual([{ op: '=', text: SEED, userId: null }]);
		expect(file(now, 'dot.png').size).toEqual({ old: null, new: 5 });

		const own = diffVersion(pid, v1.id, 'previous', user().id).files;
		expect(changes(file(own, 'notes.tex').segments!)).toEqual([['+', 'hello\n', b]]);
		const later = diffVersion(pid, v1.id, 'current', user().id).files;
		expect(file(later, 'dot.png')).toMatchObject({ change: 'edited', size: { old: 3, new: 5 } });
		// a deleted file: plain diff, attributed to the only author of the range
		expect(file(later, 'notes.tex')).toMatchObject({ change: 'deleted', segments: [{ op: '-', text: 'hello\n', userId: b }] });
	});

	it('falls back to a plain diff when the log doesn’t reproduce the texts', async () => {
		const { server, pid, main } = await setup();
		const base = lastVersion(pid)!;
		const a = await connect(server.url, main, OWNER);
		await edit(server, pid, () => a.text.insert(0, 'x'));
		// the baseline row gone: the replay misses the seed text
		server.db
			.delete(historyLog)
			.where(and(eq(historyLog.docName, main), eq(historyLog.kind, 'baseline')))
			.run();
		const f = file(diffVersion(pid, base.id, 'current', user().id).files, 'main.tex');
		expect(
			f
				.segments!.filter((s) => s.op !== '-')
				.map((s) => s.text)
				.join('')
		).toBe(`x${SEED}`);
		expect(changes(f.segments!)).toEqual([['+', 'x', user().id]]);
	});

	it('canRestore follows the caller’s edit rights on the file', async () => {
		const { server, pid, main } = await setup();
		await setText(main, 'changed\n', { userId: user().id, projectId: pid });
		const v = closeVersion(pid, 'edit')!;
		const can = (email: string) => diffVersion(pid, v.id, 'previous', user(email).id).files[0].canRestore;
		expect([can(OWNER), can(B), can(R)]).toEqual([true, true, false]);
		server.db
			.insert(overrides)
			.values({ projectId: pid, userId: user(B).id, fileId: main, role: 'reader' })
			.run();
		expect(can(B)).toBe(false);
	});

	it('canRestore follows the restore’s rules: a file that moves back needs edit on its old folder (T053)', async () => {
		const { server, pid } = await setup();
		const o = user().id;
		const locked = createEntry(pid, { kind: 'folder', name: 'locked', parentId: null }, o);
		const a = createEntry(pid, { kind: 'text', name: 'a.tex', parentId: locked.id }, o);
		await setText(a.id, 'one\n', { userId: o, projectId: pid });
		const v = closeVersion(pid, 'edit')!;
		renameOrMove(pid, a.id, { parentId: null }, o);
		await setText(a.id, 'two\n', { userId: o, projectId: pid });
		server.db.insert(overrides).values({ projectId: pid, userId: user(B).id, fileId: locked.id, role: 'reader' }).run();

		const can = (email: string) => file(diffVersion(pid, v.id, 'current', user(email).id).files, 'a.tex').canRestore;
		// B may edit a.tex where it is now, but not put it back into locked/: the restore would answer 403
		expect([can(OWNER), can(B), can(R)]).toEqual([true, false, false]);
		const { restoreVersion } = await import('../../src/lib/server/restore.ts');
		await expect(restoreVersion(pid, v.id, user(B).id, a.id)).rejects.toMatchObject({ status: 403 });
		// edit on locked/ again: offered, and the restore goes through
		server.db.delete(overrides).run();
		expect(can(B)).toBe(true);
		expect((await restoreVersion(pid, v.id, user(B).id, a.id)).version).not.toBeNull();
	});

	it('another project’s version is a 404', async () => {
		const { pid } = await setup();
		const other = project();
		const v = lastVersion(other)!;
		expect(() => diffVersion(pid, v.id, 'current', user().id)).toThrow(expect.objectContaining({ status: 404 }));
	});
});

describe('history routes', () => {
	it('readers list versions (paged, newest first) and see diffs', async () => {
		const { pid, main } = await setup();
		for (const t of ['a', 'b', 'c']) {
			await setText(main, t, { userId: user(B).id, projectId: pid });
			closeVersion(pid, 'edit');
		}
		const page = await hit(listRoute.GET, {
			...ev(R, { pid }),
			url: new URL('http://x/?limit=2')
		});
		expect(page.status).toBe(200);
		expect(page.body.hasMore).toBe(true);
		expect(page.body.versions.map((v: { kind: string }) => v.kind)).toEqual(['edit', 'edit']);
		expect(page.body.versions[0].authors[0]).toMatchObject({ id: user(B).id, name: 'b' });
		const rest = await hit(listRoute.GET, {
			...ev(R, { pid }),
			url: new URL(`http://x/?before=${page.body.versions[1].id}`)
		});
		expect(rest.body).toMatchObject({ hasMore: false, versions: [{ kind: 'edit' }, { kind: 'baseline' }] });
		expect(listVersions(pid, user(R).id, { labelsOnly: true }).versions).toEqual([]);

		const vid = String(page.body.versions[1].id);
		const d = await hit(diffRoute.GET, {
			...ev(R, { pid, vid }),
			url: new URL('http://x/?compare=previous')
		});
		expect(d.status).toBe(200);
		expect(d.body.files[0]).toMatchObject({ path: 'main.tex', change: 'edited', canRestore: false });
		const other = project();
		const foreign = String(lastVersion(other)!.id);
		expect(
			(
				await hit(diffRoute.GET, {
					...ev(OWNER, { pid, vid: foreign }),
					url: new URL('http://x/')
				})
			).status
		).toBe(404);
		expect(
			(
				await hit(diffRoute.GET, {
					...ev(OWNER, { pid, vid: 'nope' }),
					url: new URL('http://x/')
				})
			).status
		).toBe(404);
	});
});
