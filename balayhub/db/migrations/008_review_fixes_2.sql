-- When BalayHub last asked PayMongo about a pending checkout (fair polling order).
ALTER TABLE billing_payments ADD COLUMN last_checked_at timestamptz;
