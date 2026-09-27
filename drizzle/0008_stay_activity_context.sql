ALTER TABLE "guest_activity" ADD COLUMN IF NOT EXISTS "reservation_id" text REFERENCES "reservations"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "guest_activity" ADD COLUMN IF NOT EXISTS "stay_id" text REFERENCES "guest_stays"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "guest_activity" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guest_activity_reservation_idx" ON "guest_activity" ("reservation_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guest_activity_stay_idx" ON "guest_activity" ("stay_id", "occurred_at");
