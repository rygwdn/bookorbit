-- Upstream 0125 temporarily rejects provenance from the retired workflow feature.
-- Its constraint change and the later restoration run in the same transaction.
CREATE TEMP TABLE "bookorbit_legacy_workflow_hashes_read_aloud_upgrade" ON COMMIT DROP AS
SELECT "id" FROM "book_file_hash_history" WHERE "reason" = 'workflow_regenerate';
--> statement-breakpoint
UPDATE "book_file_hash_history" SET "reason" = 'rescan'
WHERE "id" IN (SELECT "id" FROM "bookorbit_legacy_workflow_hashes_read_aloud_upgrade");
