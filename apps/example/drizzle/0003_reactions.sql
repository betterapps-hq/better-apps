CREATE TABLE `reaction` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text DEFAULT '' NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`user_id` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reaction_by_user` ON `reaction` (`subject_type`,`subject_id`,`user_id`,`emoji`);--> statement-breakpoint
CREATE INDEX `reaction_by_emoji` ON `reaction` (`subject_type`,`subject_id`,`emoji`,`created_at`);--> statement-breakpoint
CREATE INDEX `reaction_of_user` ON `reaction` (`user_id`);