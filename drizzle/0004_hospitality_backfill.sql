-- Idempotent backfill. Only accommodation with usable dates becomes a reservation.
UPDATE "guests"
SET "normalized_phone" = NULLIF(CASE WHEN left(regexp_replace("phone", '[^0-9]', '', 'g'), 1) = '8' AND length(regexp_replace("phone", '[^0-9]', '', 'g')) = 11 THEN '7' || substr(regexp_replace("phone", '[^0-9]', '', 'g'), 2) ELSE regexp_replace("phone", '[^0-9]', '', 'g') END, ''),
    "normalized_email" = NULLIF(lower(btrim("email")), '')
WHERE "normalized_phone" IS NULL OR "normalized_email" IS NULL;
--> statement-breakpoint
UPDATE "leads" SET "request_status" = CASE
  WHEN "stage" = 'confirmed' THEN 'won'
  WHEN "stage" = 'completed' THEN 'closed'
  WHEN "stage" IN ('lost', 'cancelled') THEN 'lost'
  WHEN "stage" = 'new' THEN 'new'
  ELSE 'active' END
WHERE "request_status" = 'new';
--> statement-breakpoint
INSERT INTO "unit_types" ("id", "property_id", "name")
SELECT 'ut_' || md5("property_id" || ':' || "category"), "property_id", "category"
FROM "rooms" WHERE btrim("category") <> '' GROUP BY "property_id", "category"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "rooms" r SET "unit_type_id" = ut."id"
FROM "unit_types" ut
WHERE r."unit_type_id" IS NULL AND r."property_id" = ut."property_id" AND r."category" = ut."name";
--> statement-breakpoint
INSERT INTO "reservations" ("id", "code", "property_id", "booker_customer_id", "request_id", "unit_type_id", "room_type_snapshot", "source", "status", "arrival_at", "departure_at", "adults", "children", "currency", "special_request", "external_reservation_id", "external_confirmation_number", "confirmed_at")
SELECT 'res_lead_' || l."id", 'R-' || l."code", l."property_id", l."guest_id", l."id", ut."id", l."room_type", l."source",
       CASE WHEN l."stage" = 'completed' THEN 'completed' ELSE 'confirmed' END,
       l."check_in", l."check_out", l."adults", l."children", COALESCE(f."currency", 'KZT'), l."special_request", l."reservation_id", l."booking_reference", l."updated_at"
FROM "leads" l
LEFT JOIN "folios" f ON f."lead_id" = l."id"
LEFT JOIN "unit_types" ut ON ut."property_id" = l."property_id" AND ut."name" = l."room_type"
WHERE l."stage" IN ('confirmed', 'completed')
  AND l."check_in" IS NOT NULL AND l."check_out" > l."check_in"
  AND (EXISTS (SELECT 1 FROM "lead_items" li WHERE li."lead_id" = l."id" AND li."type" = 'accommodation')
       OR EXISTS (SELECT 1 FROM "lead_interests" i WHERE i."lead_id" = l."id" AND i."direction" = 'accommodation')
       OR (l."room_type" IS NOT NULL AND btrim(l."room_type") <> ''))
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Existing stay records are indisputable accommodation evidence. An exact
-- property+reference can match even when the booker and staying guest differ.
UPDATE "guest_stays" gs SET "reservation_id" = r."id"
FROM "reservations" r
WHERE gs."reservation_id" IS NULL AND gs."property_id" = r."property_id"
  AND gs."booking_reference" = r."external_confirmation_number";
--> statement-breakpoint
INSERT INTO "reservations" ("id", "code", "property_id", "booker_customer_id", "room_type_snapshot", "source", "status", "arrival_at", "departure_at", "adults", "children", "currency", "external_confirmation_number", "confirmed_at")
SELECT 'res_stay_' || gs."id", 'R-STAY-' || gs."id", gs."property_id", gs."guest_id", gs."room_type", 'legacy_stay',
       CASE WHEN gs."status" = 'completed' THEN 'completed' ELSE 'confirmed' END,
       gs."check_in", gs."check_out", gs."adults", gs."children", 'KZT', gs."booking_reference", gs."created_at"
