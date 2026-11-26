ALTER TABLE `notification_outbox` ADD `provider_id` text;
--> statement-breakpoint
CREATE INDEX `outbox_provider_ix` ON `notification_outbox` (`provider_id`);