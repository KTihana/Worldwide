CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`country_id` text NOT NULL,
	`object_key` text NOT NULL,
	`caption` text DEFAULT '' NOT NULL,
	`content_type` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `photos_owner_country` ON `photos` (`user_id`,`country_id`);--> statement-breakpoint
CREATE TABLE `visits` (
	`user_id` text NOT NULL,
	`country_id` text NOT NULL,
	`visited` integer DEFAULT 0 NOT NULL,
	`cover_id` text,
	`note` text DEFAULT '' NOT NULL,
	`visit_date` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `country_id`)
);
