import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
	createEntry,
	deleteEntry,
	getMainFileId,
	getText,
	listFiles,
	readBlob,
	renameOrMove,
	setMainFile,
	setText,
	uploadFile
} from '../../src/lib/server/files.ts';
import { closeVersion, lastVersion, listVersions } from '../../src/lib/server/history.ts';
import { restoreVersion } from '../../src/lib/server/restore.ts';
import { files, memberships, overrides } from '../../src/lib/server/schema.ts';
import * as restoreRoute from '../../src/routes/api/projects/[pid]/history/[vid]/restore/+server.ts';
import { connect, ev, hit, json, OWNER, project, start, user, waitFor } from './helpers.ts';

// Restore (008 US2, research R5): single file and whole project, as new versions, through Yjs, with per-file roles.

const B = 'b@test.local';
const R = 'r@test.local';

async function setup() {
	const server = await start();
	const pid = project();
	const now = Date.now();
	for (const [email, role] of [
		[B, 'editor'],
		[R, 'reader']
	] as const)
		server.db
			.insert(memberships)
			.values({
				projectId: pid,
				userId: user(email).id,
				role,
				viaLink: false,
				createdAt: now
			})
			.run();
	return { server, pid, main: getMainFileId(pid)! };
}

const byPath = (pid: string) => {
	const all = listFiles(pid);
	const path = (id: string | null): string => {
		const f = all.find((x) => x.id === id)!;
		return f.parentId ? `${path(f.parentId)}/${f.name}` : f.name;
	};
	return new Map(all.map((f) => [path(f.id), f]));
};
const restore = (pid: string, vid: number, email: string, body: object = {}) =>
	hit(restoreRoute.POST, ev(email, { pid, vid: String(vid) }, json('POST', body)));