FROM "guest_stays" gs
WHERE gs."reservation_id" IS NULL AND gs."check_out" > gs."check_in"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "guest_stays" gs SET "reservation_id" = r."id"
FROM "reservations" r
WHERE gs."reservation_id" IS NULL AND r."id" = 'res_stay_' || gs."id";
--> statement-breakpoint
UPDATE "guest_stays" SET "operational_status" = CASE
  WHEN "status" IN ('completed', 'checked_out') THEN 'checked_out'
  WHEN "status" = 'in_house' THEN 'in_house'
  WHEN "status" = 'no_show' THEN 'no_show'
  WHEN "status" = 'cancelled' THEN 'cancelled'
  ELSE 'upcoming' END
WHERE "operational_status" = 'upcoming';
--> statement-breakpoint
INSERT INTO "guest_stays" ("id", "guest_id", "property_id", "reservation_id", "room_type", "check_in", "check_out", "nights", "adults", "children", "amount", "booking_reference", "status", "operational_status", "actual_check_in", "actual_check_out")
SELECT 'stay_res_' || r."id", r."booker_customer_id", r."property_id", r."id",
       COALESCE(r."room_type_snapshot", 'Размещение'), r."arrival_at", r."departure_at",
       GREATEST(1, ceil(extract(epoch FROM (r."departure_at" - r."arrival_at")) / 86400)::integer),
       r."adults", r."children", COALESCE(f."total_amount", 0),
       COALESCE(r."external_confirmation_number", r."code"),
       CASE WHEN r."status" = 'completed' THEN 'completed' ELSE 'confirmed' END,
       CASE WHEN r."status" = 'completed' THEN 'checked_out' ELSE 'upcoming' END,
       CASE WHEN r."status" = 'completed' THEN r."arrival_at" ELSE NULL END,
       CASE WHEN r."status" = 'completed' THEN r."departure_at" ELSE NULL END
FROM "reservations" r LEFT JOIN "folios" f ON f."lead_id" = r."request_id"
WHERE NOT EXISTS (SELECT 1 FROM "guest_stays" gs WHERE gs."reservation_id" = r."id")
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "reservation_guests" ("id", "reservation_id", "customer_id", "full_name", "role", "is_primary", "is_booker", "age_group")
SELECT 'rg_' || r."id", r."id", r."booker_customer_id", g."full_name", 'primary', true, true, 'adult'
FROM "reservations" r JOIN "guests" g ON g."id" = r."booker_customer_id"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "reservation_guests" rg SET "is_primary" = false
FROM "reservations" r
WHERE rg."reservation_id" = r."id" AND rg."is_booker" = true
  AND EXISTS (SELECT 1 FROM "guest_stays" gs WHERE gs."reservation_id" = r."id" AND gs."guest_id" <> r."booker_customer_id");
--> statement-breakpoint
INSERT INTO "reservation_guests" ("id", "reservation_id", "customer_id", "full_name", "role", "is_primary", "is_booker", "age_group")
SELECT 'rg_stay_' || gs."id", gs."reservation_id", gs."guest_id", g."full_name", 'primary', true, false, 'adult'
FROM "guest_stays" gs JOIN "reservations" r ON r."id" = gs."reservation_id"
JOIN "guests" g ON g."id" = gs."guest_id"
WHERE gs."guest_id" <> r."booker_customer_id"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "folios" f SET "reservation_id" = r."id"
FROM "reservations" r WHERE f."reservation_id" IS NULL AND f."lead_id" = r."request_id";
--> statement-breakpoint
UPDATE "folios" f SET "stay_id" = gs."id"
FROM "guest_stays" gs WHERE f."stay_id" IS NULL AND f."reservation_id" = gs."reservation_id";
--> statement-breakpoint
UPDATE "guest_payments" gp SET "reservation_id" = r."id"
FROM "reservations" r WHERE gp."reservation_id" IS NULL AND gp."lead_id" = r."request_id";
--> statement-breakpoint
UPDATE "guest_payments" gp SET "reservation_id" = gs."reservation_id"
FROM "guest_stays" gs WHERE gp."reservation_id" IS NULL AND gp."stay_id" = gs."id";
