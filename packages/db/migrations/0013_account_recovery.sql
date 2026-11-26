ALTER TABLE `users` ADD `email_verified_at` text;
--> statement-breakpoint
UPDATE `users` SET `email_verified_at` = `created_at` WHERE `email_verified_at` IS NULL;