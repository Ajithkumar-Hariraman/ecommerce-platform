CREATE TABLE outbox_events (
  id uuid PRIMARY KEY,
  event_id uuid UNIQUE NOT NULL,
  event_type text NOT NULL CHECK (event_type = 'OrderPaid'),
  event_version integer NOT NULL CHECK (event_version = 1),
  aggregate_type text NOT NULL CHECK (aggregate_type = 'Order'),
  aggregate_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','PUBLISHED','FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  last_error_category text CHECK (last_error_category IN ('KAFKA_UNAVAILABLE','INVALID_EVENT','LEASE_EXHAUSTED')),
  lease_token uuid,
  CHECK ((status = 'PROCESSING') = (lease_token IS NOT NULL)),
  CHECK ((status = 'PUBLISHED') = (published_at IS NOT NULL))
);
CREATE INDEX outbox_dispatch_idx ON outbox_events(available_at,created_at,id)
  WHERE status IN ('PENDING','PROCESSING');
CREATE INDEX outbox_published_retention_idx ON outbox_events(published_at) WHERE status = 'PUBLISHED';
