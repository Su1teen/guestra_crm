ALTER TABLE properties ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Qyzylorda';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS agent_action_executions (
  id text PRIMARY KEY,
  property_id text NOT NULL REFERENCES properties(id),
  guest_id text NOT NULL REFERENCES guests(id),
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  proposal_message_id text NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  confirmation_message_id text NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (action_type IN ('book_accommodation', 'book_service', 'reschedule_service', 'cancel_service', 'extend_stay')),
  payload_hash text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS agent_action_execution_confirmation_uidx
  ON agent_action_executions (confirmation_message_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS agent_action_execution_proposal_uidx
  ON agent_action_executions (proposal_message_id, action_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_action_execution_conversation_idx
  ON agent_action_executions (conversation_id, created_at DESC);
