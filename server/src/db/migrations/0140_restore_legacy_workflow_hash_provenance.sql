ALTER TABLE "book_file_hash_history" DROP CONSTRAINT "book_file_hash_history_reason_chk";
--> statement-breakpoint
ALTER TABLE "book_file_hash_history" ADD CONSTRAINT "book_file_hash_history_reason_chk"
CHECK ("reason" in ('file_write', 'external_change', 'rescan', 'kobo_download', 'read_aloud_replace', 'workflow_regenerate'));
--> statement-breakpoint
DO $$ BEGIN
  IF to_regclass('pg_temp.bookorbit_legacy_workflow_hashes_read_aloud_upgrade') IS NOT NULL THEN
    UPDATE "book_file_hash_history" SET "reason" = 'workflow_regenerate'
    WHERE "id" IN (SELECT "id" FROM "bookorbit_legacy_workflow_hashes_read_aloud_upgrade");
  END IF;
END $$;
