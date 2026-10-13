'use strict';

// Digital guidebook (D-57). Owners and managers write one guidebook per listing
// and send each guest a private link. The guest page is public and rate-limited.
// The door code is encrypted at rest and reaches a guest only inside the stay window.

const express = require('express');
const config = require('../config');
const { one, tx } = require('../db');
const { HttpError, ah, notFound } = require('../lib/http');
const { validate, uuidParam } = require('../lib/validate');
const { requireRole, rateLimit } = require('../lib/auth');
const { propertyScope, loadUnit } = require('../lib/access');
const { audit } = require('../lib/audit');
const guidebook = require('../lib/guidebook');

const router = express.Router();
const publicRouter = express.Router();
const managers = requireRole('owner', 'manager');

// ---------------------------------------------------------------- host side
const guideSpec = {
  arrival: { type: 'text', label: 'Arrival and directions' },
  arrival_tl: { type: 'text', label: 'Arrival and directions (Taglish)' },
  parking: { type: 'text', label: 'Parking' },
  parking_tl: { type: 'text', label: 'Parking (Taglish)' },
  building_notes: { type: 'text', label: 'Building and gate notes' },
  building_notes_tl: { type: 'text', label: 'Building and gate notes (Taglish)' },
  local_tips: { type: 'text', label: 'Local tips' },
  local_tips_tl: { type: 'text', label: 'Local tips (Taglish)' },
  emergency_contacts: { type: 'text', label: 'Emergency contacts' },
  emergency_contacts_tl: { type: 'text', label: 'Emergency contacts (Taglish)' },
  door_code: { type: 'string', max: 40, label: 'Door code' },
};

router.get('/units/:id/guide', managers, ah(async (req, res) => {
  const unit = await loadUnit(req.user, uuidParam(req.params.id));
  const row = await one('SELECT * FROM unit_guides WHERE unit_id = $1', [unit.unit_id]);
  res.json({ guide: guidebook.guideForHost(row) });
}));

// Only the fields sent are changed. An empty door_code clears the code.
router.put('/units/:id/guide', managers, ah(async (req, res) => {
  const unit = await loadUnit(req.user, uuidParam(req.params.id));
  const input = validate(req.body, guideSpec, { partial: true });
  const row = await tx((db) => guidebook.saveGuide(db, req.user, unit.unit_id, input));
  // The audit records which fields changed, never their values (the door code is secret).
  await audit(null, req.user, 'guide.updated', 'unit', unit.unit_id, { fields: Object.keys(input) });
  res.json({ guide: guidebook.guideForHost(row) });
}));

router.post('/reservations/:id/guide-link', managers, ah(async (req, res) => {
  const params = [uuidParam(req.params.id)];
  const b = await one(
    `SELECT b.booking_id FROM bookings b
       JOIN units u ON u.unit_id = b.unit_id
       JOIN properties p ON p.property_id = u.property_id
      WHERE b.booking_id = $1 AND b.kind = 'reservation' AND ${propertyScope(req.user, params)}`, params);
  if (!b) throw notFound();
  const token = await guidebook.ensureGuideToken(b.booking_id);
  if (!token) throw new HttpError(409, 'This stay is cancelled, so it has no guidebook link.', { code: 'CANCELLED' });
  await audit(null, req.user, 'guide.link_shared', 'booking', b.booking_id);
  res.json({ url: guidebook.guideLink(token) });
}));

// ---------------------------------------------------------------- guest side (public, by private link)
const guideLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, key: (req) => `guide|${req.ip}` });
publicRouter.use('/public/guide', guideLimiter);

const NOT_AVAILABLE = 'This guidebook is not available for this stay. Please ask your host for a new link.';

// Found only for a confirmed stay inside the link window. Anything else is the same 404.
async function loadByToken(token, today) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw notFound(NOT_AVAILABLE);
  const cols = [...guidebook.GUIDE_COLUMNS, 'door_code_enc'].map((c) => `ug.${c}`).join(', ');
  const row = await one(
    `SELECT b.check_in, b.check_out, b.status, COALESCE(g.full_name, b.guest_label) AS guest_name,
            u.unit_name, to_char(u.checkin_time, 'HH24:MI') AS checkin_time, to_char(u.checkout_time, 'HH24:MI') AS checkout_time,
            u.wifi_name, u.wifi_password, u.checkin_instructions, u.house_rules,
            p.property_name, p.city, o.guest_language, ${cols}
       FROM bookings b
       JOIN units u ON u.unit_id = b.unit_id
       JOIN properties p ON p.property_id = u.property_id
       JOIN organizations o ON o.organization_id = b.organization_id
       LEFT JOIN guests g ON g.guest_id = b.guest_id
       LEFT JOIN unit_guides ug ON ug.unit_id = u.unit_id
      WHERE b.guide_token = $1 AND b.kind = 'reservation'`, [token]);
  if (!row || row.status !== 'confirmed' || !guidebook.linkOpen(row, today)) throw notFound(NOT_AVAILABLE);
  return row;
}

publicRouter.get('/public/guide/:token', ah(async (req, res) => {
  const today = guidebook.manilaToday();
  const row = await loadByToken(req.params.token, today);
  res.set('Cache-Control', 'no-store'); // the page can carry the door code
  res.json(guidebook.guideForGuest(row, today));
}));

module.exports = { router, publicRouter };
