CREATE TABLE IF NOT EXISTS "agent_tool_events" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text,
	"conversation_id" text,
	"guest_id" text,
	"tool" text NOT NULL,
	"channel" text,
	"request_id" text,
	"success" boolean NOT NULL,
	"status_code" integer NOT NULL,
	"error_code" text,
	"duration_ms" integer NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"kind" text NOT NULL,
	"mime_type" text,
	"file_name" text,
	"file_size" integer,
	"external_file_id" text,
	"storage_provider" text,
	"storage_key" text,
	"duration_ms" integer,
	"processing_status" text DEFAULT 'received' NOT NULL,
	"transcript" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_tool_events" ADD CONSTRAINT "agent_tool_events_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_tool_events" ADD CONSTRAINT "agent_tool_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_tool_events" ADD CONSTRAINT "agent_tool_events_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tool_events_conversation_idx" ON "agent_tool_events" USING btree ("conversation_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tool_events_tool_idx" ON "agent_tool_events" USING btree ("tool","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tool_events_guest_idx" ON "agent_tool_events" USING btree ("guest_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_attachments_message_idx" ON "message_attachments" USING btree ("message_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "message_attachments_external_file_uidx" ON "message_attachments" USING btree ("message_id","external_file_id");
