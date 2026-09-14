DROP INDEX "playable_video_analyses_asset_pipeline_model_unique";--> statement-breakpoint
ALTER TABLE "playable_task_assets" ADD COLUMN "duration_seconds" real;--> statement-breakpoint
ALTER TABLE "playable_video_analyses" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "playable_video_analyses" ADD COLUMN "media_resolution" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "active_reference_video_asset_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "gameplay_annotations" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "playable_video_analyses_asset_pipeline_model_attempt_unique" ON "playable_video_analyses" USING btree ("asset_id","pipeline_version","model","attempt");