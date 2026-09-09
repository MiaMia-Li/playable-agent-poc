CREATE TABLE "playable_video_analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"pipeline_version" text NOT NULL,
	"model" text NOT NULL,
	"blueprint" jsonb,
	"error_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "playable_video_analyses" ADD CONSTRAINT "playable_video_analyses_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playable_video_analyses" ADD CONSTRAINT "playable_video_analyses_asset_id_playable_task_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."playable_task_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "playable_video_analyses_task_created_idx" ON "playable_video_analyses" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "playable_video_analyses_asset_pipeline_idx" ON "playable_video_analyses" USING btree ("asset_id","pipeline_version");