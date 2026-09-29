-- Additive hospitality lifecycle, desk alerts and immutable folio documents.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS request_lifecycle text NOT NULL DEFAULT 'enquire';
--> statement-breakpoint
ALTER TABLE guest_notes ADD COLUMN IF NOT EXISTS property_id text REFERENCES properties(id) ON DELETE SET NULL;
ALTER TABLE guest_notes ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';
ALTER TABLE guest_notes ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
ALTER TABLE guest_notes ADD COLUMN IF NOT EXISTS alert boolean NOT NULL DEFAULT false;
ALTER TABLE guest_notes ADD COLUMN IF NOT EXISTS valid_from timestamptz;
ALTER TABLE guest_notes ADD COLUMN IF NOT EXISTS valid_until timestamptz;
ALTER TABLE guest_notes ADD COLUMN IF NOT EXISTS display_areas jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE reservation_notes ADD COLUMN IF NOT EXISTS property_id text REFERENCES properties(id) ON DELETE SET NULL;
ALTER TABLE reservation_notes ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';
ALTER TABLE reservation_notes ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
ALTER TABLE reservation_notes ADD COLUMN IF NOT EXISTS alert boolean NOT NULL DEFAULT false;
ALTER TABLE reservation_notes ADD COLUMN IF NOT EXISTS valid_from timestamptz;
ALTER TABLE reservation_notes ADD COLUMN IF NOT EXISTS valid_until timestamptz;
ALTER TABLE reservation_notes ADD COLUMN IF NOT EXISTS display_areas jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS request_lifecycle_history (
  id text PRIMARY KEY, lead_id text NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  from_status text, to_status text NOT NULL, employee_id text REFERENCES employees(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'manual', reason text, changed_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS request_lifecycle_history_lead_idx ON request_lifecycle_history(lead_id, changed_at);
--> statement-breakpoint
ALTER TABLE folios ADD COLUMN IF NOT EXISTS final_version integer NOT NULL DEFAULT 0;
ALTER TABLE folios ADD COLUMN IF NOT EXISTS finalised_at timestamptz;
CREATE TABLE IF NOT EXISTS folio_documents (
  id text PRIMARY KEY, folio_id text NOT NULL REFERENCES folios(id) ON DELETE CASCADE,
  version integer NOT NULL, kind text NOT NULL, snapshot jsonb NOT NULL,
  created_by_employee_id text REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(folio_id, version)
);
CREATE INDEX IF NOT EXISTS folio_documents_folio_idx ON folio_documents(folio_id);
