-- QA round 14 (D-90): top bar. Bookmarks follow the person across devices; notifications feed the bell.
-- Postgres caps regex repetition at 255, so the 300-character limit is a length() check beside the character-class regex.
-- Rollback (forward-only): DROP TABLE notifications; DROP TABLE bookmarks; then delete the 033 row from the migrations table.

CREATE TABLE bookmarks (
  bookmark_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  user_id         uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  path            text NOT NULL CHECK (path ~ '^#/[A-Za-z0-9._~/?=&%-]+$' AND length(path) <= 302),
  label           text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 80),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, path)
);
CREATE INDEX bookmarks_user_idx ON bookmarks (user_id, created_at);

CREATE TABLE notifications (
  notification_id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  user_id         uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN ('new_booking', 'guest_message', 'checkin_form', 'payment', 'cleaning',
                                                'mention', 'assignment', 'sync_problem', 'owner_activity')),
  property_id     uuid REFERENCES properties(property_id) ON DELETE SET NULL,
  title           text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body            text CHECK (length(body) <= 500),
  url             text NOT NULL CHECK (url ~ '^/#/[A-Za-z0-9._~/?=&%-]*$' AND length(url) <= 303),
  created_at      timestamptz NOT NULL DEFAULT now(),
  read_at         timestamptz
);
CREATE INDEX notifications_user_idx ON notifications (user_id, notification_id DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
