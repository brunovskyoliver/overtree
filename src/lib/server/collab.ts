import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { Hocuspocus } from '@hocuspocus/server';
import { asc, eq, lte, and, max } from 'drizzle-orm';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import { openDb } from './db.ts';
import { documents, updates } from './schema.ts';

export const DOC_NAME = 'main.tex';

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

// Hocuspocus 4 has no built-in server here: we own the ws upgrade on /collab
// and forward messages/close events to the ClientConnection ourselves.
export function attachCollab(httpServer: HttpServer, dataDir?: string) {
	const db = openDb(dataDir);

	const hocuspocus = new Hocuspocus({
		debounce: 500,
		maxDebounce: 2000,
		quiet: true,

		async onConnect({ documentName }) {
			// ponytail: single-file project, feature 005 adds real projects/auth
			if (documentName !== DOC_NAME) throw new Error(`unknown document ${documentName}`);
		},

		// Runs before Hocuspocus attaches its own update listener, so nothing here reaches onChange.
		async onLoadDocument({ document, documentName }) {
			const snapshot = db.select().from(documents).where(eq(documents.name, documentName)).get();
			const rows = db
				.select({ update: updates.update })
				.from(updates)
				.where(eq(updates.docName, documentName))
				.orderBy(asc(updates.id))
				.all();
			if (snapshot) Y.applyUpdate(document, snapshot.state);
			for (const row of rows) Y.applyUpdate(document, row.update);

			if (!snapshot && rows.length === 0) {
				document.getText('content').insert(0, SEED);
				// persist the seed ourselves, onChange isn't wired yet during load
				appendUpdate(documentName, Y.encodeStateAsUpdate(document));
			}
		},

		// better-sqlite3 is synchronous: the update is on disk before the next message is handled.
		async onChange({ documentName, update }) {
			appendUpdate(documentName, update);
		},

		// Debounced snapshot + log compaction, one transaction.
		async onStoreDocument({ document, documentName }) {
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

	function appendUpdate(docName: string, update: Uint8Array) {
		db.insert(updates).values({ docName, update: Buffer.from(update), createdAt: Date.now() }).run();
	}

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
	globalThis.__overtreeServer = { hocuspocus, db };

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
