import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';

// Opens (and migrates) $DATA_DIR/overtree.db. A function, not a module singleton,
// so tests can reopen the same directory to simulate a restart.
export function openDb(dataDir = process.env.DATA_DIR ?? './data') {
	mkdirSync(dataDir, { recursive: true });
	const sqlite = new Database(join(dataDir, 'overtree.db'));
	sqlite.pragma('journal_mode = WAL');
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: join(import.meta.dirname, '../../../drizzle') });
	return db;
}

export type Db = ReturnType<typeof openDb>;
