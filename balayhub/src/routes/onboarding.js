'use strict';

// Launchpad: a guided, step-by-step setup for a new workspace owner. Most steps
// tick themselves off from real data; optional ones can be skipped.

const express = require('express');
const { one, query } = require('../db');
const { ah, HttpError } = require('../lib/http');
const { requireRole } = require('../lib/auth');
const { planStatus } = require('../lib/plans');
const PAY_HOW_CARD = 'Pay with your saved card in one tap, or with GCash, Maya or another card.';

const router = express.Router();
const owners = requireRole('owner');

// The checklist every workspace starts with (migration 004); changing it counts as "set up".
const DEFAULT_CHECKLIST = JSON.stringify(["Change bed linens and pillowcases","Clean and disinfect the bathroom","Replace towels and toiletries","Wash dishes and wipe the kitchen","Sweep and mop the floors","Take out the trash","Check for damage or missing items","Turn off the AC and lights, lock up"]);

const PHASES = [
  { key: 'listings', title: 'Set up your listings', text: 'Tell BalayHub about the units you rent out. Everything else builds on this.' },
  { key: 'channels', title: 'Bring in your bookings', text: 'Connect Airbnb, Booking.com and Agoda so all your bookings land in one calendar.' },
  { key: 'guests', title: 'Talk to your guests', text: 'Let BalayHub send the routine messages for you.' },
  { key: 'team', title: 'Bring in your team', text: 'Your co-host and cleaners get their own logins with just the access they need.' },
  { key: 'paid', title: 'Get paid', text: 'Take direct bookings with no channel fees and keep BalayHub running.' },
];

