WITH "ranked_video_analyses" AS (
	SELECT
		"id",
		ROW_NUMBER() OVER (
			PARTITION BY "asset_id", "pipeline_version", "model"
			ORDER BY
				CASE "status"
					WHEN 'succeeded' THEN 0
					WHEN 'analyzing' THEN 1
					WHEN 'preprocessing' THEN 2
					WHEN 'pending' THEN 3
					ELSE 4
				END,
				"created_at" DESC,
				"id" DESC
		) AS "duplicate_rank"
	FROM "playable_video_analyses"
)
DELETE FROM "playable_video_analyses"
WHERE "id" IN (
	SELECT "id"
	FROM "ranked_video_analyses"
	WHERE "duplicate_rank" > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX "playable_video_analyses_asset_pipeline_model_unique" ON "playable_video_analyses" USING btree ("asset_id","pipeline_version","model");