describe('restoreVersion', () => {
	it('restores one file as a new restore version; other files and history untouched', async () => {
		const { pid, main } = await setup();
		const b = user(B).id;
		const notes = createEntry(pid, { kind: 'text', name: 'notes.tex', parentId: null }, b);
		await setText(main, 'good\n', { userId: b, projectId: pid });
		await setText(notes.id, 'notes v1\n', { userId: b, projectId: pid });
		const good = closeVersion(pid, 'edit')!;
		await setText(main, 'bad\n', { userId: b, projectId: pid });
		await setText(notes.id, 'notes v2\n', { userId: b, projectId: pid });
		const before = listVersions(pid, b).versions.map((v) => v.id);

		const res = await restore(pid, good.id, B, { fileId: main });
		expect(res.status).toBe(200);
		expect(res.body.skipped).toEqual([]);
		expect(res.body.version).toMatchObject({
			kind: 'restore',
			restoredFrom: { id: good.id },
			authors: [{ id: b }]
		});
		expect(res.body.version.changed).toEqual([{ id: main, path: 'main.tex', change: 'edited' }]);
		expect(await getText(main)).toBe('good\n');
		expect(await getText(notes.id)).toBe('notes v2\n');
		// the bad state was sealed as its own version first; every old version is still there
		const after = listVersions(pid, b).versions;
		expect(after.map((v) => v.kind).slice(0, 2)).toEqual(['restore', 'edit']);
		expect(after.map((v) => v.id)).toEqual(expect.arrayContaining(before));
		// nothing left to restore: no new version
		expect((await restore(pid, good.id, B, { fileId: main })).body).toEqual({
			version: null,
			skipped: []
		});
	});

	it('restores the whole project: added, deleted, renamed, binary and main file', async () => {
		const { server, pid, main } = await setup();
		const o = user().id;
		const ch = createEntry(pid, { kind: 'folder', name: 'chapters', parentId: null }, o);
		const intro = createEntry(pid, { kind: 'text', name: 'intro.tex', parentId: ch.id }, o);
		await setText(intro.id, 'intro\n', { userId: o, projectId: pid });
		const img = (await uploadFile(pid, null, 'fig.png', new Uint8Array([1, 2, 3]), false, o)).entry;
		const other = createEntry(pid, { kind: 'text', name: 'other.tex', parentId: null }, o);
		const v = closeVersion(pid, 'edit')!;

		deleteEntry(pid, ch.id, o); // folder and file gone
		renameOrMove(pid, main, { name: 'paper.tex' }, o);
		await uploadFile(pid, null, 'fig.png', new Uint8Array([9, 9, 9, 9]), true, o);
		createEntry(pid, { kind: 'text', name: 'later.tex', parentId: null }, o);
		setMainFile(pid, other.id, o);
		// a swap of names needs both moves at once
		const a = createEntry(pid, { kind: 'text', name: 'a.tex', parentId: null }, o);
		closeVersion(pid, 'edit');
		renameOrMove(pid, other.id, { name: 'tmp.tex' }, o);
		renameOrMove(pid, a.id, { name: 'other.tex' }, o);
		renameOrMove(pid, other.id, { name: 'a.tex' }, o);

		const res = await restoreVersion(pid, v.id, o);
		expect(res.skipped).toEqual([]);
		expect(res.version).toMatchObject({
			kind: 'restore',
			restoredFrom: { id: v.id }
		});
		const now = byPath(pid);
		expect([...now.keys()].sort()).toEqual(['chapters', 'chapters/intro.tex', 'fig.png', 'main.tex', 'other.tex']);
		expect(now.get('main.tex')!.id).toBe(main);
		expect(now.get('other.tex')!.id).toBe(other.id);
		expect(now.get('chapters/intro.tex')!.id).not.toBe(intro.id); // recreated: a new id
		expect(await getText(now.get('chapters/intro.tex')!.id)).toBe('intro\n');
		expect(now.get('fig.png')).toMatchObject({ id: img.id, size: 3 });
		const { hash } = server.db.select({ hash: files.hash }).from(files).where(eq(files.id, img.id)).get()!;
		expect([...readBlob(hash!)]).toEqual([1, 2, 3]);
		expect(getMainFileId(pid)).toBe(main);
		expect(listVersions(pid, o).versions.map((v) => v.kind)).toEqual(['restore', 'edit', 'edit', 'edit', 'baseline']);
	});

	it('a reader is refused; a missing version is a 404', async () => {
		const { pid, main } = await setup();
		const v = lastVersion(pid)!;
		expect((await restore(pid, v.id, R)).status).toBe(403);
		expect((await restore(pid, v.id, R, { fileId: main })).status).toBe(403);
		expect((await restore(pid, 99999, OWNER)).status).toBe(404);
		expect((await restore(pid, v.id, OWNER, { fileId: 5 })).status).toBe(400);
	});

	it('an editor with a read-only file: single restore refused, project restore skips and lists it', async () => {
		const { server, pid, main } = await setup();
		const o = user().id;
		const ch = createEntry(pid, { kind: 'folder', name: 'chapters', parentId: null }, o);
		const c2 = createEntry(pid, { kind: 'text', name: 'chapter2.tex', parentId: ch.id }, o);
		await setText(c2.id, 'two\n', { userId: o, projectId: pid });
		const v = closeVersion(pid, 'edit')!;
		await setText(c2.id, 'two changed\n', { userId: o, projectId: pid });
		await setText(main, 'main changed\n', { userId: o, projectId: pid });
		createEntry(pid, { kind: 'text', name: 'new.tex', parentId: ch.id }, o);
		server.db
			.insert(overrides)
			.values({
				projectId: pid,
				userId: user(B).id,
				fileId: c2.id,
				role: 'reader'
			})
			.run();

		expect((await restore(pid, v.id, B, { fileId: c2.id })).status).toBe(403);
		expect(await getText(c2.id)).toBe('two changed\n');

		const res = await restore(pid, v.id, B);
		expect(res.status).toBe(200);
		expect(res.body.skipped).toEqual(['chapters/chapter2.tex']);
		expect(await getText(c2.id)).toBe('two changed\n');
		expect(await getText(main)).toBe((await import('../../src/lib/server/collab.ts')).SEED);
		expect(byPath(pid).has('chapters/new.tex')).toBe(false);

		// the owner is never restricted
		server.db.insert(overrides).values({ projectId: pid, userId: o, fileId: c2.id, role: 'reader' }).run();
		const own = await restore(pid, v.id, OWNER, { fileId: c2.id });
		expect(own.status).toBe(200);
		expect(await getText(c2.id)).toBe('two\n');
	});

	it('a file whose old folder isn’t restored is skipped whole: neither moved nor its text restored (T054)', async () => {
		const { server, pid } = await setup();
		const o = user().id;
		const ro = createEntry(pid, { kind: 'folder', name: 'ro', parentId: null }, o);
		const sub = createEntry(pid, { kind: 'folder', name: 'sub', parentId: ro.id }, o);
		const x = createEntry(pid, { kind: 'text', name: 'x.tex', parentId: sub.id }, o);
		await setText(x.id, 'old\n', { userId: o, projectId: pid });
		const v = closeVersion(pid, 'edit')!;
		renameOrMove(pid, x.id, { parentId: null }, o);
		deleteEntry(pid, sub.id, o);
		await setText(x.id, 'new\n', { userId: o, projectId: pid });
		// B can't recreate ro/sub, so x.tex has nowhere to go back to
		server.db.insert(overrides).values({ projectId: pid, userId: user(B).id, fileId: ro.id, role: 'reader' }).run();

		const res = await restore(pid, v.id, B);
		expect(res.status).toBe(200);
		expect(res.body.skipped).toEqual(['ro/sub', 'x.tex']);
		expect(byPath(pid).get('x.tex')!.id).toBe(x.id);
		expect(await getText(x.id)).toBe('new\n');
	});

	it('a collaborator typing during a restore: both apply and the clients converge', async () => {
		const { server, pid, main } = await setup();
		const { SEED } = await import('../../src/lib/server/collab.ts');
		const v = lastVersion(pid)!; // the seed text
		const b = await connect(server.url, main, B);
		b.text.insert(0, 'mine\n');
		await waitFor(() => false === b.provider.hasUnsyncedChanges);
		while (!(await getText(main)).startsWith('mine')) await new Promise((r) => setTimeout(r, 10));

		// B keeps typing at the top while the owner restores the file
		const restoring = restoreVersion(pid, v.id, user().id, main);
		for (const [i, ch] of [...'abc'].entries()) {
			b.text.insert(i, ch);
			await new Promise((r) => setTimeout(r, 5));
		}
		expect((await restoring).version).not.toBeNull();

		const c = await connect(server.url, main, OWNER);
		await waitFor(() => !b.provider.hasUnsyncedChanges && b.text.toString() === c.text.toString() && !b.text.toString().includes('mine'));
		expect(b.text.toString()).toBe(`abc${SEED}`);
		expect(await getText(main)).toBe(`abc${SEED}`);
	});

	it('an open document gets the restored text live; the collaborator can’t undo it', async () => {
		const { server, pid, main } = await setup();
		const b = await connect(server.url, main, B);
		const undo = new Y.UndoManager(b.text); // tracks local edits only, like y-codemirror's
		const v = lastVersion(pid)!;
		b.text.insert(0, 'mine\n');
		while (!(await getText(main)).startsWith('mine')) await new Promise((r) => setTimeout(r, 10));
		const res = await restoreVersion(pid, v.id, user().id, main);
		expect(res.version).not.toBeNull();
		await waitFor(() => !b.text.toString().startsWith('mine'));
		const restored = b.text.toString();
		expect(undo.undoStack.length).toBe(1); // only b's own insert
		undo.undo();
		expect(b.text.toString()).toBe(restored);
	});
});

