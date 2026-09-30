CREATE TABLE public.order_status_history (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  from_status varchar(32) NOT NULL CHECK (from_status IN ('CREATED','PAYMENT_PENDING','PAID','PAYMENT_FAILED','PROCESSING','SHIPPED','DELIVERED','CANCELLED')),
  to_status varchar(32) NOT NULL CHECK (to_status IN ('CREATED','PAYMENT_PENDING','PAID','PAYMENT_FAILED','PROCESSING','SHIPPED','DELIVERED','CANCELLED')),
  reason text NOT NULL CHECK (length(reason) > 0),
  changed_at timestamptz(3) NOT NULL
);
CREATE INDEX order_history_order_changed_idx ON public.order_status_history(order_id,changed_at);
CREATE TABLE public.processed_webhook_events (
  event_id uuid PRIMARY KEY,
  processed_at timestamptz(3) NOT NULL
);
