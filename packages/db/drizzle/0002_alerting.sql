CREATE TABLE `alert_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rule_id` integer,
	`rule_name` text NOT NULL,
	`severity` text NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`subject_label` text NOT NULL,
	`message` text NOT NULL,
	`value` real,
	`state` text NOT NULL,
	`fired_at` integer NOT NULL,
	`resolved_at` integer,
	`acknowledged_at` integer,
	`notified_at` integer,
	FOREIGN KEY (`rule_id`) REFERENCES `alert_rules`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `alert_events_state_idx` ON `alert_events` (`state`);--> statement-breakpoint
CREATE INDEX `alert_events_rule_subject_idx` ON `alert_events` (`rule_id`,`subject_id`);--> statement-breakpoint
CREATE TABLE `alert_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`severity` text NOT NULL,
	`scope` text NOT NULL,
	`condition` text NOT NULL,
	`channel_ids` text NOT NULL,
	`cooldown_minutes` integer NOT NULL,
	`renotify_minutes` integer NOT NULL,
	`notify_recovery` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notification_channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`config` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`last_sent_at` integer,
	`last_error` text
);
