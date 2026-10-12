-- When a send actually started (so a stuck send is detected by its start time).
ALTER TABLE messages ADD COLUMN sending_started_at timestamptz;
