ALTER TABLE "tasks" ADD COLUMN "playable_mode" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "phase" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "confirmation" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "latest_artifact_key" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "latest_validation" jsonb;
