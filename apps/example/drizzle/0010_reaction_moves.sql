CREATE TABLE `reaction_move` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`event_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reaction_move_by_time` ON `reaction_move` (`event_at`);