-- 0002_folio_service_journey.sql
-- Folio (счёт заказа), серверный pricing snapshot для услуг,
-- категории каталога услуг и параметры квалификации.

-- 1. Folio tables
CREATE TABLE IF NOT EXISTS "folios" (
  "id" text PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "lead_id" text NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "guest_id" text NOT NULL REFERENCES "guests"("id") ON DELETE CASCADE,
  "property_id" text NOT NULL REFERENCES "properties"("id"),
  "status" text NOT NULL DEFAULT 'open',
  "currency" text NOT NULL DEFAULT 'KZT',
  "subtotal" integer NOT NULL DEFAULT 0,
  "discount_amount" integer NOT NULL DEFAULT 0,
  "total_amount" integer NOT NULL DEFAULT 0,
  "deposit_required" integer NOT NULL DEFAULT 0,
  "paid_amount" integer NOT NULL DEFAULT 0,
  "balance" integer NOT NULL DEFAULT 0,
  "closed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "folios_lead_uidx" ON "folios" ("lead_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "folios_code_uidx" ON "folios" ("code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folios_guest_idx" ON "folios" ("guest_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folios_property_idx" ON "folios" ("property_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "folio_lines" (
  "id" text PRIMARY KEY NOT NULL,
  "folio_id" text NOT NULL REFERENCES "folios"("id") ON DELETE CASCADE,
  "lead_item_id" text REFERENCES "lead_items"("id") ON DELETE SET NULL,
  "catalog_item_id" text REFERENCES "service_catalog"("id") ON DELETE SET NULL,
  "category" text NOT NULL,
  "description" text NOT NULL,
  "quantity" integer NOT NULL DEFAULT 1,
  "unit" text,
  "unit_price" integer NOT NULL DEFAULT 0,
  "line_total" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'active',
  "metadata" jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folio_lines_folio_idx" ON "folio_lines" ("folio_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folio_lines_item_idx" ON "folio_lines" ("lead_item_id");
--> statement-breakpoint

-- 2. lead_items: привязка к каталогу и price snapshot
ALTER TABLE "lead_items" ADD COLUMN IF NOT EXISTS "catalog_item_id" text REFERENCES "service_catalog"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "lead_items" ADD COLUMN IF NOT EXISTS "pricing_mode_snapshot" text;
--> statement-breakpoint
ALTER TABLE "lead_items" ADD COLUMN IF NOT EXISTS "catalog_default_price" integer;
--> statement-breakpoint
ALTER TABLE "lead_items" ADD COLUMN IF NOT EXISTS "price_overridden" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "lead_items" ADD COLUMN IF NOT EXISTS "override_reason" text;
--> statement-breakpoint

-- 3. lead_interests: базовые параметры запроса по категории
ALTER TABLE "lead_interests" ADD COLUMN IF NOT EXISTS "details" jsonb;
--> statement-breakpoint

-- 4. service_catalog: полноценный rate card
ALTER TABLE "service_catalog" ADD COLUMN IF NOT EXISTS "service_type" text;
--> statement-breakpoint
ALTER TABLE "service_catalog" ADD COLUMN IF NOT EXISTS "pricing_unit" text;
--> statement-breakpoint
ALTER TABLE "service_catalog" ADD COLUMN IF NOT EXISTS "default_duration_minutes" integer;
--> statement-breakpoint
ALTER TABLE "service_catalog" ADD COLUMN IF NOT EXISTS "display_order" integer NOT NULL DEFAULT 0;
--> statement-breakpoint

-- 5. guest_payments и offers: привязка к folio
ALTER TABLE "guest_payments" ADD COLUMN IF NOT EXISTS "folio_id" text REFERENCES "folios"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "folio_id" text REFERENCES "folios"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- 6. Backfill folio для существующих лидов
INSERT INTO "folios" ("id", "code", "lead_id", "guest_id", "property_id", "status", "currency", "subtotal", "total_amount", "deposit_required", "paid_amount", "balance", "closed_at")
SELECT
  'folio_' || l."id",
  'F-' || l."code",
  l."id",
  l."guest_id",
  l."property_id",
  CASE l."stage"
    WHEN 'completed' THEN 'closed'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'lost' THEN 'cancelled'
    WHEN 'confirmed' THEN CASE WHEN l."paid_amount" >= l."total_amount" AND l."total_amount" > 0 THEN 'settled' ELSE 'open' END
    WHEN 'payment_pending' THEN 'payment_pending'
    WHEN 'offer' THEN 'quoted'
    ELSE 'open'
  END,
  'KZT',
  l."total_amount",
  l."total_amount",
  l."deposit",
  l."paid_amount",
  GREATEST(l."total_amount" - l."paid_amount", 0),
  CASE WHEN l."stage" IN ('completed', 'cancelled', 'lost') THEN now() ELSE NULL END
FROM "leads" l
WHERE NOT EXISTS (SELECT 1 FROM "folios" f WHERE f."lead_id" = l."id");
--> statement-breakpoint

-- 7. Backfill folio_lines из существующих lead_items
INSERT INTO "folio_lines" ("id", "folio_id", "lead_item_id", "catalog_item_id", "category", "description", "quantity", "unit", "unit_price", "line_total", "status", "metadata")
SELECT
  'fline_' || li."id",
  f."id",
  li."id",
  NULL,
  li."type",
  li."name",
  li."quantity",
  NULL,
  COALESCE(li."unit_amount", CASE WHEN li."quantity" > 0 THEN COALESCE(li."total_amount", 0) / li."quantity" ELSE COALESCE(li."total_amount", 0) END, 0),
  COALESCE(li."total_amount", 0),
  CASE WHEN li."status" = 'cancelled' THEN 'cancelled' ELSE 'active' END,
  li."metadata"
FROM "lead_items" li
JOIN "folios" f ON f."lead_id" = li."lead_id"
WHERE NOT EXISTS (SELECT 1 FROM "folio_lines" fl WHERE fl."lead_item_id" = li."id");
--> statement-breakpoint

-- 8. Привязать существующие платежи к фолио
UPDATE "guest_payments" gp
SET "folio_id" = f."id"
FROM "folios" f
WHERE gp."lead_id" = f."lead_id" AND gp."folio_id" IS NULL;
--> statement-breakpoint

-- 9. Трансфер убран из продаж (исторические позиции не трогаем)
UPDATE "service_catalog" SET "active" = false WHERE "code" = 'transfer';
