CREATE TABLE `notification_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`channel` text NOT NULL,
	`to_addr` text NOT NULL,
	`template` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`sent_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `outbox_tenant_ix` ON `notification_outbox` (`tenant_id`,`created_at`);