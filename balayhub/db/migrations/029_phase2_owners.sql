-- Phase 2 owners: owner portal sign-in, fee models, reviewed/published statements,
-- payout records, repairs reserve, owner-made date blocks.
--
-- Rollback (forward-only; run as a NEW migration, or restore the pre-deploy backup):
--   ALTER TABLE bookings DROP COLUMN owner_block_by;
--   DROP TABLE owner_reserve_entries, owner_payouts, owner_statements, owner_login_tokens, owner_sessions;
--   ALTER TABLE unit_owners DROP COLUMN fee_model, DROP COLUMN flat_monthly_fee, DROP COLUMN reserve_target,
--     DROP COLUMN reserve_monthly, DROP COLUMN portal_enabled, DROP COLUMN portal_invited_at, DROP COLUMN portal_last_seen_at;
-- (All additive: existing owners keep fee_model net_pct and reserve 0, so statement numbers do not change.)

-- 1. Owner settings: fee model, repairs reserve, portal access.
ALTER TABLE unit_owners
  ADD COLUMN fee_model text NOT NULL DEFAULT 'net_pct' CHECK (fee_model IN ('net_pct', 'gross_pct', 'flat')),
  ADD COLUMN flat_monthly_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (flat_monthly_fee >= 0),
  ADD COLUMN reserve_target numeric(12,2) NOT NULL DEFAULT 0 CHECK (reserve_target >= 0),
  ADD COLUMN reserve_monthly numeric(12,2) NOT NULL DEFAULT 0 CHECK (reserve_monthly >= 0),
  ADD COLUMN portal_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN portal_invited_at timestamptz,
  ADD COLUMN portal_last_seen_at timestamptz;

-- 2. Owner portal sessions (cookie bh_owner) and one-time sign-in links. Only hashes are stored.
CREATE TABLE owner_sessions (
  token_hash      text PRIMARY KEY,
  owner_id        uuid NOT NULL REFERENCES unit_owners(owner_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  user_agent      text
);
CREATE INDEX owner_sessions_owner_idx ON owner_sessions (owner_id);

CREATE TABLE owner_login_tokens (
  token_hash text PRIMARY KEY,
  owner_id   uuid NOT NULL REFERENCES unit_owners(owner_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX owner_login_tokens_owner_idx ON owner_login_tokens (owner_id);

-- 3. Statement records: draft until published; snapshot is the frozen published copy.
CREATE TABLE owner_statements (
  statement_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  owner_id        uuid NOT NULL REFERENCES unit_owners(owner_id),
  month           text NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  snapshot        jsonb,
  published_at    timestamptz,
  published_by    uuid REFERENCES users(user_id),
  sent_at         timestamptz,
  sent_to         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, month)
);
CREATE INDEX owner_statements_org_month_idx ON owner_statements (organization_id, month);

-- 4. Payouts made to owners (records only; voided, never deleted).
CREATE TABLE owner_payouts (
  payout_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(organization_id),
  owner_id         uuid NOT NULL REFERENCES unit_owners(owner_id),
  month            text CHECK (month IS NULL OR month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  amount           numeric(12,2) NOT NULL CHECK (amount > 0),
  paid_on          date NOT NULL,
  method           text NOT NULL CHECK (method IN ('gcash', 'maya', 'bank_transfer', 'cash', 'other')),
  reference_number text CHECK (reference_number IS NULL OR length(reference_number) <= 100),
  note             text CHECK (note IS NULL OR length(note) <= 500),
  recorded_by      uuid REFERENCES users(user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  voided_at        timestamptz,
  voided_by        uuid REFERENCES users(user_id),
  void_reason      text,
  CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);
CREATE INDEX owner_payouts_owner_idx ON owner_payouts (owner_id, paid_on);
CREATE INDEX owner_payouts_org_idx ON owner_payouts (organization_id);

-- 5. Repairs reserve ledger. balance = non-voided deposits - non-voided withdrawals.
CREATE TABLE owner_reserve_entries (
  entry_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  owner_id        uuid NOT NULL REFERENCES unit_owners(owner_id),
  kind            text NOT NULL CHECK (kind IN ('deposit', 'withdrawal')),
  amount          numeric(12,2) NOT NULL CHECK (amount > 0),
  entry_date      date NOT NULL,
  note            text CHECK (note IS NULL OR length(note) <= 300),
  statement_id    uuid REFERENCES owner_statements(statement_id),
  recorded_by     uuid REFERENCES users(user_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  voided_at       timestamptz,
  voided_by       uuid REFERENCES users(user_id),
  void_reason     text,
  CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);
CREATE INDEX owner_reserve_entries_owner_idx ON owner_reserve_entries (owner_id);
CREATE INDEX owner_reserve_entries_statement_idx ON owner_reserve_entries (statement_id) WHERE statement_id IS NOT NULL;

-- 6. Blocks an owner made in the portal.
ALTER TABLE bookings ADD COLUMN owner_block_by uuid REFERENCES unit_owners(owner_id) ON DELETE SET NULL;
CREATE INDEX bookings_owner_block_idx ON bookings (owner_block_by) WHERE owner_block_by IS NOT NULL;

-- 7. Payout idempotency: a retried save (same Idempotency-Key) returns the payout already recorded
--    instead of adding a second. Same pattern as booking_refunds (migration 028).
ALTER TABLE owner_payouts ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX owner_payouts_idem_uq ON owner_payouts (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