// Steps, in order. `optional` steps can be skipped and don't block "complete".
const STEPS = [
  { key: 'listings', phase: 'listings', title: 'Add your first listing', minutes: 3, href: '#/listings?new=1', action: 'Add listing',
    why: 'A listing is one unit you rent out per night, like a condo unit in a tower.',
    how: ['Go to Listings and click Add listing.', 'Enter the listing name (for example Tower 1 - 1201) and the nightly rate, then choose the building, or add it with its street address, city and province (guests see only the city and province).', 'Repeat for each unit.'] },
  { key: 'guest_info', phase: 'listings', title: 'Add Wi-Fi, check-in instructions and house rules', minutes: 3, href: '#/listings', action: 'Edit a listing',
    why: 'These are filled in automatically in the messages your guests receive.',
    how: ['Go to Listings and click Edit on a listing.', 'Under "Guest info", add the Wi-Fi name and password, how to get the key, and your house rules.', 'Save, then do the same for your other listings.'] },
  { key: 'photos', phase: 'listings', optional: true, title: 'Add photos and a description', minutes: 5, href: '#/listings', action: 'Add photos',
    why: 'Photos are shown on your direct booking page, where guests book you without channel fees.',
    how: ['Go to Listings and click Photos on a listing.', 'Upload up to 12 photos. The first one is the cover.', 'Click Edit to add a short description for guests.'] },
  { key: 'channels', phase: 'channels', title: 'Connect your Airbnb or Booking.com calendar', minutes: 5, action: 'Open Channels',
    why: 'Bookings come in automatically and your dates are blocked on every channel, so you never double-book.',
    how: ['On Airbnb, open the listing\'s calendar → Availability → "Connect to another website" and copy the Export link.', 'In BalayHub go to Listings → Channels on the same listing, choose Airbnb, paste the link and click Connect calendar.', 'Copy "Your BalayHub calendar" link from the same window and paste it into Airbnb\'s Import calendar.', 'Do the same for Booking.com and Agoda.'] },
  { key: 'reservation', phase: 'channels', title: 'Add or receive your first reservation', minutes: 2, href: '#/reservations?new=1', action: 'New reservation',
    why: 'Direct bookings from Facebook, Messenger or repeat guests go here too.',
    how: ['Click New reservation, choose the listing and dates.', 'Enter the guest\'s name, mobile and email. The price is filled in from your rates.', 'Tick "Email a booking confirmation" if the guest has an email.'] },
  { key: 'messages', phase: 'guests', title: 'Turn on automatic guest messages', minutes: 3, href: '#/inbox-settings', action: 'Set up messages',
    why: 'Check-in instructions the day before arrival and a thank-you after check-out go out by themselves.',
    how: ['Go to Inbox → Templates & automatic messages.', 'Read the templates and adjust the wording if you like.', 'Turn on the automatic messages you want.'] },
  { key: 'checkin_form', phase: 'guests', optional: true, title: 'Use the guest check-in form', minutes: 2, href: '#/inbox-settings', action: 'Check templates',
    why: 'Guests register everyone\'s names and upload IDs before arrival, as most condo buildings require.',
    how: ['Each reservation has a private check-in link (open a reservation → Guest check-in form → Copy link).', 'Make sure your booking confirmation or check-in template includes {{checkin_link}} so it is sent automatically.', 'When a guest submits it, you get a note in the Inbox and can copy the details for the building admin.'] },
  { key: 'team', phase: 'team', optional: true, title: 'Invite your co-host or cleaner', minutes: 2, href: '#/settings', action: 'Invite',
    why: 'Each person sees only the properties you choose. Staff never see guests\' phone numbers or emails.',
    how: ['Go to Settings → Team and click Invite.', 'Choose Property manager (co-host) or Staff (cleaner), and the properties they can see.', 'Send them the invitation link.'] },
  { key: 'housekeeping', phase: 'team', optional: true, title: 'Set up your cleaning checklist', minutes: 2, href: '#/housekeeping', action: 'Open Housekeeping',
    why: 'A cleaning task is created for every check-out with your checklist; cleaners tick it off on their phone.',
    how: ['Go to Housekeeping and click Edit checklist.', 'List what your cleaner must do, one item per line.', 'Assign tasks to a team member or type the name of a cleaner without a login.'] },
  { key: 'booking_page', phase: 'paid', optional: true, title: 'Turn on your direct booking page', minutes: 10, href: '#/settings', action: 'Set up booking page',
    why: 'Guests book and pay you directly by GCash, Maya or card, with no Airbnb fees.',
    how: ['Create a PayMongo account (dashboard.paymongo.com) and copy your Secret key.', 'Go to Settings → Direct booking page → Connect PayMongo.', 'Tick "Show this listing on my booking page" on your listings, then Turn on and share your link.'] },
  { key: 'plan', phase: 'paid', title: 'Choose your plan', minutes: 2, href: '#/settings', action: 'See plans',
    why: 'Keep BalayHub running after your free trial. Your data is never deleted.',
    how: ['Go to Settings → Plan & billing.', 'Pick a plan and 1, 3 or 12 months (12 months gets 2 months free).', 'Pay with GCash, Maya or card.'] },
];

// Home's "Connect calendar" card opens this listing's Channels dialog, so the Launchpad step opens the same one.
const channelsHref = (unitId) => (unitId ? `#/listings?channels=${unitId}` : '#/listings');

