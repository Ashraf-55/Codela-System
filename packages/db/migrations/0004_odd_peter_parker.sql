CREATE TABLE `counters` (
	`tenant_id` text NOT NULL,
	`key` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `counters_uq` ON `counters` (`tenant_id`,`key`);--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`code` text,
	`unique_key` text,
	`data` text NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `records_tenant_type_ix` ON `records` (`tenant_id`,`entity_type`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `records_code_uq` ON `records` (`tenant_id`,`entity_type`,`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `records_unique_uq` ON `records` (`tenant_id`,`entity_type`,`unique_key`);