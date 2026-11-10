DROP INDEX `short_link_code_unique`;--> statement-breakpoint
ALTER TABLE `short_link` ADD `scope` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `short_link_code` ON `short_link` (`code`,`scope`);