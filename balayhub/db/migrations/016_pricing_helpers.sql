-- Pricing helpers: weekend and holiday rates, weekly/monthly discounts, and
-- seasons (date ranges with their own nightly rate and/or minimum stay).
ALTER TABLE units
  ADD COLUMN weekend_rate     numeric(12,2) CHECK (weekend_rate >= 0),
  ADD COLUMN holiday_rate     numeric(12,2) CHECK (holiday_rate >= 0),
  ADD COLUMN weekly_discount  smallint NOT NULL DEFAULT 0 CHECK (weekly_discount BETWEEN 0 AND 50),
  ADD COLUMN monthly_discount smallint NOT NULL DEFAULT 0 CHECK (monthly_discount BETWEEN 0 AND 70);

CREATE TABLE seasons (
  season_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  unit_id         uuid REFERENCES units(unit_id) ON DELETE CASCADE,  -- NULL: every listing
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  start_date      date NOT NULL,                                       -- first night
  end_date        date NOT NULL,                                       -- last night
  nightly_rate    numeric(12,2) CHECK (nightly_rate >= 0),
  min_nights      smallint CHECK (min_nights BETWEEN 1 AND 60),
  created_by      uuid REFERENCES users(user_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date AND end_date - start_date <= 366),
  CHECK (nightly_rate IS NOT NULL OR min_nights IS NOT NULL)
);
CREATE INDEX seasons_org_idx ON seasons (organization_id, end_date);
