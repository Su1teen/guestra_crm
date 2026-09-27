ALTER TABLE "service_catalog" ADD COLUMN IF NOT EXISTS "booking_mode" text NOT NULL DEFAULT 'manual';
--> statement-breakpoint
ALTER TABLE "service_catalog" ADD COLUMN IF NOT EXISTS "slot_interval_minutes" integer NOT NULL DEFAULT 60;
--> statement-breakpoint
ALTER TABLE "service_reservations" ADD COLUMN IF NOT EXISTS "request_id" text REFERENCES "leads"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_resource_groups" (
  "id" text PRIMARY KEY NOT NULL,
  "property_id" text NOT NULL REFERENCES "properties"("id"),
  "code" text NOT NULL,
  "name" text NOT NULL,
  "allocation_mode" text NOT NULL,
  "capacity" integer NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "service_resource_groups_property_code_uidx" UNIQUE("property_id", "code"),
  CONSTRAINT "service_resource_groups_mode_check" CHECK ("allocation_mode" IN ('unit', 'capacity')),
  CONSTRAINT "service_resource_groups_capacity_check" CHECK ("capacity" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_resources" (
  "id" text PRIMARY KEY NOT NULL,
  "resource_group_id" text NOT NULL REFERENCES "service_resource_groups"("id"),
  "code" text NOT NULL,
  "name" text NOT NULL,
  "capacity" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'active',
  "active" boolean NOT NULL DEFAULT true,
  "metadata" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "service_resources_group_code_uidx" UNIQUE("resource_group_id", "code"),
  CONSTRAINT "service_resources_status_check" CHECK ("status" IN ('active', 'unavailable', 'maintenance')),
  CONSTRAINT "service_resources_capacity_check" CHECK ("capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_resource_requirements" (
  "id" text PRIMARY KEY NOT NULL,
  "catalog_item_id" text NOT NULL REFERENCES "service_catalog"("id"),
  "resource_group_id" text NOT NULL REFERENCES "service_resource_groups"("id"),
  "demand_basis" text NOT NULL DEFAULT 'fixed',
  "demand_quantity" integer NOT NULL DEFAULT 1,
  "min_capacity_basis" text NOT NULL DEFAULT 'none',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "service_requirements_catalog_group_uidx" UNIQUE("catalog_item_id", "resource_group_id"),
  CONSTRAINT "service_requirements_basis_check" CHECK ("demand_basis" IN ('fixed', 'quantity', 'participants')),
  CONSTRAINT "service_requirements_min_capacity_check" CHECK ("min_capacity_basis" IN ('none', 'participants')),
  CONSTRAINT "service_requirements_quantity_check" CHECK ("demand_quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_resource_allocations" (
  "id" text PRIMARY KEY NOT NULL,
  "service_reservation_id" text NOT NULL REFERENCES "service_reservations"("id") ON DELETE CASCADE,
  "resource_group_id" text NOT NULL REFERENCES "service_resource_groups"("id"),
  "resource_id" text REFERENCES "service_resources"("id"),
  "start_at" timestamptz NOT NULL,
  "end_at" timestamptz NOT NULL,
  "quantity" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "service_allocations_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "service_allocations_time_check" CHECK ("end_at" > "start_at"),
  CONSTRAINT "service_allocations_status_check" CHECK ("status" IN ('active', 'released'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_allocations_resource_time_idx" ON "service_resource_allocations" ("resource_id", "start_at", "end_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_allocations_group_time_idx" ON "service_resource_allocations" ("resource_group_id", "start_at", "end_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_allocations_reservation_idx" ON "service_resource_allocations" ("service_reservation_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_resource_blocks" (
  "id" text PRIMARY KEY NOT NULL,
  "resource_group_id" text NOT NULL REFERENCES "service_resource_groups"("id"),
  "resource_id" text REFERENCES "service_resources"("id"),
  "start_at" timestamptz NOT NULL,
  "end_at" timestamptz NOT NULL,
  "reason" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "created_by" text REFERENCES "employees"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "service_blocks_time_check" CHECK ("end_at" > "start_at"),
  CONSTRAINT "service_blocks_status_check" CHECK ("status" IN ('active', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_blocks_group_time_idx" ON "service_resource_blocks" ("resource_group_id", "start_at", "end_at");
