-- Phase 3 operations: cleaner role, inspections, cleaner pay, damage reports,
-- lost and found, supplies, work orders and recurring maintenance.
--
-- Rollback (forward-only; run as a NEW migration, or restore the pre-deploy backup):
--   Remove cleaner users/invitations and 'inspected' units first (UPDATE units SET cleaning_status = 'clean' WHERE cleaning_status = 'inspected';
--   DELETE FROM sessions/users/invitations WHERE role = 'cleaner'; DELETE FROM files WHERE related_record_type IN ('damage','lost_found','inspection')),
--   then restore the old CHECK lists:
--   ALTER TABLE users DROP CONSTRAINT users_role_check, ADD CONSTRAINT users_role_check CHECK (role IN ('owner','manager','staff'));
--   ALTER TABLE invitations DROP CONSTRAINT invitations_role_check, ADD CONSTRAINT invitations_role_check CHECK (role IN ('manager','staff'));
--   ALTER TABLE units DROP CONSTRAINT units_cleaning_status_check, ADD CONSTRAINT units_cleaning_status_check CHECK (cleaning_status IN ('clean','dirty'));
--   ALTER TABLE files DROP CONSTRAINT files_related_record_type_check, ADD CONSTRAINT files_related_record_type_check CHECK (related_record_type IN
--     ('lease','payment','expense','maintenance','cleaning','registration','listing','deposit','support','payment_proof','booking_payment'));
--   ALTER TABLE maintenance_requests DROP COLUMN schedule_id, DROP COLUMN cleaning_task_id;
--   DROP TABLE maintenance_schedules, supply_movements, supplies, lost_found_items, damage_reports, cleaning_inspections, cleaner_rates;
--   ALTER TABLE cleaning_tasks DROP COLUMN pay_amount, DROP COLUMN pay_status, DROP COLUMN paid_on, DROP COLUMN paid_method,
--     DROP COLUMN paid_reference, DROP COLUMN paid_by, DROP COLUMN pay_expense_id;
-- (All additive: existing rows and roles are unchanged, so nothing needs backfilling.)

-- 1. Cleaner role, inspected unit status, new file record types.
ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner', 'manager', 'staff', 'cleaner'));
ALTER TABLE invitations DROP CONSTRAINT invitations_role_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_role_check CHECK (role IN ('manager', 'staff', 'cleaner'));
ALTER TABLE units DROP CONSTRAINT units_cleaning_status_check;
ALTER TABLE units ADD CONSTRAINT units_cleaning_status_check CHECK (cleaning_status IN ('clean', 'dirty', 'inspected'));
ALTER TABLE files DROP CONSTRAINT files_related_record_type_check;
ALTER TABLE files ADD CONSTRAINT files_related_record_type_check CHECK (related_record_type IN
  ('lease', 'payment', 'expense', 'maintenance', 'cleaning', 'registration', 'listing', 'deposit', 'support', 'payment_proof', 'booking_payment',
   'damage', 'lost_found', 'inspection'));

-- 2. Cleaner pay on cleaning tasks.
ALTER TABLE cleaning_tasks
  ADD COLUMN pay_amount numeric(12,2) CHECK (pay_amount >= 0),
  ADD COLUMN pay_status text NOT NULL DEFAULT 'unpaid' CHECK (pay_status IN ('unpaid', 'paid')),
  ADD COLUMN paid_on date,
  ADD COLUMN paid_method text CHECK (paid_method IN ('cash', 'gcash', 'maya', 'bank_transfer')),
  ADD COLUMN paid_reference text CHECK (length(paid_reference) <= 100),
  ADD COLUMN paid_by uuid REFERENCES users(user_id),
  ADD COLUMN pay_expense_id uuid REFERENCES expenses(expense_id);
CREATE INDEX cleaning_tasks_pay_idx ON cleaning_tasks (organization_id, pay_status);
CREATE INDEX cleaning_tasks_pay_expense_idx ON cleaning_tasks (pay_expense_id) WHERE pay_expense_id IS NOT NULL;

