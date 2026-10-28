ALTER TABLE "book_file_hash_history" DROP CONSTRAINT "book_file_hash_history_reason_chk";--> statement-breakpoint
ALTER TABLE "book_file_hash_history" ADD CONSTRAINT "book_file_hash_history_reason_chk" CHECK ("book_file_hash_history"."reason" in ('file_write', 'external_change', 'rescan', 'kobo_download', 'workflow_regenerate'));--> statement-breakpoint
DO $$ BEGIN
  IF to_regclass('pg_temp.bookorbit_workflow_hash_history_upgrade') IS NOT NULL THEN
    UPDATE "book_file_hash_history" SET "reason" = 'workflow_regenerate'
    WHERE "id" IN (SELECT "id" FROM "bookorbit_workflow_hash_history_upgrade");
  END IF;
END $$;
