-- Runtime DML access must not permit modification of checksum-tracked history.
-- Local installations without the dedicated AWS runtime role remain unchanged.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecommerce_runtime') THEN
    REVOKE ALL ON TABLE public.schema_migrations FROM ecommerce_runtime;
  END IF;
END $$;
