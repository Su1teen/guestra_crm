-- Pre-arrival reminders chosen per property (default keeps the current 3-day and 1-day reminders).
ALTER TABLE "property_inbox_settings" ADD COLUMN IF NOT EXISTS "pre_arrival_reminders" jsonb DEFAULT '["pre_arrival_3d","pre_arrival_1d"]'::jsonb NOT NULL;
--> statement-breakpoint
-- Saved report settings ("Сохранить как…"): settings only, never figures; opened with fresh data.
CREATE TABLE IF NOT EXISTS "report_templates" (
  "id" text PRIMARY KEY NOT NULL,
  "report_key" text NOT NULL,
  "name" text NOT NULL,
  "params" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "visibility" text DEFAULT 'me' NOT NULL,
  "owner_user_id" text NOT NULL,
  "property_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_templates_owner_idx" ON "report_templates" ("owner_user_id");
