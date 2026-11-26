CREATE TABLE `add_ons` (
	`key` text PRIMARY KEY NOT NULL,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`price_minor` integer NOT NULL,
	`currency` text DEFAULT 'EGP' NOT NULL,
	`billing_type` text NOT NULL,
	`compatible_products` text NOT NULL,
	`grants` text DEFAULT '{}' NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`read_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notif_tenant_ix` ON `notifications` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`product_slug` text NOT NULL,
	`tier` text NOT NULL,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`price_monthly` integer NOT NULL,
	`price_annual` integer NOT NULL,
	`currency` text DEFAULT 'EGP' NOT NULL,
	`trial_days` integer DEFAULT 14 NOT NULL,
	`limits` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`product_slug`) REFERENCES `products`(`slug`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plans_product_tier_uq` ON `plans` (`product_slug`,`tier`);--> statement-breakpoint
CREATE TABLE `search_index` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`title` text NOT NULL,
	`subtitle` text,
	`keywords` text NOT NULL,
	`permission_key` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_entity_uq` ON `search_index` (`tenant_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `search_tenant_ix` ON `search_index` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `subscription_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`type` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`meta` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `sub_events_tenant_ix` ON `subscription_events` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`billing_period` text DEFAULT 'monthly' NOT NULL,
	`status` text NOT NULL,
	`trial_ends_at` text,
	`current_period_start` text,
	`current_period_end` text,
	`grace_ends_at` text,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`canceled_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_tenant_uq` ON `subscriptions` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `tenant_add_ons` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`add_on_key` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`add_on_key`) REFERENCES `add_ons`(`key`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenant_addon_uq` ON `tenant_add_ons` (`tenant_id`,`add_on_key`);