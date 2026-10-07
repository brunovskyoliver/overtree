import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { Hocuspocus } from '@hocuspocus/server';
import { asc, eq, lte, and, max } from 'drizzle-orm';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import { canEdit, fileRole, projectRole, type ConnectionContext } from './access.ts';
import { authenticateToken } from './auth.ts';
import { openDb } from './db.ts';
import { logText, sweep, SWEEP_MS } from './history.ts';
import { touchProject } from './projects.ts';
import { documents, files, updates } from './schema.ts';

export const SEED = `\\documentclass{article}
\\usepackage{graphicx} % Required for inserting images

\\title{Untitled project}
\\author{}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}

\\end{document}
`;

const PRESENCE = 'project:';

/** Refusal for onAuthenticate: the provider gets `authenticationFailed` with this reason (contracts/http-api.md). */
const forbidden = () => Object.assign(new Error('forbidden'), { reason: 'forbidden' });

// Hocuspocus 4 has no built-in server here: we own the ws upgrade on /collab
// and forward messages/close events to the ClientConnection ourselves.
export function attachCollab(httpServer: HttpServer, dataDir = process.env.DATA_DIR ?? './data') {
	const db = openDb(dataDir);
	// Document names are text file ids, plus `project:<id>` for presence and server events (research R8, never
	// persisted). A deleted file's doc may still get a late (debounced) change or store: skip it so the row doesn't
	// come back (research R4).
	const textFile = (id: string) =>
		db.select({ projectId: files.projectId }).from(files).where(and(eq(files.id, id), eq(files.kind, 'text'))).get();
	const isPresence = (name: string) => name.startsWith(PRESENCE);

	// updatedAt from typing, at most every 10 s per project (research R14)
	// ponytail: an in-memory map; a restart may write once more, which is harmless
	const touched = new Map<string, number>();
	const touchThrottled = (pid: string) => {
		const now = Date.now();
		if (now - (touched.get(pid) ?? 0) < 10_000) return;
		touched.set(pid, now);
		touchProject(pid);
	};

	const hocuspocus = new Hocuspocus<ConnectionContext>({
		debounce: 500,
		maxDebounce: 2000,
		quiet: true,

		// Every document on the socket is checked (research R3, R7): a valid token of an enabled user with access.
		// Readers and every presence doc are read-only: Hocuspocus drops their document updates, awareness still flows.
		async onAuthenticate({ token, documentName, connectionConfig }): Promise<ConnectionContext> {
			const user = await authenticateToken(token);
			if (!user || user.disabled) throw forbidden();
			if (isPresence(documentName)) {
				const projectId = documentName.slice(PRESENCE.length);
				if (!projectRole(projectId, user.id)) throw forbidden();
				connectionConfig.readOnly = true;
				return { userId: user.id, projectId };
			}
			const file = textFile(documentName);
			const role = file && fileRole(file.projectId, user.id, documentName);
			if (!file || !role) throw forbidden();
			connectionConfig.readOnly = !canEdit(role);
			return { userId: user.id, projectId: file.projectId };
		},

		// Runs before Hocuspocus attaches its own update listener, so nothing here reaches onChange.
		async onLoadDocument({ document, documentName }) {
			if (isPresence(documentName)) return;
			const snapshot = db.select().from(documents).where(eq(documents.name, documentName)).get();
			const rows = db
				.select({ update: updates.update })
				.from(updates)
				.where(eq(updates.docName, documentName))
				.orderBy(asc(updates.id))
				.all();
			if (snapshot) Y.applyUpdate(document, snapshot.state);
			for (const row of rows) Y.applyUpdate(document, row.update);
			// no seeding here: createProject() stores the starter text of a new project
		},

		// better-sqlite3 is synchronous: the update is on disk before the next message is handled. The history copy
		// carries the author: the socket's context, or the one given to openDirectConnection (research R1).
		async onChange({ documentName, update, context }) {
			const file = !isPresence(documentName) && textFile(documentName);
			if (!file) return;
			db.insert(updates).values({ docName: documentName, update: Buffer.from(update), createdAt: Date.now() }).run();
			logText(file.projectId, documentName, context.userId, update); // buffered (history.ts FLUSH_MS)
			touchThrottled(file.projectId);
		},

		// Debounced snapshot + log compaction, one transaction.
		async onStoreDocument({ document, documentName }) {
			if (isPresence(documentName) || !textFile(documentName)) return;
			db.transaction((tx) => {
				const last = tx
					.select({ id: max(updates.id) })
					.from(updates)
					.where(eq(updates.docName, documentName))
					.get();
				const state = Buffer.from(Y.encodeStateAsUpdate(document));
				const updatedAt = Date.now();
				tx.insert(documents)
					.values({ name: documentName, state, updatedAt })
					.onConflictDoUpdate({ target: documents.name, set: { state, updatedAt } })
					.run();
				if (last?.id != null) {
					tx.delete(updates)
						.where(and(eq(updates.docName, documentName), lte(updates.id, last.id)))
						.run();
				}
			});
		}
	});

	const wss = new WebSocketServer({ noServer: true });

	httpServer.on('upgrade', (req, socket, head) => {
		if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/collab') return; // e.g. Vite HMR
		wss.handleUpgrade(req, socket, head, (ws) => {
			const connection = hocuspocus.handleConnection(ws, toRequest(req));
			ws.on('message', (data: Buffer) => connection.handleMessage(data));
			ws.on('close', (code, reason) => connection.handleClose({ code, reason: reason.toString() }));
		});
	});

	// SvelteKit routes are bundled apart from server.ts/the Vite plugin, so they reach this instance via globalThis.
	globalThis.__overtreeServer = { hocuspocus, db, dataDir };

	// History versions (research R2). At startup nobody is editing across the restart: close whatever is open.
	sweep(Infinity);
	const sweeper = setInterval(() => {
		// a later attachCollab (tests restart the server in one process) or a closed db ends this one
		if (globalThis.__overtreeServer?.db !== db || !db.$client.open) return clearInterval(sweeper);
		try {
			sweep();
		} catch (e) {
			console.error('history sweep failed', e);
		}
	}, SWEEP_MS);
	sweeper.unref();

	return { hocuspocus, wss, db };
}

export function getServer() {
	const server = globalThis.__overtreeServer;
	if (!server) throw new Error('collab server not attached: run via `pnpm dev` or `node server.ts`');
	return server;
}

function toRequest(req: IncomingMessage) {
	const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers)) {
		if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
	}
	return new Request(url, { headers });
}
