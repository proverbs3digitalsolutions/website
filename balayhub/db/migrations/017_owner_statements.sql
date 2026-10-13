-- Owner statements for hosts who manage units on behalf of other owners.
CREATE TABLE unit_owners (
  owner_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  full_name       text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 120),
  email           text,
  phone           text,
  management_fee_pct numeric(5,2) NOT NULL DEFAULT 20 CHECK (management_fee_pct BETWEEN 0 AND 100),
  cleaning_to_manager boolean NOT NULL DEFAULT true,   -- cleaning fees pay the cleaner, not the owner
  notes           text,
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX unit_owners_org_idx ON unit_owners (organization_id);

ALTER TABLE units ADD COLUMN owner_id uuid REFERENCES unit_owners(owner_id) ON DELETE SET NULL;

-- What the channel kept (commission / service fee), for owner statements and reports.
ALTER TABLE bookings ADD COLUMN channel_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (channel_fee >= 0);
