-- Condo gate pass: guest details (and IDs) sent to the building admin before arrival.
ALTER TABLE properties
  ADD COLUMN admin_email           text,
  ADD COLUMN gatepass_enabled      boolean NOT NULL DEFAULT false,
  ADD COLUMN gatepass_days_before  smallint NOT NULL DEFAULT 1 CHECK (gatepass_days_before BETWEEN 0 AND 7),
  ADD COLUMN gatepass_attach_ids   boolean NOT NULL DEFAULT false,
  ADD COLUMN gatepass_authorized_by text,
  ADD COLUMN gatepass_notes        text;

CREATE TABLE gate_passes (
  gatepass_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(organization_id),
  booking_id      uuid NOT NULL UNIQUE REFERENCES bookings(booking_id),
  token           text NOT NULL UNIQUE,
  status          text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'acknowledged', 'failed')),
  sent_to         text,
  sent_at         timestamptz,
  send_count      integer NOT NULL DEFAULT 0,
  acknowledged_at timestamptz,
  last_error      text,
  missing_form_noted_at timestamptz,   -- host told the guest form isn't filled yet
  created_at      timestamptz NOT NULL DEFAULT now()
);
