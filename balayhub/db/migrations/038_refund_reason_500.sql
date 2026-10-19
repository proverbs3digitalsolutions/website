-- QA round 17 (O5): a refund's reason takes up to 500 characters, like every other audit reason. Only the length limit changes.
-- Rollback (only when no refund reason is over 300 characters): ALTER TABLE booking_refunds DROP CONSTRAINT booking_refunds_reason_check; ALTER TABLE booking_refunds ADD CONSTRAINT booking_refunds_reason_check CHECK (length(trim(reason)) BETWEEN 1 AND 300);

ALTER TABLE booking_refunds DROP CONSTRAINT booking_refunds_reason_check;
ALTER TABLE booking_refunds ADD CONSTRAINT booking_refunds_reason_check CHECK (length(trim(reason)) BETWEEN 1 AND 500);
