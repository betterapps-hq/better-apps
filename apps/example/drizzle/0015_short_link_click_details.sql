ALTER TABLE `short_link_click` ADD `host` text;--> statement-breakpoint
ALTER TABLE `short_link_click` ADD `country` text;--> statement-breakpoint
ALTER TABLE `short_link_click` ADD `referrer` text;--> statement-breakpoint
ALTER TABLE `short_link_click` ADD `outcome` text DEFAULT 'opened' NOT NULL;