import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createEntry, deleteEntry, getFile, getMainFileId, renameOrMove, setMainFile, setText, uploadFile } from '../../src/lib/server/files.ts';
import {
	blobText,
	closeVersion,
	IDLE_MS,
	lastVersion,
	listVersions,
	manifestPaths,
	MAX_OPEN_MS,
	readManifest,
	sweep,
	type Changed
} from '../../src/lib/server/history.ts';
import { deleteProject } from '../../src/lib/server/projects.ts';
import { restoreVersion } from '../../src/lib/server/restore.ts';
import { historyLog, memberships, versionLabels, versions } from '../../src/lib/server/schema.ts';
import * as labelsRoute from '../../src/routes/api/projects/[pid]/history/labels/+server.ts';
import * as labelRoute from '../../src/routes/api/projects/[pid]/history/labels/[lid]/+server.ts';
import { connect, ev, hit, json, OWNER, project, start, tempDir, user, waitFor, type Started } from './helpers.ts';

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

describe('labels (US5, research R6)', () => {
	const R = 'r@test.local';
	const C = 'c@test.local';
	async function setupLabels() {
		const s = await setup();
		for (const [email, role] of [
			[R, 'reader'],
			[C, 'editor']
		] as const)
			s.server.db
				.insert(memberships)
				.values({ projectId: s.pid, userId: user(email).id, role, viaLink: false, createdAt: Date.now() })
				.run();
		return s;
	}
	const add = (pid: string, email: string, body: object) => hit(labelsRoute.POST, ev(email, { pid }, json('POST', body)));
	const rename = (pid: string, lid: number, email: string, name: unknown) =>
		hit(labelRoute.PATCH, ev(email, { pid, lid: String(lid) }, json('PATCH', { name })));
	const remove = (pid: string, lid: number, email: string) => hit(labelRoute.DELETE, ev(email, { pid, lid: String(lid) }));

	it('editors add, readers can’t; names are trimmed and 1–100 characters', async () => {
		const { pid } = await setupLabels();
		const v = lastVersion(pid)!;
		expect((await add(pid, R, { versionId: v.id, name: 'Draft' })).status).toBe(403);
		const res = await add(pid, B, { versionId: v.id, name: '  Draft 1  ' });
		expect(res).toMatchObject({ status: 201, body: { versionId: v.id, name: 'Draft 1', user: { id: user(B).id }, canEdit: true } });
		expect((await add(pid, B, { versionId: v.id, name: '   ' })).status).toBe(400);
		expect((await add(pid, B, { versionId: v.id, name: 'x'.repeat(101) })).status).toBe(400);
		expect((await add(pid, B, { versionId: v.id, name: 'x'.repeat(100) })).status).toBe(201);
		expect((await add(pid, B, { versionId: 'one', name: 'x' })).status).toBe(400);
		expect((await add(pid, B, { versionId: 99999, name: 'x' })).status).toBe(404);
		// a version of another project
		const other = project(OWNER, 'Other');
		expect((await add(pid, OWNER, { versionId: lastVersion(other)!.id, name: 'x' })).status).toBe(404);
	});

	it('only the author or the owner renames and deletes; canEdit says so', async () => {
		const { pid } = await setupLabels();
		const v = lastVersion(pid)!;
		const { body: label } = await add(pid, B, { versionId: v.id, name: 'Submitted' });
		expect((await rename(pid, label.id, C, 'Mine now')).status).toBe(403);
		expect((await remove(pid, label.id, C)).status).toBe(403);
		expect((await rename(pid, label.id, R, 'Mine now')).status).toBe(403);
		expect(listVersions(pid, user(C).id).versions[0].labels).toMatchObject([{ name: 'Submitted', canEdit: false }]);
		expect(listVersions(pid, user().id).versions[0].labels).toMatchObject([{ name: 'Submitted', canEdit: true }]);

		expect(await rename(pid, label.id, B, ' Final ')).toMatchObject({ status: 200, body: { id: label.id, name: 'Final' } });
		expect((await rename(pid, label.id, B, '')).status).toBe(400);
		expect(await rename(pid, label.id, OWNER, 'Final 2')).toMatchObject({ status: 200, body: { name: 'Final 2', canEdit: true } });
		expect((await remove(pid, label.id, OWNER)).status).toBe(204);
		expect((await remove(pid, label.id, OWNER)).status).toBe(404);

		const { body: second } = await add(pid, B, { versionId: v.id, name: 'Again' });
		expect((await remove(pid, second.id, B)).status).toBe(204);
		expect(listVersions(pid, user().id).versions[0].labels).toEqual([]);
		// a label of another project
		const other = project(OWNER, 'Other');
		const { body: foreign } = await add(other, OWNER, { versionId: lastVersion(other)!.id, name: 'x' });
		expect((await rename(pid, foreign.id, OWNER, 'y')).status).toBe(404);
	});

	it('an author demoted to reader can no longer change their label (FR-017)', async () => {
		const { pid, server } = await setupLabels();
		const { body: label } = await add(pid, C, { versionId: lastVersion(pid)!.id, name: 'Mine' });
		server.db
			.update(memberships)
			.set({ role: 'reader' })
			.where(and(eq(memberships.projectId, pid), eq(memberships.userId, user(C).id)))
			.run();
		expect(listVersions(pid, user(C).id).versions[0].labels).toMatchObject([{ name: 'Mine', canEdit: false }]);
		expect((await rename(pid, label.id, C, 'Still mine')).status).toBe(403);
		expect((await remove(pid, label.id, C)).status).toBe(403);
	});

	it('labeling the current version closes open edits into a version first, else labels the newest', async () => {
		const { server, pid, main } = await setupLabels();
		const first = lastVersion(pid)!;
		expect((await add(pid, B, { name: 'Nothing new' })).body.versionId).toBe(first.id);

		const b = await connect(server.url, main, B);
		b.text.insert(0, '% open edit\n');
		await waitFor(() => log(server, pid).some((r) => r.kind === 'text'));
		const res = await add(pid, B, { name: 'Before review' });
		const v = lastVersion(pid)!;
		expect(v).toMatchObject({ kind: 'edit', authors: JSON.stringify([user(B).id]) });
		expect(res.body.versionId).toBe(v.id);
		expect(blobText(readManifest(v.manifestHash).entries.find((e) => e.id === main)!.hash!)).toContain('% open edit');
	});

	it('the labels-only list skips unlabeled versions', async () => {
		const { pid } = await setupLabels();
		const a = closeVersion(pid, 'restore')!;
		closeVersion(pid, 'restore');
		const c = closeVersion(pid, 'restore')!;
		await add(pid, B, { versionId: a.id, name: 'A' });
		await add(pid, B, { versionId: c.id, name: 'C1' });
		await add(pid, OWNER, { versionId: c.id, name: 'C2' });
		const o = user().id;
		expect(listVersions(pid, o).versions).toHaveLength(4);
		const only = listVersions(pid, o, { labelsOnly: true });
		expect(only.versions.map((v) => [v.id, v.labels.map((l) => l.name)])).toEqual([
			[c.id, ['C1', 'C2']],
			[a.id, ['A']]
		]);
		expect(listVersions(pid, o, { labelsOnly: true, limit: 1 })).toMatchObject({ hasMore: true, versions: [{ id: c.id }] });
		expect(listVersions(pid, o, { labelsOnly: true, before: c.id }).versions.map((v) => v.id)).toEqual([a.id]);
	});
});

