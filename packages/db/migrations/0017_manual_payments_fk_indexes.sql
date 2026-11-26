CREATE INDEX `manual_pay_invoice_ix` ON `manual_payments` (`invoice_id`);
--> statement-breakpoint
CREATE INDEX `manual_pay_receipt_file_ix` ON `manual_payments` (`receipt_file_id`);
