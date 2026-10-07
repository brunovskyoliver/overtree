import { blob, index, integer, primaryKey, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
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

// Compiler per project; no row means pdflatex.
export const compileSettings = sqliteTable('compile_settings', {
	project: text('project').primaryKey(),
	compiler: text('compiler').$type<Compiler>().notNull()
});

export type SiteRole = 'admin' | 'user';
export type MemberRole = 'editor' | 'reader';

// Users mirrored from Clerk (or the test bypass) on first sight (005 data-model.md).
export const users = sqliteTable('users', {
	id: text('id').primaryKey(), // Clerk user id, or `test_<email>`
	email: text('email').notNull().unique(), // lower-cased primary email
	name: text('name').notNull(),
	avatarUrl: text('avatar_url'),
	role: text('role').$type<SiteRole>().notNull(),
	disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
	createdAt: integer('created_at').notNull(),
	lastSeenAt: integer('last_seen_at').notNull(),
	syncedAt: integer('synced_at').notNull() // last profile refresh from Clerk
});

// One row, id 1.
export const settings = sqliteTable('settings', {
	id: integer('id').primaryKey(),
	signupMode: text('signup_mode').$type<'open' | 'invite'>().notNull().default('invite'),
	allowlist: text('allowlist').notNull().default('[]') // JSON array of `name@host` / `@host`
});

export const projects = sqliteTable('projects', {
	id: text('id').primaryKey(), // uuid; the pre-005 project is 'main'
	title: text('title').notNull(),
	ownerId: text('owner_id').references(() => users.id), // null only for the migrated project until the first admin
	mainFileId: text('main_file_id'),
	linkToken: text('link_token').unique(), // null: link sharing off
	linkRole: text('link_role').$type<MemberRole>(),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull()
});

// Project tree (data-model.md). Text file ids are also their Hocuspocus document names.
export const files = sqliteTable(
	'files',
	{
		id: text('id').primaryKey(),
		projectId: text('project_id')
			.notNull()
			.default('main')
			.references(() => projects.id),
		parentId: text('parent_id').references((): AnySQLiteColumn => files.id),
		name: text('name').notNull(),
		kind: text('kind').$type<FileKind>().notNull(),
		hash: text('hash'),
		size: integer('size'),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull()
	},
	(t) => [index('files_parent_idx').on(t.parentId), index('files_project_parent_idx').on(t.projectId, t.parentId)]
);

// The owner has no row. `role` comes from an invite (null: joined by link only); `viaLink` counts while the link is on.
export const memberships = sqliteTable(
	'memberships',
	{
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id),
		userId: text('user_id')
			.notNull()
			.references(() => users.id),
		role: text('role').$type<MemberRole>(),
		viaLink: integer('via_link', { mode: 'boolean' }).notNull().default(false),
		createdAt: integer('created_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.projectId, t.userId] }), index('memberships_user_idx').on(t.userId)]
);

// Pending invites for emails without an account; become memberships when that email is mirrored.
export const invites = sqliteTable(
	'invites',
	{
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id),
		email: text('email').notNull(), // lower-cased
		role: text('role').$type<MemberRole>().notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [primaryKey({ columns: [t.projectId, t.email] }), index('invites_email_idx').on(t.email)]
);

// Per-file or per-folder role of one member, raising or lowering their project role.
export const overrides = sqliteTable(
	'overrides',
	{
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id),
		userId: text('user_id')
			.notNull()
			.references(() => users.id),
		fileId: text('file_id')
			.notNull()
			.references(() => files.id),
		role: text('role').$type<MemberRole>().notNull()
	},
	(t) => [primaryKey({ columns: [t.projectId, t.userId, t.fileId] })]
);

// --- history (008 data-model.md) -----------------------------------------------------------------------------------

export type HistoryKind = 'text' | 'tree' | 'baseline';
export type VersionKind = 'baseline' | 'edit' | 'compile' | 'restore' | 'github';

// Append-only copy of every Yjs update with its author, plus tree changes; never compacted (research R1).
export const historyLog = sqliteTable(
	'history_log',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id),
		docName: text('doc_name'), // text file id; null for `tree` rows
		userId: text('user_id').references(() => users.id), // null: baseline or system write
		kind: text('kind').$type<HistoryKind>().notNull(),
		update: blob('update', { mode: 'buffer' }), // null for `tree` rows
		createdAt: integer('created_at').notNull()
	},
	(t) => [index('history_log_project_idx').on(t.projectId, t.id), index('history_log_doc_idx').on(t.docName, t.id)]
);

