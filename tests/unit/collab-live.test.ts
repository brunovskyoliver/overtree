import { describe, expect, it } from 'vitest';
import { YSyncConfig } from 'y-codemirror.next';
import * as Y from 'yjs';
import { broadcast } from '../../src/lib/server/access.ts';
import { getMainFileId } from '../../src/lib/server/files.ts';
import { memberships } from '../../src/lib/server/schema.ts';
import { connect, project, start, user, waitFor } from './helpers.ts';

// Live collaboration (005 US4) on the server side: convergence, per-user undo, offline merge, project events and
// awareness. The browser side is tests/e2e/presence.spec.ts and collab5.spec.ts.

const B = 'b@test.local';

async function setup() {
	const server = await start();
	const pid = project();
	return { server, pid, main: getMainFileId(pid)! };
}

describe('live collaboration', () => {
	it('converges with interleaved edits from two providers', async () => {
		const { server, main } = await setup();
		const a = await connect(server.url, main);
		const b = await connect(server.url, main);
		for (let i = 0; i < 20; i++) {
			// whole tokens at token boundaries (start or end), so no marker splits another
			a.text.insert(i % 2 ? 0 : a.text.length, `a${i} `);
			b.text.insert(i % 2 ? b.text.length : 0, `b${i} `);
		}
		await waitFor(() => a.text.toString() === b.text.toString() && a.text.toString().includes('a19') && a.text.toString().includes('b19'));
		for (let i = 0; i < 20; i++) for (const who of 'ab') expect(a.text.toString()).toContain(`${who}${i} `);
	});

	it('undo with the y-codemirror origin reverts only local changes', async () => {
		const { server, main } = await setup();
		const a = await connect(server.url, main);
		const b = await connect(server.url, main);
		// what yCollab sets up in the editor: local typing is transacted with the sync config as origin
		const conf = new YSyncConfig(a.text, a.provider.awareness);
		const undo = new Y.UndoManager(a.text);
		undo.addTrackedOrigin(conf);
		const seed = a.text.toString();
		a.doc.transact(() => a.text.insert(0, 'MINE '), conf);
		await waitFor(() => b.text.toString().startsWith('MINE '));
		b.text.insert(b.text.length, ' THEIRS');
		await waitFor(() => a.text.toString().endsWith(' THEIRS'));
		undo.undo();
		await waitFor(() => b.text.toString() === `${seed} THEIRS`);
		expect(a.text.toString()).toBe(`${seed} THEIRS`);
		expect(undo.canUndo()).toBe(false); // the remote edit was never on the stack
	});

	it('merges edits made offline on reconnect', async () => {
		const { server, main } = await setup();
		const a = await connect(server.url, main);
		const b = await connect(server.url, main);
		const socket = b.provider.configuration.websocketProvider;
		socket.disconnect();
		await waitFor(() => socket.status === 'disconnected');
		b.text.insert(0, 'offline-b ');
		a.text.insert(a.text.length, ' online-a');
		await new Promise((r) => setTimeout(r, 200));
		expect(a.text.toString()).not.toContain('offline-b');
		socket.connect();
		await waitFor(() => a.text.toString() === b.text.toString() && a.text.toString().includes('offline-b'));
		expect(b.text.toString()).toContain(' online-a');
	});

	it('broadcast reaches the project-document subscribers', async () => {
		const { server, pid } = await setup();
		const events: string[] = [];
		const p = await connect(server.url, `project:${pid}`);
		p.provider.on('stateless', ({ payload }: { payload: string }) => events.push(payload));
		broadcast(pid, { type: 'tree' });
		await waitFor(() => events.length === 1);
		expect(JSON.parse(events[0])).toEqual({ type: 'tree' });
	});

	it('propagates awareness from a read-only connection', async () => {
		const { server, pid, main } = await setup();
		server.db.insert(memberships).values({ projectId: pid, userId: user(B).id, role: 'reader', viaLink: false, createdAt: Date.now() }).run();
		const a = await connect(server.url, main);
		const reader = await connect(server.url, main, B);
		reader.provider.awareness!.setLocalStateField('user', { id: user(B).id, name: 'B' });
		const seen = () => [...a.provider.awareness!.getStates().values()].some((s) => s.user?.name === 'B');
		await waitFor(seen);
		// and on the project document (top-bar avatars)
		const pa = await connect(server.url, `project:${pid}`);
		const pb = await connect(server.url, `project:${pid}`, B);
		pb.provider.awareness!.setLocalStateField('fileId', main);
		await waitFor(() => [...pa.provider.awareness!.getStates().values()].some((s) => s.fileId === main));
		// leaving clears it for the others
		reader.provider.destroy();
		await waitFor(() => !seen());
	});
});
