-- More booking channels: Vrbo, Expedia and Trip.com.
ALTER TABLE bookings DROP CONSTRAINT bookings_channel_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_channel_check
  CHECK (channel IN ('direct', 'airbnb', 'booking', 'agoda', 'vrbo', 'expedia', 'tripcom', 'other'));
ALTER TABLE ical_feeds DROP CONSTRAINT ical_feeds_channel_check;
ALTER TABLE ical_feeds ADD CONSTRAINT ical_feeds_channel_check
  CHECK (channel IN ('airbnb', 'booking', 'agoda', 'vrbo', 'expedia', 'tripcom', 'other'));
