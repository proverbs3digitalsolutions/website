'use strict';

// Short-term rental reports: performance for any period (occupancy, average
// nightly rate, RevPAR, by channel and by listing, profit after channel fees
// and expenses), and a yearly income summary for the bookkeeper (BIR filing).
// Revenue is "earned" per night (accommodation spread over the stay; cleaning,
// other fees and extra charges on check-in). The tax summary also shows money
// actually received (payments by date, less refunds by date), which is what
// most small hosts report.

const express = require('express');
const { query } = require('../db');
const { HttpError, ah } = require('../lib/http');
const { isValidDate, uuidParam } = require('../lib/validate');
const { requireRole } = require('../lib/auth');
const { propertyScope } = require('../lib/access');
const { own } = require('../lib/pick');

const router = express.Router();
const managers = requireRole('owner', 'manager');
const validationError = (fields) => new HttpError(400, 'Please check the highlighted fields.', { code: 'VALIDATION', fields });
const manilaToday = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const m2 = (c) => (Math.round(c) / 100).toFixed(2);
const cents = (v) => Math.round(Number(v || 0) * 100);
const CHANNEL_LABEL = { direct: 'Direct', airbnb: 'Airbnb', booking: 'Booking.com', agoda: 'Agoda', vrbo: 'Vrbo', expedia: 'Expedia', tripcom: 'Trip.com', other: 'Other' };

function period(q) {
  const t = manilaToday();
  // A from or to that is given but isn't a real date is refused at its field, never replaced by this month.
  const fields = {};
  if (q.from && !isValidDate(q.from)) fields.from = 'Enter a real date.';
  if (q.to && !isValidDate(q.to)) fields.to = 'Enter a real date.';
  if (Object.keys(fields).length) throw validationError(fields);
  if (/^\d{4}$/.test(q.year || '')) {
    if (Number(q.year) < 2000 || Number(q.year) > 2100) throw validationError({ year: 'Choose a valid year.' });
    return { from: `${q.year}-01-01`, to: `${Number(q.year) + 1}-01-01`, label: q.year };
  }
  if (/^\d{4}-\d{2}$/.test(q.month || '') && isValidDate(`${q.month}-01`)) {
    const [y, m] = q.month.split('-').map(Number);
    return { from: `${q.month}-01`, to: new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10), label: q.month };
  }
  if (isValidDate(q.from) && isValidDate(q.to)) {
    if (q.to < q.from) throw validationError({ to: 'The end date must be after the start date.' });
    if (daysBetween(q.from, q.to) > 731) throw validationError({ to: 'Choose up to two years.' });
    return { from: q.from, to: new Date(Date.parse(`${q.to}T00:00:00Z`) + 86400000).toISOString().slice(0, 10), label: `${q.from} to ${q.to}` };
  }
  // A month that isn't a real YYYY-MM falls back to this month, and the answer says so (month_invalid).
  return { ...period({ month: t.slice(0, 7) }), month_invalid: Boolean(q.month) };
}

// Report filters: property, listing and channel (validated; unknown values are ignored).
function reportFilters(q) {
  return {
    property_id: q.property_id ? uuidParam(q.property_id) : null,
    unit_id: q.unit_id ? uuidParam(q.unit_id) : null,
    channel: own(CHANNEL_LABEL, q.channel) ? q.channel : null,
  };
}

