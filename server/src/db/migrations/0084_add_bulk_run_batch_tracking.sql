ALTER TABLE "book_workflow_outputs" ADD COLUMN "run_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "book_workflow_outputs" ADD COLUMN "triggered_by" integer;--> statement-breakpoint
ALTER TABLE "book_workflow_outputs" ADD CONSTRAINT "book_workflow_outputs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_workflow_outputs_run_batch_id_idx" ON "book_workflow_outputs" USING btree ("run_batch_id","triggered_by");