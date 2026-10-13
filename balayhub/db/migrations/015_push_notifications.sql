-- Push notifications to phones and computers.
CREATE TABLE push_subscriptions (
  subscription_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  endpoint        text NOT NULL UNIQUE,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  device          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_sent_at    timestamptz
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

-- Which notifications each person wants (all on by default).
ALTER TABLE users ADD COLUMN notify_prefs jsonb NOT NULL DEFAULT '{}';
