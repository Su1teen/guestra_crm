CREATE TABLE IF NOT EXISTS integration_principal_registry (
 id text PRIMARY KEY, key_hash varchar(64) NOT NULL UNIQUE,
 environment text NOT NULL CHECK(environment IN ('production','sandbox','test')),
 property_ids jsonb NOT NULL, scopes jsonb NOT NULL, workspace_ids jsonb NOT NULL DEFAULT '[]',
 revoked boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS integration_bootstrap_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, principal_id text NOT NULL,
 action text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now()
);
