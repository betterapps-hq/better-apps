CREATE TABLE `short_link_click` (
	`id` text PRIMARY KEY NOT NULL,
	`link_id` text NOT NULL,
	`clicked_at` integer NOT NULL,
	`slot` integer NOT NULL,
	FOREIGN KEY (`link_id`) REFERENCES `short_link`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `short_link_click_by_link` ON `short_link_click` (`link_id`,`slot`);