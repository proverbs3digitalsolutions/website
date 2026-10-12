-- Short-term rentals (Airbnb / staycation hosts): listings, guests, reservations,
-- calendar blocks, nightly rates, reservation payments and iCal channel sync.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Which modules a workspace uses.
ALTER TABLE organizations
  ADD COLUMN business_type text NOT NULL DEFAULT 'long_term'
    CHECK (business_type IN ('short_term', 'long_term', 'both'));

-- A unit doubles as a short-term listing.
ALTER TABLE units ALTER COLUMN monthly_rent SET DEFAULT 0;
ALTER TABLE units
  ADD COLUMN nightly_rate        numeric(12,2) CHECK (nightly_rate >= 0),
  ADD COLUMN cleaning_fee        numeric(12,2) NOT NULL DEFAULT 0 CHECK (cleaning_fee >= 0),
  ADD COLUMN max_guests          smallint CHECK (max_guests BETWEEN 1 AND 50),
  ADD COLUMN checkin_time        time NOT NULL DEFAULT '14:00',
  ADD COLUMN checkout_time       time NOT NULL DEFAULT '12:00',
  ADD COLUMN cleaning_status     text NOT NULL DEFAULT 'clean' CHECK (cleaning_status IN ('clean', 'dirty')),
  ADD COLUMN cleaning_updated_at timestamptz,
  ADD COLUMN ical_token          text UNIQUE;

CREATE TABLE guests (
  guest_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  full_name       text NOT NULL CHECK (length(trim(full_name)) BETWEEN 1 AND 120),
  email           text,
  phone           text,
  notes           text,
  created_by      uuid REFERENCES users(user_id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guests_org_idx ON guests (organization_id);

-- Calendar links imported from Airbnb, Booking.com, Agoda, etc.
CREATE TABLE ical_feeds (
  feed_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  unit_id         uuid NOT NULL REFERENCES units(unit_id),
  channel         text NOT NULL CHECK (channel IN ('airbnb', 'booking', 'agoda', 'other')),
  url             text NOT NULL,
  last_synced_at  timestamptz,
  last_status     text CHECK (last_status IN ('ok', 'error')),
  last_message    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, url)
);

-- Reservations and owner blocks share one table so the database itself
-- guarantees a listing is never double-booked.
CREATE TABLE bookings (
  booking_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(organization_id),
  unit_id             uuid NOT NULL REFERENCES units(unit_id),
  kind                text NOT NULL CHECK (kind IN ('reservation', 'block')),
  guest_id            uuid REFERENCES guests(guest_id),
  guest_label         text,
  channel             text NOT NULL DEFAULT 'direct' CHECK (channel IN ('direct', 'airbnb', 'booking', 'agoda', 'other')),
  status              text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  check_in            date NOT NULL,
  check_out           date NOT NULL,
  num_guests          smallint CHECK (num_guests BETWEEN 1 AND 50),
  accommodation_total numeric(12,2) NOT NULL DEFAULT 0 CHECK (accommodation_total >= 0),
  cleaning_fee        numeric(12,2) NOT NULL DEFAULT 0 CHECK (cleaning_fee >= 0),
  other_fees          numeric(12,2) NOT NULL DEFAULT 0 CHECK (other_fees >= 0),
  total_amount        numeric(12,2) GENERATED ALWAYS AS (accommodation_total + cleaning_fee + other_fees) STORED,
  confirmation_code   text NOT NULL,
  block_reason        text,
  notes               text,
  checked_in_at       timestamptz,
  checked_out_at      timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text,
  ical_feed_id        uuid REFERENCES ical_feeds(feed_id) ON DELETE SET NULL,
  external_uid        text,
  created_by          uuid REFERENCES users(user_id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (check_out > check_in),
  CHECK (check_out - check_in <= 366),
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    unit_id WITH =, daterange(check_in, check_out) WITH &&
  ) WHERE (status = 'confirmed')
);
CREATE UNIQUE INDEX bookings_code_uq ON bookings (organization_id, confirmation_code);
CREATE UNIQUE INDEX bookings_feed_uid_uq ON bookings (ical_feed_id, external_uid) WHERE ical_feed_id IS NOT NULL;
CREATE INDEX bookings_org_dates_idx ON bookings (organization_id, check_in, check_out);

-- Per-night price overrides (otherwise the listing's base nightly rate applies).
CREATE TABLE nightly_rates (
  unit_id   uuid NOT NULL REFERENCES units(unit_id),
  rate_date date NOT NULL,
  price     numeric(12,2) NOT NULL CHECK (price >= 0),
  PRIMARY KEY (unit_id, rate_date)
);

-- Money received for a reservation. Voided, never deleted.
CREATE TABLE booking_payments (
  payment_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(organization_id),
  booking_id       uuid NOT NULL REFERENCES bookings(booking_id),
  amount           numeric(12,2) NOT NULL CHECK (amount > 0),
  payment_date     date NOT NULL,
  payment_method   text NOT NULL CHECK (payment_method IN ('cash', 'bank_transfer', 'gcash', 'maya', 'card', 'channel_payout', 'other')),
  reference_number text,
  notes            text,
  recorded_by      uuid NOT NULL REFERENCES users(user_id),
  idempotency_key  text,
  voided_at        timestamptz,
  voided_by        uuid REFERENCES users(user_id),
  void_reason      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);
CREATE INDEX booking_payments_booking_idx ON booking_payments (booking_id);
CREATE UNIQUE INDEX booking_payments_idem_uq ON booking_payments (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