router.get('/onboarding', owners, ah(async (req, res) => {
  const s = await one(
    `SELECT o.onboarding_dismissed_at, o.onboarding_skipped, o.booking_enabled, (o.card_last4 IS NOT NULL) AS has_card,
       (SELECT COUNT(*)::int FROM units u JOIN properties p USING (property_id)
         WHERE p.organization_id = o.organization_id AND u.status = 'active' AND u.nightly_rate IS NOT NULL) AS listings,
       EXISTS (SELECT 1 FROM units u JOIN properties p USING (property_id)
         WHERE p.organization_id = o.organization_id AND u.status = 'active'
           AND (u.wifi_name IS NOT NULL OR u.checkin_instructions IS NOT NULL OR u.house_rules IS NOT NULL)) AS guest_info,
       EXISTS (SELECT 1 FROM files f WHERE f.organization_id = o.organization_id AND f.related_record_type = 'listing') AS photos,
       EXISTS (SELECT 1 FROM ical_feeds f WHERE f.organization_id = o.organization_id AND f.last_status = 'ok') AS channels,
       (EXISTS (SELECT 1 FROM ical_feeds f WHERE f.organization_id = o.organization_id)
         AND NOT EXISTS (SELECT 1 FROM ical_feeds f WHERE f.organization_id = o.organization_id AND f.last_status = 'ok')) AS channels_failing,
       EXISTS (SELECT 1 FROM bookings b WHERE b.organization_id = o.organization_id AND b.kind = 'reservation') AS reservation,
       EXISTS (SELECT 1 FROM automations a WHERE a.organization_id = o.organization_id AND a.enabled) AS messages,
       EXISTS (SELECT 1 FROM guest_registrations r WHERE r.organization_id = o.organization_id AND r.submitted_at IS NOT NULL) AS checkin_form,
       (EXISTS (SELECT 1 FROM users x WHERE x.organization_id = o.organization_id AND x.user_id <> $2)
         OR EXISTS (SELECT 1 FROM invitations i WHERE i.organization_id = o.organization_id)) AS team,
       (o.cleaning_checklist <> $3::jsonb
         OR EXISTS (SELECT 1 FROM cleaning_tasks t WHERE t.organization_id = o.organization_id AND (t.assigned_to IS NOT NULL OR t.assignee_name IS NOT NULL))) AS housekeeping,
       (SELECT u.unit_id FROM units u JOIN properties p USING (property_id)
         WHERE p.organization_id = o.organization_id AND u.status = 'active' AND p.status = 'active'
         ORDER BY p.property_name, u.unit_name LIMIT 1) AS first_unit_id
     FROM organizations o WHERE o.organization_id = $1`, [req.user.organization_id, req.user.user_id, DEFAULT_CHECKLIST]);
  const p = planStatus(req.user);
  const auto = { ...s, listings: s.listings > 0, booking_page: s.booking_enabled, plan: !['trial'].includes(p.plan) };
  const skipped = new Set(s.onboarding_skipped || []);
  const steps = STEPS.map((x) => ({ ...x, how: x.key === 'plan' && s.has_card ? [...x.how.slice(0, 2), PAY_HOW_CARD] : x.how, href: x.key === 'channels' ? channelsHref(s.first_unit_id) : x.href, done: Boolean(auto[x.key]), skipped: !auto[x.key] && skipped.has(x.key) }));
  const required = steps.filter((x) => !x.optional);
  const settled = steps.filter((x) => x.done || x.skipped).length;
  res.json({
    phases: PHASES,
    steps,
    done: settled,
    total: steps.length,
    required_done: required.filter((x) => x.done).length,
    required_total: required.length,
    complete: required.every((x) => x.done) && steps.every((x) => x.done || x.skipped || x.optional),
    dismissed: Boolean(s.onboarding_dismissed_at),
    channels_failing: s.channels_failing,
  });
}));

router.post('/onboarding/skip', owners, ah(async (req, res) => {
  const key = String(req.body?.step || '');
  const undo = req.body?.undo === true;
  const step = STEPS.find((x) => x.key === key);
  if (!step) throw new HttpError(400, 'Unknown step.', { code: 'BAD_REQUEST' });
  if (!step.optional && !undo) throw new HttpError(400, 'This step can\'t be skipped.', { code: 'REQUIRED_STEP' });
  await query(
    undo
      ? `UPDATE organizations SET onboarding_skipped = onboarding_skipped - $2 WHERE organization_id = $1`
      : `UPDATE organizations SET onboarding_skipped = (SELECT jsonb_agg(DISTINCT x) FROM jsonb_array_elements_text(onboarding_skipped || to_jsonb($2::text)) x) WHERE organization_id = $1`,
    [req.user.organization_id, key]);
  res.json({ ok: true });
}));

// Hide (or show again) the Launchpad reminder on Home.
router.post('/onboarding/dismiss', owners, ah(async (req, res) => {
  const show = req.body?.show === true;
  await query(`UPDATE organizations SET onboarding_dismissed_at = ${show ? 'NULL' : 'now()'} WHERE organization_id = $1`, [req.user.organization_id]);
  res.json({ ok: true });
}));

module.exports = router;
