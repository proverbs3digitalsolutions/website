-- Workspace deletion requested by its owner: everything is deleted after this time.
ALTER TABLE organizations ADD COLUMN deletion_scheduled_at timestamptz;
