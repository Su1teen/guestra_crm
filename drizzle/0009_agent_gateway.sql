ALTER TABLE "conversations" ADD COLUMN "automation_mode" text DEFAULT 'human' NOT NULL;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "external_chat_id" text;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "handoff_reason_code" text;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "handoff_priority" text;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "handoff_note" text;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "requested_action" text;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "handoff_requested_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "handoff_resolved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "ai_resumed_at" timestamp with time zone;
--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_channel_property_guest_chat_uidx" ON "conversations" USING btree ("channel", "property_id", "guest_id", "external_chat_id");
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sender_type" text DEFAULT 'human' NOT NULL;
--> statement-breakpoint
UPDATE "messages" SET "sender_type" = CASE WHEN "direction" = 'in' THEN 'contact' WHEN "direction" = 'note' THEN 'human' ELSE 'human' END;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "external_message_id" text;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "external_update_id" text;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "delivery_status" text DEFAULT 'sent' NOT NULL;
--> statement-breakpoint
UPDATE "messages" SET "delivery_status" = 'received' WHERE "direction" = 'in';
--> statement-breakpoint
UPDATE "messages" SET "delivery_status" = 'sent' WHERE "direction" = 'out';
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "messages_idempotency_uidx" ON "messages" USING btree ("idempotency_key");
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "idempotency_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_idempotency_uidx" ON "tasks" USING btree ("idempotency_key");
--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "idempotency_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_idempotency_uidx" ON "reservations" USING btree ("idempotency_key");
--> statement-breakpoint
ALTER TABLE "unit_types" ADD COLUMN "max_adults" integer;
--> statement-breakpoint
ALTER TABLE "unit_types" ADD COLUMN "max_children" integer;
--> statement-breakpoint
ALTER TABLE "unit_types" ADD COLUMN "max_occupancy" integer;
--> statement-breakpoint
ALTER TABLE "unit_types" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "service_catalog" ADD COLUMN "agent_booking_mode" text DEFAULT 'disabled' NOT NULL;
--> statement-breakpoint
CREATE TABLE "property_knowledge" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL REFERENCES "properties"("id") ON DELETE cascade,
	"topic" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"language" text DEFAULT 'ru' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"source" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "property_knowledge_property_topic_language_uidx" ON "property_knowledge" USING btree ("property_id", "topic", "language");
--> statement-breakpoint
UPDATE "service_catalog" SET "agent_booking_mode" = CASE
	WHEN "code" IN ('spa_visit', 'spa_pool', 'massage_60', 'bathhouse', 'karaoke', 'act_atv', 'act_horse') THEN 'live_booking'
	WHEN "code" = 'restaurant_sova' OR "service_type" IN ('corporate_event', 'wedding_or_banquet') THEN 'request_only'
	WHEN "service_type" = 'other' THEN 'info_only'
	ELSE 'disabled'
END
WHERE "agent_booking_mode" = 'disabled';
--> statement-breakpoint
UPDATE "unit_types" SET "max_occupancy" = 4,
	"metadata" = '{"shortDescription":"Домик внутри леса для размещения до 4 гостей.","capacity":4,"recommendedFor":["гостей, которым важен лесной формат отдыха"],"notRecommendedFor":["семей с маленькими детьми или пожилыми гостями на втором ярусе"],"bedLayout":"Первый уровень: раскладной двухместный диван; второй ярус: двуспальное место.","locationDescription":"Расположен внутри леса.","features":["подвесная качеля","печь-камин","санузел с душем","терраса","тёплый пол","телевизор","Wi-Fi","кондиционер","чайная зона","мини-бар"],"sellingPoints":["печь-камин","расположение внутри леса"],"warnings":["На втором ярусе низкий потолок, крутая лестница и нет ограждения.","Тёплый чан доступен по сезону за дополнительную плату; нагрев занимает около 5 часов.","Ванна на террасе доступна по сезону."],"source":"https://leshotelborovoe.kz/prozhivanie/"}'::jsonb
