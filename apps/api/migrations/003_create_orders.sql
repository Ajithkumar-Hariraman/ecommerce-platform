CREATE TABLE public.orders (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL,
  status varchar(32) NOT NULL,
  total_in_minor_units bigint NOT NULL,
  payment_id uuid,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL,
  updated_at timestamptz(3) NOT NULL,
  CONSTRAINT orders_status_check CHECK (status IN (
    'CREATED', 'PAYMENT_PENDING', 'PAID', 'PAYMENT_FAILED',
    'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'
  )),
  CONSTRAINT orders_total_check CHECK (total_in_minor_units BETWEEN 0 AND 9007199254740991),
  CONSTRAINT orders_version_check CHECK (version >= 1)
);

CREATE TABLE public.order_items (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_in_minor_units bigint NOT NULL CHECK (unit_price_in_minor_units BETWEEN 0 AND 9007199254740991),
  line_total_in_minor_units bigint NOT NULL CHECK (line_total_in_minor_units BETWEEN 0 AND 9007199254740991)
);

CREATE INDEX orders_customer_created_idx ON public.orders (customer_id, created_at DESC);
CREATE INDEX orders_status_created_idx ON public.orders (status, created_at DESC);
CREATE INDEX order_items_order_idx ON public.order_items (order_id);
