-- One durable notification record also acts as the consumer receipt.
-- No Order FK: Orders can live in MongoDB; the consumer owns this projection.
CREATE TABLE order_notifications (
  event_id uuid PRIMARY KEY,
  order_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_notifications_order_idx ON order_notifications(order_id);
