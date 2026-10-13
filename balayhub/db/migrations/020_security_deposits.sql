-- Refundable security deposits for stays (kept apart from booking income).
CREATE TABLE stay_deposits (
  deposit_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(organization_id),
  booking_id       uuid NOT NULL UNIQUE REFERENCES bookings(booking_id),
  amount           numeric(12,2) NOT NULL CHECK (amount > 0),
  received_date    date NOT NULL,
  method           text NOT NULL,
  reference_number text,
  status           text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'refunded', 'partly_refunded', 'kept')),
  deduction_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (deduction_amount >= 0),
  deduction_reason text,
  refund_amount    numeric(12,2) CHECK (refund_amount >= 0),
  refund_method    text,
  refund_reference text,
  settled_at       timestamptz,
  recorded_by      uuid REFERENCES users(user_id),
  settled_by       uuid REFERENCES users(user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (refund_amount IS NULL OR refund_amount + deduction_amount = amount)
);
CREATE INDEX stay_deposits_org_idx ON stay_deposits (organization_id, status);

ALTER TABLE files DROP CONSTRAINT files_related_record_type_check;
ALTER TABLE files ADD CONSTRAINT files_related_record_type_check
  CHECK (related_record_type IN ('lease', 'payment', 'expense', 'maintenance', 'cleaning', 'registration', 'listing', 'deposit'));
