CREATE TABLE `invoice_line` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`position` integer NOT NULL,
	`description` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_amount` integer NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoice`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invoice_line_invoice_idx` ON `invoice_line` (`invoice_id`,`position`);--> statement-breakpoint
ALTER TABLE `invoice` ADD `customer_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice` ADD `customer_address` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice` ADD `tax_rate` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `invoice` ADD `paid_on` text;--> statement-breakpoint
ALTER TABLE `invoice` ADD `notes` text DEFAULT '' NOT NULL;