'use strict';

// Reservation activity log (D-69): what happened on a reservation and its related
// records, newest first, in plain English. Owners and managers only; staff get 403
// before any data is read.

const express = require('express');
const { query, one } = require('../db');
const { ah, notFound } = require('../lib/http');
const { uuidParam } = require('../lib/validate');
const { requireRole } = require('../lib/auth');
const { propertyScope } = require('../lib/access');
const { item } = require('../lib/activity');

const router = express.Router();
const managers = requireRole('owner', 'manager');
const LIMIT = 200;

// Ids of the records that belong to one booking. Audit rows point at them by record_id.
const RELATED = `
  SELECT charge_id::text AS id FROM booking_charges WHERE booking_id = $1::uuid
  UNION ALL SELECT payment_id::text FROM booking_payments WHERE booking_id = $1::uuid
  UNION ALL SELECT refund_id::text FROM booking_refunds WHERE booking_id = $1::uuid
  UNION ALL SELECT proof_id::text FROM payment_proofs WHERE booking_id = $1::uuid
  UNION ALL SELECT report_id::text FROM damage_reports WHERE booking_id = $1::uuid
  UNION ALL SELECT item_id::text FROM lost_found_items WHERE booking_id = $1::uuid
  UNION ALL SELECT task_id::text FROM cleaning_tasks WHERE booking_id = $1::uuid
  UNION ALL SELECT quote_id::text FROM booking_quotes WHERE booking_id = $1::uuid
  UNION ALL SELECT conversation_id::text FROM conversations WHERE booking_id = $1::uuid
  UNION ALL SELECT message_id::text FROM messages
    WHERE conversation_id IN (SELECT conversation_id FROM conversations WHERE booking_id = $1::uuid)`;

router.get('/reservations/:id/activity', managers, ah(async (req, res) => {
  const bookingId = uuidParam(req.params.id);
  const scope = [bookingId];
  const booking = await one(
    `SELECT b.booking_id FROM bookings b
       JOIN units u ON u.unit_id = b.unit_id
       JOIN properties p ON p.property_id = u.property_id
      WHERE b.booking_id = $1 AND ${propertyScope(req.user, scope)}`, scope);
  if (!booking) throw notFound();

  const { rows } = await query(
    `WITH related AS (${RELATED})
     SELECT a.action, a.details, a.created_at, u.full_name AS actor_name
       FROM audit_logs a
       LEFT JOIN users u ON u.user_id = a.actor_user_id
      WHERE a.organization_id = $2
        AND (a.record_id = $1::text OR a.record_id IN (SELECT id FROM related) OR a.details->>'booking_id' = $1::text)
      ORDER BY a.created_at DESC, a.audit_id DESC
      LIMIT ${LIMIT}`,
    [bookingId, req.user.organization_id]);
  res.json({ items: rows.map((r) => item(r)) });
}));

module.exports = router;
