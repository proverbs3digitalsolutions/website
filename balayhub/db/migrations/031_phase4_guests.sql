-- Phase 4 guest experience: guidebook (unit_guides, door code), house rules acceptance,
-- add-ons (listing_addons + 'addon' charges), quotes (booking_quotes), booking sources,
-- review links / returning-guest code / abandoned-booking follow-up settings, and
-- search-friendly listing slugs (units.public_slug).
--
-- Rollback (forward-only; run as a NEW migration, or restore the pre-deploy backup):
--   Void or delete 'addon' charges first: DELETE FROM booking_charges WHERE category = 'addon';
--   ALTER TABLE booking_charges DROP CONSTRAINT booking_charges_category_check,
--     ADD CONSTRAINT booking_charges_category_check CHECK (category IN
--     ('early_checkin','late_checkout','extra_guest','extra_bed','airport_transfer','damage','extra_cleaning','other'));
--   ALTER TABLE booking_charges DROP COLUMN addon_id, DROP COLUMN request_key;
--   ALTER TABLE direct_checkouts DROP CONSTRAINT direct_checkouts_accommodation_total_check;
--   ALTER TABLE direct_checkouts DROP COLUMN quote_id, DROP COLUMN rules_accepted_at, DROP COLUMN rules_text, DROP COLUMN source,
--     DROP COLUMN addons, DROP COLUMN addons_total, DROP COLUMN followup_sent_at;
--   DROP TABLE booking_quotes, listing_addons, unit_guides;
--   ALTER TABLE bookings DROP COLUMN guide_token, DROP COLUMN rules_accepted_at, DROP COLUMN rules_text, DROP COLUMN source;
--   ALTER TABLE organizations DROP COLUMN review_links, DROP COLUMN returning_guest_pct, DROP COLUMN abandoned_followup;
--   ALTER TABLE discount_codes DROP COLUMN issued_to_booking_id;
--   ALTER TABLE units DROP COLUMN public_slug;
-- (All additive; the only backfill is units.public_slug, which is dropped with the column.)

-- 1. Add-on catalogue (before booking_charges.addon_id and direct_checkouts/quotes jsonb refer to it).
CREATE TABLE listing_addons (
  addon_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  name            text NOT NULL CHECK (length(TRIM(BOTH FROM name)) >= 1 AND length(name) <= 80),
  name_tl         text CHECK (length(name_tl) <= 80),
  description     text CHECK (length(description) <= 300),
  price           numeric(12,2) NOT NULL CHECK (price > 0),
  pricing         text NOT NULL CHECK (pricing IN ('per_stay', 'per_night', 'per_guest', 'per_guest_night')),
  max_quantity    smallint NOT NULL DEFAULT 1 CHECK (max_quantity BETWEEN 1 AND 20),
  unit_ids        uuid[] NOT NULL DEFAULT '{}',
  on_booking_page boolean NOT NULL DEFAULT true,
  before_arrival  boolean NOT NULL DEFAULT true,
  active          boolean NOT NULL DEFAULT true,
  sort_order      smallint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX listing_addons_org_idx ON listing_addons (organization_id, active, sort_order);

ALTER TABLE booking_charges DROP CONSTRAINT booking_charges_category_check;
ALTER TABLE booking_charges ADD CONSTRAINT booking_charges_category_check CHECK (category IN
  ('early_checkin', 'late_checkout', 'extra_guest', 'extra_bed', 'airport_transfer', 'damage', 'extra_cleaning', 'other', 'addon'));
ALTER TABLE booking_charges ADD COLUMN addon_id uuid REFERENCES listing_addons(addon_id);
CREATE INDEX booking_charges_addon_idx ON booking_charges (addon_id) WHERE addon_id IS NOT NULL;
-- Pre-arrival add-on purchases: each row carries '<idempotency key>:<addon_id>', so a retried request can't add them twice.
ALTER TABLE booking_charges ADD COLUMN request_key text;
CREATE UNIQUE INDEX booking_charges_request_key_uq ON booking_charges (booking_id, request_key) WHERE request_key IS NOT NULL;

-- 2. Guidebook: one per listing. door_code_enc is encrypted with src/lib/secretbox.js.
CREATE TABLE unit_guides (
  unit_id             uuid PRIMARY KEY REFERENCES units(unit_id),
  organization_id     uuid NOT NULL REFERENCES organizations(organization_id),
  arrival             text CHECK (length(arrival) <= 2000),
  arrival_tl          text CHECK (length(arrival_tl) <= 2000),
  parking             text CHECK (length(parking) <= 2000),
  parking_tl          text CHECK (length(parking_tl) <= 2000),
  building_notes      text CHECK (length(building_notes) <= 2000),
  building_notes_tl   text CHECK (length(building_notes_tl) <= 2000),
  local_tips          text CHECK (length(local_tips) <= 2000),
  local_tips_tl       text CHECK (length(local_tips_tl) <= 2000),
  emergency_contacts  text CHECK (length(emergency_contacts) <= 2000),
  emergency_contacts_tl text CHECK (length(emergency_contacts_tl) <= 2000),
  door_code_enc       text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES users(user_id)
);
CREATE INDEX unit_guides_org_idx ON unit_guides (organization_id);

-- 3. Bookings: private guide link, house rules acceptance, booking source.
ALTER TABLE bookings
  ADD COLUMN guide_token text,
  ADD COLUMN rules_accepted_at timestamptz,
  ADD COLUMN rules_text text CHECK (length(rules_text) <= 4000),
  ADD COLUMN source text CHECK (source IN
    ('facebook', 'instagram', 'messenger', 'viber', 'tiktok', 'google', 'whatsapp', 'email', 'referral', 'quote', 'other'));
CREATE UNIQUE INDEX bookings_guide_token_uq ON bookings (guide_token) WHERE guide_token IS NOT NULL;

-- 4. Quotes.
CREATE TABLE booking_quotes (
  quote_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(organization_id),
  unit_id            uuid NOT NULL REFERENCES units(unit_id),
  public_token       text NOT NULL UNIQUE,
  check_in           date NOT NULL,
  check_out          date NOT NULL,
  num_guests         smallint NOT NULL CHECK (num_guests BETWEEN 1 AND 50),
  guest_name         text CHECK (length(guest_name) <= 120),
  guest_email        text,
  guest_phone        text,
  accommodation_total numeric(12,2) NOT NULL CHECK (accommodation_total >= 0),
  cleaning_fee       numeric(12,2) NOT NULL DEFAULT 0 CHECK (cleaning_fee >= 0),
  addons             jsonb NOT NULL DEFAULT '[]'::jsonb,
  addons_total       numeric(12,2) NOT NULL DEFAULT 0 CHECK (addons_total >= 0),
  discount_amount    numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_amount       numeric(12,2) NOT NULL CHECK (total_amount > 0),
  pay_type           text NOT NULL CHECK (pay_type IN ('full', 'deposit')),
  note               text CHECK (length(note) <= 1000),
  expires_at         timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'expired', 'cancelled')),
  booking_id         uuid REFERENCES bookings(booking_id),
  created_by         uuid REFERENCES users(user_id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  cancelled_at       timestamptz,
  sent_count         smallint NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  last_sent_at       timestamptz,
  CHECK (check_out > check_in)
);
CREATE INDEX booking_quotes_org_status_idx ON booking_quotes (organization_id, status);
CREATE INDEX booking_quotes_unit_idx ON booking_quotes (unit_id);
CREATE INDEX booking_quotes_booking_idx ON booking_quotes (booking_id) WHERE booking_id IS NOT NULL;

