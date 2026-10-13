-- Gate passes sent before migration 021 have no building recorded: fill it in,
-- so their links keep working and they aren't sent again.
UPDATE gate_passes gp SET property_id = u.property_id
  FROM bookings b JOIN units u ON u.unit_id = b.unit_id
 WHERE b.booking_id = gp.booking_id AND gp.property_id IS NULL;
