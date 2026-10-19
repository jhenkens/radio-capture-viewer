ALTER TABLE `transmissions` ADD `archived` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `transmissions` ADD `vad_speech_ms` integer;--> statement-breakpoint
ALTER TABLE `transmissions` ADD `vad_max_prob` real;--> statement-breakpoint
ALTER TABLE `transmissions` ADD `vad_checked_at` integer;