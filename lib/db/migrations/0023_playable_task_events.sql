CREATE TABLE "playable_task_events" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"type" text NOT NULL,
	"phase" text,
	"message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "playable_task_events" ADD CONSTRAINT "playable_task_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;