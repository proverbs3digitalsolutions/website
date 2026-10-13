-- Guests pay a reservation's remaining balance online (host's own PayMongo account).
ALTER TABLE bookings ADD COLUMN pay_token text;
CREATE UNIQUE INDEX bookings_pay_token_uq ON bookings (pay_token) WHERE pay_token IS NOT NULL;

CREATE TABLE balance_checkouts (
  checkout_ref    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  booking_id      uuid NOT NULL REFERENCES bookings(booking_id),
  amount          numeric(12,2) NOT NULL CHECK (amount > 0),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'failed')),
  provider_checkout_id text UNIQUE,
  key_enc         text NOT NULL,
  test_mode       boolean NOT NULL DEFAULT false,
  payment_id      uuid REFERENCES booking_payments(payment_id),
  payment_method  text,
  last_checked_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  paid_at         timestamptz
);
CREATE INDEX balance_checkouts_booking_idx ON balance_checkouts (booking_id, status);
ALTER TABLE balance_checkouts ADD COLUMN checkout_url text;