async function performance(user, { from, to }, f = {}) {
  const params = [];
  const where = [propertyScope(user, params)];
  if (f.property_id) { params.push(f.property_id); where.push(`p.property_id = $${params.length}`); }
  if (f.unit_id) { params.push(f.unit_id); where.push(`u.unit_id = $${params.length}`); }
  // Listings in scope (incl. archived ones that had stays).
  const { rows: listings } = await query(
    `SELECT u.unit_id, u.unit_name, p.property_id, p.property_name, (u.status = 'active' AND p.status = 'active' AND u.nightly_rate IS NOT NULL) AS active
       FROM units u JOIN properties p ON p.property_id = u.property_id WHERE ${where.join(' AND ')} AND (u.nightly_rate IS NOT NULL OR EXISTS (SELECT 1 FROM bookings x WHERE x.unit_id = u.unit_id))
      ORDER BY p.property_name, u.unit_name`, params);
  const ids = listings.map((l) => l.unit_id);
  // A channel filter narrows stays; null matches every channel.
  const channel = f.channel || null;
  // Earned accommodation and channel fees per night inside the period.
  const { rows: nights } = await query(
    `SELECT b.unit_id, b.channel, COUNT(*)::int AS nights,
            SUM(b.accommodation_total / (b.check_out - b.check_in)) AS accommodation,
            SUM(b.channel_fee / (b.check_out - b.check_in)) AS channel_fees
       FROM bookings b, generate_series(GREATEST(b.check_in, $2::date), LEAST(b.check_out, $3::date) - 1, interval '1 day') n
      WHERE b.unit_id = ANY($1) AND b.kind = 'reservation' AND b.status = 'confirmed' AND b.check_in < $3 AND b.check_out > $2
        AND ($4::text IS NULL OR b.channel = $4)
      GROUP BY b.unit_id, b.channel`, [ids, from, to, channel]);
  // Extras are one-off charges on check-in, so they sit in fees next to cleaning and other fees.
  const { rows: stays } = await query(
    `SELECT b.unit_id, b.channel, COUNT(*) FILTER (WHERE b.status = 'confirmed')::int AS stays,
            COUNT(*) FILTER (WHERE b.status = 'cancelled')::int AS cancelled,
            SUM(b.cleaning_fee + b.other_fees + b.extras_total) FILTER (WHERE b.status = 'confirmed') AS fees,
            SUM(b.check_out - b.check_in) FILTER (WHERE b.status = 'confirmed')::int AS stay_nights
       FROM bookings b WHERE b.unit_id = ANY($1) AND b.kind = 'reservation' AND b.check_in >= $2 AND b.check_in < $3
        AND ($4::text IS NULL OR b.channel = $4)
      GROUP BY b.unit_id, b.channel`, [ids, from, to, channel]);
  const { rows: blocked } = await query(
    `SELECT b.unit_id, COUNT(*)::int AS nights FROM bookings b,
            generate_series(GREATEST(b.check_in, $2::date), LEAST(b.check_out, $3::date) - 1, interval '1 day') n
      WHERE b.unit_id = ANY($1) AND b.kind = 'block' AND b.status = 'confirmed' AND b.check_in < $3 AND b.check_out > $2 GROUP BY b.unit_id`, [ids, from, to]);
  const propIds = [...new Set(listings.map((l) => l.property_id))];
  // Expenses aren't tied to a channel, so a channel filter leaves them out; a
  // listing filter leaves out building-level expenses (dues etc.).
  const { rows: expenses } = channel ? { rows: [] } : await query(
    `SELECT e.unit_id, e.property_id, e.category, SUM(e.amount) AS amount FROM expenses e
      WHERE e.property_id = ANY($1) AND ((e.unit_id IS NULL AND NOT $5) OR e.unit_id = ANY($2)) AND e.voided_at IS NULL AND e.expense_date >= $3 AND e.expense_date < $4
      GROUP BY e.unit_id, e.property_id, e.category`, [propIds, ids, from, to, Boolean(f.unit_id)]);

  const days = daysBetween(from, to);
  const today = manilaToday();
  const byUnit = new Map(listings.map((l) => [l.unit_id, { ...l, nights: 0, acc: 0, fees: 0, chFees: 0, stays: 0, cancelled: 0, expenses: 0,
    capacity: l.active ? Math.max(0, days - (blocked.find((b) => b.unit_id === l.unit_id)?.nights || 0)) : 0 }]));
  const byChannel = new Map();
  const ch = (c) => { if (!byChannel.has(c)) byChannel.set(c, { channel: c, label: CHANNEL_LABEL[c] || c, nights: 0, acc: 0, fees: 0, chFees: 0, stays: 0, cancelled: 0, stayNights: 0 }); return byChannel.get(c); };
  for (const n of nights) {
    const u = byUnit.get(n.unit_id); const c = ch(n.channel);
    for (const x of [u, c]) { x.nights += n.nights; x.acc += cents(n.accommodation); x.chFees += cents(n.channel_fees); }
  }
  let stayNights = 0;
  for (const s of stays) {
    const u = byUnit.get(s.unit_id); const c = ch(s.channel);
    for (const x of [u, c]) { x.stays += s.stays; x.cancelled += s.cancelled; x.fees += cents(s.fees); }
    c.stayNights += s.stay_nights || 0; stayNights += s.stay_nights || 0;
  }
  const byCategory = {};
  let propertyExpenses = 0;
  for (const e of expenses) {
    byCategory[e.category] = (byCategory[e.category] || 0) + cents(e.amount);
    if (e.unit_id && byUnit.has(e.unit_id)) byUnit.get(e.unit_id).expenses += cents(e.amount); else propertyExpenses += cents(e.amount);
  }
  const fmt = (x) => {
    const revenue = x.acc + x.fees;
    return {
      nights: x.nights, stays: x.stays, cancelled: x.cancelled, revenue: m2(revenue), accommodation: m2(x.acc), fees: m2(x.fees), channel_fees: m2(x.chFees),
      adr: x.nights ? m2(x.acc / x.nights) : '0.00',
    };
  };
  const units = [...byUnit.values()].filter((u) => u.active || u.nights || u.stays).map((u) => ({
    unit_id: u.unit_id, unit_name: u.unit_name, property_name: u.property_name, ...fmt(u),
    occupancy: u.capacity ? Math.round((100 * u.nights) / u.capacity) : null, expenses: m2(u.expenses),
    net: m2(u.acc + u.fees - u.chFees - u.expenses),
  }));
  const channels = [...byChannel.values()].sort((a, b) => b.acc + b.fees - (a.acc + a.fees)).map((c) => ({ channel: c.channel, label: c.label, ...fmt(c), avg_stay: c.stays ? Math.round((10 * c.stayNights) / c.stays) / 10 : 0 }));
  // capNights and capAcc: nights and accommodation of listings that have capacity, the only figures occupancy and RevPAR are measured against.
  const tot = [...byUnit.values()].reduce((a, u) => ({ nights: a.nights + u.nights, capNights: a.capNights + (u.capacity ? u.nights : 0), capAcc: a.capAcc + (u.capacity ? u.acc : 0), acc: a.acc + u.acc, fees: a.fees + u.fees, chFees: a.chFees + u.chFees, stays: a.stays + u.stays, cancelled: a.cancelled + u.cancelled, capacity: a.capacity + u.capacity, expenses: a.expenses + u.expenses }),
    { nights: 0, capNights: 0, capAcc: 0, acc: 0, fees: 0, chFees: 0, stays: 0, cancelled: 0, capacity: 0, expenses: 0 });
  const totalExpenses = tot.expenses + propertyExpenses;
  const revenue = tot.acc + tot.fees;
  return {
    from, to_exclusive: to, partial: to > today, expenses_excluded: Boolean(channel),
    totals: {
      revenue: m2(revenue), accommodation: m2(tot.acc), fees: m2(tot.fees), channel_fees: m2(tot.chFees), expenses: m2(totalExpenses),
      net: m2(revenue - tot.chFees - totalExpenses), nights: tot.nights, stays: tot.stays, cancelled: tot.cancelled,
      occupancy: tot.capacity ? Math.round((100 * tot.capNights) / tot.capacity) : 0,
      adr: tot.nights ? m2(tot.acc / tot.nights) : '0.00', revpar: tot.capacity ? m2(tot.capAcc / tot.capacity) : '0.00',
      avg_stay: tot.stays ? Math.round((10 * stayNights) / tot.stays) / 10 : 0,
    },
    channels, units,
    expenses_by_category: Object.entries(byCategory).map(([category, c]) => ({ category, amount: m2(c) })).sort((a, b) => Number(b.amount) - Number(a.amount)),
    building_expenses: m2(propertyExpenses),
  };
}

