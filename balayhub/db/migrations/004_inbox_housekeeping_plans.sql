-- Inbox (guest messaging), housekeeping, guest receipts, plans/trial and demo.

-- ---------------------------------------------------------------- listing info used in messages
ALTER TABLE units
  ADD COLUMN wifi_name            text,
  ADD COLUMN wifi_password        text,
  ADD COLUMN checkin_instructions text,
  ADD COLUMN house_rules          text;

-- ---------------------------------------------------------------- inbox
CREATE TABLE conversations (
  conversation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  booking_id      uuid NOT NULL REFERENCES bookings(booking_id),
  guest_id        uuid REFERENCES guests(guest_id),
  subject         text NOT NULL,
  reply_token     text NOT NULL UNIQUE,     -- routes guest email replies back to this thread
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'archived')),
  assigned_to     uuid REFERENCES users(user_id),
  snoozed_until   timestamptz,
  unread          boolean NOT NULL DEFAULT false,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id)
);
CREATE INDEX conversations_org_idx ON conversations (organization_id, last_message_at DESC);

CREATE TABLE messages (
  message_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES organizations(organization_id),
  direction        text NOT NULL CHECK (direction IN ('in', 'out', 'note')),
  kind             text NOT NULL DEFAULT 'message' CHECK (kind IN ('message', 'receipt', 'confirmation', 'automated')),
  from_name        text,
  from_email       text,
  to_email         text,
  subject          text,
  body             text NOT NULL,
  status           text NOT NULL CHECK (status IN ('scheduled', 'sending', 'sent', 'failed', 'received', 'cancelled', 'note')),
  error            text,
  scheduled_at     timestamptz,
  sent_at          timestamptz,
  sent_by          uuid REFERENCES users(user_id),
  email_message_id text,
  automation_id    uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conv_idx ON messages (conversation_id, created_at);
CREATE INDEX messages_due_idx ON messages (scheduled_at) WHERE status = 'scheduled';
CREATE UNIQUE INDEX messages_inbound_uq ON messages (organization_id, email_message_id) WHERE direction = 'in' AND email_message_id IS NOT NULL;

CREATE TABLE message_templates (
  template_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  name            text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  subject         text NOT NULL CHECK (length(trim(subject)) BETWEEN 1 AND 200),
  body            text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 5000),
  system_key      text,                     -- 'confirmation', 'checkin', 'thanks', 'payment_reminder', 'receipt'
  archived        boolean NOT NULL DEFAULT false,
  created_by      uuid REFERENCES users(user_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX message_templates_system_uq ON message_templates (organization_id, system_key) WHERE system_key IS NOT NULL;

-- Automatic messages relative to a stay.
CREATE TABLE automations (
  automation_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  template_id     uuid NOT NULL REFERENCES message_templates(template_id),
  name            text NOT NULL,
  trigger_event   text NOT NULL CHECK (trigger_event IN ('booking_created', 'before_check_in', 'check_in_day', 'before_check_out', 'after_check_out')),
  offset_days     smallint NOT NULL DEFAULT 0 CHECK (offset_days BETWEEN 0 AND 30),
  send_time       time NOT NULL DEFAULT '10:00',
  enabled         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- One automatic message per automation per stay.
CREATE TABLE automation_runs (
  automation_id uuid NOT NULL REFERENCES automations(automation_id) ON DELETE CASCADE,
  booking_id    uuid NOT NULL REFERENCES bookings(booking_id),
  message_id    uuid REFERENCES messages(message_id) ON DELETE SET NULL,
  skipped       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (automation_id, booking_id)
);

-- Where the IMAP poller left off.
CREATE TABLE mail_sync_state (
  mailbox     text PRIMARY KEY,
  uid_validity bigint,
  last_uid    bigint NOT NULL DEFAULT 0,
  last_run_at timestamptz,
  last_error  text
);

-- ---------------------------------------------------------------- receipts
ALTER TABLE booking_payments
  ADD COLUMN receipt_number  text,
  ADD COLUMN receipt_sent_at timestamptz;
CREATE UNIQUE INDEX booking_payments_receipt_uq ON booking_payments (organization_id, receipt_number) WHERE receipt_number IS NOT NULL;
CREATE TABLE receipt_counters (
  organization_id uuid PRIMARY KEY REFERENCES organizations(organization_id),
  last_number     integer NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- housekeeping
ALTER TABLE organizations
  ADD COLUMN cleaning_checklist jsonb NOT NULL DEFAULT
    '["Change bed linens and pillowcases","Clean and disinfect the bathroom","Replace towels and toiletries","Wash dishes and wipe the kitchen","Sweep and mop the floors","Take out the trash","Check for damage or missing items","Turn off the AC and lights, lock up"]';

CREATE TABLE cleaning_tasks (
  task_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  unit_id         uuid NOT NULL REFERENCES units(unit_id),
  booking_id      uuid REFERENCES bookings(booking_id),     -- the departing stay
  due_date        date NOT NULL,
  next_check_in   date,
  status          text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
  assigned_to     uuid REFERENCES users(user_id),
  assignee_name   text,                                       -- a cleaner without a BalayHub login
  checklist       jsonb NOT NULL DEFAULT '[]',
  notes           text,
  started_at      timestamptz,
  completed_at    timestamptz,
  completed_by    uuid REFERENCES users(user_id),
  created_by      uuid REFERENCES users(user_id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cleaning_tasks_booking_uq ON cleaning_tasks (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX cleaning_tasks_org_idx ON cleaning_tasks (organization_id, due_date);

ALTER TABLE files DROP CONSTRAINT files_related_record_type_check;
ALTER TABLE files ADD CONSTRAINT files_related_record_type_check
  CHECK (related_record_type IN ('lease', 'payment', 'expense', 'maintenance', 'cleaning'));

-- ---------------------------------------------------------------- plans, trial, demo
ALTER TABLE organizations
  ADD COLUMN plan          text NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial', 'starter', 'growth', 'pro', 'comped')),
  ADD COLUMN trial_ends_at timestamptz,
  ADD COLUMN is_demo       boolean NOT NULL DEFAULT false;
-- Existing workspaces (created before plans existed) are kept free.
UPDATE organizations SET plan = 'comped';
