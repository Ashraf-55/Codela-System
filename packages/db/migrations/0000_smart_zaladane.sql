CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`tenant_id` text,
	`action` text NOT NULL,
	`entity` text,
	`entity_id` text,
	`meta` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_tenant_ix` ON `audit_logs` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`ref` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`email` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_tenant_ref_uq` ON `customers` (`tenant_id`,`ref`);--> statement-breakpoint
CREATE INDEX `customers_tenant_ix` ON `customers` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`role_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `membership_uq` ON `memberships` (`user_id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `membership_tenant_ix` ON `memberships` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`slug` text PRIMARY KEY NOT NULL,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` text NOT NULL,
	`permission` text NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_perm_uq` ON `role_permissions` (`role_id`,`permission`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text,
	`name` text NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_tenant_name_uq` ON `roles` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`tenant_id` text,
	`scope` text DEFAULT 'tenant' NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_uq` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`product_slug` text NOT NULL,
	`status` text DEFAULT 'provisioning' NOT NULL,
	`locale` text DEFAULT 'ar' NOT NULL,
	`currency` text DEFAULT 'EGP' NOT NULL,
	`timezone` text DEFAULT 'Africa/Cairo' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_slug_uq` ON `tenants` (`slug`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`password_hash` text NOT NULL,
	`name` text NOT NULL,
	`locale` text DEFAULT 'ar' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`is_platform_staff` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);