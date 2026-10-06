import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getCompiler } from '../../src/lib/server/compile.ts';
import { getMainFileId, listFiles } from '../../src/lib/server/files.ts';
import { listProjects } from '../../src/lib/server/projects.ts';
import { projects, settings } from '../../src/lib/server/schema.ts';
import { connect, start, tempDir, user } from './helpers.ts';

// Upgrading data dirs written before 005 (data-model "Migration data steps", SC-007).

const DRIZZLE = join(import.meta.dirname, '../../drizzle');

/** A data dir migrated with the first `n` migrations only, as an older release left it. */
function oldDb(n: number) {
	const dir = tempDir();
	const folder = join(dir, 'migrations');
	mkdirSync(join(folder, 'meta'), { recursive: true });
	const journal = JSON.parse(readFileSync(join(DRIZZLE, 'meta/_journal.json'), 'utf8'));
	journal.entries = journal.entries.slice(0, n);
	writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
	for (const f of readdirSync(DRIZZLE)) if (f.endsWith('.sql')) copyFileSync(join(DRIZZLE, f), join(folder, f));
	const sqlite = new Database(join(dir, 'overtree.db'));
	migrate(drizzle(sqlite), { migrationsFolder: folder });
	return { dir, sqlite };
}

const state = (text: string) => {
	const doc = new Y.Doc();
	doc.getText('content').insert(0, text);
	return Buffer.from(Y.encodeStateAsUpdate(doc));
};

describe('migration to 005', () => {
	it('a 003 data dir becomes projects("main") without owner; the first user becomes admin and owner (SC-007)', async () => {
		const { dir, sqlite } = oldDb(3);
		sqlite.exec(`
			INSERT INTO project VALUES ('main', 'm');
			INSERT INTO files VALUES ('ch', NULL, 'chapters', 'folder', NULL, NULL, 1, 1);
			INSERT INTO files VALUES ('in', 'ch', 'intro.tex', 'text', NULL, NULL, 1, 1);
			INSERT INTO files VALUES ('m', NULL, 'main.tex', 'text', NULL, NULL, 1, 1);
			INSERT INTO compile_settings VALUES ('main', 'xelatex');
		`);
		sqlite.prepare('INSERT INTO documents VALUES (?, ?, 1)').run('m', state('% main from 003\n'));
		sqlite.prepare('INSERT INTO updates (doc_name, "update", created_at) VALUES (?, ?, 2)').run('in', state('% intro from 003\n'));
		sqlite.close();

		const server = await start(dir);
		expect(server.db.select().from(projects).all()).toMatchObject([{ id: 'main', title: 'Untitled project', ownerId: null, mainFileId: 'm' }]);
		expect(server.db.select().from(settings).get()).toMatchObject({ signupMode: 'invite', allowlist: expect.any(String) });
		expect(listFiles('main').map((f) => f.name).sort()).toEqual(['chapters', 'intro.tex', 'main.tex']);
		expect(getCompiler('main')).toBe('xelatex');

		// the first account ever, whatever its email: admin, and the orphaned project is theirs
		const first = user('first@elsewhere.org');
		expect(first.role).toBe('admin');
		expect(listProjects(first.id)).toMatchObject([{ id: 'main', role: 'owner' }]);
		expect((await connect(server.url, 'm', 'first@elsewhere.org')).text.toString()).toBe('% main from 003\n');
		expect((await connect(server.url, 'in', 'first@elsewhere.org')).text.toString()).toBe('% intro from 003\n');
		// a later account gets nothing that is already owned
		expect(listProjects(user('second@test.local').id)).toEqual([]);
	});

	it('a 001/002 data dir (text under the doc name main.tex) gets a root main.tex as main document', async () => {
		const { dir, sqlite } = oldDb(2);
		sqlite.prepare('INSERT INTO documents VALUES (?, ?, 1)').run('main.tex', state('% from 002\n'));
		sqlite.close();

		const server = await start(dir);
		const files = listFiles('main');
		expect(files).toMatchObject([{ name: 'main.tex', kind: 'text', parentId: null }]);
		expect(getMainFileId('main')).toBe(files[0].id);
		user();
		expect((await connect(server.url, files[0].id)).text.toString()).toBe('% from 002\n');
	});

	it('a fresh data dir has no projects and invite-only sign-up', async () => {
		const server = await start(tempDir());
		expect(server.db.select().from(projects).all()).toEqual([]);
		expect(server.db.select().from(settings).all()).toHaveLength(1);
	});
});
