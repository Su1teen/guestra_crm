-- Additive pilot operations. Historical service and housekeeping rows remain untouched.
ALTER TABLE "housekeeping_tasks" ADD COLUMN IF NOT EXISTS "stay_id" text REFERENCES "guest_stays"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "operational_tasks" ADD COLUMN IF NOT EXISTS "reservation_id" text REFERENCES "reservations"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "operational_tasks" ADD COLUMN IF NOT EXISTS "stay_id" text REFERENCES "guest_stays"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "department" text;
--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN IF NOT EXISTS "eta_at" timestamptz;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "housekeeping_checkout_stay_uidx" ON "housekeeping_tasks" ("stay_id") WHERE "type" = 'checkout' AND "stay_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operational_tasks_stay_idx" ON "operational_tasks" ("stay_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "packages" (
  "id" text PRIMARY KEY NOT NULL,
  "property_id" text NOT NULL REFERENCES "properties"("id"),
  "name" text NOT NULL,
  "description" text,
  "billing_mode" text DEFAULT 'included' NOT NULL,
  "price" integer DEFAULT 0 NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "packages_billing_valid" CHECK ("price" >= 0 AND "billing_mode" IN ('included', 'separate'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "package_entitlements" (
  "id" text PRIMARY KEY NOT NULL,
  "package_id" text NOT NULL REFERENCES "packages"("id") ON DELETE CASCADE,
  "catalog_item_id" text NOT NULL REFERENCES "service_catalog"("id"),
  "included_quantity" integer DEFAULT 1 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "package_entitlements_positive_quantity" CHECK ("included_quantity" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "package_entitlements_package_catalog_uidx" ON "package_entitlements" ("package_id", "catalog_item_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_reservations" (
  "id" text PRIMARY KEY NOT NULL,
  "property_id" text NOT NULL REFERENCES "properties"("id"),
  "customer_id" text NOT NULL REFERENCES "guests"("id"),
  "reservation_id" text REFERENCES "reservations"("id") ON DELETE SET NULL,
  "stay_id" text REFERENCES "guest_stays"("id") ON DELETE SET NULL,
  "catalog_item_id" text NOT NULL REFERENCES "service_catalog"("id"),
  "folio_id" text REFERENCES "folios"("id") ON DELETE SET NULL,
  "folio_line_id" text REFERENCES "folio_lines"("id") ON DELETE SET NULL,
  "entitlement_id" text REFERENCES "package_entitlements"("id") ON DELETE SET NULL,
  "idempotency_key" text,
  "status" text DEFAULT 'scheduled' NOT NULL,
  "start_at" timestamptz NOT NULL,
  "end_at" timestamptz,
  "participants" integer DEFAULT 1 NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "unit_price" integer DEFAULT 0 NOT NULL,
  "total_amount" integer DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'KZT' NOT NULL,
  "notes" text,
  "completed_at" timestamptz,
  "cancelled_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "service_reservations_positive_quantity" CHECK ("quantity" > 0 AND "participants" > 0 AND "unit_price" >= 0 AND "total_amount" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_reservations_idempotency_uidx" ON "service_reservations" ("idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "service_reservations_folio_line_uidx" ON "service_reservations" ("folio_line_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_reservations_stay_idx" ON "service_reservations" ("stay_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_reservations_customer_idx" ON "service_reservations" ("customer_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "guest_reviews" (
  "id" text PRIMARY KEY NOT NULL,
  "property_id" text NOT NULL REFERENCES "properties"("id"),
  "guest_id" text REFERENCES "guests"("id") ON DELETE SET NULL,
  "stay_id" text REFERENCES "guest_stays"("id") ON DELETE SET NULL,
  "guest_name" text NOT NULL,
  "channel" text NOT NULL,
  "rating" integer NOT NULL,
  "max_rating" integer DEFAULT 5 NOT NULL,
  "review_at" timestamptz NOT NULL,
  "text" text NOT NULL,
  "topic" text DEFAULT 'Общее впечатление' NOT NULL,
  "status" text DEFAULT 'new' NOT NULL,
  "reply" text,
  "responded_at" timestamptz,
  "external_url" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "guest_reviews_rating_range" CHECK ("max_rating" > 0 AND "rating" >= 0 AND "rating" <= "max_rating")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guest_reviews_property_date_idx" ON "guest_reviews" ("property_id", "review_at");
