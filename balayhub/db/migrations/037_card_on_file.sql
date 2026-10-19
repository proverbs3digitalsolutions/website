-- Card on file before the free trial (D-98). Forward-only.
-- Rollback: DROP TABLE paymongo_plans; DROP INDEX billing_payments_one_live_card_check, organizations_card_check_pending_idx;
--   ALTER TABLE billing_payments DROP CONSTRAINT billing_payments_kind_shape, DROP COLUMN kind, payment_intent_id, invoice_id, failure_code;
--   restore billing_payments_provider_check to ('paymongo','coupon'); SET NOT NULL on plan and months (after deleting card_check rows);
--   ALTER TABLE organizations DROP COLUMN card_check ... subscription_status.
-- Existing workspaces keep card_check NULL (not required), so they are grandfathered.

ALTER TABLE organizations
  ADD COLUMN card_check text CHECK (card_check IN ('required', 'passed', 'waived')),
  ADD COLUMN card_checked_at timestamptz,
  ADD COLUMN paymongo_customer_id text,
  ADD COLUMN card_payment_method_id text,
  ADD COLUMN card_brand text CHECK (char_length(card_brand) <= 20),
  ADD COLUMN card_last4 text CHECK (card_last4 ~ '^[0-9]{4}$'),
  ADD COLUMN renewal_plan text CHECK (renewal_plan IN ('starter', 'growth', 'pro')),
  ADD COLUMN auto_renew boolean NOT NULL DEFAULT false,
  ADD COLUMN auto_renew_consented_at timestamptz,
  ADD COLUMN paymongo_subscription_id text UNIQUE,
  ADD COLUMN subscription_status text CHECK (subscription_status IN ('active', 'past_due', 'unpaid', 'cancelled', 'incomplete')),
  ADD CONSTRAINT organizations_card_checked_shape CHECK (card_check IS DISTINCT FROM 'passed' OR card_checked_at IS NOT NULL),
  ADD CONSTRAINT organizations_auto_renew_consent CHECK (NOT auto_renew OR auto_renew_consented_at IS NOT NULL);

CREATE INDEX organizations_card_check_pending_idx ON organizations (created_at) WHERE card_check = 'required';

ALTER TABLE billing_payments
  ADD COLUMN kind text NOT NULL DEFAULT 'plan' CHECK (kind IN ('plan', 'card_check')),
  ADD COLUMN payment_intent_id text UNIQUE,
  ADD COLUMN invoice_id text UNIQUE,
  ADD COLUMN failure_code text CHECK (char_length(failure_code) <= 64),
  ALTER COLUMN plan DROP NOT NULL,
  ALTER COLUMN months DROP NOT NULL;

ALTER TABLE billing_payments DROP CONSTRAINT billing_payments_provider_check;
ALTER TABLE billing_payments
  ADD CONSTRAINT billing_payments_provider_check CHECK (provider IN ('paymongo', 'coupon', 'paymongo_intent', 'paymongo_subscription')),
  ADD CONSTRAINT billing_payments_kind_shape CHECK (
    (kind = 'plan' AND plan IS NOT NULL AND months IS NOT NULL)
    OR (kind = 'card_check' AND plan IS NULL AND months IS NULL AND provider = 'paymongo_intent' AND amount = 20));

CREATE UNIQUE INDEX billing_payments_one_live_card_check ON billing_payments (organization_id)
  WHERE kind = 'card_check' AND status = 'pending';

-- Platform-level cache of PayMongo subscription plans (Stage 2). Not workspace data, so not in PURGED_TABLES.
CREATE TABLE paymongo_plans (
  plan_key         text NOT NULL CHECK (plan_key IN ('starter', 'growth', 'pro')),
  amount_c         integer NOT NULL CHECK (amount_c >= 100),
  paymongo_plan_id text NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_key, amount_c)
);
