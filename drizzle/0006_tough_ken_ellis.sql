CREATE TABLE `zotero_accounts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`zotero_user_id` text NOT NULL,
	`username` text NOT NULL,
	`api_key` blob NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
