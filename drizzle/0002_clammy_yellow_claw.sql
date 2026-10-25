CREATE TABLE `snapshot_rows` (
	`owner` text NOT NULL,
	`snapshot` text NOT NULL,
	`row` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`owner`, `snapshot`, `row`)
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`created` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE `transfer_parts` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`part` integer NOT NULL,
	`etag` text NOT NULL,
	`hash` text NOT NULL,
	`size` integer NOT NULL,
	PRIMARY KEY(`owner`, `id`, `part`)
);
--> statement-breakpoint
CREATE TABLE `transfers` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`payload` text NOT NULL,
	`size` integer NOT NULL,
	`state` text NOT NULL,
	`expires` integer NOT NULL,
	`upload_id` text NOT NULL,
	`key` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE INDEX `transfer_expiry` ON `transfers` (`owner`,`expires`);