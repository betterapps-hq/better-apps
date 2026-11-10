CREATE TABLE `attachment_move` (
	`id` text PRIMARY KEY NOT NULL,
	`to_org_id` text DEFAULT '' NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`claim` text NOT NULL,
	`held_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attachment_move_by_time` ON `attachment_move` (`held_at`);