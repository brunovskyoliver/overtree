CREATE TABLE `github_accounts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`github_id` integer NOT NULL,
	`login` text NOT NULL,
	`access_token` blob NOT NULL,
	`access_expires_at` integer NOT NULL,
	`refresh_token` blob NOT NULL,
	`refresh_expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `github_links` (
	`project_id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`installation_id` integer NOT NULL,
	`repo_id` integer NOT NULL,
	`repo` text NOT NULL,
	`branch` text NOT NULL,
	`ignore` text NOT NULL,
	`status` text NOT NULL,
	`base_commit` text,
	`base_files` text,
	`watermark` integer DEFAULT 0 NOT NULL,
	`pending_push` integer DEFAULT false NOT NULL,
	`last_push_at` integer,
	`last_pull_at` integer,
	`last_check_at` integer,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`error` text,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `github_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`trigger` text NOT NULL,
	`user_id` text,
	`result` text NOT NULL,
	`commit` text,
	`error` text,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `github_runs_project_idx` ON `github_runs` (`project_id`,`id`);--> statement-breakpoint
ALTER TABLE `versions` ADD `source` text;