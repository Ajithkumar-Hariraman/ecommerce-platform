-- Historical customer UUIDs never establish authenticated ownership.
-- No backfill: historical Orders remain available only to elevated users.
ALTER TABLE public.orders ADD COLUMN owner_subject text;
ALTER TABLE public.orders ADD CONSTRAINT orders_owner_subject_check
  CHECK (owner_subject IS NULL OR length(btrim(owner_subject)) > 0);
ALTER TABLE public.orders ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE public.orders ADD CONSTRAINT orders_identity_reference_check
  CHECK (customer_id IS NOT NULL OR owner_subject IS NOT NULL);
