PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_lfg_posts` (
	`message_id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`game_id` integer,
	`game_name` text NOT NULL,
	`author_id` text NOT NULL,
	`when` text,
	`note` text,
	`created_at` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`closed_by` text,
	`closed_at` text,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "lfg_posts_status_check" CHECK("__new_lfg_posts"."status" IN ('open', 'finished', 'cancelled'))
);
--> statement-breakpoint
INSERT INTO `__new_lfg_posts`("message_id", "channel_id", "game_id", "game_name", "author_id", "when", "note", "created_at") SELECT "message_id", "channel_id", "game_id", "game_name", "author_id", "when", "note", "created_at" FROM `lfg_posts`;--> statement-breakpoint
DROP TABLE `lfg_posts`;--> statement-breakpoint
ALTER TABLE `__new_lfg_posts` RENAME TO `lfg_posts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;