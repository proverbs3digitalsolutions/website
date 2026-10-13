-- Which building a gate pass was sent for (a moved reservation needs a new pass).
ALTER TABLE gate_passes ADD COLUMN property_id uuid REFERENCES properties(property_id);
