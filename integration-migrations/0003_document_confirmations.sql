-- Hotel documents sent into guest chats for confirmation (AI conversation or a new staff chat).
CREATE TABLE IF NOT EXISTS guestra_document_confirmations (
 id text PRIMARY KEY, property_id text NOT NULL REFERENCES properties(id), customer_id text NOT NULL REFERENCES guests(id),
 conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 pms_reservation_id text NOT NULL, confirmation_number text, kind text NOT NULL CHECK(kind IN ('proposal','confirmation')),
 document_url text NOT NULL, mode text NOT NULL CHECK(mode IN ('ai','manual')),
 status text NOT NULL DEFAULT 'awaiting' CHECK(status IN ('awaiting','confirmed','answered','declined','superseded')),
 request_message_id text NOT NULL, response_message_id text, idempotency_key text NOT NULL,
 requested_by text, resolved_by text, answered_at timestamptz, confirmed_at timestamptz,
 pms_synced_at timestamptz, pms_sync_error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS guestra_document_confirmation_key ON guestra_document_confirmations(property_id,idempotency_key);
CREATE INDEX IF NOT EXISTS guestra_document_confirmation_conversation ON guestra_document_confirmations(conversation_id,status);
CREATE INDEX IF NOT EXISTS guestra_document_confirmation_reservation ON guestra_document_confirmations(property_id,pms_reservation_id);
