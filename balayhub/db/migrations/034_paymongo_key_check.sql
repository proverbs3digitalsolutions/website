-- QA round 14 (#34): a host's PayMongo key is "Connected" only after PayMongo accepted it. NULL means saved but not checked.
-- Rollback (forward-only): ALTER TABLE organizations DROP COLUMN paymongo_key_checked_at; then delete the 034 row from the migrations table.

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS paymongo_key_checked_at timestamptz;
