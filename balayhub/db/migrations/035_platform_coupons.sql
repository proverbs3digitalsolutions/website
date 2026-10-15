-- QA round 15 (founder request, D-94): platform plan coupons for BalayHub's own plans. Not the hosts' guest discount codes (discount_codes, F17).
-- Rollback (forward-only): DROP the two new billing_payments constraints and columns, re-add billing_payments_amount_check (amount > 0),
-- DROP TABLE platform_coupon_redemptions, platform_coupons; then delete the 035 row from schema_migrations.

CREATE TABLE platform_coupons (
  coupon_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL CHECK (code ~ '^[A-Z0-9-]{3,32}$'),
  name               text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  kind               text NOT NULL CHECK (kind IN ('percent', 'fixed', 'free')),
  percent_off        smallint CHECK (percent_off BETWEEN 1 AND 99),
  amount_off         numeric(12,2) CHECK (amount_off > 0),
  duration           text NOT NULL CHECK (duration IN ('once', 'months', 'forever')),
  duration_months    smallint CHECK (duration_months BETWEEN 2 AND 36),
  plans              text[] CHECK (plans IS NULL OR (cardinality(plans) > 0 AND plans <@ ARRAY['starter', 'growth', 'pro']::text[])),
  max_redemptions    integer CHECK (max_redemptions > 0),
  once_per_workspace boolean NOT NULL DEFAULT true,
  require_card       boolean NOT NULL DEFAULT false,
  starts_at          timestamptz NOT NULL,
  ends_at            timestamptz,
  active             boolean NOT NULL DEFAULT true,
  note               text CHECK (length(note) <= 1000),
  created_by         uuid REFERENCES users(user_id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'percent') = (percent_off IS NOT NULL)),
  CHECK ((kind = 'fixed') = (amount_off IS NOT NULL)),
  CHECK ((duration = 'months') = (duration_months IS NOT NULL)),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE UNIQUE INDEX platform_coupons_code_uq ON platform_coupons (code);

CREATE TABLE platform_coupon_redemptions (
  redemption_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id       uuid NOT NULL REFERENCES platform_coupons(coupon_id),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'used_up', 'released')),
  months_total    smallint CHECK (months_total > 0),          -- NULL means forever
  months_used     smallint NOT NULL DEFAULT 0 CHECK (months_used >= 0),
  redeemed_by     uuid REFERENCES users(user_id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  activated_at    timestamptz,
  released_at     timestamptz
);
CREATE UNIQUE INDEX platform_coupon_redemptions_live_uq ON platform_coupon_redemptions (coupon_id, organization_id) WHERE status IN ('pending', 'active');
CREATE INDEX platform_coupon_redemptions_coupon_idx ON platform_coupon_redemptions (coupon_id, created_at DESC);
CREATE INDEX platform_coupon_redemptions_org_idx ON platform_coupon_redemptions (organization_id, created_at DESC);

-- A free coupon period is a billing row of 0 with provider 'coupon'; PayMongo rows stay above 0.
ALTER TABLE billing_payments DROP CONSTRAINT billing_payments_amount_check;
ALTER TABLE billing_payments
  ADD CONSTRAINT billing_payments_amount_check CHECK (amount > 0 OR (amount = 0 AND provider = 'coupon')),
  ADD CONSTRAINT billing_payments_provider_check CHECK (provider IN ('paymongo', 'coupon')),
  ADD COLUMN list_amount          numeric(12,2) CHECK (list_amount > 0),
  ADD COLUMN discount_amount      numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  ADD COLUMN coupon_redemption_id uuid REFERENCES platform_coupon_redemptions(redemption_id),
  ADD COLUMN coupon_months        smallint NOT NULL DEFAULT 0 CHECK (coupon_months >= 0);
CREATE INDEX billing_payments_redemption_idx ON billing_payments (coupon_redemption_id) WHERE coupon_redemption_id IS NOT NULL;
