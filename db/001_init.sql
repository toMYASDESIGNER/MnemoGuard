-- MnemoGuard CockroachDB schema.
-- Vector indexes must be enabled once per cluster by an administrator:
-- SET CLUSTER SETTING feature.vector_index.enabled = true;

CREATE TABLE IF NOT EXISTS memory_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject STRING NOT NULL,
  claim STRING NOT NULL,
  source JSONB NOT NULL,
  trust_state STRING NOT NULL CHECK (trust_state IN ('trusted', 'review', 'quarantined')),
  risk_score INT NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  reasons JSONB NOT NULL DEFAULT '[]',
  conflicts JSONB NOT NULL DEFAULT '[]',
  high_risk BOOL NOT NULL DEFAULT false,
  embedding VECTOR(64) NOT NULL,
  expires_at TIMESTAMPTZ NULL,
  reviewed_at TIMESTAMPTZ NULL,
  reviewed_by STRING NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  INDEX memory_subject_state_idx (subject, trust_state, created_at DESC),
  VECTOR INDEX memory_embedding_idx (embedding vector_cosine_ops)
);

CREATE TABLE IF NOT EXISTS memory_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type STRING NOT NULL,
  payload JSONB NOT NULL,
  previous_hash STRING NOT NULL,
  hash STRING NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE VIEW IF NOT EXISTS trusted_agent_memory AS
SELECT *
FROM memory_records
WHERE trust_state = 'trusted'
  AND (expires_at IS NULL OR expires_at > now());

CREATE OR REPLACE FUNCTION append_memory_event(p_event_type STRING, p_payload JSONB)
RETURNS JSONB
LANGUAGE SQL
AS $$
  WITH previous AS (
    SELECT COALESCE((SELECT hash FROM memory_events ORDER BY created_at DESC LIMIT 1), 'GENESIS') AS value
  ), inserted AS (
    INSERT INTO memory_events (event_type, payload, previous_hash, hash)
    SELECT p_event_type,
           p_payload,
           previous.value,
           encode(sha256((previous.value || p_event_type || p_payload::STRING)::BYTES), 'hex')
    FROM previous
    RETURNING *
  )
  SELECT jsonb_build_object(
    'id', id,
    'type', event_type,
    'payload', payload,
    'previousHash', previous_hash,
    'hash', hash,
    'createdAt', created_at
  ) FROM inserted;
$$;

GRANT SELECT ON trusted_agent_memory TO public;
