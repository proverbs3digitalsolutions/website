-- Onboarding checklist, guest check-in forms, and online plan payments.

ALTER TABLE organizations ADD COLUMN onboarding_dismissed_at timestamptz;

-- ---------------------------------------------------------------- guest check-in (registration) form
-- Private link the host sends to the guest: /#/checkin/<token>
ALTER TABLE bookings ADD COLUMN checkin_token text;
CREATE UNIQUE INDEX bookings_checkin_token_uq ON bookings (checkin_token) WHERE checkin_token IS NOT NULL;

CREATE TABLE guest_registrations (
  registration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  booking_id      uuid NOT NULL UNIQUE REFERENCES bookings(booking_id),
  lead_name       text NOT NULL,
  phone           text,
  email           text,
  guests          jsonb NOT NULL DEFAULT '[]',   -- other guests' full names
  arrival_time    text,
  vehicle_plate   text,
  notes           text,
  consent_at      timestamptz NOT NULL,
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  ids_purged_at   timestamptz                    -- ID photos deleted after the stay
);

ALTER TABLE files DROP CONSTRAINT files_related_record_type_check;
ALTER TABLE files ADD CONSTRAINT files_related_record_type_check
  CHECK (related_record_type IN ('lease', 'payment', 'expense', 'maintenance', 'cleaning', 'registration'));
-- Files uploaded by a guest (no BalayHub account).
ALTER TABLE files ALTER COLUMN uploaded_by DROP NOT NULL;

-- ---------------------------------------------------------------- online plan payments (PayMongo)
CREATE TABLE billing_payments (
  billing_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  plan            text NOT NULL CHECK (plan IN ('starter', 'growth', 'pro')),
  months          smallint NOT NULL CHECK (months IN (1, 3, 12)),
  amount          numeric(12,2) NOT NULL CHECK (amount > 0),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired', 'failed')),
  provider        text NOT NULL DEFAULT 'paymongo',
  checkout_id     text UNIQUE,
  checkout_url    text,
  payment_method  text,
  paid_at         timestamptz,
  period_start    date,
  period_end      date,
  created_by      uuid REFERENCES users(user_id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_payments_org_idx ON billing_payments (organization_id, created_at DESC);
