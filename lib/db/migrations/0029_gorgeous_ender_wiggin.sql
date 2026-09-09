ALTER TABLE "playable_task_builds" ADD COLUMN "revision" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "pending_revision" jsonb;