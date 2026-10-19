-- A paid card charge remembers which card paid it, so payment history survives Remove card. Forward-only.
-- Rollback: ALTER TABLE billing_payments DROP COLUMN card_brand, DROP COLUMN card_last4;
-- Older rows stay NULL; the history falls back to the workspace's current card for them.

ALTER TABLE billing_payments
  ADD COLUMN card_brand text CHECK (char_length(card_brand) <= 20),
  ADD COLUMN card_last4 text CHECK (card_last4 ~ '^[0-9]{4}$');
