CREATE TABLE `invites` (
	`project_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `email`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invites_email_idx` ON `invites` (`email`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text,
	`via_link` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `memberships_user_idx` ON `memberships` (`user_id`);--> statement-breakpoint
CREATE TABLE `overrides` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`file_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`, `file_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`owner_id` text,
	`main_file_id` text,
	`link_token` text,
	`link_role` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_link_token_unique` ON `projects` (`link_token`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`signup_mode` text DEFAULT 'invite' NOT NULL,
	`allowlist` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`avatar_url` text,
	`role` text NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
-- Data steps (005 data-model.md, hand-written). The migrator runs in a transaction, where PRAGMA foreign_keys
-- can't be switched off: rows are copied in an order that keeps every foreign key valid.
-- 1. The 003 project row becomes projects('main'), owner assigned when the first admin signs in.
INSERT INTO `projects` (`id`, `title`, `owner_id`, `main_file_id`, `created_at`, `updated_at`)
	SELECT `id`, 'Untitled project', NULL, `main_file_id`, CAST(strftime('%s', 'now') AS integer) * 1000, CAST(strftime('%s', 'now') AS integer) * 1000 FROM `project`;--> statement-breakpoint
-- A 001/002 data dir (003 never ran): its text lives in Yjs rows named 'main.tex'.
INSERT INTO `projects` (`id`, `title`, `owner_id`, `main_file_id`, `created_at`, `updated_at`)
	SELECT 'main', 'Untitled project', NULL, NULL, CAST(strftime('%s', 'now') AS integer) * 1000, CAST(strftime('%s', 'now') AS integer) * 1000
	WHERE NOT EXISTS (SELECT 1 FROM `project`) AND (EXISTS (SELECT 1 FROM `documents` WHERE `name` = 'main.tex') OR EXISTS (SELECT 1 FROM `updates` WHERE `doc_name` = 'main.tex'));--> statement-breakpoint
DROP TABLE `project`;--> statement-breakpoint
-- 2. files gets project_id (default 'main'). SQLite can't ADD a REFERENCES column with a default to a filled
-- table: rebuild it. The self-reference names the new table so the rename keeps it pointing at itself.
CREATE TABLE `__new_files` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text DEFAULT 'main' NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`hash` text,
	`size` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `__new_files`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `__new_files` (`id`, `project_id`, `parent_id`, `name`, `kind`, `hash`, `size`, `created_at`, `updated_at`)
	SELECT `id`, 'main', `parent_id`, `name`, `kind`, `hash`, `size`, `created_at`, `updated_at` FROM `files`;--> statement-breakpoint
DROP TABLE `files`;--> statement-breakpoint
ALTER TABLE `__new_files` RENAME TO `files`;--> statement-breakpoint
CREATE INDEX `files_parent_idx` ON `files` (`parent_id`);--> statement-breakpoint
CREATE INDEX `files_project_parent_idx` ON `files` (`project_id`,`parent_id`);--> statement-breakpoint
-- 001/002: what 003's ensureProject did, a root main.tex holding the old text as the main document.
INSERT INTO `files` (`id`, `project_id`, `parent_id`, `name`, `kind`, `created_at`, `updated_at`)
	SELECT lower(hex(randomblob(16))), 'main', NULL, 'main.tex', 'text', CAST(strftime('%s', 'now') AS integer) * 1000, CAST(strftime('%s', 'now') AS integer) * 1000
	WHERE EXISTS (SELECT 1 FROM `projects` WHERE `id` = 'main' AND `main_file_id` IS NULL)
		AND NOT EXISTS (SELECT 1 FROM `files`) AND (EXISTS (SELECT 1 FROM `documents` WHERE `name` = 'main.tex') OR EXISTS (SELECT 1 FROM `updates` WHERE `doc_name` = 'main.tex'));--> statement-breakpoint
UPDATE `projects` SET `main_file_id` = (SELECT `id` FROM `files` WHERE `project_id` = 'main' AND `parent_id` IS NULL AND `name` = 'main.tex')
	WHERE `id` = 'main' AND `main_file_id` IS NULL AND (EXISTS (SELECT 1 FROM `documents` WHERE `name` = 'main.tex') OR EXISTS (SELECT 1 FROM `updates` WHERE `doc_name` = 'main.tex'));--> statement-breakpoint
UPDATE `documents` SET `name` = (SELECT `main_file_id` FROM `projects` WHERE `id` = 'main')
	WHERE `name` = 'main.tex' AND EXISTS (SELECT 1 FROM `projects` WHERE `id` = 'main' AND `main_file_id` IS NOT NULL);--> statement-breakpoint
UPDATE `updates` SET `doc_name` = (SELECT `main_file_id` FROM `projects` WHERE `id` = 'main')
	WHERE `doc_name` = 'main.tex' AND EXISTS (SELECT 1 FROM `projects` WHERE `id` = 'main' AND `main_file_id` IS NOT NULL);--> statement-breakpoint
-- 3. Sign-up settings: invite-only.
INSERT INTO `settings` (`id`, `signup_mode`, `allowlist`) VALUES (1, 'invite', '[]');