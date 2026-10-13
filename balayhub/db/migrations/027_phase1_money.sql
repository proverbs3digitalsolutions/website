-- Phase 1 money: itemised stay charges, refunds, guest payment proofs,
-- cancellation policy + deposit percentage per unit, manual payment settings.
--
-- Rollback (forward-only; run as a NEW migration, or restore the pre-deploy backup):
--   ALTER TABLE bookings DROP COLUMN total_amount;
--   ALTER TABLE bookings ADD COLUMN total_amount numeric(12,2)
--     GENERATED ALWAYS AS (accommodation_total + cleaning_fee + other_fees) STORED;
--   ALTER TABLE bookings DROP COLUMN extras_total;
--   DROP TABLE payment_proofs, booking_refunds, booking_charges;
--   ALTER TABLE files DROP CONSTRAINT files_related_record_type_check;
--   ALTER TABLE files ADD CONSTRAINT files_related_record_type_check CHECK (related_record_type IN
--     ('lease','payment','expense','maintenance','cleaning','registration','listing','deposit','support'));
--   ALTER TABLE units DROP COLUMN cancellation_policy, DROP COLUMN cancellation_policy_text, DROP COLUMN deposit_pct;
--   ALTER TABLE organizations DROP COLUMN manual_payments_enabled, DROP COLUMN manual_payment_instructions;
-- (Drop the files rows of type payment_proof / booking_payment first, or the constraint re-add fails.)

-- 1. Itemised extras on a stay bill.
CREATE TABLE booking_charges (
  charge_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  booking_id      uuid NOT NULL REFERENCES bookings(booking_id),
  category        text NOT NULL CHECK (category IN ('early_checkin', 'late_checkout', 'extra_guest', 'extra_bed',
                    'airport_transfer', 'damage', 'extra_cleaning', 'other')),
  description     text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 200),
  quantity        int NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 99),
  unit_price      numeric(12,2) NOT NULL CHECK (unit_price > 0),
  amount          numeric(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_by      uuid REFERENCES users(user_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  voided_at       timestamptz,
  voided_by       uuid REFERENCES users(user_id),
  void_reason     text,
  CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);
CREATE INDEX booking_charges_booking_idx ON booking_charges (booking_id);

-- 2. Extras total on the booking, folded into the generated total_amount.
-- PostgreSQL 16 cannot change a generated expression, so drop and re-add the column.
-- Checked beforehand on a migrated database: nothing depends on bookings.total_amount
-- (no views, indexes, constraints, triggers or functions), only its own generated default.
-- The re-add rewrites the table (ACCESS EXCLUSIVE lock for the duration; bookings is small).
ALTER TABLE bookings ADD COLUMN extras_total numeric(12,2) NOT NULL DEFAULT 0 CHECK (extras_total >= 0);
ALTER TABLE bookings DROP COLUMN total_amount;
ALTER TABLE bookings ADD COLUMN total_amount numeric(12,2)
  GENERATED ALWAYS AS (accommodation_total + cleaning_fee + other_fees + extras_total) STORED;

-- 3. Refunds recorded against a booking.
CREATE TABLE booking_refunds (
  refund_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(organization_id),
  booking_id       uuid NOT NULL REFERENCES bookings(booking_id),
  amount           numeric(12,2) NOT NULL CHECK (amount > 0),
  refund_date      date NOT NULL,
  method           text NOT NULL CHECK (method IN ('cash', 'bank_transfer', 'gcash', 'maya', 'card', 'other')),
  reference_number text,
  reason           text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 300),
  recorded_by      uuid REFERENCES users(user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  voided_at        timestamptz,
  voided_by        uuid REFERENCES users(user_id),
  void_reason      text,
  CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);
CREATE INDEX booking_refunds_booking_idx ON booking_refunds (booking_id);

-- 4. Guest-submitted proof of a manual payment, reviewed by the host.
CREATE TABLE payment_proofs (
  proof_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(organization_id),
  booking_id       uuid NOT NULL REFERENCES bookings(booking_id),
  amount           numeric(12,2) NOT NULL CHECK (amount > 0),
  method           text NOT NULL CHECK (method IN ('gcash', 'maya', 'bank_transfer', 'other')),
  reference_number text,
  payer_name       text CHECK (payer_name IS NULL OR length(payer_name) <= 120),
  note             text CHECK (note IS NULL OR length(note) <= 500),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  reviewed_by      uuid REFERENCES users(user_id),
  reviewed_at      timestamptz,
  reject_reason    text,
  payment_id       uuid REFERENCES booking_payments(payment_id)
);
CREATE INDEX payment_proofs_booking_idx ON payment_proofs (booking_id);
CREATE INDEX payment_proofs_pending_idx ON payment_proofs (organization_id, submitted_at) WHERE status = 'pending';

-- 5. Proof screenshots and payment attachments are stored as files.
ALTER TABLE files DROP CONSTRAINT files_related_record_type_check;
ALTER TABLE files ADD CONSTRAINT files_related_record_type_check
  CHECK (related_record_type IN ('lease', 'payment', 'expense', 'maintenance', 'cleaning', 'registration', 'listing', 'deposit', 'support',
                                 'payment_proof', 'booking_payment'));

-- 6. Per-unit cancellation policy and deposit percentage.
-- deposit_pct default 50 matches the 50% hard-coded in src/routes/directbooking.js today, so nothing changes.
ALTER TABLE units
  ADD COLUMN cancellation_policy      text CHECK (cancellation_policy IN ('flexible', 'moderate', 'strict', 'non_refundable', 'custom')),
  ADD COLUMN cancellation_policy_text text CHECK (cancellation_policy_text IS NULL OR length(cancellation_policy_text) <= 1000),
  ADD COLUMN deposit_pct              smallint NOT NULL DEFAULT 50 CHECK (deposit_pct BETWEEN 10 AND 90);

-- 7. Manual (GCash / bank) payment settings per workspace.
ALTER TABLE organizations
  ADD COLUMN manual_payments_enabled     boolean NOT NULL DEFAULT false,
  ADD COLUMN manual_payment_instructions text CHECK (manual_payment_instructions IS NULL OR length(manual_payment_instructions) <= 1000);
