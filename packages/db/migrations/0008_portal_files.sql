CREATE TABLE `portal_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`password_hash` text NOT NULL,
	`name` text NOT NULL,
	`locale` text DEFAULT 'ar' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_accounts_tenant_email_uq` ON `portal_accounts` (`tenant_id`,`email`);
--> statement-breakpoint
CREATE TABLE `portal_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`account_id` text NOT NULL,
	`tenant_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `portal_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_sessions_token_uq` ON `portal_sessions` (`token_hash`);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`owner_user_id` text,
	`purpose` text NOT NULL,
	`original_name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`storage_key` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `files_tenant_ix` ON `files` (`tenant_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_key_uq` ON `files` (`storage_key`);