-- 5. Direct checkouts: rules, source, add-on snapshot, quote link, follow-up marker.
ALTER TABLE direct_checkouts
  ADD COLUMN rules_accepted_at timestamptz,
  ADD COLUMN rules_text text CHECK (length(rules_text) <= 4000),
  ADD COLUMN source text CHECK (source IN
    ('facebook', 'instagram', 'messenger', 'viber', 'tiktok', 'google', 'whatsapp', 'email', 'referral', 'quote', 'other')),
  ADD COLUMN addons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN addons_total numeric(12,2) NOT NULL DEFAULT 0 CHECK (addons_total >= 0),
  ADD COLUMN quote_id uuid REFERENCES booking_quotes(quote_id),
  ADD COLUMN followup_sent_at timestamptz;
CREATE INDEX direct_checkouts_followup_idx ON direct_checkouts (status, followup_sent_at);
CREATE INDEX direct_checkouts_quote_idx ON direct_checkouts (quote_id) WHERE quote_id IS NOT NULL;
-- A quote's stay is net of its discount, so a discount larger than the stay would store a negative amount.
ALTER TABLE direct_checkouts ADD CONSTRAINT direct_checkouts_accommodation_total_check CHECK (accommodation_total >= 0);

-- 6. Workspace settings.
ALTER TABLE organizations
  ADD COLUMN review_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN returning_guest_pct smallint CHECK (returning_guest_pct BETWEEN 1 AND 50),
  ADD COLUMN abandoned_followup boolean NOT NULL DEFAULT false;

-- 7. Returning-guest codes: one personal code per booking.
ALTER TABLE discount_codes ADD COLUMN issued_to_booking_id uuid REFERENCES bookings(booking_id);
CREATE UNIQUE INDEX discount_codes_issued_uq ON discount_codes (issued_to_booking_id) WHERE issued_to_booking_id IS NOT NULL;

-- 8. Search-friendly listing slugs. Uniqueness is per workspace (units has no organization_id),
-- enforced in code; the backfill below makes existing slugs unique within each workspace.
ALTER TABLE units ADD COLUMN public_slug text;
CREATE INDEX units_public_slug_idx ON units (public_slug);

DO $$
DECLARE
  r record;
  base text;
  cand text;
  n int;
BEGIN
  FOR r IN
    SELECT u.unit_id, u.unit_name, p.organization_id
      FROM units u JOIN properties p USING (property_id)
     ORDER BY p.organization_id, u.created_at, u.unit_id
  LOOP
    base := lower(r.unit_name);
    base := regexp_replace(base, '[^a-z0-9]+', '-', 'g');
    base := btrim(left(btrim(base, '-'), 60), '-');
    IF base = '' THEN base := 'listing'; END IF;
    cand := base;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM units u2 JOIN properties p2 USING (property_id)
                   WHERE p2.organization_id = r.organization_id AND u2.public_slug = cand) LOOP
      n := n + 1;
      cand := btrim(left(base, 60 - length(n::text) - 1), '-') || '-' || n::text;
    END LOOP;
    UPDATE units SET public_slug = cand WHERE unit_id = r.unit_id;
  END LOOP;
END $$;
