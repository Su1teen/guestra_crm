-- Messaging accounts (WhatsApp Cloud API / WABA, Instagram, the Studio test transport).
-- Secrets are never stored here: *_ref columns name the server environment variable that holds them.
CREATE TABLE IF NOT EXISTS "channel_accounts" (
  "id" text PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "channel" text NOT NULL,
  "display_name" text NOT NULL,
  "property_id" text REFERENCES "properties"("id"),
  "property_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "waba_id" text,
  "phone_number_id" text,
  "display_phone" text,
  "ig_user_id" text,
  "page_id" text,
  "access_token_ref" text,
  "app_secret_ref" text,
  "status" text DEFAULT 'disabled' NOT NULL,
  "last_event_at" timestamp with time zone,
  "last_error" text,
  "last_error_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_accounts_phone_uidx" ON "channel_accounts" ("phone_number_id") WHERE "phone_number_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "channel_accounts_ig_uidx" ON "channel_accounts" ("ig_user_id") WHERE "ig_user_id" IS NOT NULL;--> statement-breakpoint

-- Every provider webhook is stored before it is processed: Meta never replays a lost event.
CREATE TABLE IF NOT EXISTS "provider_events" (
  "id" text PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "channel_account_id" text REFERENCES "channel_accounts"("id") ON DELETE set null,
  "dedupe_key" text NOT NULL,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "provider_timestamp" timestamp with time zone,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "status" text DEFAULT 'received' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  "last_error" text,
  "result" jsonb DEFAULT '{}'::jsonb NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "provider_events_dedupe_uidx" ON "provider_events" ("provider","dedupe_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_events_queue_idx" ON "provider_events" ("status","next_attempt_at");--> statement-breakpoint

-- Messages keep the provider's own send time apart from the moment we received them.
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "provider" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "provider_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "event_type" text DEFAULT 'message' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "template_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messages_provider_external_uidx" ON "messages" ("provider","external_message_id") WHERE "provider" IS NOT NULL AND "external_message_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "channel_account_id" text REFERENCES "channel_accounts"("id") ON DELETE set null;--> statement-breakpoint

-- Message templates staff send by hand (and the AI uses by key). A WhatsApp template name lets the
-- same text go out after the 24-hour customer service window closes.
CREATE TABLE IF NOT EXISTS "message_templates" (
  "id" text PRIMARY KEY NOT NULL,
  "property_id" text REFERENCES "properties"("id") ON DELETE cascade,
  "key" text NOT NULL,
  "category" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "language" text DEFAULT 'ru' NOT NULL,
  "action" text,
  "wa_template_name" text,
  "wa_template_language" text,
  "wa_template_params" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "wa_status" text DEFAULT 'not_submitted' NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 100 NOT NULL,
  "updated_by" text REFERENCES "employees"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_templates_scope_uidx" ON "message_templates" (coalesce("property_id", ''),"key","language");
