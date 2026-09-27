ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "conversation_id" text REFERENCES "conversations"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "room_id" text REFERENCES "rooms"("id") ON DELETE SET NULL;
--> statement-breakpoint
INSERT INTO "tasks" ("id", "title", "type", "status", "priority", "due_at", "owner_id", "guest_id", "lead_id", "property_id", "description", "completed_at", "source")
SELECT 'task_legacy_followup_' || follow_up."id", follow_up."recommended_action", 'follow_up',
  CASE WHEN follow_up."status" = 'open' AND follow_up."due_at" < now() THEN 'overdue'
       WHEN follow_up."status" = 'open' THEN 'todo' ELSE 'done' END,
  CASE WHEN follow_up."temperature" = 'hot' THEN 'high' ELSE 'medium' END,
  follow_up."due_at", follow_up."owner_id", follow_up."guest_id", follow_up."lead_id", follow_up."property_id",
  follow_up."context", follow_up."completed_at", 'legacy_follow_up:' || follow_up."id"
FROM "follow_ups" AS follow_up
WHERE NOT EXISTS (
  SELECT 1 FROM "tasks" AS task
  WHERE task."source" = 'legacy_follow_up:' || follow_up."id"
     OR (task."lead_id" = follow_up."lead_id" AND task."guest_id" = follow_up."guest_id" AND task."type" = 'follow_up')
);
--> statement-breakpoint
UPDATE "tasks" AS task SET "conversation_id" = conversation."id"
FROM "conversations" AS conversation
WHERE task."conversation_id" IS NULL AND task."lead_id" IS NOT NULL AND conversation."lead_id" = task."lead_id";
--> statement-breakpoint
UPDATE "tasks" AS task SET "reservation_id" = reservation."id"
FROM "reservations" AS reservation
WHERE task."reservation_id" IS NULL AND task."lead_id" IS NOT NULL AND reservation."request_id" = task."lead_id";
--> statement-breakpoint
UPDATE "tasks" AS task SET "stay_id" = stay."id", "room_id" = stay."room_id"
FROM "guest_stays" AS stay
WHERE task."stay_id" IS NULL AND task."reservation_id" IS NOT NULL AND stay."reservation_id" = task."reservation_id";
