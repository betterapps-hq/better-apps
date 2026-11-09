CREATE TABLE `attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`org_id` text DEFAULT '' NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`slot` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `attachment_file`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachment_by_file_on_record` ON `attachment` (`subject_type`,`subject_id`,`org_id`,`file_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `attachment_slot` ON `attachment` (`subject_type`,`subject_id`,`org_id`,`slot`);--> statement-breakpoint
CREATE INDEX `attachment_by_file` ON `attachment` (`file_id`);--> statement-breakpoint
CREATE TABLE `attachment_file` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text DEFAULT '' NOT NULL,
	`owner` text,
	`created_by` text NOT NULL,
	`name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`storage_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`subject_type` text,
	`target` text,
	`upload_token_hash` text,
	`expires_at` integer,
	`upload_closes_at` integer NOT NULL,
	`etag` text,
	`created_at` integer NOT NULL,
	`uploaded_at` integer
);
--> statement-breakpoint
CREATE INDEX `attachment_file_by_owner` ON `attachment_file` (`owner`,`created_at`);--> statement-breakpoint
CREATE INDEX `attachment_file_by_creator` ON `attachment_file` (`created_by`,`status`);--> statement-breakpoint
CREATE INDEX `attachment_file_by_expiry` ON `attachment_file` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `attachment_file_by_closing` ON `attachment_file` (`status`,`upload_closes_at`);--> statement-breakpoint
CREATE TABLE `attachment_removal` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attachment_removal_by_time` ON `attachment_removal` (`created_at`);