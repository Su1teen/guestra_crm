ALTER TABLE reservations ADD COLUMN IF NOT EXISTS hold_expires_at timestamptz;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS payment_requests (
  id text PRIMARY KEY,
  lead_id text NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  reservation_id text REFERENCES reservations(id) ON DELETE SET NULL,
  folio_id text NOT NULL REFERENCES folios(id),
  conversation_id text REFERENCES conversations(id) ON DELETE SET NULL,
  guest_id text NOT NULL REFERENCES guests(id),
  amount integer NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'KZT',
  kind text NOT NULL CHECK (kind IN ('deposit', 'full')),
  method text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'expired', 'cancelled')),
  payment_url text,
  external_provider_id text,
  expires_at timestamptz,
  sent_at timestamptz,
  paid_at timestamptz,
  created_by text REFERENCES employees(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS payment_requests_lead_status_idx ON payment_requests(lead_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS payment_requests_reservation_idx ON payment_requests(reservation_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS scheduled_outbound_messages (
  id text PRIMARY KEY,
  reservation_id text NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  conversation_id text REFERENCES conversations(id) ON DELETE SET NULL,
  guest_id text NOT NULL REFERENCES guests(id),
  property_id text NOT NULL REFERENCES properties(id),
  trigger_type text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')),
  template_key text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  sent_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scheduled_outbound_due_idx ON scheduled_outbound_messages(status, scheduled_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS scheduled_outbound_reservation_idx ON scheduled_outbound_messages(reservation_id);
