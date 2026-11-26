CREATE TABLE `manual_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`method` text NOT NULL,
	`reference` text NOT NULL,
	`reference_norm` text NOT NULL,
	`payer_name` text,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`billing_period` text NOT NULL,
	`receipt_file_id` text NOT NULL,
	`receipt_sha256` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`submitted_by` text NOT NULL,
	`reviewed_by` text,
	`reviewed_at` text,
	`review_note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`transaction_id`) REFERENCES `payment_transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`invoice_id`) REFERENCES `billing_invoices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`receipt_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `manual_pay_ref_uq` ON `manual_payments` (`method`,`reference_norm`) WHERE status <> 'rejected';
--> statement-breakpoint
CREATE UNIQUE INDEX `manual_pay_receipt_uq` ON `manual_payments` (`receipt_sha256`) WHERE status <> 'rejected';
--> statement-breakpoint
CREATE UNIQUE INDEX `manual_pay_tx_uq` ON `manual_payments` (`transaction_id`);
--> statement-breakpoint
CREATE INDEX `manual_pay_tenant_ix` ON `manual_payments` (`tenant_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `manual_pay_status_ix` ON `manual_payments` (`status`,`created_at`);
