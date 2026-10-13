-- Which browser/device each sign-in is from, shown on the My account page.
ALTER TABLE sessions ADD COLUMN user_agent text CHECK (length(user_agent) <= 300);
