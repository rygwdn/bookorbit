-- Replays upstream 0099 because its timestamp is older than production's current migration watermark.
ALTER TABLE "libraries" ALTER COLUMN "mark_as_finished_percent_complete" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "libraries" ALTER COLUMN "mark_as_finished_percent_complete" SET DEFAULT 98;