-- Private guest reviews, repeat/VIP guest flags, direct-booking discount codes.
ALTER TABLE guests
  ADD COLUMN vip            boolean NOT NULL DEFAULT false,
  ADD COLUMN do_not_rebook  boolean NOT NULL DEFAULT false;
CREATE INDEX guests_email_idx ON guests (organization_id, lower(email)) WHERE email IS NOT NULL;

ALTER TABLE bookings ADD COLUMN review_token text;
CREATE UNIQUE INDEX bookings_review_token_uq ON bookings (review_token) WHERE review_token IS NOT NULL;

CREATE TABLE guest_reviews (
  review_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  booking_id      uuid NOT NULL UNIQUE REFERENCES bookings(booking_id),
  guest_id        uuid REFERENCES guests(guest_id),
  rating          smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  cleanliness     smallint CHECK (cleanliness BETWEEN 1 AND 5),
  comment         text CHECK (length(comment) <= 2000),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guest_reviews_org_idx ON guest_reviews (organization_id, created_at DESC);

CREATE TABLE discount_codes (
  code_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  code            text NOT NULL CHECK (code ~ '^[A-Z0-9-]{3,20}$'),
  description     text,
  percent_off     smallint CHECK (percent_off BETWEEN 1 AND 90),
  amount_off      numeric(12,2) CHECK (amount_off > 0),
  min_nights      smallint NOT NULL DEFAULT 1 CHECK (min_nights BETWEEN 1 AND 60),
  valid_from      date,
  valid_until     date,
  max_uses        integer CHECK (max_uses > 0),
  returning_only  boolean NOT NULL DEFAULT false,
  active          boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES users(user_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((percent_off IS NULL) <> (amount_off IS NULL))
);
CREATE UNIQUE INDEX discount_codes_uq ON discount_codes (organization_id, code);

ALTER TABLE direct_checkouts
  ADD COLUMN discount_code_id uuid REFERENCES discount_codes(code_id),
  ADD COLUMN discount_amount  numeric(12,2) NOT NULL DEFAULT 0;

-- Existing thank-you templates get the private review link (empty when not applicable).
UPDATE message_templates SET body = body || E'\n\n{{review_link}}'
 WHERE system_key = 'thanks' AND body NOT LIKE '%{{review_link}}%';
