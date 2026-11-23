-- Staff accounts: blocking and session revocation.
ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "session_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "password_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_users" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp with time zone;--> statement-breakpoint

-- Chat distribution: who is on the line.
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "available_for_distribution" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "availability_changed_at" timestamp with time zone;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "property_inbox_settings" (
  "property_id" text PRIMARY KEY NOT NULL REFERENCES "properties"("id") ON DELETE cascade,
  "distribution_enabled" boolean DEFAULT true NOT NULL,
  "shift_start" text DEFAULT '09:00' NOT NULL,
  "shift_end" text DEFAULT '21:00' NOT NULL,
  "urgent_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "delayed_after_minutes" integer DEFAULT 60 NOT NULL,
  "handoff_message" text,
  "handoff_message_off_hours" text,
  "updated_by" text REFERENCES "employees"("id") ON DELETE set null,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "conversation_assignments" (
  "id" text PRIMARY KEY NOT NULL,
  "conversation_id" text NOT NULL REFERENCES "conversations"("id") ON DELETE cascade,
  "property_id" text NOT NULL REFERENCES "properties"("id"),
  "from_employee_id" text REFERENCES "employees"("id") ON DELETE set null,
  "to_employee_id" text REFERENCES "employees"("id") ON DELETE set null,
  "actor_employee_id" text REFERENCES "employees"("id") ON DELETE set null,
  "reason" text NOT NULL,
  "operation_id" text,
  "business_date" date NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_assignments_conversation_idx" ON "conversation_assignments" ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_assignments_load_idx" ON "conversation_assignments" ("property_id","business_date","to_employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_assignments_operation_uidx" ON "conversation_assignments" ("operation_id","conversation_id") WHERE "operation_id" IS NOT NULL;--> statement-breakpoint

-- Inbox: urgency, repeat contact after closing, late delivery.
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "urgent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "urgent_reason" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "urgent_dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "reopened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "last_inbound_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "delayed_inbound_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "assigned_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_pool_idx" ON "conversations" ("property_id","assignee_id","status");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "conversation_favorites" (
  "employee_id" text NOT NULL REFERENCES "employees"("id") ON DELETE cascade,
  "conversation_id" text NOT NULL REFERENCES "conversations"("id") ON DELETE cascade,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("employee_id","conversation_id")
);--> statement-breakpoint

-- Sales attribution: reassigning a chat never moves an earned sale.
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "first_contact_employee_id" text REFERENCES "employees"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "closing_employee_id" text REFERENCES "employees"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "commission_employee_id" text REFERENCES "employees"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "closed_via" text;
--> statement-breakpoint

-- Who changed what: statuses, assignees, availability, accounts, settings.
CREATE TABLE IF NOT EXISTS "staff_audit_events" (
  "id" text PRIMARY KEY NOT NULL,
  "actor_user_id" text REFERENCES "app_users"("id") ON DELETE set null,
  "actor_employee_id" text REFERENCES "employees"("id") ON DELETE set null,
  "property_id" text REFERENCES "properties"("id") ON DELETE set null,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "action" text NOT NULL,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_audit_events_entity_idx" ON "staff_audit_events" ("entity_type","entity_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_audit_events_property_idx" ON "staff_audit_events" ("property_id","created_at");
