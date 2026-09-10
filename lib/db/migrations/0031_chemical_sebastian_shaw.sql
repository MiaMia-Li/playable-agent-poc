CREATE TABLE "playable_reference_selections" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"selection" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playable_research_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"task_id" text NOT NULL,
	"position" integer NOT NULL,
	"candidate" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playable_research_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"trigger" text NOT NULL,
	"search_brief" jsonb NOT NULL,
	"cache_key" text NOT NULL,
	"strategy_version" text NOT NULL,
	"source_ids" jsonb NOT NULL,
	"industry_summary" jsonb,
	"warnings" jsonb,
	"cached_from_run_id" text,
	"error_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "playable_reference_selections" ADD CONSTRAINT "playable_reference_selections_run_id_playable_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."playable_research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playable_reference_selections" ADD CONSTRAINT "playable_reference_selections_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playable_reference_selections" ADD CONSTRAINT "playable_reference_selections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playable_research_candidates" ADD CONSTRAINT "playable_research_candidates_run_id_playable_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."playable_research_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playable_research_candidates" ADD CONSTRAINT "playable_research_candidates_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playable_research_runs" ADD CONSTRAINT "playable_research_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playable_research_runs" ADD CONSTRAINT "playable_research_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "playable_reference_selections_run_idx" ON "playable_reference_selections" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "playable_reference_selections_task_created_idx" ON "playable_reference_selections" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "playable_research_candidates_run_position_idx" ON "playable_research_candidates" USING btree ("run_id","position");--> statement-breakpoint
CREATE INDEX "playable_research_runs_task_created_idx" ON "playable_research_runs" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "playable_research_runs_cache_idx" ON "playable_research_runs" USING btree ("user_id","cache_key","strategy_version","completed_at");