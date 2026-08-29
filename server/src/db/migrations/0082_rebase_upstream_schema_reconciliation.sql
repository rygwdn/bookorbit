-- Reconciles personal-integration's post-rebase migration chain with upstream/main.
--
-- drizzle-orm's runtime migrator (drizzle-orm/node-postgres/migrator, used by this
-- app's dist/scripts/migrate.js) only compares each journal entry's `when` timestamp
-- against the single most-recently-applied migration's created_at, and runs anything
-- newer unconditionally; it does not track which individual migrations ran. Because
-- upstream's 0078-0080 (reading_session_sync_cursors, the annotations index, and
-- book_metadata.cover_updated_at) carry authoring timestamps that predate the last
-- migration already applied on the divergent (pre-rebase) production database, they
-- would be silently skipped there forever. Re-apply them here, guarded so this is a
-- no-op wherever they already ran in order.
--
-- The workflow feature tables below were originally 0078/0079 in the pre-rebase
-- mangabaka lineage (guarded there for the same reason); guarded again here since
-- production may already have them from the prior deployment.
CREATE TABLE IF NOT EXISTS "reading_session_sync_cursors" (
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"source" varchar(32) NOT NULL,
	"source_device_key" varchar(128) NOT NULL,
	"counter" integer NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"last_modified" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_session_sync_cursors_user_id_book_id_source_source_device_key_pk" PRIMARY KEY("user_id","book_id","source","source_device_key"),
	CONSTRAINT "rssc_counter_nonnegative_chk" CHECK ("reading_session_sync_cursors"."counter" >= 0),
	CONSTRAINT "rssc_generation_nonnegative_chk" CHECK ("reading_session_sync_cursors"."generation" >= 0)
);
--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD COLUMN IF NOT EXISTS "source_device_key" varchar(128);--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reading_session_sync_cursors_user_id_users_id_fk') THEN
    ALTER TABLE "reading_session_sync_cursors" ADD CONSTRAINT "reading_session_sync_cursors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reading_session_sync_cursors_book_id_books_id_fk') THEN
    ALTER TABLE "reading_session_sync_cursors" ADD CONSTRAINT "reading_session_sync_cursors_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rssc_book_id_idx" ON "reading_session_sync_cursors" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rs_user_book_source_device_started_idx" ON "reading_sessions" USING btree ("user_id","book_id","source","source_device_key","started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "annotations_user_created_active_idx" ON "annotations" USING btree ("user_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "annotations"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "book_metadata" ADD COLUMN IF NOT EXISTS "cover_updated_at" timestamp with time zone;--> statement-breakpoint
UPDATE "book_metadata" SET "cover_updated_at" = "updated_at" WHERE "cover_updated_at" IS NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "book_workflow_outputs" (
	"id" serial PRIMARY KEY NOT NULL,
	"book_id" integer NOT NULL,
	"workflow_id" integer NOT NULL,
	"book_file_id" integer,
	"source_book_file_id" integer,
	"source_file_hash" varchar(32),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_batch_id" uuid,
	"triggered_by" integer,
	CONSTRAINT "book_workflow_outputs_status_chk" CHECK ("book_workflow_outputs"."status" in ('pending', 'running', 'success', 'failed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_delivery_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"workflow_id" integer NOT NULL,
	"opds_user_id" integer,
	"koreader_device_id" varchar(100),
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_delivery_preferences_target_chk" CHECK (("workflow_delivery_preferences"."opds_user_id" is not null and "workflow_delivery_preferences"."koreader_device_id" is null) or ("workflow_delivery_preferences"."opds_user_id" is null and "workflow_delivery_preferences"."koreader_device_id" is not null)),
	CONSTRAINT "workflow_delivery_preferences_priority_chk" CHECK ("workflow_delivery_preferences"."priority" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" integer NOT NULL,
	"step_order" integer NOT NULL,
	"command" varchar(500) NOT NULL,
	"args" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output_extension" varchar(20),
	"in_place" boolean DEFAULT false NOT NULL,
	"timeout_seconds" integer DEFAULT 300 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_steps_workflow_step_order_uidx" UNIQUE("workflow_id","step_order"),
	CONSTRAINT "workflow_steps_timeout_chk" CHECK ("workflow_steps"."timeout_seconds" > 0 and "workflow_steps"."timeout_seconds" <= 3600),
	CONSTRAINT "workflow_steps_inplace_no_ext_chk" CHECK (not ("workflow_steps"."in_place" and "workflow_steps"."output_extension" is not null))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"output_format" varchar(20) NOT NULL,
	"input_formats" text[],
	"output_filename_template" varchar(500),
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflows_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "book_files" DROP CONSTRAINT "book_files_role_chk";--> statement-breakpoint
ALTER TABLE "book_file_hash_history" DROP CONSTRAINT "book_file_hash_history_reason_chk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'book_workflow_outputs_book_id_books_id_fk') THEN
    ALTER TABLE "book_workflow_outputs" ADD CONSTRAINT "book_workflow_outputs_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'book_workflow_outputs_workflow_id_workflows_id_fk') THEN
    ALTER TABLE "book_workflow_outputs" ADD CONSTRAINT "book_workflow_outputs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'book_workflow_outputs_book_file_id_book_files_id_fk') THEN
    ALTER TABLE "book_workflow_outputs" ADD CONSTRAINT "book_workflow_outputs_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'book_workflow_outputs_source_book_file_id_book_files_id_fk') THEN
    ALTER TABLE "book_workflow_outputs" ADD CONSTRAINT "book_workflow_outputs_source_book_file_id_book_files_id_fk" FOREIGN KEY ("source_book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'book_workflow_outputs_triggered_by_users_id_fk') THEN
    ALTER TABLE "book_workflow_outputs" ADD CONSTRAINT "book_workflow_outputs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_delivery_preferences_user_id_users_id_fk') THEN
    ALTER TABLE "workflow_delivery_preferences" ADD CONSTRAINT "workflow_delivery_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_delivery_preferences_workflow_id_workflows_id_fk') THEN
    ALTER TABLE "workflow_delivery_preferences" ADD CONSTRAINT "workflow_delivery_preferences_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_delivery_preferences_opds_user_id_opds_users_id_fk') THEN
    ALTER TABLE "workflow_delivery_preferences" ADD CONSTRAINT "workflow_delivery_preferences_opds_user_id_opds_users_id_fk" FOREIGN KEY ("opds_user_id") REFERENCES "public"."opds_users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_steps_workflow_id_workflows_id_fk') THEN
    ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflows_created_by_users_id_fk') THEN
    ALTER TABLE "workflows" ADD CONSTRAINT "workflows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "book_workflow_outputs_book_workflow_uidx" ON "book_workflow_outputs" USING btree ("book_id","workflow_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "book_workflow_outputs_workflow_id_idx" ON "book_workflow_outputs" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "book_workflow_outputs_book_file_id_idx" ON "book_workflow_outputs" USING btree ("book_file_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "book_workflow_outputs_run_batch_id_idx" ON "book_workflow_outputs" USING btree ("run_batch_id","triggered_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_delivery_preferences_user_id_idx" ON "workflow_delivery_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_delivery_preferences_workflow_id_idx" ON "workflow_delivery_preferences" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_delivery_preferences_koreader_device_idx" ON "workflow_delivery_preferences" USING btree ("user_id","koreader_device_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_delivery_preferences_opds_workflow_uidx" ON "workflow_delivery_preferences" USING btree ("opds_user_id","workflow_id") WHERE "workflow_delivery_preferences"."opds_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_delivery_preferences_koreader_workflow_uidx" ON "workflow_delivery_preferences" USING btree ("user_id","koreader_device_id","workflow_id") WHERE "workflow_delivery_preferences"."koreader_device_id" is not null;--> statement-breakpoint
ALTER TABLE "book_files" ADD CONSTRAINT "book_files_role_chk" CHECK ("book_files"."role" in ('content', 'cover', 'metadata', 'supplement', 'workflow_output'));--> statement-breakpoint
ALTER TABLE "book_file_hash_history" ADD CONSTRAINT "book_file_hash_history_reason_chk" CHECK ("book_file_hash_history"."reason" in ('file_write', 'external_change', 'rescan', 'workflow_regenerate'));--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN IF NOT EXISTS "is_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collections_public_display_name_idx" ON "collections" USING btree ("is_public","display_order","name");
