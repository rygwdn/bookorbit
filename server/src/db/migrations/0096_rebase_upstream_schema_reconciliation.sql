-- Guarded re-application of the workflow feature schema.
--
-- personal-integration previously shipped this exact schema (book_workflow_outputs,
-- workflow_delivery_preferences, workflow_steps, workflows, and the book_files /
-- book_file_hash_history check-constraint updates) under prior numberings (0082, then
-- 0086) that already ran on production. Each renumbering happens because upstream keeps
-- independently claiming the same idx before this migration lands, so drizzle-orm's
-- single-watermark migrator would otherwise skip intervening upstream migrations as
-- already applied. This migration re-adds the workflow-only objects under the current
-- numbering, guarded so it's a no-op on production (already has them) and a normal
-- create on a fresh install (never ran an earlier lineage).
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
ALTER TABLE "book_files" DROP CONSTRAINT IF EXISTS "book_files_role_chk";--> statement-breakpoint
ALTER TABLE "book_file_hash_history" DROP CONSTRAINT IF EXISTS "book_file_hash_history_reason_chk";--> statement-breakpoint
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
ALTER TABLE "book_file_hash_history" ADD CONSTRAINT "book_file_hash_history_reason_chk" CHECK ("book_file_hash_history"."reason" in ('file_write', 'external_change', 'rescan', 'workflow_regenerate'));
