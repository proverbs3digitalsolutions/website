-- Sign in with Google: link a Google account (stable "sub" id) to a user.
ALTER TABLE users ADD COLUMN google_sub text;
CREATE UNIQUE INDEX users_google_sub_uq ON users (google_sub) WHERE google_sub IS NOT NULL;
