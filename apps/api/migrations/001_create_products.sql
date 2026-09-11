CREATE TABLE public.products (
  id uuid CONSTRAINT products_pkey PRIMARY KEY,
  sku text NOT NULL CONSTRAINT products_sku_key UNIQUE,
  name text NOT NULL,
  description text,
  price_in_minor_units bigint NOT NULL,
  stock bigint NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz(3) NOT NULL,
  updated_at timestamptz(3) NOT NULL,
  CONSTRAINT products_sku_not_blank CHECK (sku ~ '[^[:space:]]'),
  CONSTRAINT products_name_not_blank CHECK (name ~ '[^[:space:]]'),
  CONSTRAINT products_price_check CHECK (price_in_minor_units BETWEEN 1 AND 9007199254740991),
  CONSTRAINT products_stock_check CHECK (stock BETWEEN 0 AND 9007199254740991),
  CONSTRAINT products_status_check CHECK (status IN ('ACTIVE', 'INACTIVE'))
);
