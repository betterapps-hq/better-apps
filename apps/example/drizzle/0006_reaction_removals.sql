CREATE TABLE `reaction_removal` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reaction_removal_by_time` ON `reaction_removal` (`created_at`);