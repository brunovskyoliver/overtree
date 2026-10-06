// Shared setup for server unit tests: a collab server on a fresh data dir, test users, projects and providers
// signed in through the test bypass (OVERTREE_TEST_AUTH=1 from vite.config.ts).
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { afterEach } from 'vitest';
import * as Y from 'yjs';
import { mirrorUser } from '../../src/lib/server/auth.ts';
import { attachCollab, SEED } from '../../src/lib/server/collab.ts';
import { createProject } from '../../src/lib/server/projects.ts';
import { settings } from '../../src/lib/server/schema.ts';

export const cleanup: (() => unknown)[] = [];
afterEach(async () => {
	while (cleanup.length) await cleanup.pop()!();
});

export const tempDir = () => mkdtempSync(join(tmpdir(), 'overtree-test-'));

export type Started = Awaited<ReturnType<typeof start>>;

/** A collab server on `dataDir`; `stop` closes sockets, the HTTP server and the database (also on cleanup). */
export async function start(dataDir = tempDir()) {
	const http = createServer();
	const collab = attachCollab(http, dataDir);
	// sign-up is invite-only by default: let every @test.local user in (policy tests use other domains)
	collab.db.update(settings).set({ allowlist: JSON.stringify(['@test.local']) }).run();
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
	return { ...collab, url, dataDir, stop };
}

export const OWNER = 'owner@test.local';

/** The user signed in through the test bypass with this email (mirrored like a first request). */
export const user = (email = OWNER) => mirrorUser({ id: `test_${email}`, email });

/** A new project with a seeded root main.tex, owned by `email` (created as needed). */
export function project(email = OWNER, title = 'Untitled project') {
	return createProject({ ownerId: user(email).id, title, mainText: SEED });
}

/** A provider for document `name`, signed in as `email` (null: no token); resolves once synced, rejects with the
 *  reason when authentication fails. */
export async function connect(url: string, name: string, email: string | null = OWNER) {
	const doc = new Y.Doc();
	const provider = new HocuspocusProvider({ url, name, document: doc, token: email === null ? null : `test:${email}` });
	cleanup.push(() => provider.destroy());
	await new Promise<void>((resolve, reject) => {
		provider.on('synced', () => resolve());
		provider.on('authenticationFailed', ({ reason }: { reason: string }) => reject(new Error(reason)));
	});
	return { doc, provider, text: doc.getText('content') };
}

export async function waitFor(check: () => boolean, ms = 3000) {
	const until = Date.now() + ms;
	while (!check()) {
		if (Date.now() > until) throw new Error('waitFor timed out');
		await new Promise((r) => setTimeout(r, 10));
	}
}

/** The status of the FileError `fn` throws. */
export function status(fn: () => unknown) {
	try {
		fn();
	} catch (e) {
		return (e as { status?: number }).status;
	}
	throw new Error('expected a FileError');
}

/** A route handler's response (status and JSON body), or the status of the error it throws. */
export async function hit(handler: (event: never) => Response | Promise<Response>, event: object) {
	try {
		const res = await handler(event as never);
		const type = res.headers.get('content-type') ?? '';
		return { status: res.status, body: type.includes('json') ? await res.json() : null };
	} catch (e) {
		return { status: (e as { status: number }).status, body: null };
	}
}

export const json = (method: string, body: unknown) =>
	new Request('http://x/', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const ev = (email: string, params: Record<string, string>, request?: Request) => ({
	locals: { user: user(email) },
	params,
	request,
	url: new URL('http://x/')
});