// A version covers the project's log rows after the previous version's watermark up to its own (research R2).
export const versions = sqliteTable(
	'versions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id),
		kind: text('kind').$type<VersionKind>().notNull(),
		watermark: integer('watermark').notNull(), // max history_log.id covered
		manifestHash: text('manifest_hash').notNull(), // blob with the Manifest JSON (research R3)
		authors: text('authors').notNull(), // JSON array of user ids
		changed: text('changed').notNull(), // JSON array of Changed
		restoredFrom: integer('restored_from').references((): AnySQLiteColumn => versions.id),
		source: text('source'), // JSON { commits, notes } for `github` versions (012 data-model.md); null otherwise
		startedAt: integer('started_at').notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [index('versions_project_idx').on(t.projectId, t.id)]
);

export const versionLabels = sqliteTable(
	'version_labels',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id),
		versionId: integer('version_id')
			.notNull()
			.references(() => versions.id),
		name: text('name').notNull(), // trimmed, 1–100 characters
		userId: text('user_id')
			.notNull()
			.references(() => users.id),
		createdAt: integer('created_at').notNull()
	},
	(t) => [index('version_labels_project_idx').on(t.projectId, t.versionId)]
);

// --- GitHub sync (012 data-model.md) -------------------------------------------------------------------------------

export type GitHubLinkStatus = 'pending' | 'active' | 'failing' | 'needs-reconnect' | 'needs-access' | 'owner-changed';
export type GitHubRunKind = 'push' | 'pull' | 'import';
export type GitHubRunTrigger = 'session-end' | 'long-session' | 'open' | 'periodic' | 'manual' | 'startup' | 'retry' | 'link';
export type GitHubRunResult = 'pushed' | 'pulled' | 'noop' | 'failed';

// One GitHub connection per Overtree user; tokens AES-GCM sealed (research R10).
export const githubAccounts = sqliteTable('github_accounts', {
	userId: text('user_id')
		.primaryKey()
		.references(() => users.id),
	githubId: integer('github_id').notNull(),
	login: text('login').notNull(),
	accessToken: blob('access_token', { mode: 'buffer' }).notNull(),
	accessExpiresAt: integer('access_expires_at').notNull(),
	refreshToken: blob('refresh_token', { mode: 'buffer' }).notNull(),
	refreshExpiresAt: integer('refresh_expires_at').notNull(),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull()
});

// At most one repository link per project (research R7, R12).
export const githubLinks = sqliteTable('github_links', {
	projectId: text('project_id')
		.primaryKey()
		.references(() => projects.id),
	userId: text('user_id').references(() => users.id), // whose connection authorizes it: the owner at link time
	installationId: integer('installation_id').notNull(),
	repoId: integer('repo_id').notNull(), // stable across renames
	repo: text('repo').notNull(), // `owner/name`, refreshed on rename
	branch: text('branch').notNull(),
	ignore: text('ignore').notNull(), // JSON array of glob patterns (research R8)
	status: text('status').$type<GitHubLinkStatus>().notNull(),
	baseCommit: text('base_commit'), // null until the first sync
	baseFiles: text('base_files'), // blob hash of JSON { [path]: { sha, hash? } }
	watermark: integer('watermark').notNull().default(0), // history_log.id covered by GitHub
	pendingPush: integer('pending_push', { mode: 'boolean' }).notNull().default(false),
	lastPushAt: integer('last_push_at'),
	lastPullAt: integer('last_pull_at'),
	lastCheckAt: integer('last_check_at'),
	failCount: integer('fail_count').notNull().default(0),
	nextAttemptAt: integer('next_attempt_at'),
	error: text('error'),
	note: text('note'), // JSON MergeNote
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull()
});

// Sync runs for the status popover (US4); noop periodic pulls are not stored.
export const githubRuns = sqliteTable(
	'github_runs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id),
		kind: text('kind').$type<GitHubRunKind>().notNull(),
		trigger: text('trigger').$type<GitHubRunTrigger>().notNull(),
		userId: text('user_id').references(() => users.id), // manual runs only
		result: text('result').$type<GitHubRunResult>().notNull(),
		commit: text('commit'),
		error: text('error'),
		startedAt: integer('started_at').notNull(),
		finishedAt: integer('finished_at').notNull()
	},
	(t) => [index('github_runs_project_idx').on(t.projectId, t.id)]
);
