CREATE TABLE `better_apps_event` (
	`id` text PRIMARY KEY NOT NULL,
	`feature` text NOT NULL,
	`type` text NOT NULL,
	`data` text,
	`actor` text,
	`author` text,
	`silent` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`available_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `betterAppsEvent_availableAt_idx` ON `better_apps_event` (`available_at`);--> statement-breakpoint
DROP INDEX `reaction_by_user`;--> statement-breakpoint
DROP INDEX `reaction_by_emoji`;--> statement-breakpoint
ALTER TABLE `reaction` ADD `slot` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `reaction` SET `slot` = (SELECT COUNT(*) FROM `reaction` AS `earlier` WHERE `earlier`.`subject_type` = `reaction`.`subject_type` AND `earlier`.`subject_id` = `reaction`.`subject_id` AND `earlier`.`org_id` = `reaction`.`org_id` AND `earlier`.`user_id` = `reaction`.`user_id` AND `earlier`.`id` < `reaction`.`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reaction_slot` ON `reaction` (`subject_type`,`subject_id`,`org_id`,`user_id`,`slot`);--> statement-breakpoint
CREATE UNIQUE INDEX `reaction_by_user` ON `reaction` (`subject_type`,`subject_id`,`org_id`,`user_id`,`emoji`);--> statement-breakpoint
CREATE INDEX `reaction_by_emoji` ON `reaction` (`subject_type`,`subject_id`,`org_id`,`emoji`,`created_at`);