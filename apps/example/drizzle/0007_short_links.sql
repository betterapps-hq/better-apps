CREATE TABLE `short_link` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`owner` text NOT NULL,
	`org_id` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`url` text,
	`subject_type` text,
	`subject_id` text,
	`grants_view` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`expires_at` integer,
	`clicks` integer DEFAULT 0 NOT NULL,
	`last_clicked_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `short_link_code_unique` ON `short_link` (`code`);--> statement-breakpoint
CREATE INDEX `short_link_by_owner` ON `short_link` (`owner`,`created_at`);--> statement-breakpoint
CREATE INDEX `short_link_by_org` ON `short_link` (`org_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `short_link_by_subject` ON `short_link` (`subject_type`,`subject_id`,`created_at`);