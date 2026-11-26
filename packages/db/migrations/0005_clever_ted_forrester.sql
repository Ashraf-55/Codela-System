CREATE TABLE `billing_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`number` text NOT NULL,
	`subscription_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`billing_period` text NOT NULL,
	`description` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`issued_at` text NOT NULL,
	`paid_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_invoice_number_uq` ON `billing_invoices` (`number`);--> statement-breakpoint
CREATE INDEX `billing_invoice_tenant_ix` ON `billing_invoices` (`tenant_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `payment_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`gateway` text NOT NULL,
	`provider_ref` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`simulated` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`invoice_id`) REFERENCES `billing_invoices`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_tx_idem_uq` ON `payment_transactions` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_tx_ref_uq` ON `payment_transactions` (`gateway`,`provider_ref`);--> statement-breakpoint
CREATE INDEX `payment_tx_tenant_ix` ON `payment_transactions` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`event_id` text NOT NULL,
	`payload_hash` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_event_uq` ON `webhook_events` (`provider`,`event_id`);