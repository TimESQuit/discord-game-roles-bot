CREATE TABLE `categories` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_unique` ON `categories` (`name`);--> statement-breakpoint
CREATE TABLE `game_aliases` (
	`game_id` integer NOT NULL,
	`alias` text NOT NULL,
	PRIMARY KEY(`game_id`, `alias`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `games` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`category_id` integer NOT NULL,
	`role_id` text NOT NULL,
	`added_by` text NOT NULL,
	`added_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `games_normalized_name_unique` ON `games` (`normalized_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `games_role_id_unique` ON `games` (`role_id`);--> statement-breakpoint
CREATE TABLE `lfg_posts` (
	`message_id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`game_id` integer,
	`game_name` text NOT NULL,
	`author_id` text NOT NULL,
	`when` text,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `lfg_responses` (
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`responded_at` text NOT NULL,
	PRIMARY KEY(`message_id`, `user_id`),
	FOREIGN KEY (`message_id`) REFERENCES `lfg_posts`(`message_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "lfg_responses_kind_check" CHECK("lfg_responses"."kind" IN ('in', 'maybe'))
);
--> statement-breakpoint
CREATE TABLE `setup` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `suggestions` (
	`id` integer PRIMARY KEY NOT NULL,
	`suggester_id` text NOT NULL,
	`name` text NOT NULL,
	`category_id` integer NOT NULL,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewer_id` text,
	`rejection_reason` text,
	`decided_at` text,
	`created_at` text NOT NULL,
	`review_message_id` text,
	`game_id` integer,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "suggestions_status_check" CHECK("suggestions"."status" IN ('pending', 'approved', 'rejected', 'withdrawn'))
);
--> statement-breakpoint
CREATE INDEX `suggestions_by_user` ON `suggestions` (`suggester_id`,`status`);