-- Help & support: tickets from hosts and their staff, with a two-way
-- conversation, a timeline of every step, attachments and a rating.
CREATE SEQUENCE support_ticket_no_seq START 1001;

CREATE TABLE support_tickets (
  ticket_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no       integer NOT NULL UNIQUE DEFAULT nextval('support_ticket_no_seq'),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  created_by      uuid REFERENCES users(user_id) ON DELETE SET NULL,
  subject         text NOT NULL CHECK (length(subject) BETWEEN 3 AND 150),
  category        text NOT NULL CHECK (category IN ('question', 'problem', 'payments', 'account', 'feature', 'other')),
  priority        text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  status          text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'waiting_on_customer', 'resolved', 'closed')),
  context         jsonb NOT NULL DEFAULT '{}',
  assigned_to     uuid REFERENCES users(user_id) ON DELETE SET NULL,
  first_response_at timestamptz,
  resolved_at     timestamptz,
  closed_at       timestamptz,
  rating          smallint CHECK (rating BETWEEN 1 AND 5),
  rating_comment  text CHECK (length(rating_comment) <= 1000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_tickets_org_idx ON support_tickets (organization_id, updated_at DESC);
CREATE INDEX support_tickets_status_idx ON support_tickets (status, updated_at DESC);

CREATE TABLE support_messages (
  message_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid NOT NULL REFERENCES support_tickets(ticket_id) ON DELETE CASCADE,
  author_id       uuid REFERENCES users(user_id) ON DELETE SET NULL,
  author_kind     text NOT NULL CHECK (author_kind IN ('customer', 'support')),
  internal        boolean NOT NULL DEFAULT false,   -- support-only note
  body            text NOT NULL CHECK (length(body) BETWEEN 1 AND 8000),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_messages_ticket_idx ON support_messages (ticket_id, created_at);

-- Timeline: every step of the ticket (created, status changes, assignment, rating…).
CREATE TABLE support_events (
  event_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       uuid NOT NULL REFERENCES support_tickets(ticket_id) ON DELETE CASCADE,
  kind            text NOT NULL,
  from_status     text,
  to_status       text,
  actor_id        uuid REFERENCES users(user_id) ON DELETE SET NULL,
  actor_kind      text NOT NULL CHECK (actor_kind IN ('customer', 'support', 'system')),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_events_ticket_idx ON support_events (ticket_id, created_at);

ALTER TABLE files DROP CONSTRAINT files_related_record_type_check;
ALTER TABLE files ADD CONSTRAINT files_related_record_type_check
  CHECK (related_record_type IN ('lease', 'payment', 'expense', 'maintenance', 'cleaning', 'registration', 'listing', 'deposit', 'support'));
