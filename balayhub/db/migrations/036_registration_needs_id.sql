-- QA round 15 (D-95): a check-in registration is finished only when an ID photo is stored. NULL submitted_at = draft waiting for the photo.
-- Rollback: UPDATE guest_registrations SET submitted_at = updated_at WHERE submitted_at IS NULL; ALTER TABLE guest_registrations ALTER COLUMN submitted_at SET NOT NULL;
ALTER TABLE guest_registrations ALTER COLUMN submitted_at DROP NOT NULL;
