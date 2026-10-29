-- Staff two-way sync between CRM and PMS: one row per mirrored entity.
-- origin = the system where the entity was created; the other side holds the copy.
CREATE TABLE IF NOT EXISTS guestra_staff_sync (
 property_id text NOT NULL REFERENCES properties(id), entity text NOT NULL, local_id text NOT NULL, remote_id text NOT NULL,
 origin text NOT NULL CHECK(origin IN ('crm','pms')), state jsonb NOT NULL DEFAULT '{}'::jsonb, last_error text,
 attempts integer NOT NULL DEFAULT 0, synced_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(property_id,entity,local_id),
 CONSTRAINT guestra_staff_sync_remote UNIQUE(property_id,entity,remote_id)
);
-- CRM rows that could not be pushed yet keep their error here so staff can see and retry them.
CREATE TABLE IF NOT EXISTS guestra_staff_sync_failures (
 property_id text NOT NULL REFERENCES properties(id), entity text NOT NULL, local_id text NOT NULL, last_error text NOT NULL,
 attempts integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(property_id,entity,local_id)
);
