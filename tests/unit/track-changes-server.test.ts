import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getMainFileId, getText, setText } from '../../src/lib/server/files.ts';
import { closeVersion } from '../../src/lib/server/history.ts';
import { documents, memberships } from '../../src/lib/server/schema.ts';
import { changesOf, recordEdit, resolveChanges, type Author } from '../../src/lib/track-changes.ts';
import * as projectRoute from '../../src/routes/api/projects/[pid]/+server.ts';
import * as restoreRoute from '../../src/routes/api/projects/[pid]/history/[vid]/restore/+server.ts';
import * as trackRoute from '../../src/routes/api/projects/[pid]/track-changes/+server.ts';
import { connect, ev, hit, json, OWNER, project, start, user, waitFor } from './helpers.ts';

// Track changes (013) through the collab server: records sync live and persist with the document, the project
// switch is for owners and editors and reaches open editors, restore drops a file's suggestions.

const B = 'b@test.local';
const R = 'r@test.local';

async function setup(dataDir?: string) {
	const server = await start(dataDir);
	const pid = project();
	for (const [email, role] of [
		[B, 'editor'],
		[R, 'reader']
	] as const)
		server.db.insert(memberships).values({ projectId: pid, userId: user(email).id, role, viaLink: false, createdAt: Date.now() }).run();
	return { server, pid, main: getMainFileId(pid)! };
}

/** `author` types `s` at `at` in a provider's document, recorded like the editor does. */
function typeIn(doc: Y.Doc, at: number, s: string, author: Author) {
	const t = doc.getText('content');
	const origin = {};
	const before = resolveChanges(t);
	doc.transact(() => t.insert(at, s), origin);
	recordEdit(t, [{ fromA: at, toA: at, fromB: at, toB: at + s.length, deleted: '' }], before, author, origin);
}

const bob: Author = { id: `test_${B}`, name: 'b', color: '#81c995' };

describe('track changes on the server', () => {
	it('suggestions reach the other editor live and survive a server restart', async () => {
		const { server, main } = await setup();
		const a = await connect(server.url, main);
		const b = await connect(server.url, main, B);
		typeIn(b.doc, 0, '% new\n', bob);
		await waitFor(() => resolveChanges(a.text).length === 1);
		const [r] = resolveChanges(a.text);
		expect(a.text.toString().slice(r.from, r.to)).toBe('% new\n');
		expect(r.change.author.id).toBe(bob.id);

		// stored with the document: a fresh server on the same data has them
		await waitFor(() => !b.provider.hasUnsyncedChanges);
		await waitFor(() => {
			const stored = server.db.select().from(documents).all().find((row) => row.name === main);
			if (!stored) return false;
			const snapshot = new Y.Doc();
			try {
				Y.applyUpdate(snapshot, stored.state);
				return resolveChanges(snapshot.getText('content')).length === 1;
			} finally {
				snapshot.destroy();
			}
		});
		a.provider.destroy();
		b.provider.destroy();
		const dir = server.dataDir;
		await server.stop();
		const again = await start(dir);
		const c = await connect(again.url, main);
		expect(resolveChanges(c.text).map((x) => c.text.toString().slice(x.from, x.to))).toEqual(['% new\n']);
	});

	it("a reader's records are dropped like their text", async () => {
		const { server, main } = await setup();
		const a = await connect(server.url, main);
		const r = await connect(server.url, main, R);
		typeIn(r.doc, 0, 'nope ', { ...bob, id: `test_${R}` });
		await new Promise((res) => setTimeout(res, 300));
		expect(changesOf(a.doc).size).toBe(0);
		expect(await getText(main)).not.toContain('nope');
	});

	it('the switch: owner and editors set it, readers get 403, details and open editors follow', async () => {
		const { server, pid } = await setup();
		const events: string[] = [];
		const p = await connect(server.url, `project:${pid}`);
		p.provider.on('stateless', ({ payload }: { payload: string }) => events.push(payload));
		const put = (email: string, body: unknown) => hit(trackRoute.PUT, ev(email, { pid }, json('PUT', body)));
		const details = async () => (await hit(projectRoute.GET, ev(R, { pid }))).body.trackChanges;

		expect(await details()).toBe(false);
		expect((await put(B, { on: true })).status).toBe(204);
		expect(await details()).toBe(true);
		await waitFor(() => events.includes(JSON.stringify({ type: 'project' })));
		expect((await put(R, { on: false })).status).toBe(403);
		expect((await put(OWNER, { on: 'yes' })).status).toBe(400);
		expect((await put(OWNER, { on: false })).status).toBe(204);
		expect(await details()).toBe(false);
	});

	it('restoring a version drops the file’s suggestions and keeps the version’s text', async () => {
		const { server, pid, main } = await setup();
		const ctx = { userId: user(B).id, projectId: pid };
		await setText(main, 'good\n', ctx);
		const good = closeVersion(pid, 'edit')!;
		const a = await connect(server.url, main, B);
		typeIn(a.doc, 0, 'suggested ', bob);
		await waitFor(() => !a.provider.hasUnsyncedChanges);
		const res = await hit(restoreRoute.POST, ev(B, { pid, vid: String(good.id) }, json('POST', { fileId: main })));
		expect(res.status).toBe(200);
		await waitFor(() => a.text.toString() === 'good\n');
		expect(changesOf(a.doc).size).toBe(0);
	});
});
