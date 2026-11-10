CREATE TABLE `attachment_move` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`event_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attachment_move_by_time` ON `attachment_move` (`event_at`);