CREATE TABLE `documents` (
	`name` text PRIMARY KEY NOT NULL,
	`state` blob NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `updates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`doc_name` text NOT NULL,
	`update` blob NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `updates_doc_name_idx` ON `updates` (`doc_name`);