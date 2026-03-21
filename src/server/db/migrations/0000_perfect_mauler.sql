CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`key_hash` text NOT NULL,
	`system_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`system_id`) REFERENCES `systems`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `channels` (
	`id` text PRIMARY KEY NOT NULL,
	`system_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`system_id`) REFERENCES `systems`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `event_transmissions` (
	`event_id` text NOT NULL,
	`transmission_id` text NOT NULL,
	PRIMARY KEY(`event_id`, `transmission_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transmission_id`) REFERENCES `transmissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`system_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`start_time` integer NOT NULL,
	`end_time` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`system_id`) REFERENCES `systems`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `systems` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`transmission_id` text NOT NULL,
	`type` text NOT NULL,
	`required` integer DEFAULT true NOT NULL,
	`complete` integer DEFAULT false NOT NULL,
	`processing_start_time` integer,
	`processing_end_time` integer,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`retry_limit` integer DEFAULT 3 NOT NULL,
	`retry_delay_ms` integer DEFAULT 30000 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`transmission_id`) REFERENCES `transmissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `transmission_files` (
	`id` text PRIMARY KEY NOT NULL,
	`transmission_id` text NOT NULL,
	`provider` text NOT NULL,
	`path` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`transmission_id`) REFERENCES `transmissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `transmissions` (
	`id` text PRIMARY KEY NOT NULL,
	`system_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`available` integer DEFAULT false NOT NULL,
	`transcript` text,
	`duration_ms` integer,
	`recorded_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`system_id`) REFERENCES `systems`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `upload_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`transmission_id` text NOT NULL,
	`signed_url` text NOT NULL,
	`signed_url_key` text NOT NULL,
	`expires_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`transmission_id`) REFERENCES `transmissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `channels_system_id_idx` ON `channels` (`system_id`);--> statement-breakpoint
CREATE INDEX `tasks_pending_idx` ON `tasks` (`complete`,`required`,`failure_count`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `tf_provider_transmission_uniq` ON `transmission_files` (`provider`,`transmission_id`);--> statement-breakpoint
CREATE INDEX `transmissions_list_idx` ON `transmissions` (`system_id`,`channel_id`,`available`,`recorded_at`);