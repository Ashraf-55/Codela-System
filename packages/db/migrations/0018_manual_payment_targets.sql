ALTER TABLE `manual_payments` ADD `kind` text DEFAULT 'plan' NOT NULL;--> statement-breakpoint
ALTER TABLE `manual_payments` ADD `target_plan_id` text REFERENCES `plans`(`id`);--> statement-breakpoint
ALTER TABLE `manual_payments` ADD `add_on_key` text REFERENCES `add_ons`(`key`);--> statement-breakpoint
CREATE INDEX `manual_pay_target_plan_ix` ON `manual_payments` (`target_plan_id`);--> statement-breakpoint
CREATE INDEX `manual_pay_addon_ix` ON `manual_payments` (`add_on_key`);
