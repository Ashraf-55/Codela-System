ALTER TABLE `tenant_add_ons` ADD `expires_at` text;--> statement-breakpoint
ALTER TABLE `tenant_add_ons` ADD `renewal_due_at` text;--> statement-breakpoint
CREATE TABLE `addon_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`add_on_key` text NOT NULL,
	`action` text NOT NULL,
	`meta` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`add_on_key`) REFERENCES `add_ons`(`key`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `addon_events_tenant_ix` ON `addon_events` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `addon_events_key_ix` ON `addon_events` (`add_on_key`);--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`title_ar` text NOT NULL,
	`title_en` text NOT NULL,
	`body_ar` text DEFAULT '' NOT NULL,
	`body_en` text DEFAULT '' NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`product_slug` text,
	`starts_at` text,
	`ends_at` text,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);--> statement-breakpoint
CREATE INDEX `announcements_active_ix` ON `announcements` (`active`,`starts_at`);--> statement-breakpoint
CREATE TABLE `notification_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`channel` text DEFAULT 'email' NOT NULL,
	`subject_ar` text DEFAULT '' NOT NULL,
	`subject_en` text DEFAULT '' NOT NULL,
	`body_ar` text NOT NULL,
	`body_en` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`updated_by` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_templates_key_channel_uq` ON `notification_templates` (`key`,`channel`);
