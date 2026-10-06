import { blob, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
