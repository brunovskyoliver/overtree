import { describe, expect, it } from 'vitest';
import { SEED } from '../../src/lib/server/collab.ts';
import { getMainFileId } from '../../src/lib/server/files.ts';
import { documents, updates } from '../../src/lib/server/schema.ts';
import { connect, project, start, tempDir, waitFor, type Started } from './helpers.ts';

// Disconnect every client so Hocuspocus stores immediately, wait for the snapshot, then stop.
async function stopGracefully(server: Started, ...clients: { provider: { destroy(): void } }[]) {
	for (const c of clients) c.provider.destroy();
	await waitFor(
		() =>
			server.db.select().from(documents).all().length === 1 &&
			server.db.select().from(updates).all().length === 0
	);
	await server.stop();
}

/** A server with one fresh project; `main` is its main.tex document. */
async function setup(dir = tempDir()) {
	const server = await start(dir);
	const pid = project();
	return { server, pid, main: getMainFileId(pid)! };
}

describe('collab server', () => {
	it('syncs edits between two clients', async () => {
		const { server, main } = await setup();
		const a = await connect(server.url, main);
		const b = await connect(server.url, main);

		a.text.insert(0, 'from a ');
		await waitFor(() => b.text.toString().startsWith('from a '));
		b.text.insert(b.text.length, 'from b');
		await waitFor(() => a.text.toString().endsWith('from b'));
		expect(a.text.toString()).toBe(b.text.toString());
	});

	it('seeds the starter text exactly once', async () => {
		const dir = tempDir();
		const { server, main } = await setup(dir);
		const [a, b] = await Promise.all([connect(server.url, main), connect(server.url, main)]);
		expect(a.text.toString()).toBe(SEED);
		expect(b.text.toString()).toBe(SEED);
		// no edit after load, so no snapshot: the seed lives in the update log only
		expect(server.db.select().from(updates).all()).toHaveLength(1);
		a.provider.destroy();
		b.provider.destroy();
		await server.stop();

		const again = await connect((await start(dir)).url, main);
		expect(again.text.toString()).toBe(SEED);
	});

	it('keeps text across a restart and compacts the update log on store', async () => {
		const dir = tempDir();
		const { server, main } = await setup(dir);
		const a = await connect(server.url, main);
		a.text.insert(0, '% kept\n');
		const expected = a.text.toString();
		await stopGracefully(server, a); // asserts: one snapshot row, zero update rows

		const reopened = await start(dir);
		const b = await connect(reopened.url, main);
		expect(b.text.toString()).toBe(expected);
	});

	it('recovers from the update log when no snapshot was written', async () => {
		const dir = tempDir();
		const { server, main } = await setup(dir);
		const a = await connect(server.url, main);
		const before = server.db.select().from(updates).all().length;
		a.text.insert(0, '% crash\n');
		const expected = a.text.toString();
		await waitFor(() => server.db.select().from(updates).all().length > before);
		// simulate a crash: the database goes away before the debounced snapshot runs
		server.db.$client.close();
		await server.stop();

		const reopened = await start(dir);
		expect(reopened.db.select().from(documents).all()).toHaveLength(0);
		const b = await connect(reopened.url, main);
		expect(b.text.toString()).toBe(expected);
	});

	it('rejects names that are not text files', async () => {
		const { server } = await setup();
		await expect(connect(server.url, 'other.tex')).rejects.toThrow('forbidden');
		await expect(connect(server.url, 'main.tex')).rejects.toThrow('forbidden'); // the 002 name, now an id
	});
});
