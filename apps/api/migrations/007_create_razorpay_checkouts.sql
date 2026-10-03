-- Provider mapping is shared infrastructure; Orders may reside in PostgreSQL or MongoDB.
CREATE TABLE razorpay_checkouts (
  order_id uuid PRIMARY KEY,
  payment_id uuid NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  amount bigint NOT NULL CHECK (amount BETWEEN 100 AND 9007199254740991),
  currency text NOT NULL CHECK (currency = 'INR'),
  provider_order_id text UNIQUE,
  creation_started boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE razorpay_payment_attempts (
  provider_payment_id text PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES razorpay_checkouts(order_id),
  status text NOT NULL CHECK (status IN ('authorized','captured','failed')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE razorpay_webhook_events (
  provider_event_id text PRIMARY KEY,
  body_hash text NOT NULL,
  processed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
