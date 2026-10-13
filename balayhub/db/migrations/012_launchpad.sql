-- Launchpad steps the owner marked as done or skipped by hand.
ALTER TABLE organizations ADD COLUMN onboarding_skipped jsonb NOT NULL DEFAULT '[]';
