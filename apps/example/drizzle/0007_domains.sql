CREATE TABLE `domain` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text DEFAULT '' NOT NULL,
	`hostname` text NOT NULL,
	`claimed_hostname` text,
	`ownership_token` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`certificate` text NOT NULL,
	`records` text,
	`provider_id` text,
	`primary_of` text,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`check_token` text,
	`checking_since` integer,
	`next_check_at` integer,
	`last_checked_at` integer,
	`verified_at` integer,
	`created_at` integer NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domain_claimed_hostname_unique` ON `domain` (`claimed_hostname`);--> statement-breakpoint
CREATE UNIQUE INDEX `domain_primary_of_unique` ON `domain` (`primary_of`);--> statement-breakpoint
CREATE INDEX `domain_by_org` ON `domain` (`org_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `domain_org_hostname` ON `domain` (`org_id`,`hostname`);