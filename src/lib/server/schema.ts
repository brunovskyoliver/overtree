import { blob, index, integer, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Compiler } from '../compile-types.ts';
import type { FileKind } from '../files.ts';

// Compacted Yjs state per document (Y.encodeStateAsUpdate).
export const documents = sqliteTable('documents', {
	name: text('name').primaryKey(),
	state: blob('state', { mode: 'buffer' }).notNull(),
	updatedAt: integer('updated_at').notNull()
});

// Append-only Yjs updates since the last snapshot.
export const updates = sqliteTable(
	'updates',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		docName: text('doc_name').notNull(),
		update: blob('update', { mode: 'buffer' }).notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [index('updates_doc_name_idx').on(t.docName)]
);

// Compiler per project ('main' until feature 005); no row means pdflatex.
export const compileSettings = sqliteTable('compile_settings', {
	project: text('project').primaryKey(),
	compiler: text('compiler').$type<Compiler>().notNull()
});

// Project tree (data-model.md). Text file ids are also their Hocuspocus document names.
export const files = sqliteTable(
	'files',
	{
		id: text('id').primaryKey(),
		parentId: text('parent_id').references((): AnySQLiteColumn => files.id),
		name: text('name').notNull(),
		kind: text('kind').$type<FileKind>().notNull(),
		hash: text('hash'),
		size: integer('size'),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull()
	},
	(t) => [index('files_parent_idx').on(t.parentId)]
);

// One row ('main') until feature 005.
export const project = sqliteTable('project', {
	id: text('id').primaryKey(),
	mainFileId: text('main_file_id')
});
