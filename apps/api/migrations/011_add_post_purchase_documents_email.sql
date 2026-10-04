ALTER TABLE orders ADD COLUMN customer_details jsonb CHECK (customer_details IS NULL OR jsonb_typeof(customer_details)='object');
ALTER TABLE order_items ADD COLUMN product_name varchar(200);
CREATE TABLE order_email_deliveries (
  order_id uuid PRIMARY KEY REFERENCES orders(id),
  state varchar(12) NOT NULL CHECK (state IN ('SENDING','SENT','PENDING','UNCERTAIN','SKIPPED')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  message_id varchar(200) NOT NULL
);
