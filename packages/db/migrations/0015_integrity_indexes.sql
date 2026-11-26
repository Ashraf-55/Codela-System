CREATE INDEX `sessions_user_ix` ON `sessions` (`user_id`);
--> statement-breakpoint
CREATE INDEX `sessions_tenant_ix` ON `sessions` (`tenant_id`);
--> statement-breakpoint
CREATE INDEX `portal_sessions_account_ix` ON `portal_sessions` (`account_id`);
--> statement-breakpoint
CREATE INDEX `portal_sessions_tenant_ix` ON `portal_sessions` (`tenant_id`);
--> statement-breakpoint
CREATE INDEX `notif_user_ix` ON `notifications` (`user_id`);
--> statement-breakpoint
CREATE INDEX `membership_role_ix` ON `memberships` (`role_id`);
--> statement-breakpoint
CREATE INDEX `subscriptions_plan_ix` ON `subscriptions` (`plan_id`);
--> statement-breakpoint
CREATE INDEX `billing_invoice_sub_ix` ON `billing_invoices` (`subscription_id`);
--> statement-breakpoint
CREATE INDEX `billing_invoice_plan_ix` ON `billing_invoices` (`plan_id`);
--> statement-breakpoint
CREATE INDEX `payment_tx_invoice_ix` ON `payment_transactions` (`invoice_id`);
--> statement-breakpoint
CREATE INDEX `sub_events_sub_ix` ON `subscription_events` (`subscription_id`);
--> statement-breakpoint
CREATE INDEX `leads_owner_ix` ON `leads` (`owner_id`);
--> statement-breakpoint
CREATE INDEX `tasks_assignee_ix` ON `internal_tasks` (`assignee_id`);