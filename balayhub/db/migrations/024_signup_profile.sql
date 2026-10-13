-- Answers from the "Get started" sign-up (number of units, mobile), for onboarding and support.
ALTER TABLE organizations ADD COLUMN signup_profile jsonb NOT NULL DEFAULT '{}';
