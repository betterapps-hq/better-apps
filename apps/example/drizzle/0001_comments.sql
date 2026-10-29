CREATE TABLE `comment` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`org_id` text DEFAULT '' NOT NULL,
	`author_type` text NOT NULL,
	`author_id` text NOT NULL,
	`author_name` text,
	`format` text DEFAULT 'text' NOT NULL,
	`body` text,
	`body_text` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`edited_at` integer,
	`deleted_at` integer,
	`metadata` text,
	FOREIGN KEY (`thread_id`) REFERENCES `comment_thread`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comment_by_thread` ON `comment` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `comment_by_author` ON `comment` (`author_type`,`author_id`);--> statement-breakpoint
CREATE TABLE `comment_thread` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text DEFAULT '' NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`visibility` text DEFAULT 'default' NOT NULL,
	`anchor_kind` text,
	`anchor` text,
	`anchor_version` text,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_at` integer,
	`resolved_by` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_activity_at` integer NOT NULL,
	`comment_count` integer DEFAULT 0 NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `comment_thread_by_activity` ON `comment_thread` (`org_id`,`subject_type`,`subject_id`,`last_activity_at`);--> statement-breakpoint
CREATE INDEX `comment_thread_by_creation` ON `comment_thread` (`org_id`,`subject_type`,`subject_id`,`created_at`);