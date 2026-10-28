-- Upstream 0110 predates the deployed fork watermark and is skipped on upgrade.
ALTER TABLE "email_providers" ADD COLUMN IF NOT EXISTS "last_tested_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "email_providers" ADD COLUMN IF NOT EXISTS "last_test_ok" boolean;
--> statement-breakpoint
ALTER TABLE "email_providers" ADD COLUMN IF NOT EXISTS "last_test_error" text;