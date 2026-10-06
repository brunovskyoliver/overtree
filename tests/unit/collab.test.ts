import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { attachCollab, SEED } from '../../src/lib/server/collab.ts';
import { listFiles } from '../../src/lib/server/files.ts';
import { documents, updates } from '../../src/lib/server/schema.ts';

type Started = Awaited<ReturnType<typeof start>>;
const cleanup: (() => unknown)[] = [];

afterEach(async () => {
	while (cleanup.length) await cleanup.pop()!();
});

async function start(dataDir: string) {
	const http = createServer();
	const collab = attachCollab(http, dataDir);
	await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
	const url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/collab`;
	let closed = false;
	const stop = async () => {
		if (closed) return;
		closed = true;
		for (const ws of collab.wss.clients) ws.terminate();
		http.closeAllConnections();
		await new Promise((r) => http.close(r));
		if (collab.db.$client.open) collab.db.$client.close();
	};
	cleanup.push(stop);
	return { ...collab, url, stop };
}

// Node's global WebSocket is used by the provider (no `ws` polyfill needed on Node >= 22).
// Default: the project's only file, main.tex, by its id (the last started server's).
async function connect(server: Started, name = listFiles()[0].id) {
	const doc = new Y.Doc();
	const provider = new HocuspocusProvider({ url: server.url, name, document: doc });
	cleanup.push(() => provider.destroy());
	await new Promise<void>((resolve, reject) => {
		provider.on('synced', () => resolve());
		provider.on('authenticationFailed', ({ reason }: { reason: string }) => reject(new Error(reason)));
	});
	return { doc, provider, text: doc.getText('content') };
}

async function waitFor(check: () => boolean, ms = 3000) {
	const until = Date.now() + ms;
	while (!check()) {
		if (Date.now() > until) throw new Error('waitFor timed out');
		await new Promise((r) => setTimeout(r, 10));
	}
}

const tempDir = () => mkdtempSync(join(tmpdir(), 'overtree-test-'));

// Disconnect every client so Hocuspocus stores immediately, wait for the snapshot, then stop.
async function stopGracefully(server: Started, ...clients: { provider: HocuspocusProvider }[]) {
	for (const c of clients) c.provider.destroy();
	await waitFor(
		() =>
			server.db.select().from(documents).all().length === 1 &&
			server.db.select().from(updates).all().length === 0
	);
	await server.stop();
}

describe('collab server', () => {
	it('syncs edits between two clients', async () => {
		const server = await start(tempDir());
		const a = await connect(server);
		const b = await connect(server);

		a.text.insert(0, 'from a ');
		await waitFor(() => b.text.toString().startsWith('from a '));
		b.text.insert(b.text.length, 'from b');
		await waitFor(() => a.text.toString().endsWith('from b'));
		expect(a.text.toString()).toBe(b.text.toString());
	});

	it('seeds the starter text exactly once', async () => {
		const dir = tempDir();
		const server = await start(dir);
		const [a, b] = await Promise.all([connect(server), connect(server)]);
		expect(a.text.toString()).toBe(SEED);
		expect(b.text.toString()).toBe(SEED);
		// no edit after load, so no snapshot: the seed lives in the update log only
		expect(server.db.select().from(updates).all()).toHaveLength(1);
		a.provider.destroy();
		b.provider.destroy();
		await server.stop();

		const again = await connect(await start(dir));
		expect(again.text.toString()).toBe(SEED);
	});

	it('keeps text across a restart and compacts the update log on store', async () => {
		const dir = tempDir();
		const server = await start(dir);
		const a = await connect(server);
		a.text.insert(0, '% kept\n');
		const expected = a.text.toString();
		await stopGracefully(server, a); // asserts: one snapshot row, zero update rows

		const reopened = await start(dir);
		const b = await connect(reopened);
		expect(b.text.toString()).toBe(expected);
	});

	it('recovers from the update log when no snapshot was written', async () => {
		const dir = tempDir();
		const server = await start(dir);
		const a = await connect(server);
		const before = server.db.select().from(updates).all().length;
		a.text.insert(0, '% crash\n');
		const expected = a.text.toString();
		await waitFor(() => server.db.select().from(updates).all().length > before);
		// simulate a crash: the database goes away before the debounced snapshot runs
		server.db.$client.close();
		await server.stop();

		const reopened = await start(dir);
		expect(reopened.db.select().from(documents).all()).toHaveLength(0);
		const b = await connect(reopened);
		expect(b.text.toString()).toBe(expected);
	});

	it('rejects names that are not text files', async () => {
		const server = await start(tempDir());
		await expect(connect(server, 'other.tex')).rejects.toThrow();
		await expect(connect(server, 'main.tex')).rejects.toThrow(); // the 002 name, now an id
	});
});
