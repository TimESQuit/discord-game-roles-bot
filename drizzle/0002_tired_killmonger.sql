PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_categories`("id", "name", "position") SELECT "id", "name", "position" FROM `categories`;--> statement-breakpoint
DROP TABLE `categories`;--> statement-breakpoint
ALTER TABLE `__new_categories` RENAME TO `categories`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_unique` ON `categories` (`name`);--> statement-breakpoint
CREATE TABLE `__new_games` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`category_id` integer NOT NULL,
	`role_id` text NOT NULL,
	`added_by` text NOT NULL,
	`added_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_games`("id", "name", "normalized_name", "category_id", "role_id", "added_by", "added_at") SELECT "id", "name", "normalized_name", "category_id", "role_id", "added_by", "added_at" FROM `games`;--> statement-breakpoint
DROP TABLE `games`;--> statement-breakpoint
ALTER TABLE `__new_games` RENAME TO `games`;--> statement-breakpoint
CREATE UNIQUE INDEX `games_normalized_name_unique` ON `games` (`normalized_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `games_role_id_unique` ON `games` (`role_id`);--> statement-breakpoint
CREATE TABLE `__new_suggestions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
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
	`aliases` text,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "suggestions_status_check" CHECK("__new_suggestions"."status" IN ('pending', 'approved', 'rejected', 'withdrawn'))
);
--> statement-breakpoint
INSERT INTO `__new_suggestions`("id", "suggester_id", "name", "category_id", "note", "status", "reviewer_id", "rejection_reason", "decided_at", "created_at", "review_message_id", "game_id", "aliases") SELECT "id", "suggester_id", "name", "category_id", "note", "status", "reviewer_id", "rejection_reason", "decided_at", "created_at", "review_message_id", "game_id", "aliases" FROM `suggestions`;--> statement-breakpoint
DROP TABLE `suggestions`;--> statement-breakpoint
ALTER TABLE `__new_suggestions` RENAME TO `suggestions`;--> statement-breakpoint
CREATE INDEX `suggestions_by_user` ON `suggestions` (`suggester_id`,`status`);