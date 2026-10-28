-- Drizzle runs pending migrations in one transaction. Preserve workflow reasons while
-- the unchanged upstream Kobo migration temporarily installs its narrower constraint.
CREATE TEMP TABLE "bookorbit_workflow_hash_history_upgrade" ON COMMIT DROP AS
SELECT "id" FROM "book_file_hash_history" WHERE "reason" = 'workflow_regenerate';--> statement-breakpoint
UPDATE "book_file_hash_history" SET "reason" = 'rescan'
WHERE "id" IN (SELECT "id" FROM "bookorbit_workflow_hash_history_upgrade");
