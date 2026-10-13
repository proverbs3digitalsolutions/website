'use strict';

// "Get started" checklist shown to a new workspace owner on Home.

const express = require('express');
const { one, query } = require('../db');
const { ah } = require('../lib/http');
const { requireRole } = require('../lib/auth');

const router = express.Router();
const owners = requireRole('owner');

router.get('/onboarding', owners, ah(async (req, res) => {
  const org = req.user.organization_id;
  const s = await one(
    `SELECT o.onboarding_dismissed_at,
       (SELECT COUNT(*)::int FROM units u JOIN properties p USING (property_id)
         WHERE p.organization_id = o.organization_id AND u.status = 'active' AND u.nightly_rate IS NOT NULL) AS listings,
       EXISTS (SELECT 1 FROM units u JOIN properties p USING (property_id)
         WHERE p.organization_id = o.organization_id AND u.status = 'active'
           AND (u.wifi_name IS NOT NULL OR u.checkin_instructions IS NOT NULL)) AS guest_info,
       EXISTS (SELECT 1 FROM ical_feeds f WHERE f.organization_id = o.organization_id) AS channels,
       EXISTS (SELECT 1 FROM bookings b WHERE b.organization_id = o.organization_id AND b.kind = 'reservation') AS reservation,
       (EXISTS (SELECT 1 FROM automations a WHERE a.organization_id = o.organization_id AND a.enabled)
         OR EXISTS (SELECT 1 FROM messages m WHERE m.organization_id = o.organization_id AND m.direction = 'out')) AS messages,
       (EXISTS (SELECT 1 FROM users x WHERE x.organization_id = o.organization_id AND x.user_id <> $2)
         OR EXISTS (SELECT 1 FROM invitations i WHERE i.organization_id = o.organization_id)) AS team
     FROM organizations o WHERE o.organization_id = $1`, [org, req.user.user_id]);
  const steps = [
    { key: 'listings', done: s.listings > 0, title: 'Add your first listing', text: 'Your unit, its nightly rate and cleaning fee.', href: '#/listings?new=1', action: 'Add listing' },
    { key: 'guest_info', done: s.guest_info, title: 'Add Wi-Fi and check-in instructions', text: 'They are filled in automatically in your guest messages.', href: '#/listings', action: 'Edit listing' },
    { key: 'channels', done: s.channels, title: 'Connect your Airbnb or Booking.com calendar', text: 'Bookings come in automatically and double bookings are blocked.', href: '#/listings', action: 'Open Channels' },
    { key: 'reservation', done: s.reservation, title: 'Add a reservation', text: 'Add a direct booking, or wait for your channel bookings to sync.', href: '#/reservations?new=1', action: 'New reservation' },
    { key: 'messages', done: s.messages, title: 'Turn on automatic guest messages', text: 'Send check-in instructions and thank-you notes without lifting a finger.', href: '#/inbox-settings', action: 'Set up messages' },
    { key: 'team', done: s.team, title: 'Invite your co-host or cleaner', text: 'Each person sees only the properties you choose.', href: '#/settings', action: 'Invite' },
  ];
  const done = steps.filter((x) => x.done).length;
  res.json({ steps, done, total: steps.length, dismissed: Boolean(s.onboarding_dismissed_at), complete: done === steps.length });
}));

router.post('/onboarding/dismiss', owners, ah(async (req, res) => {
  const show = req.body?.show === true;
  await query(`UPDATE organizations SET onboarding_dismissed_at = ${show ? 'NULL' : 'now()'} WHERE organization_id = $1`, [req.user.organization_id]);
  res.json({ ok: true });
}));

module.exports = router;
