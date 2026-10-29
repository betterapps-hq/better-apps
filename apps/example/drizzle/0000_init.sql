CREATE TABLE `invoice` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`customer` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`issued_on` text NOT NULL,
	`due_on` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_number_unique` ON `invoice` (`number`);--> statement-breakpoint
CREATE TABLE `note` (
	`id` text PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	`author_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `note_createdAt_idx` ON `note` (`created_at`);