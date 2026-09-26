-- Phase 1: additive customer/request/reservation/stay foundation.
-- Keep all legacy tables, columns and historical rows for Railway deployments.
ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "normalized_phone" text;
--> statement-breakpoint
ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "normalized_email" text;
--> statement-breakpoint
ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "profile_status" text NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "preferred_channel" text;
--> statement-breakpoint
ALTER TABLE "guests" ADD COLUMN IF NOT EXISTS "merged_into_guest_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guests_normalized_phone_idx" ON "guests" ("organization_id", "normalized_phone");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guests_normalized_email_idx" ON "guests" ("organization_id", "normalized_email");
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "request_status" text NOT NULL DEFAULT 'new';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_request_status_idx" ON "leads" ("request_status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "unit_types" (
  "id" text PRIMARY KEY NOT NULL,
  "property_id" text NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unit_types_property_name_uidx" ON "unit_types" ("property_id", "name");
--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "unit_type_id" text REFERENCES "unit_types"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reservations" (
  "id" text PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "property_id" text NOT NULL REFERENCES "properties"("id"),
  "booker_customer_id" text NOT NULL REFERENCES "guests"("id"),
  "request_id" text REFERENCES "leads"("id") ON DELETE SET NULL,
  "unit_type_id" text REFERENCES "unit_types"("id") ON DELETE SET NULL,
  "rate_plan_id" text,
  "package_id" text,
  "room_type_snapshot" text,
  "source" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "arrival_at" timestamptz NOT NULL,
  "departure_at" timestamptz NOT NULL,
  "adults" integer NOT NULL DEFAULT 0,
  "children" integer NOT NULL DEFAULT 0,
  "currency" text NOT NULL DEFAULT 'KZT',
  "special_request" text,
  "external_reservation_id" text,
  "external_confirmation_number" text,
  "confirmed_at" timestamptz,
  "cancelled_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "reservations_dates_ck" CHECK ("departure_at" > "arrival_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reservations_code_uidx" ON "reservations" ("code");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reservations_property_external_id_uidx" ON "reservations" ("property_id", "external_reservation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reservations_property_confirmation_uidx" ON "reservations" ("property_id", "external_confirmation_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reservations_property_arrival_idx" ON "reservations" ("property_id", "arrival_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reservations_property_status_idx" ON "reservations" ("property_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reservations_request_idx" ON "reservations" ("request_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reservation_units" (
  "id" text PRIMARY KEY NOT NULL,
  "reservation_id" text NOT NULL REFERENCES "reservations"("id") ON DELETE CASCADE,
  "room_id" text NOT NULL REFERENCES "rooms"("id"),
  "arrival_at" timestamptz NOT NULL,
  "departure_at" timestamptz NOT NULL,
  "status" text NOT NULL DEFAULT 'assigned',
  "assigned_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "reservation_units_dates_ck" CHECK ("departure_at" > "arrival_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reservation_units_reservation_room_uidx" ON "reservation_units" ("reservation_id", "room_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reservation_units_room_dates_idx" ON "reservation_units" ("room_id", "arrival_at", "departure_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reservation_guests" (
  "id" text PRIMARY KEY NOT NULL,
  "reservation_id" text NOT NULL REFERENCES "reservations"("id") ON DELETE CASCADE,
  "customer_id" text REFERENCES "guests"("id") ON DELETE SET NULL,
  "full_name" text,
  "role" text NOT NULL DEFAULT 'guest',
  "is_primary" boolean NOT NULL DEFAULT false,
  "is_booker" boolean NOT NULL DEFAULT false,
  "age_group" text NOT NULL DEFAULT 'adult',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reservation_guests_reservation_idx" ON "reservation_guests" ("reservation_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reservation_notes" (
  "id" text PRIMARY KEY NOT NULL,
  "reservation_id" text NOT NULL REFERENCES "reservations"("id") ON DELETE CASCADE,
  "author_id" text REFERENCES "employees"("id") ON DELETE SET NULL,
  "text" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reservation_notes_reservation_idx" ON "reservation_notes" ("reservation_id");
--> statement-breakpoint
ALTER TABLE "guest_stays" ADD COLUMN IF NOT EXISTS "reservation_id" text REFERENCES "reservations"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "guest_stays" ADD COLUMN IF NOT EXISTS "reservation_unit_id" text REFERENCES "reservation_units"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "guest_stays" ADD COLUMN IF NOT EXISTS "room_id" text REFERENCES "rooms"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "guest_stays" ADD COLUMN IF NOT EXISTS "actual_check_in" timestamptz;
--> statement-breakpoint
ALTER TABLE "guest_stays" ADD COLUMN IF NOT EXISTS "actual_check_out" timestamptz;
--> statement-breakpoint
ALTER TABLE "guest_stays" ADD COLUMN IF NOT EXISTS "operational_status" text NOT NULL DEFAULT 'upcoming';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guest_stays_reservation_idx" ON "guest_stays" ("reservation_id");
--> statement-breakpoint
ALTER TABLE "folios" ALTER COLUMN "lead_id" DROP NOT NULL;
--> statement-breakpoint
-- Preserve the financial record if a legacy request is ever removed.
ALTER TABLE "folios" DROP CONSTRAINT IF EXISTS "folios_lead_id_fkey";
--> statement-breakpoint
ALTER TABLE "folios" ADD CONSTRAINT "folios_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "folios" ADD COLUMN IF NOT EXISTS "reservation_id" text REFERENCES "reservations"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "folios" ADD COLUMN IF NOT EXISTS "stay_id" text REFERENCES "guest_stays"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folios_reservation_idx" ON "folios" ("reservation_id");
--> statement-breakpoint
ALTER TABLE "guest_payments" ADD COLUMN IF NOT EXISTS "reservation_id" text REFERENCES "reservations"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "reservation_id" text REFERENCES "reservations"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "stay_id" text REFERENCES "guest_stays"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "reservation_id" text REFERENCES "reservations"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "stay_id" text REFERENCES "guest_stays"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "source" text;
