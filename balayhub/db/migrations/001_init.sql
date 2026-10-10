-- BalayHub core schema (MVP)
-- Money: NUMERIC(12,2) in PHP. Dates are calendar dates; timestamps are timestamptz
-- and displayed in Asia/Manila. Financial history is never hard-deleted.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- accounts
CREATE TABLE organizations (
  organization_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  currency         char(3) NOT NULL DEFAULT 'PHP',
  timezone         text NOT NULL DEFAULT 'Asia/Manila',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  user_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name        text NOT NULL CHECK (length(trim(full_name)) BETWEEN 1 AND 120),
  email            text NOT NULL,
  phone            text,
  password_hash    text NOT NULL,
  organization_id  uuid REFERENCES organizations(organization_id),
  role             text CHECK (role IN ('owner', 'manager', 'staff')),
  account_status   text NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'revoked')),
  email_verified_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((organization_id IS NULL) = (role IS NULL))
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

CREATE TABLE sessions (
  token_hash   text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- One-time tokens for email verification and password reset.
CREATE TABLE auth_tokens (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invitations (
  invitation_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  email           text NOT NULL,
  role            text NOT NULL CHECK (role IN ('manager', 'staff')),
  token_hash      text NOT NULL UNIQUE,
  invited_by      uuid NOT NULL REFERENCES users(user_id),
  property_ids    uuid[] NOT NULL DEFAULT '{}',
  expires_at      timestamptz NOT NULL,
  accepted_at     timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- portfolio
CREATE TABLE properties (
  property_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  property_name   text NOT NULL CHECK (length(trim(property_name)) BETWEEN 1 AND 120),
  property_type   text NOT NULL CHECK (property_type IN ('apartment', 'boarding_house', 'condominium', 'house', 'commercial', 'dormitory', 'other')),
  address         text NOT NULL CHECK (length(trim(address)) BETWEEN 1 AND 250),
  city            text NOT NULL CHECK (length(trim(city)) BETWEEN 1 AND 80),
  province        text NOT NULL CHECK (length(trim(province)) BETWEEN 1 AND 80),
  postal_code     text,
  description     text,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX properties_org_idx ON properties (organization_id);

-- Managers (and staff) only see the properties they are assigned to.
CREATE TABLE property_assignments (
  user_id     uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES properties(property_id),
  PRIMARY KEY (user_id, property_id)
);

CREATE TABLE units (
  unit_id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id             uuid NOT NULL REFERENCES properties(property_id),
  unit_name               text NOT NULL CHECK (length(trim(unit_name)) BETWEEN 1 AND 60),
  unit_type               text NOT NULL CHECK (unit_type IN ('room', 'studio', 'apartment', 'bedspace', 'house', 'commercial_space', 'other')),
  monthly_rent            numeric(12,2) NOT NULL CHECK (monthly_rent >= 0),
  security_deposit_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (security_deposit_amount >= 0),
  -- 'available' is rentable; occupancy itself is derived from active leases.
  availability            text NOT NULL DEFAULT 'available' CHECK (availability IN ('available', 'unavailable')),
  availability_date       date,
  status                  text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX units_property_idx ON units (property_id);
CREATE UNIQUE INDEX units_name_uq ON units (property_id, lower(unit_name)) WHERE status = 'active';

-- ---------------------------------------------------------------- tenants & leases
CREATE TABLE tenants (
  tenant_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(organization_id),
  full_name         text NOT NULL CHECK (length(trim(full_name)) BETWEEN 1 AND 120),
  email             text,
  phone             text,
  emergency_contact text,
  notes             text,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by        uuid REFERENCES users(user_id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tenants_org_idx ON tenants (organization_id);

CREATE TABLE leases (
  lease_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(organization_id),
  unit_id          uuid NOT NULL REFERENCES units(unit_id),
  tenant_id        uuid NOT NULL REFERENCES tenants(tenant_id),
  start_date       date NOT NULL,
  end_date         date,
  monthly_rent     numeric(12,2) NOT NULL CHECK (monthly_rent > 0),
  due_day          smallint NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  deposit_amount   numeric(12,2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  lease_status     text NOT NULL DEFAULT 'active' CHECK (lease_status IN ('active', 'ended', 'terminated', 'cancelled')),
  document_file_id uuid,
  ended_at         timestamptz,
  created_by       uuid REFERENCES users(user_id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
-- At most one active lease per unit.
CREATE UNIQUE INDEX leases_one_active_per_unit ON leases (unit_id) WHERE lease_status = 'active';
CREATE INDEX leases_tenant_idx ON leases (tenant_id);
CREATE INDEX leases_org_idx ON leases (organization_id);

-- ---------------------------------------------------------------- money
-- Charges: what is due. Generated monthly from leases (idempotent per period).
CREATE TABLE rent_charges (
  charge_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id    uuid NOT NULL REFERENCES leases(lease_id),
  period      date NOT NULL,             -- first day of the billing month
  due_date    date NOT NULL,
  amount_due  numeric(12,2) NOT NULL CHECK (amount_due > 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lease_id, period)
);

-- Payments: what was received. Stored separately from charges so partial and
-- multiple payments allocate correctly. Never edited; corrected by voiding.
CREATE TABLE payments (
  payment_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(organization_id),
  lease_id         uuid NOT NULL REFERENCES leases(lease_id),
  amount_paid      numeric(12,2) NOT NULL CHECK (amount_paid > 0),
  payment_date     date NOT NULL,
  payment_method   text NOT NULL CHECK (payment_method IN ('cash', 'bank_transfer', 'gcash', 'maya', 'check', 'other')),
  reference_number text,
  notes            text,
  receipt_file_id  uuid,
  recorded_by      uuid NOT NULL REFERENCES users(user_id),
  idempotency_key  text,
  voided_at        timestamptz,
  voided_by        uuid REFERENCES users(user_id),
  void_reason      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);
CREATE INDEX payments_lease_idx ON payments (lease_id);
CREATE UNIQUE INDEX payments_idem_uq ON payments (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE maintenance_requests (
  request_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  property_id     uuid NOT NULL REFERENCES properties(property_id),
  unit_id         uuid REFERENCES units(unit_id),
  reported_by     text,
  title           text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 150),
  description     text,
  priority        text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'cancelled')),
  assigned_to     text,
  estimated_cost  numeric(12,2) CHECK (estimated_cost >= 0),
  created_by      uuid REFERENCES users(user_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);
CREATE INDEX maintenance_org_idx ON maintenance_requests (organization_id);

CREATE TABLE expenses (
  expense_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(organization_id),
  property_id      uuid NOT NULL REFERENCES properties(property_id),
  unit_id          uuid REFERENCES units(unit_id),
  maintenance_request_id uuid REFERENCES maintenance_requests(request_id),
  category         text NOT NULL CHECK (category IN ('repairs', 'utilities', 'taxes', 'insurance', 'association_dues', 'supplies', 'salaries', 'cleaning', 'other')),
  description      text,
  amount           numeric(12,2) NOT NULL CHECK (amount > 0),
  expense_date     date NOT NULL,
  vendor_name      text,
  receipt_file_id  uuid,
  recorded_by      uuid NOT NULL REFERENCES users(user_id),
  idempotency_key  text,
  voided_at        timestamptz,
  voided_by        uuid REFERENCES users(user_id),
  void_reason      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);
CREATE INDEX expenses_org_idx ON expenses (organization_id, expense_date);
CREATE UNIQUE INDEX expenses_idem_uq ON expenses (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------- files
CREATE TABLE files (
  file_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(organization_id),
  related_record_type text NOT NULL CHECK (related_record_type IN ('lease', 'payment', 'expense', 'maintenance')),
  related_record_id   uuid NOT NULL,
  storage_key         text NOT NULL,
  file_name           text NOT NULL,
  mime_type           text NOT NULL,
  size_bytes          integer NOT NULL,
  uploaded_by         uuid NOT NULL REFERENCES users(user_id),
  uploaded_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_related_idx ON files (related_record_type, related_record_id);

-- ---------------------------------------------------------------- audit & privacy
CREATE TABLE audit_logs (
  audit_id        bigserial PRIMARY KEY,
  organization_id uuid REFERENCES organizations(organization_id),
  actor_user_id   uuid REFERENCES users(user_id),
  action          text NOT NULL,
  record_type     text NOT NULL,
  record_id       text,
  details         jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_org_idx ON audit_logs (organization_id, created_at DESC);

CREATE TABLE consent_records (
  consent_id        bigserial PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  consent_type      text NOT NULL,
  policy_version    text NOT NULL,
  consent_timestamp timestamptz NOT NULL DEFAULT now(),
  withdrawn_at      timestamptz
);
