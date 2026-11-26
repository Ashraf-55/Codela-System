ALTER TABLE `users` ADD `failed_logins` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `locked_until` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `totp_secret` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `totp_enabled` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD `totp_last_step` integer;
--> statement-breakpoint
ALTER TABLE `portal_accounts` ADD `failed_logins` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `portal_accounts` ADD `locked_until` text;