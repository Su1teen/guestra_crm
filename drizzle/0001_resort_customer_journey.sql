-- 0001_resort_customer_journey.sql
-- Resort CRM Customer Journey: multi-service deals, interests, items, service catalog

-- 1. Add new columns to leads
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "paid_amount" integer NOT NULL DEFAULT 0;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "payment_due_at" timestamp with time zone;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "payment_terms" text;

-- 2. Make guest_services.stay_id nullable and add new columns
ALTER TABLE "guest_services" ALTER COLUMN "stay_id" DROP NOT NULL;
ALTER TABLE "guest_services" ADD COLUMN IF NOT EXISTS "lead_id" text REFERENCES "leads"("id") ON DELETE SET NULL;
ALTER TABLE "guest_services" ADD COLUMN IF NOT EXISTS "property_id" text REFERENCES "properties"("id") ON DELETE SET NULL;
ALTER TABLE "guest_services" ADD COLUMN IF NOT EXISTS "service_type" text;
ALTER TABLE "guest_services" ADD COLUMN IF NOT EXISTS "quantity" integer NOT NULL DEFAULT 1;
ALTER TABLE "guest_services" ADD COLUMN IF NOT EXISTS "participants" integer;
ALTER TABLE "guest_services" ADD COLUMN IF NOT EXISTS "start_at" timestamp with time zone;
ALTER TABLE "guest_services" ADD COLUMN IF NOT EXISTS "end_at" timestamp with time zone;
ALTER TABLE "guest_services" ADD COLUMN IF NOT EXISTS "booking_reference" text;
ALTER TABLE "guest_services" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'completed';

-- 3. Make offers accommodation fields nullable, add terms
ALTER TABLE "offers" ALTER COLUMN "room_type" DROP NOT NULL;
ALTER TABLE "offers" ALTER COLUMN "check_in" DROP NOT NULL;
ALTER TABLE "offers" ALTER COLUMN "check_out" DROP NOT NULL;
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "terms" text;

-- 4. Add leadItemId to offer_lines
ALTER TABLE "offer_lines" ADD COLUMN IF NOT EXISTS "lead_item_id" text;

-- 5. Create lead_interests table
CREATE TABLE IF NOT EXISTS "lead_interests" (
  "id" text PRIMARY KEY NOT NULL,
  "lead_id" text NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "direction" text NOT NULL,
  "is_primary" boolean NOT NULL DEFAULT false,
  "status" text NOT NULL DEFAULT 'active',
  "owner_id" text REFERENCES "employees"("id") ON DELETE SET NULL,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "lead_interests_lead_direction_uidx" ON "lead_interests" ("lead_id", "direction");
CREATE INDEX IF NOT EXISTS "lead_interests_lead_idx" ON "lead_interests" ("lead_id");

-- 6. Create lead_items table
CREATE TABLE IF NOT EXISTS "lead_items" (
  "id" text PRIMARY KEY NOT NULL,
  "lead_id" text NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "interest_id" text REFERENCES "lead_interests"("id") ON DELETE SET NULL,
  "type" text NOT NULL,
  "category" text,
  "name" text NOT NULL,
  "status" text NOT NULL DEFAULT 'interest',
  "quantity" integer NOT NULL DEFAULT 1,
  "start_at" timestamp with time zone,
  "end_at" timestamp with time zone,
  "adults" integer,
  "children" integer,
  "participants" integer,
  "room_type" text,
  "nights" integer,
  "unit_amount" integer,
  "total_amount" integer,
  "currency" text NOT NULL DEFAULT 'KZT',
  "external_reference" text,
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "lead_items_lead_idx" ON "lead_items" ("lead_id");

-- 7. Create service_catalog table
CREATE TABLE IF NOT EXISTS "service_catalog" (
  "id" text PRIMARY KEY NOT NULL,
  "property_id" text NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "code" text NOT NULL,
  "category" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "active" boolean NOT NULL DEFAULT true,
  "pricing_mode" text NOT NULL DEFAULT 'quote',
  "default_price" integer,
  "currency" text NOT NULL DEFAULT 'KZT',
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "service_catalog_property_code_uidx" ON "service_catalog" ("property_id", "code");

-- 8. Backfill: Create lead_interests from existing lead_classifications
INSERT INTO "lead_interests" ("id", "lead_id", "direction", "is_primary", "status")
SELECT
  'backfill_interest_' || "lead_id",
  "lead_id",
  "direction",
  true,
  'active'
FROM "lead_classifications"
ON CONFLICT DO NOTHING;

-- 9. Backfill: Create accommodation lead_items from existing leads with room_type
INSERT INTO "lead_items" ("id", "lead_id", "type", "name", "status", "quantity", "start_at", "end_at", "adults", "children", "room_type", "nights", "total_amount", "currency")
SELECT
  'backfill_item_' || "id",
  "id",
  'accommodation',
  COALESCE("room_type", 'Номер'),
  CASE
    WHEN "stage" = 'completed' THEN 'completed'
    WHEN "stage" = 'confirmed' THEN 'confirmed'
    WHEN "stage" = 'offer' THEN 'quoted'
    ELSE 'interest'
  END,
  1,
  "check_in",
  "check_out",
  "adults",
  "children",
  "room_type",
  "nights",
  "room_amount",
  'KZT'
FROM "leads"
WHERE "room_type" IS NOT NULL
ON CONFLICT DO NOTHING;

-- 10. Backfill legacy lead_services without deleting or mutating source rows
INSERT INTO "lead_items" ("id", "lead_id", "type", "category", "name", "status", "quantity", "total_amount", "currency", "metadata")
SELECT
  'backfill_service_' || ls."id",
  ls."lead_id",
  'other',
  'legacy_service',
  ls."name",
  CASE
    WHEN l."stage" = 'completed' THEN 'completed'
    WHEN l."stage" = 'confirmed' THEN 'confirmed'
    WHEN l."stage" IN ('offer', 'payment_pending') THEN 'quoted'
    ELSE 'selected'
  END,
  1,
  ls."amount",
  'KZT',
  jsonb_build_object('legacyLeadServiceId', ls."id")
FROM "lead_services" ls
JOIN "leads" l ON l."id" = ls."lead_id"
ON CONFLICT DO NOTHING;
