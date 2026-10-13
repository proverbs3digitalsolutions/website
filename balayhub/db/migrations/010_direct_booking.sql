-- Listing photos and descriptions, and each host's public direct-booking page
-- paid through the host's own PayMongo account.

ALTER TABLE units
  ADD COLUMN description      text,
  ADD COLUMN bookable_online  boolean NOT NULL DEFAULT false,
  ADD COLUMN payment_option   text NOT NULL DEFAULT 'either' CHECK (payment_option IN ('full', 'deposit', 'either')),
  ADD COLUMN min_nights       smallint NOT NULL DEFAULT 1 CHECK (min_nights BETWEEN 1 AND 60),
  ADD COLUMN balance_due_days smallint NOT NULL DEFAULT 3 CHECK (balance_due_days BETWEEN 0 AND 60);

ALTER TABLE organizations
  ADD COLUMN booking_slug        text,
  ADD COLUMN booking_enabled     boolean NOT NULL DEFAULT false,
  ADD COLUMN booking_intro       text,
  ADD COLUMN paymongo_key_enc    text,     -- the host's own PayMongo secret key, encrypted
  ADD COLUMN paymongo_key_hint   text;     -- e.g. "sk_live_…a1b2"
CREATE UNIQUE INDEX organizations_booking_slug_uq ON organizations (lower(booking_slug)) WHERE booking_slug IS NOT NULL;

ALTER TABLE files DROP CONSTRAINT files_related_record_type_check;
ALTER TABLE files ADD CONSTRAINT files_related_record_type_check
  CHECK (related_record_type IN ('lease', 'payment', 'expense', 'maintenance', 'cleaning', 'registration', 'listing'));
ALTER TABLE files ADD COLUMN sort_order smallint NOT NULL DEFAULT 0;

-- A guest's online booking attempt. Dates are held for 30 minutes while they pay.
CREATE TABLE direct_checkouts (
  checkout_ref    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_token    text NOT NULL UNIQUE,         -- in the guest's return link
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  unit_id         uuid NOT NULL REFERENCES units(unit_id),
  check_in        date NOT NULL,
  check_out       date NOT NULL,
  num_guests      smallint NOT NULL,
  guest_name      text NOT NULL,
  guest_email     text NOT NULL,
  guest_phone     text NOT NULL,
  notes           text,
  pay_type        text NOT NULL CHECK (pay_type IN ('full', 'deposit')),
  accommodation_total numeric(12,2) NOT NULL,
  cleaning_fee    numeric(12,2) NOT NULL,
  total_amount    numeric(12,2) NOT NULL,
  amount_due_now  numeric(12,2) NOT NULL CHECK (amount_due_now > 0),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'expired', 'conflict', 'failed')),
  provider_checkout_id text UNIQUE,
  booking_id      uuid REFERENCES bookings(booking_id),
  payment_method  text,
  hold_until      timestamptz NOT NULL,
  last_checked_at timestamptz,
  consent_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  confirmed_at    timestamptz
);
CREATE INDEX direct_checkouts_unit_idx ON direct_checkouts (unit_id, status, hold_until);
