import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createEntry, deleteEntry, getFile, getMainFileId, renameOrMove, setMainFile, setText, uploadFile } from '../../src/lib/server/files.ts';
import {
	blobText,
	closeVersion,
	IDLE_MS,
	lastVersion,
	manifestPaths,
	MAX_OPEN_MS,
	readManifest,
	sweep,
	type Changed
} from '../../src/lib/server/history.ts';
import { deleteProject } from '../../src/lib/server/projects.ts';
import { historyLog, memberships, versionLabels, versions } from '../../src/lib/server/schema.ts';
import { connect, OWNER, project, start, tempDir, user, waitFor, type Started } from './helpers.ts';

// History log, versions and manifests (008 Phase 2, research R1–R3).

const B = 'b@test.local';

async function setup(dir = tempDir()) {
	const server = await start(dir);
	const pid = project();
	server.db.insert(memberships).values({ projectId: pid, userId: user(B).id, role: 'editor', viaLink: false, createdAt: Date.now() }).run();
	return { server, pid, main: getMainFileId(pid)! };
}

const log = (s: Started, pid: string) => s.db.select().from(historyLog).where(eq(historyLog.projectId, pid)).all();
const allVersions = (s: Started, pid: string) => s.db.select().from(versions).where(eq(versions.projectId, pid)).all();
const changes = (v: { changed: string }) => (JSON.parse(v.changed) as Changed[]).map((c) => [c.change, c.path, c.from]);

describe('history log', () => {
	it('text rows carry the socket user and the direct connection context', async () => {
		const { server, pid, main } = await setup();
		const a = await connect(server.url, main, OWNER);
		const b = await connect(server.url, main, B);
		a.text.insert(0, 'from a\n');
		await waitFor(() => log(server, pid).some((r) => r.userId === user().id));
		b.text.insert(0, 'from b\n');
		await waitFor(() => log(server, pid).some((r) => r.userId === user(B).id));
		await setText(main, 'server\n', { userId: user(B).id, projectId: pid });
		await setText(main, 'system\n', {});
		await waitFor(() => log(server, pid).filter((r) => r.kind === 'text').length === 4);
		expect(log(server, pid).map((r) => [r.kind, r.userId])).toEqual([
			['baseline', null], // the new project's starting point
			['text', user().id],
			['text', user(B).id],
			['text', user(B).id],
			['text', null]
		]);
	});

	it('setText sends a minimal edit, not the whole text', async () => {
		const { server, pid, main } = await setup();
		const long = 'x'.repeat(5000);
		await setText(main, `${long}\nold line\n${long}\n`, {});
		const before = log(server, pid).length;
		await setText(main, `${long}\nnew line\n${long}\n`, {});
		await waitFor(() => log(server, pid).length > before);
		const update = log(server, pid).at(-1)!.update!;
		expect(update.length).toBeLessThan(200);
		const doc = new Y.Doc();
		for (const r of log(server, pid)) if (r.update) Y.applyUpdate(doc, r.update);
		expect(doc.getText('content').toString()).toBe(`${long}\nnew line\n${long}\n`);
	});

	it('tree operations log their actor', async () => {
		const { server, pid, main } = await setup();
		const b = user(B).id;
		const folder = createEntry(pid, { kind: 'folder', name: 'ch', parentId: null }, b);
		const intro = createEntry(pid, { kind: 'text', name: 'intro.tex', parentId: folder.id }, b);
		renameOrMove(pid, intro.id, { name: 'one.tex' }, b);
		setMainFile(pid, intro.id, b);
		await uploadFile(pid, null, 'dot.png', new Uint8Array([1, 2, 3]), false, b);
		await uploadFile(pid, null, 'dot.png', new Uint8Array([4, 5]), true, b);
		await uploadFile(pid, null, 'refs.bib', new TextEncoder().encode('@book{a}'), false, b);
		await waitFor(() => log(server, pid).some((r) => r.kind === 'text'));
		deleteEntry(pid, main, b);
		expect(log(server, pid).map((r) => [r.kind, r.userId])).toEqual([
			['baseline', null],
			...Array(6).fill(['tree', b]), // create ×2, rename, main, upload, replace
			['tree', b], // refs.bib created...
			['text', b], // ...and its text written through Yjs
			['tree', b] // delete
		]);
	});
});

