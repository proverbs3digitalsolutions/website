-- Direct booking hardening.
ALTER TABLE direct_checkouts
  ADD COLUMN key_enc      text,   -- the host's PayMongo key used for this checkout (encrypted), so a later key change can't lose it
  ADD COLUMN client_hash  text,   -- hashed guest IP, to cap open holds per visitor
  ADD COLUMN test_mode    boolean NOT NULL DEFAULT false;
CREATE INDEX direct_checkouts_client_idx ON direct_checkouts (client_hash, status, hold_until);
-- Online payments are recorded by "BalayHub" when no owner account is available.
ALTER TABLE booking_payments ALTER COLUMN recorded_by DROP NOT NULL;