describe('performance (SC-002, SC-003)', () => {
	it('the first page of 1,000 versions loads in under 1 s', async () => {
		const { server, pid } = await setup();
		const base = lastVersion(pid)!;
		const authors = JSON.stringify([user().id, user(B).id]);
		const edit = (i: number): Changed => ({ id: `f${i}`, path: `ch/part-${i}.tex`, change: 'edited' });
		const changed = JSON.stringify([0, 1, 2, 3, 4].map(edit));
		server.db.transaction((tx) => {
			for (let i = 1; i <= 1000; i++) {
				const t = base.createdAt + i * 60_000;
				const kind = i % 7 ? 'edit' : 'compile';
				const row = { ...base, id: undefined, kind, authors, changed, startedAt: t - 30_000, createdAt: t } as const;
				const v = tx.insert(versions).values(row).returning().get();
				if (i % 10 === 0)
					tx.insert(versionLabels).values({ projectId: pid, versionId: v.id, name: `Draft ${i}`, userId: user(B).id, createdAt: t }).run();
			}
		});
		// a neighbor project's history in the same tables
		const other = project(OWNER, 'Other');
		for (let i = 0; i < 200; i++) closeVersion(other, 'restore');

		let t0 = performance.now();
		const page = listVersions(pid, user().id);
		expect(performance.now() - t0).toBeLessThan(1000);
		expect(page).toMatchObject({ hasMore: true, versions: { length: 50 } });
		expect(page.versions[0].labels).toMatchObject([{ name: 'Draft 1000' }]);

		t0 = performance.now();
		const labeled = listVersions(pid, user().id, { labelsOnly: true, before: page.versions.at(-1)!.id });
		expect(performance.now() - t0).toBeLessThan(1000);
		expect(labeled.versions).toHaveLength(50);
	});

	it('a whole-project restore of 50 files takes under 2 s', async () => {
		const { pid } = await setup();
		const me = user().id;
		const ctx = { userId: me, projectId: pid };
		const ch = createEntry(pid, { kind: 'folder', name: 'chapters', parentId: null }, me);
		const body = (n: number, tag: string) => Array.from({ length: 40 }, (_, l) => `Line ${l} of section ${n}, ${tag}.\n`).join('');
		const texts = [];
		for (let i = 0; i < 50; i++) {
			const f = createEntry(pid, { kind: 'text', name: `s${i}.tex`, parentId: ch.id }, me);
			await setText(f.id, body(i, 'good'), ctx);
			texts.push(f);
		}
		const good = closeVersion(pid, 'edit')!;
		// 10 deleted, 10 renamed, 30 edited
		for (const [i, f] of texts.entries()) {
			if (i < 10) deleteEntry(pid, f.id, me);
			else if (i < 20) renameOrMove(pid, f.id, { name: `renamed-${i}.tex` }, me);
			else await setText(f.id, body(i, 'bad'), ctx);
		}
		closeVersion(pid, 'edit');

		const t0 = performance.now();
		const { version, skipped } = await restoreVersion(pid, good.id, me);
		expect(performance.now() - t0).toBeLessThan(2000);
		expect(skipped).toEqual([]);
		expect(version!.changed).toHaveLength(50);
	});
});