// Direct bookings by how the guest found the listing (D-61). Same period and scope rules as
// the stays count: check-in date inside the period, confirmed stays only. A channel filter
// other than direct leaves nothing to show.
async function bySource(user, { from, to }, f = {}) {
  if (f.channel && f.channel !== 'direct') return [];
  const params = [];
  const where = [propertyScope(user, params)];
  params.push(from); where.push(`b.check_in >= $${params.length}`);
  params.push(to); where.push(`b.check_in < $${params.length}`);
  if (f.property_id) { params.push(f.property_id); where.push(`p.property_id = $${params.length}`); }
  if (f.unit_id) { params.push(f.unit_id); where.push(`u.unit_id = $${params.length}`); }
  const { rows } = await query(
    `SELECT b.source, COUNT(*)::int AS stays, SUM(b.check_out - b.check_in)::int AS nights, SUM(b.total_amount) AS revenue
       FROM bookings b JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
      WHERE ${where.join(' AND ')} AND b.kind = 'reservation' AND b.channel = 'direct' AND b.status = 'confirmed'
      GROUP BY b.source ORDER BY SUM(b.total_amount) DESC, b.source NULLS LAST`, params);
  return rows.map((r) => ({ source: r.source, stays: r.stays, nights: r.nights, revenue: m2(cents(r.revenue)) }));
}

