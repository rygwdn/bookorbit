CREATE TABLE "koreader_device_retirements" (
	"user_id" integer NOT NULL,
	"device_id" varchar(100) NOT NULL,
	"retired_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "koreader_device_retirements_user_id_device_id_pk" PRIMARY KEY("user_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "book_workflow_outputs" (
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
	CONSTRAINT "book_workflow_outputs_status_chk" CHECK ("book_workflow_outputs"."status" in ('pending', 'running', 'success', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "book_workflow_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"book_id" integer NOT NULL,
	"workflow_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_steps" (
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
CREATE TABLE "workflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"output_format" varchar(20) NOT NULL,
	"input_formats" text[],
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflows_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "book_files" DROP CONSTRAINT "book_files_role_chk";--> statement-breakpoint
ALTER TABLE "book_file_hash_history" DROP CONSTRAINT "book_file_hash_history_reason_chk";--> statement-breakpoint
ALTER TABLE "book_metadata" ALTER COLUMN "mangabaka_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "book_metadata" ALTER COLUMN "mangabaka_series_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "collection_books" ADD COLUMN "position" bigserial NOT NULL;--> statement-breakpoint
ALTER TABLE "kobo_sync_settings" ADD COLUMN "store_sync" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "koreader_device_retirements" ADD CONSTRAINT "koreader_device_retirements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_workflow_outputs" ADD CONSTRAINT "book_workflow_outputs_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_workflow_outputs" ADD CONSTRAINT "book_workflow_outputs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_workflow_outputs" ADD CONSTRAINT "book_workflow_outputs_book_file_id_book_files_id_fk" FOREIGN KEY ("book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_workflow_outputs" ADD CONSTRAINT "book_workflow_outputs_source_book_file_id_book_files_id_fk" FOREIGN KEY ("source_book_file_id") REFERENCES "public"."book_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_workflow_preferences" ADD CONSTRAINT "book_workflow_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_workflow_preferences" ADD CONSTRAINT "book_workflow_preferences_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_workflow_preferences" ADD CONSTRAINT "book_workflow_preferences_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "koreader_device_retirements_user_id_idx" ON "koreader_device_retirements" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "book_workflow_outputs_book_workflow_uidx" ON "book_workflow_outputs" USING btree ("book_id","workflow_id");--> statement-breakpoint
CREATE INDEX "book_workflow_outputs_workflow_id_idx" ON "book_workflow_outputs" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "book_workflow_outputs_book_file_id_idx" ON "book_workflow_outputs" USING btree ("book_file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "book_workflow_preferences_user_book_uidx" ON "book_workflow_preferences" USING btree ("user_id","book_id");--> statement-breakpoint
CREATE INDEX "book_workflow_preferences_workflow_id_idx" ON "book_workflow_preferences" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "collection_books_collection_position_idx" ON "collection_books" USING btree ("collection_id","position");--> statement-breakpoint
ALTER TABLE "book_files" ADD CONSTRAINT "book_files_role_chk" CHECK ("book_files"."role" in ('content', 'cover', 'metadata', 'supplement', 'workflow_output'));--> statement-breakpoint
ALTER TABLE "book_file_hash_history" ADD CONSTRAINT "book_file_hash_history_reason_chk" CHECK ("book_file_hash_history"."reason" in ('file_write', 'external_change', 'rescan', 'workflow_regenerate'));