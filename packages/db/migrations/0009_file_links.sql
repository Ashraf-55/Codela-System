ALTER TABLE `files` ADD `entity_type` text;
--> statement-breakpoint
ALTER TABLE `files` ADD `entity_id` text;
--> statement-breakpoint
CREATE INDEX `files_entity_ix` ON `files` (`tenant_id`,`entity_type`,`entity_id`);