-- 3. Pay rates: one per team member, or one per outside cleaner (by name).
CREATE TABLE cleaner_rates (
  rate_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  user_id         uuid REFERENCES users(user_id),
  assignee_name   text CHECK (length(TRIM(BOTH FROM assignee_name)) >= 1 AND length(assignee_name) <= 120),
  rate_type       text NOT NULL CHECK (rate_type IN ('per_clean', 'per_hour')),
  amount          numeric(12,2) NOT NULL CHECK (amount >= 0),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((user_id IS NULL) <> (assignee_name IS NULL))
);
CREATE UNIQUE INDEX cleaner_rates_user_uq ON cleaner_rates (organization_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX cleaner_rates_name_uq ON cleaner_rates (organization_id, lower(assignee_name)) WHERE assignee_name IS NOT NULL;

-- 4. Inspections of finished cleaning tasks.
CREATE TABLE cleaning_inspections (
  inspection_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  task_id         uuid NOT NULL REFERENCES cleaning_tasks(task_id),
  inspected_by    uuid REFERENCES users(user_id),
  items           jsonb NOT NULL DEFAULT '[]'::jsonb,
  score           smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  passed          boolean NOT NULL,
  notes           text CHECK (length(notes) <= 1000),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cleaning_inspections_task_idx ON cleaning_inspections (task_id);
CREATE INDEX cleaning_inspections_org_idx ON cleaning_inspections (organization_id, created_at);

-- 5. Damage reports.
CREATE TABLE damage_reports (
  report_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  unit_id         uuid NOT NULL REFERENCES units(unit_id),
  booking_id      uuid REFERENCES bookings(booking_id),
  task_id         uuid REFERENCES cleaning_tasks(task_id),
  description     text NOT NULL CHECK (length(TRIM(BOTH FROM description)) >= 1 AND length(description) <= 1000),
  estimated_cost  numeric(12,2) CHECK (estimated_cost >= 0),
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'charged', 'deducted', 'waived')),
  charge_id       uuid REFERENCES booking_charges(charge_id),
  resolution_note text CHECK (length(resolution_note) <= 500),
  reported_by     uuid REFERENCES users(user_id),
  resolved_by     uuid REFERENCES users(user_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);
CREATE INDEX damage_reports_status_idx ON damage_reports (organization_id, status);
CREATE INDEX damage_reports_booking_idx ON damage_reports (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX damage_reports_task_idx ON damage_reports (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX damage_reports_unit_idx ON damage_reports (unit_id);

-- 6. Lost and found.
CREATE TABLE lost_found_items (
  item_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  unit_id         uuid NOT NULL REFERENCES units(unit_id),
  booking_id      uuid REFERENCES bookings(booking_id),
  task_id         uuid REFERENCES cleaning_tasks(task_id),
  description     text NOT NULL CHECK (length(TRIM(BOTH FROM description)) >= 1 AND length(description) <= 300),
  found_where     text CHECK (length(found_where) <= 200),
  found_on        date,
  status          text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'returned', 'disposed')),
  status_note     text CHECK (length(status_note) <= 300),
  found_by        uuid REFERENCES users(user_id),
  updated_by      uuid REFERENCES users(user_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lost_found_status_idx ON lost_found_items (organization_id, status);
CREATE INDEX lost_found_booking_idx ON lost_found_items (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX lost_found_task_idx ON lost_found_items (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX lost_found_unit_idx ON lost_found_items (unit_id);

-- 7. Supplies and their movements.
CREATE TABLE supplies (
  supply_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  property_id     uuid NOT NULL REFERENCES properties(property_id),
  name            text NOT NULL CHECK (length(TRIM(BOTH FROM name)) >= 1 AND length(name) <= 80),
  unit_label      text NOT NULL DEFAULT 'pcs' CHECK (length(unit_label) <= 20),
  par_level       integer NOT NULL DEFAULT 0 CHECK (par_level >= 0),
  on_hand         integer NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX supplies_name_uq ON supplies (property_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX supplies_org_idx ON supplies (organization_id, property_id);

CREATE TABLE supply_movements (
  movement_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  supply_id       uuid NOT NULL REFERENCES supplies(supply_id),
  kind            text NOT NULL CHECK (kind IN ('used', 'restocked', 'count')),
  quantity        integer NOT NULL,
  task_id         uuid REFERENCES cleaning_tasks(task_id),
  note            text CHECK (length(note) <= 200),
  recorded_by     uuid REFERENCES users(user_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'count' AND quantity >= 0) OR (kind IN ('used', 'restocked') AND quantity > 0))
);
CREATE INDEX supply_movements_supply_idx ON supply_movements (supply_id, created_at);
CREATE INDEX supply_movements_task_idx ON supply_movements (task_id) WHERE task_id IS NOT NULL;

-- 8. Recurring maintenance schedules, then link requests to tasks and schedules.
CREATE TABLE maintenance_schedules (
  schedule_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  property_id     uuid NOT NULL REFERENCES properties(property_id),
  unit_id         uuid REFERENCES units(unit_id),
  title           text NOT NULL CHECK (length(TRIM(BOTH FROM title)) >= 1 AND length(title) <= 150),
  description     text CHECK (length(description) <= 1000),
  every_n         integer NOT NULL CHECK (every_n BETWEEN 1 AND 365),
  every_unit      text NOT NULL CHECK (every_unit IN ('days', 'months')),
  next_due        date NOT NULL,
  priority        text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  active          boolean NOT NULL DEFAULT true,
  last_created_at timestamptz,
  created_by      uuid REFERENCES users(user_id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX maintenance_schedules_due_idx ON maintenance_schedules (next_due) WHERE active;
CREATE INDEX maintenance_schedules_org_idx ON maintenance_schedules (organization_id, property_id);

ALTER TABLE maintenance_requests
  ADD COLUMN cleaning_task_id uuid REFERENCES cleaning_tasks(task_id),
  ADD COLUMN schedule_id uuid REFERENCES maintenance_schedules(schedule_id);
CREATE INDEX maintenance_requests_task_idx ON maintenance_requests (cleaning_task_id) WHERE cleaning_task_id IS NOT NULL;
CREATE INDEX maintenance_requests_schedule_idx ON maintenance_requests (schedule_id) WHERE schedule_id IS NOT NULL;
