-- Explicit opt-in migration. Never part of the automatic production journal.
CREATE TABLE IF NOT EXISTS integration_mappings (
 id text PRIMARY KEY, property_id text NOT NULL REFERENCES properties(id), tenant_id text NOT NULL,
 source_system text NOT NULL, local_type text NOT NULL, local_id text NOT NULL,
 remote_property_id text NOT NULL, remote_type text NOT NULL, remote_id text NOT NULL,
 verified_at timestamptz NOT NULL, evidence jsonb NOT NULL,
 CONSTRAINT integration_mapping_local UNIQUE(property_id,source_system,local_type,local_id,remote_type),
 CONSTRAINT integration_mapping_remote UNIQUE(property_id,source_system,remote_property_id,remote_type,remote_id,local_type)
);
CREATE TABLE IF NOT EXISTS integration_operations (
 id text PRIMARY KEY,property_id text NOT NULL REFERENCES properties(id),customer_id text NOT NULL REFERENCES guests(id),
 conversation_id text NOT NULL REFERENCES conversations(id),kind text NOT NULL,operation_key text NOT NULL,fingerprint text NOT NULL,
 payload jsonb NOT NULL,status text NOT NULL DEFAULT 'pending',result jsonb,attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(),last_error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT integration_operation_key UNIQUE(property_id,operation_key),CONSTRAINT integration_operation_status CHECK(status IN ('pending','completed','rejected'))
);
CREATE INDEX IF NOT EXISTS integration_operation_pending ON integration_operations(status,available_at);
CREATE TABLE IF NOT EXISTS integration_projections (
 property_id text NOT NULL REFERENCES properties(id),remote_property_id text NOT NULL,entity_type text NOT NULL,entity_id text NOT NULL,
 customer_id text NOT NULL REFERENCES guests(id),revision bigint NOT NULL CHECK(revision>=0),snapshot jsonb NOT NULL,verified_at timestamptz NOT NULL,
 PRIMARY KEY(property_id,remote_property_id,entity_type,entity_id)
);
CREATE TABLE IF NOT EXISTS integration_inbox (
 property_id text NOT NULL REFERENCES properties(id),event_id text NOT NULL,fingerprint text NOT NULL,envelope jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending',attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),
 received_at timestamptz NOT NULL DEFAULT now(),last_error text,PRIMARY KEY(property_id,event_id)
);
CREATE TABLE IF NOT EXISTS integration_outbox (
 id text PRIMARY KEY,property_id text NOT NULL REFERENCES properties(id),event_type text NOT NULL,payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),delivered_at timestamptz,attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now()
);
-- A counter row serializes commits within a conversation. bigserial alone loses
-- late commits when a faster transaction advances a consumer's cursor.
CREATE TABLE IF NOT EXISTS message_change_heads (conversation_id text PRIMARY KEY,sequence bigint NOT NULL);
CREATE TABLE IF NOT EXISTS message_changes (
 conversation_id text NOT NULL,message_id text NOT NULL,sequence bigint NOT NULL,kind text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(conversation_id,sequence)
);
CREATE OR REPLACE FUNCTION guestra_message_change(conv text,msg text,change_kind text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE next_seq bigint;
BEGIN
 INSERT INTO message_change_heads VALUES(conv,1) ON CONFLICT(conversation_id)
 DO UPDATE SET sequence=message_change_heads.sequence+1 RETURNING sequence INTO next_seq;
 INSERT INTO message_changes(conversation_id,message_id,sequence,kind) VALUES(conv,msg,next_seq,change_kind);
END $$;
CREATE OR REPLACE FUNCTION guestra_message_change_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.direction IN ('in','out') AND OLD.sender_type NOT IN ('internal','note') THEN PERFORM guestra_message_change(OLD.conversation_id,OLD.id,'tombstone');END IF;
  RETURN OLD;
 END IF;
 IF NEW.direction IN ('in','out') AND NEW.sender_type NOT IN ('internal','note') THEN
  PERFORM guestra_message_change(NEW.conversation_id,NEW.id,CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'updated' END);
 ELSIF TG_OP='UPDATE' AND OLD.direction IN ('in','out') AND OLD.sender_type NOT IN ('internal','note') THEN
  PERFORM guestra_message_change(OLD.conversation_id,OLD.id,'tombstone');
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION guestra_attachment_change_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_message messages;
BEGIN
 SELECT * INTO row_message FROM messages WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.message_id ELSE NEW.message_id END;
 IF row_message.id IS NOT NULL AND row_message.direction IN ('in','out') AND row_message.sender_type NOT IN ('internal','note') THEN
  PERFORM guestra_message_change(row_message.conversation_id,row_message.id,'updated');
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='guestra_message_changes') THEN
  -- Initial history is guest safe and ordered; repeated migration never duplicates it.
  PERFORM guestra_message_change(conversation_id,id,'created') FROM messages
    WHERE direction IN ('in','out') AND sender_type NOT IN ('internal','note') ORDER BY conversation_id,sent_at,id;
  CREATE TRIGGER guestra_message_changes AFTER INSERT OR UPDATE OR DELETE ON messages FOR EACH ROW EXECUTE FUNCTION guestra_message_change_trigger();
  CREATE TRIGGER guestra_attachment_changes AFTER INSERT OR UPDATE OR DELETE ON message_attachments FOR EACH ROW EXECUTE FUNCTION guestra_attachment_change_trigger();
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS integration_cursors (
 property_id text PRIMARY KEY REFERENCES properties(id), sequence bigint NOT NULL DEFAULT 0 CHECK(sequence>=0),
 checked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE integration_outbox ADD COLUMN IF NOT EXISTS sequence bigint;
CREATE TABLE IF NOT EXISTS integration_outbox_heads(property_id text PRIMARY KEY REFERENCES properties(id),sequence bigint NOT NULL);
CREATE OR REPLACE FUNCTION guestra_outbox_sequence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO integration_outbox_heads VALUES(NEW.property_id,1) ON CONFLICT(property_id)
 DO UPDATE SET sequence=integration_outbox_heads.sequence+1 RETURNING sequence INTO NEW.sequence;
 RETURN NEW;
END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='guestra_outbox_sequence_trigger') THEN
 CREATE TRIGGER guestra_outbox_sequence_trigger BEFORE INSERT ON integration_outbox FOR EACH ROW EXECUTE FUNCTION guestra_outbox_sequence();
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS integration_outbox_cursor ON integration_outbox(property_id,sequence);

