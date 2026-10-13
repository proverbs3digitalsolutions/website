-- Language for guest pages (booking, payment, check-in, review): English or Taglish.
ALTER TABLE organizations ADD COLUMN guest_language text NOT NULL DEFAULT 'en' CHECK (guest_language IN ('en', 'tl'));