router.get('/stay-reports', managers, ah(async (req, res) => {
  const p = period(req.query);
  const f = reportFilters(req.query);
  res.json({ period: p.label, month_invalid: Boolean(p.month_invalid), ...(await performance(req.user, p, f)), by_source: await bySource(req.user, p, f) });
}));

// Yearly income summary: per month, earned revenue, money received, channel fees, expenses.
async function taxSummary(user, year, f = {}) {
  const months = [];
  for (let m = 1; m <= 12; m += 1) {
    const from = `${year}-${String(m).padStart(2, '0')}-01`;
    const to = m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, '0')}-01`;
    const p = await performance(user, { from, to }, f);
    months.push({ month: from.slice(0, 7), revenue: p.totals.revenue, channel_fees: p.totals.channel_fees, expenses: p.totals.expenses, net: p.totals.net, nights: p.totals.nights });
  }
  const params = [`${year}-01-01`, `${year + 1}-01-01`];
  const scope = [propertyScope(user, params)];
  if (f.property_id) { params.push(f.property_id); scope.push(`p.property_id = $${params.length}`); }
  if (f.unit_id) { params.push(f.unit_id); scope.push(`u.unit_id = $${params.length}`); }
  if (f.channel) { params.push(f.channel); scope.push(`b.channel = $${params.length}`); }
  const { rows: received } = await query(
    `SELECT to_char(bp.payment_date, 'YYYY-MM') AS month, bp.payment_method, SUM(bp.amount) AS amount
       FROM booking_payments bp JOIN bookings b ON b.booking_id = bp.booking_id JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
      WHERE bp.voided_at IS NULL AND bp.payment_date >= $1 AND bp.payment_date < $2 AND ${scope.join(' AND ')}
      GROUP BY 1, 2`, params);
  // Refunds are money paid back, counted by refund date. Like payments, they include cancelled stays.
  const { rows: refunded } = await query(
    `SELECT to_char(r.refund_date, 'YYYY-MM') AS month, SUM(r.amount) AS amount
       FROM booking_refunds r JOIN bookings b ON b.booking_id = r.booking_id JOIN units u ON u.unit_id = b.unit_id JOIN properties p ON p.property_id = u.property_id
      WHERE r.voided_at IS NULL AND r.refund_date >= $1 AND r.refund_date < $2 AND ${scope.join(' AND ')}
      GROUP BY 1`, params);
  for (const m of months) {
    const rows = received.filter((r) => r.month === m.month);
    const paid = rows.reduce((s, r) => s + cents(r.amount), 0);
    const back = cents(refunded.find((r) => r.month === m.month)?.amount);
    m.received = m2(paid);
    m.refunds = m2(back);
    m.net_received = m2(paid - back);
    m.received_by_method = Object.fromEntries(rows.map((r) => [r.payment_method, Number(r.amount).toFixed(2)]));
  }
  const sum = (list, k) => m2(list.reduce((s, x) => s + cents(x[k]), 0));
  const quarters = [1, 2, 3, 4].map((q) => {
    const list = months.slice((q - 1) * 3, q * 3);
    return {
      quarter: `Q${q}`, revenue: sum(list, 'revenue'), received: sum(list, 'received'), refunds: sum(list, 'refunds'), net_received: sum(list, 'net_received'),
      channel_fees: sum(list, 'channel_fees'), expenses: sum(list, 'expenses'), net: sum(list, 'net'),
    };
  });
  return {
    year, months, quarters,
    totals: {
      revenue: sum(months, 'revenue'), received: sum(months, 'received'), refunds: sum(months, 'refunds'), net_received: sum(months, 'net_received'),
      channel_fees: sum(months, 'channel_fees'), expenses: sum(months, 'expenses'), net: sum(months, 'net'),
    },
  };
}

router.get('/stay-reports/tax', managers, ah(async (req, res) => {
  const year = /^\d{4}$/.test(req.query.year || '') ? Number(req.query.year) : Number(manilaToday().slice(0, 4));
  if (year < 2000 || year > 2100) throw validationError({ year: 'Choose a valid year.' });
  res.json(await taxSummary(req.user, year, reportFilters(req.query)));
}));

function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

router.get('/stay-reports/export', managers, ah(async (req, res) => {
  let lines; let name;
  if (req.query.kind === 'tax') {
    const year = /^\d{4}$/.test(req.query.year || '') ? Number(req.query.year) : Number(manilaToday().slice(0, 4));
    if (year < 2000 || year > 2100) throw validationError({ year: 'Choose a valid year.' });
    const t = await taxSummary(req.user, year, reportFilters(req.query));
    // Refund columns go last so the first six keep their positions in existing spreadsheets.
    lines = [['Month', 'Revenue earned', 'Payments received', 'Channel fees', 'Expenses', 'Net (earned - fees - expenses)', 'Refunds', 'Net received (payments - refunds)'],
      ...t.months.map((m) => [m.month, m.revenue, m.received, m.channel_fees, m.expenses, m.net, m.refunds, m.net_received]),
      ...t.quarters.map((q) => [q.quarter, q.revenue, q.received, q.channel_fees, q.expenses, q.net, q.refunds, q.net_received]),
      ['Total', t.totals.revenue, t.totals.received, t.totals.channel_fees, t.totals.expenses, t.totals.net, t.totals.refunds, t.totals.net_received]];
    name = `balayhub-income-summary-${year}.csv`;
  } else {
    const p = period(req.query);
    const r = await performance(req.user, p, reportFilters(req.query));
    lines = [['Listing', 'Building', 'Stays', 'Nights', 'Occupancy %', 'Avg nightly rate', 'Revenue', 'Channel fees', 'Expenses', 'Net'],
      ...r.units.map((u) => [u.unit_name, u.property_name, u.stays, u.nights, u.occupancy ?? '', u.adr, u.revenue, u.channel_fees, u.expenses, u.net]),
      ['Building-level expenses', '', '', '', '', '', '', '', r.building_expenses, ''],
      ['Total', '', r.totals.stays, r.totals.nights, r.totals.occupancy, r.totals.adr, r.totals.revenue, r.totals.channel_fees, r.totals.expenses, r.totals.net]];
    name = `balayhub-stays-report-${p.label.replace(/\s+/g, '_')}.csv`;
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${name}"`);
  res.send(`﻿${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}\r\n`);
}));

module.exports = router;