WHERE "property_id" = 'les_borovoe' AND "name" = 'A-Frame' AND "max_occupancy" IS NULL;
--> statement-breakpoint
UPDATE "unit_types" SET "max_occupancy" = 4,
	"metadata" = '{"shortDescription":"Домик напротив леса для 2 взрослых и 2 детей или подростков.","capacity":4,"recommendedFor":["семей с детьми или подростками"],"notRecommendedFor":[],"bedLayout":"Первый уровень: двуспальная кровать; второй ярус: двуспальное место.","locationDescription":"Расположен напротив леса.","features":["панорамное окно на потолке","санузел с душем","терраса","тёплый пол","телевизор","Wi-Fi","кондиционер","чайная зона","мини-бар"],"sellingPoints":["дизайн в форме гнезда","панорамное окно на потолке"],"warnings":["На втором ярусе низкий потолок и крутая лестница; место оборудовано ограждёнными перилами."],"source":"https://leshotelborovoe.kz/prozhivanie/"}'::jsonb
WHERE "property_id" = 'les_borovoe' AND "name" = 'Nest House' AND "max_occupancy" IS NULL;
--> statement-breakpoint
UPDATE "unit_types" SET "max_occupancy" = 4,
	"metadata" = '{"shortDescription":"Домик напротив леса для 2 взрослых и 2 детей.","capacity":4,"recommendedFor":["семей с детьми","гостей, которым важна ванная комната с панорамным видом"],"notRecommendedFor":["взрослых или пожилых гостей на втором ярусе"],"bedLayout":"Первый уровень: двуспальная кровать; второй ярус: двуспальное место.","locationDescription":"Расположен напротив леса.","features":["ванная комната с панорамным видом на лес","терраса","тёплый пол","телевизор","Wi-Fi","кондиционер","чайная зона","мини-бар"],"sellingPoints":["ванная комната с панорамным видом на лес","необычный стеклянный дизайн"],"warnings":["На втором ярусе низкий потолок и крутая лестница; он рассчитан для детей и не подходит взрослым или пожилым гостям."],"source":"https://leshotelborovoe.kz/prozhivanie/"}'::jsonb
WHERE "property_id" = 'les_borovoe' AND "name" = 'Glass House' AND "max_occupancy" IS NULL;
--> statement-breakpoint
UPDATE "unit_types" SET "max_occupancy" = 2,
	"metadata" = '{"shortDescription":"Отдельный двухместный номер в Forest House.","capacity":2,"recommendedFor":["одного или двух гостей"],"notRecommendedFor":[],"bedLayout":"Отдельная спальня с двуспальной кроватью.","locationDescription":"Расположен напротив леса; номера находятся в общем доме с отдельными входами в каждый номер.","features":["отдельный санузел с душем","терраса","тёплый пол","телевизор","Wi-Fi","кондиционер","чайная зона","мини-бар"],"sellingPoints":["отдельный номер в Forest House"],"warnings":[],"source":"https://leshotelborovoe.kz/prozhivanie/"}'::jsonb
WHERE "property_id" = 'les_borovoe' AND "name" = 'Forest House · 2-местный номер' AND "max_occupancy" IS NULL;
--> statement-breakpoint
UPDATE "unit_types" SET "max_occupancy" = 6,
	"metadata" = '{"shortDescription":"Отдельный шестиместный номер в Forest House.","capacity":6,"recommendedFor":["семей или компаний до 6 гостей"],"notRecommendedFor":[],"bedLayout":"Две отдельные спальни с двуспальными кроватями и гостиная с раскладным диваном.","locationDescription":"Расположен напротив леса; номера находятся в общем доме с отдельными входами в каждый номер.","features":["отдельный санузел с душем","терраса","тёплый пол","телевизор","Wi-Fi","кондиционер","чайная зона","мини-бар"],"sellingPoints":["две отдельные спальни","гостиная с раскладным диваном"],"warnings":[],"source":"https://leshotelborovoe.kz/prozhivanie/"}'::jsonb
WHERE "property_id" = 'les_borovoe' AND "name" = 'Forest House · 6-местный номер' AND "max_occupancy" IS NULL;
--> statement-breakpoint
