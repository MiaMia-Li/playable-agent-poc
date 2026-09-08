CREATE TABLE "playable_task_builds" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"status" text DEFAULT 'building' NOT NULL,
	"confirmation" jsonb NOT NULL,
	"artifact_key" text,
	"validation" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "playable_task_builds_artifact_key_unique" UNIQUE("artifact_key")
);
--> statement-breakpoint
ALTER TABLE "playable_task_builds" ADD CONSTRAINT "playable_task_builds_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "playable_task_builds_task_created_idx" ON "playable_task_builds" USING btree ("task_id","created_at");--> statement-breakpoint
INSERT INTO "playable_task_builds" (
	"id",
	"task_id",
	"status",
	"confirmation",
	"artifact_key",
	"validation",
	"created_at",
	"completed_at"
)
SELECT
	'legacy-' || "id",
	"id",
	'succeeded',
	"confirmation",
	"latest_artifact_key",
	"latest_validation",
	"updated_at",
	COALESCE("completed_at", "updated_at")
FROM "tasks"
WHERE "latest_artifact_key" IS NOT NULL AND "confirmation" IS NOT NULL;--> statement-breakpoint
UPDATE "tasks"
SET "phase" = 'ready', "completed_at" = COALESCE("completed_at", "updated_at")
WHERE "phase" = 'reviewing' AND "latest_artifact_key" IS NOT NULL;
