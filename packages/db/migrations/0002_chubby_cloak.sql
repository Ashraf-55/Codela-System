CREATE TABLE `domains` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`hostname` text NOT NULL,
	`verify_token` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`ssl_status` text DEFAULT 'not_provisioned' NOT NULL,
	`last_checked_at` text,
	`verified_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domains_hostname_uq` ON `domains` (`hostname`);--> statement-breakpoint
CREATE INDEX `domains_tenant_ix` ON `domains` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `platform_staff` (
	`user_id` text PRIMARY KEY NOT NULL,
	`role_name` text NOT NULL,
	`department` text DEFAULT 'management' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tenant_sites` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`template_key` text DEFAULT 'classic' NOT NULL,
	`draft` text NOT NULL,
	`published` text,
	`published_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE cascade
);