describe('versions', () => {
	it('a new project starts with one baseline version holding its files', async () => {
		const { server, pid, main } = await setup();
		const [v] = allVersions(server, pid);
		expect(v).toMatchObject({ kind: 'baseline', authors: '[]' });
		expect(changes(v)).toEqual([['added', 'main.tex', undefined]]);
		const m = readManifest(v.manifestHash);
		expect(m.mainFileId).toBe(main);
		expect(blobText(m.entries[0].hash!)).toContain('\\documentclass{article}');
	});

	it('compile closes a version only when something changed; authors come from log rows only', async () => {
		const { server, pid, main } = await setup();
		expect(closeVersion(pid, 'compile')).toBeNull();
		const b = await connect(server.url, main, B);
		b.text.insert(0, '% b\n');
		await waitFor(() => log(server, pid).some((r) => r.kind === 'text'));
		const v = closeVersion(pid, 'compile')!;
		expect(v).toMatchObject({ kind: 'compile', authors: JSON.stringify([user(B).id]) });
		expect(changes(v)).toEqual([['edited', 'main.tex', undefined]]);
		expect(closeVersion(pid, 'compile')).toBeNull();
		expect(allVersions(server, pid).map((x) => x.kind)).toEqual(['baseline', 'compile']);
	});

	it('the sweep closes one version after the idle time or the max open time', async () => {
		const { server, pid, main } = await setup();
		const a = await connect(server.url, main, OWNER);
		a.text.insert(0, 'one ');
		await waitFor(() => log(server, pid).some((r) => r.kind === 'text'));
		const last = log(server, pid).at(-1)!.createdAt;
		sweep(last + IDLE_MS - 1);
		expect(allVersions(server, pid)).toHaveLength(1);
		sweep(last + IDLE_MS);
		sweep(last + IDLE_MS * 2);
		expect(allVersions(server, pid).map((v) => v.kind)).toEqual(['baseline', 'edit']);

		// continuous typing: the oldest open row is MAX_OPEN_MS old, the newest is fresh
		a.text.insert(0, 'two ');
		await waitFor(() => log(server, pid).length > 2);
		const open = log(server, pid).at(-1)!;
		server.db.update(historyLog).set({ createdAt: open.createdAt - MAX_OPEN_MS }).where(eq(historyLog.id, open.id)).run();
		a.text.insert(0, 'three ');
		await waitFor(() => log(server, pid).length > 3);
		sweep(log(server, pid).at(-1)!.createdAt + 1);
		expect(allVersions(server, pid)).toHaveLength(3);
		expect(lastVersion(pid)!.startedAt).toBe(open.createdAt - MAX_OPEN_MS);
	});

	it('manifests reconstruct the tree, texts, binaries and main file; changed lists renames, edits, deletions', async () => {
		const { server, pid, main } = await setup();
		const me = user().id;
		const ch = createEntry(pid, { kind: 'folder', name: 'ch', parentId: null }, me);
		const intro = createEntry(pid, { kind: 'text', name: 'intro.tex', parentId: ch.id }, me);
		await setText(intro.id, 'Intro\n', { userId: me, projectId: pid });
		const png = await uploadFile(pid, ch.id, 'dot.png', new Uint8Array([1, 2, 3]), false, me);
		setMainFile(pid, intro.id, me);
		await waitFor(() => log(server, pid).some((r) => r.kind === 'text'));
		const v1 = closeVersion(pid, 'edit')!;
		const m1 = readManifest(v1.manifestHash);
		const paths = manifestPaths(m1.entries);
		const byPath = new Map(m1.entries.map((e) => [paths.get(e.id), e]));
		expect([...byPath.keys()].sort()).toEqual(['ch', 'ch/dot.png', 'ch/intro.tex', 'main.tex']);
		expect(blobText(byPath.get('ch/intro.tex')!.hash!)).toBe('Intro\n');
		expect(byPath.get('ch/dot.png')!.hash).toBe(getFile(pid, png.entry.id)!.hash);
		expect(byPath.get('ch')!.hash).toBeNull();
		expect(m1.mainFileId).toBe(intro.id);
		expect(changes(v1).sort()).toEqual([
			['added', 'ch', undefined],
			['added', 'ch/dot.png', undefined],
			['added', 'ch/intro.tex', undefined]
		]);
		// main.tex untouched: its text blob is reused
		expect(byPath.get('main.tex')!.hash).toBe(readManifest(allVersions(server, pid)[0].manifestHash).entries[0].hash);

		renameOrMove(pid, ch.id, { name: 'chapters' }, me);
		await setText(intro.id, 'Intro, longer\n', { userId: me, projectId: pid });
		deleteEntry(pid, main, me);
		await waitFor(() => log(server, pid).filter((r) => r.kind === 'text').length === 2);
		const v2 = closeVersion(pid, 'edit')!;
		expect(changes(v2).sort()).toEqual([
			['deleted', 'main.tex', undefined],
			['renamed', 'chapters', 'ch'],
			['renamed', 'chapters/dot.png', 'ch/dot.png'],
			['renamed', 'chapters/intro.tex', 'ch/intro.tex']
		]);
		const m2 = readManifest(v2.manifestHash);
		expect(blobText(m2.entries.find((e) => e.id === intro.id)!.hash!)).toBe('Intro, longer\n');
	});

	it('a restart closes what was open; an upgraded project without history gets its baseline', async () => {
		const dir = tempDir();
		const { server, pid, main } = await setup(dir);
		const old = project(OWNER, 'Before 008');
		// as if created before history existed
		server.db.delete(versions).where(eq(versions.projectId, old)).run();
		server.db.delete(historyLog).where(eq(historyLog.projectId, old)).run();
		const a = await connect(server.url, main, OWNER);
		a.text.insert(0, 'open ');
		await waitFor(() => log(server, pid).some((r) => r.kind === 'text'));
		a.provider.destroy();
		await server.stop();

		const again = await start(dir);
		expect(allVersions(again, pid).map((v) => v.kind)).toEqual(['baseline', 'edit']);
		expect(allVersions(again, old).map((v) => v.kind)).toEqual(['baseline']);
		expect(log(again, old).map((r) => r.kind)).toEqual(['baseline']);
	});

	it('deleting a project removes its history', async () => {
		const { server, pid } = await setup();
		const keep = project(OWNER, 'Other');
		const v = closeVersion(pid, 'restore')!; // a restore may be empty
		server.db.insert(versionLabels).values({ projectId: pid, versionId: v.id, name: 'x', userId: user().id, createdAt: 1 }).run();
		deleteProject(pid);
		for (const t of [historyLog, versions, versionLabels])
			expect(server.db.select().from(t).where(eq(t.projectId, pid)).all()).toEqual([]);
		expect(server.db.select().from(versions).where(and(eq(versions.projectId, keep), eq(versions.kind, 'baseline'))).all()).toHaveLength(1);
	});
});
