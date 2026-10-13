-- Phase 5 pricing and team tools: season percentage adjustments, booking-window pricing rules
-- (last minute / far out / gap night), fortnight discount, minimum price, listing tags and room
-- types, group bookings, daily close, and sync-health tracking
-- (ical_conflicts, ical_feeds alert columns).
--
-- Rollback (forward-only; run as a NEW migration, or restore the pre-deploy backup):
--   UPDATE bookings SET group_id = NULL WHERE group_id IS NOT NULL;
--   ALTER TABLE bookings DROP COLUMN group_id;
--   DROP TABLE ical_conflicts, daily_closes, booking_groups, pricing_rules;
--   ALTER TABLE ical_feeds DROP COLUMN alerted_at, DROP COLUMN problem_since;
--   DROP INDEX units_tags_idx;
--   ALTER TABLE units DROP COLUMN fortnight_discount, DROP COLUMN min_price, DROP COLUMN tags, DROP COLUMN room_type;
--   DELETE FROM seasons WHERE adjust_pct IS NOT NULL;  -- seasons that only carry a percentage cannot satisfy the old check
--   ALTER TABLE seasons DROP CONSTRAINT seasons_has_value_check, DROP COLUMN adjust_pct;
--   ALTER TABLE seasons ADD CONSTRAINT seasons_check1 CHECK (nightly_rate IS NOT NULL OR min_nights IS NOT NULL);
-- (All additive; the only constraint change is the seasons check, restored above.)

-- 1. Seasons: percentage adjustment. A season needs one of rate, min nights or percentage, never rate and percentage.
ALTER TABLE seasons ADD COLUMN adjust_pct smallint CHECK (adjust_pct BETWEEN -90 AND 300);
ALTER TABLE seasons DROP CONSTRAINT seasons_check1;
ALTER TABLE seasons ADD CONSTRAINT seasons_has_value_check
  CHECK (nightly_rate IS NOT NULL OR min_nights IS NOT NULL OR adjust_pct IS NOT NULL);
ALTER TABLE seasons ADD CONSTRAINT seasons_rate_or_pct_check
  CHECK (NOT (nightly_rate IS NOT NULL AND adjust_pct IS NOT NULL));

-- 2. Listings: fortnight discount (same type as weekly_discount), minimum price, tags, room type.
ALTER TABLE units
  ADD COLUMN fortnight_discount smallint NOT NULL DEFAULT 0 CHECK (fortnight_discount >= 0 AND fortnight_discount <= 90),
  ADD COLUMN min_price numeric(12,2) CHECK (min_price >= 0),
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN room_type text CHECK (length(room_type) <= 40);
CREATE INDEX units_tags_idx ON units USING gin (tags);

-- 3. Booking-window pricing rules (unit_id NULL = all listings).
CREATE TABLE pricing_rules (
  rule_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  unit_id         uuid REFERENCES units(unit_id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('last_minute','far_out','gap_night')),
  days            smallint NOT NULL CHECK (days >= 0 AND days <= 540),
  adjust_pct      smallint NOT NULL CHECK (adjust_pct BETWEEN -90 AND 300),
  active          boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES users(user_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX pricing_rules_kind_unit_key
  ON pricing_rules (organization_id, kind, COALESCE(unit_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX pricing_rules_unit_idx ON pricing_rules (unit_id) WHERE unit_id IS NOT NULL;

-- 4. Notification settings per person: users.notify_prefs jsonb NOT NULL DEFAULT '{}' already exists (migration 015); nothing to add.

-- 5. Group bookings.
CREATE TABLE booking_groups (
  group_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  name            text NOT NULL CHECK (length(name) >= 1 AND length(name) <= 120),
  guest_id        uuid REFERENCES guests(guest_id),
  notes           text CHECK (length(notes) <= 1000),
  created_by      uuid REFERENCES users(user_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  cancelled_at    timestamptz
);
CREATE INDEX booking_groups_org_idx ON booking_groups (organization_id, created_at DESC);
CREATE INDEX booking_groups_guest_idx ON booking_groups (guest_id) WHERE guest_id IS NOT NULL;
ALTER TABLE bookings ADD COLUMN group_id uuid REFERENCES booking_groups(group_id);
CREATE INDEX bookings_group_idx ON bookings (group_id) WHERE group_id IS NOT NULL;

-- 6. Daily close (one per workspace per date; empty property_ids = all properties).
CREATE TABLE daily_closes (
  close_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  close_date      date NOT NULL,
  property_ids    uuid[] NOT NULL DEFAULT '{}',
  summary         jsonb NOT NULL DEFAULT '{}',
  note            text CHECK (length(note) <= 1000),
  closed_by       uuid REFERENCES users(user_id),
  closed_at       timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, close_date)
);
CREATE INDEX daily_closes_closed_by_idx ON daily_closes (closed_by) WHERE closed_by IS NOT NULL;

-- 7. Sync health: overlaps skipped by a calendar sync, and alert tracking on feeds.
ALTER TABLE ical_feeds ADD COLUMN alerted_at timestamptz, ADD COLUMN problem_since timestamptz;
CREATE TABLE ical_conflicts (
  conflict_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  feed_id         uuid NOT NULL REFERENCES ical_feeds(feed_id) ON DELETE CASCADE,
  unit_id         uuid NOT NULL REFERENCES units(unit_id),
  external_uid    text NOT NULL,
  check_in        date NOT NULL,
  check_out       date NOT NULL,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  alerted_at      timestamptz,
  resolved_at     timestamptz,
  UNIQUE (feed_id, external_uid)
);
CREATE INDEX ical_conflicts_org_open_idx ON ical_conflicts (organization_id) WHERE resolved_at IS NULL;
CREATE INDEX ical_conflicts_unit_idx ON ical_conflicts (unit_id);
