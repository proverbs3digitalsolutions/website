-- Paid-plan period, admin notes, and the public demo's date anchor.
ALTER TABLE organizations
  ADD COLUMN paid_until  date,          -- paid plans: last day covered by the latest payment
  ADD COLUMN plan_note   text,          -- platform admin's note (e.g. "GCash ref 1234, Oct–Dec")
  ADD COLUMN demo_anchor date;          -- demo workspace: the day its sample dates were last moved to

-- Trials started before this column was filled in.
UPDATE organizations SET trial_ends_at = created_at + interval '14 days' WHERE plan = 'trial' AND trial_ends_at IS NULL;
