-- Preserve existing Kafka failures while identifying Pub/Sub publication failures.
ALTER TABLE public.outbox_events DROP CONSTRAINT outbox_events_last_error_category_check;
ALTER TABLE public.outbox_events ADD CONSTRAINT outbox_events_last_error_category_check
  CHECK (last_error_category IN ('KAFKA_UNAVAILABLE','PUBSUB_UNAVAILABLE','INVALID_EVENT','LEASE_EXHAUSTED'));