describe('files recreated at the same path', () => {
	it('restore and diff treat a deleted-then-recreated file as the same file', async () => {
		const { pid } = await setup();
		const b = user(B).id;
		const notes = createEntry(pid, { kind: 'text', name: 'notes.tex', parentId: null }, b);
		await setText(notes.id, 'v1\n', { userId: b, projectId: pid });
		const v1 = closeVersion(pid, 'edit')!;
		deleteEntry(pid, notes.id, b);
		closeVersion(pid, 'edit');

		// the project restore recreates notes.tex with a new id
		expect((await restore(pid, v1.id, B)).status).toBe(200);
		const recreated = byPath(pid).get('notes.tex')!;
		expect(recreated.id).not.toBe(notes.id);
		const { diffVersion } = await import('../../src/lib/server/history-diff.ts');
		expect(diffVersion(pid, v1.id, 'current', b).files).toEqual([]);

		// edited afterwards: one edited entry, and restoring it (either id) edits the recreated file in place
		await setText(recreated.id, 'v2\n', { userId: b, projectId: pid });
		expect(diffVersion(pid, v1.id, 'current', b).files).toMatchObject([{ id: recreated.id, path: 'notes.tex', change: 'edited' }]);
		expect((await restore(pid, v1.id, B, { fileId: recreated.id })).status).toBe(200);
		expect(byPath(pid).get('notes.tex')!.id).toBe(recreated.id);
		expect(await getText(recreated.id)).toBe('v1\n');
		await setText(recreated.id, 'v3\n', { userId: b, projectId: pid });
		expect((await restore(pid, v1.id, B, { fileId: notes.id })).status).toBe(200);
		expect(byPath(pid).get('notes.tex')!.id).toBe(recreated.id);
		expect(await getText(recreated.id)).toBe('v1\n');
	});
});
