CREATE TABLE public.categories (
  id uuid CONSTRAINT categories_pkey PRIMARY KEY,
  slug text NOT NULL CONSTRAINT categories_slug_key UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz(3) NOT NULL,
  updated_at timestamptz(3) NOT NULL,
  CONSTRAINT categories_slug_not_blank CHECK (slug ~ '[^[:space:]]'),
  CONSTRAINT categories_name_not_blank CHECK (name ~ '[^[:space:]]'),
  CONSTRAINT categories_status_check CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

-- No backfill: products created before Categories retain a null association.
ALTER TABLE public.products ADD COLUMN category_id uuid;
ALTER TABLE public.products ADD CONSTRAINT products_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE RESTRICT;