CREATE TABLE IF NOT EXISTS integration_event_consumers (
 property_id text NOT NULL REFERENCES properties(id),principal_id text NOT NULL,sequence bigint NOT NULL DEFAULT 0 CHECK(sequence>=0),
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(property_id,principal_id)
);
CREATE OR REPLACE FUNCTION guestra_crm_domain_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE body jsonb:=to_jsonb(NEW);prop text;customer text;conversation text;kind text;event_name text;facts jsonb;tenant text;
BEGIN
 IF TG_OP='UPDATE' AND to_jsonb(OLD)=body THEN RETURN NEW;END IF;
 kind:=CASE TG_TABLE_NAME WHEN 'guests' THEN 'customer' WHEN 'conversations' THEN 'conversation'
  WHEN 'leads' THEN 'request' WHEN 'offers' THEN 'offer' WHEN 'messages' THEN 'message' END;
 prop:=body->>'property_id';customer:=body->>'guest_id';
 IF TG_TABLE_NAME='guests' THEN prop:=body->>'preferred_property_id';customer:=body->>'id';END IF;
 IF TG_TABLE_NAME='messages' THEN
  IF body->>'direction' NOT IN ('in','out') OR body->>'sender_type' IN ('internal','note') THEN RETURN NEW;END IF;
  conversation:=body->>'conversation_id';
  SELECT property_id,guest_id INTO prop,customer FROM conversations WHERE id=conversation;
 END IF;
 IF TG_TABLE_NAME='conversations' THEN conversation:=body->>'id';END IF;
 IF prop IS NULL OR kind IS NULL THEN RETURN NEW;END IF;
 SELECT organization_id INTO tenant FROM properties WHERE id=prop;
 event_name:='crm.'||kind||CASE WHEN TG_OP='INSERT' THEN '.created' ELSE '.updated' END;
 facts:=jsonb_strip_nulls(jsonb_build_object('schemaVersion','guestra-crm-events-v1','sourceSystem','guestra_crm',
  'tenantId',tenant,'customerId',customer,'conversationId',conversation,'entityType',kind,'entityId',body->>'id',
  'status',body->>'status','lifecycle',body->>'request_lifecycle','automationMode',body->>'automation_mode',
  'deliveryStatus',body->>'delivery_status','channel',body->>'channel'));
 INSERT INTO integration_outbox(id,property_id,event_type,payload) VALUES(gen_random_uuid()::text,prop,event_name,facts);
 RETURN NEW;
END $$;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['guests','conversations','leads','offers','messages'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='guestra_domain_'||tab) THEN
   EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION guestra_crm_domain_event()','guestra_domain_'||tab,tab);
  END IF;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION guestra_crm_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id<>OLD.id OR NEW.property_id<>OLD.property_id OR NEW.event_type<>OLD.event_type OR NEW.payload<>OLD.payload OR NEW.sequence IS DISTINCT FROM OLD.sequence THEN
  RAISE EXCEPTION 'IMMUTABLE_DOMAIN_EVENT';
 END IF;
 RETURN NEW;
END $$;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='guestra_crm_event_immutable_trigger') THEN
 CREATE TRIGGER guestra_crm_event_immutable_trigger BEFORE UPDATE ON integration_outbox FOR EACH ROW EXECUTE FUNCTION guestra_crm_event_immutable();
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS guestra_integration_deployment (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),environment text NOT NULL CHECK(environment IN ('test','sandbox','production')),
 deployment_id text NOT NULL UNIQUE
);
-- v2 uses the same local confirmation receipt with additional PMS actions.
ALTER TABLE agent_action_executions DROP CONSTRAINT IF EXISTS agent_action_executions_action_type_check;
ALTER TABLE agent_action_executions ADD CONSTRAINT agent_action_executions_action_type_check
 CHECK(action_type IN ('book_accommodation','book_service','reschedule_service','cancel_service','extend_stay','amend_accommodation','cancel_accommodation'));

CREATE TABLE IF NOT EXISTS guestra_sandbox_properties(property_id text PRIMARY KEY REFERENCES properties(id),tenant_id text NOT NULL);
CREATE TABLE IF NOT EXISTS guestra_sandbox_fixtures(
 property_id text NOT NULL REFERENCES properties(id),fixture_key text NOT NULL,fingerprint text NOT NULL,
 customer_id text NOT NULL,conversation_id text NOT NULL,request_id text,stage text NOT NULL,status text NOT NULL DEFAULT 'pending',
 expires_at timestamptz NOT NULL,PRIMARY KEY(property_id,fixture_key)
);
