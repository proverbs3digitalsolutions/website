-- Refunds can carry an idempotency key, so a save retried after a lost response
-- does not record the refund twice (same pattern as booking_payments).
--
-- Rollback (forward-only; run as a NEW migration, or restore the pre-deploy backup):
--   DROP INDEX booking_refunds_idem_uq;
--   ALTER TABLE booking_refunds DROP COLUMN idempotency_key;

ALTER TABLE booking_refunds ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX booking_refunds_idem_uq ON booking_refunds (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
