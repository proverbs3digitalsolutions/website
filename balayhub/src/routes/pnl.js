'use strict';

// Profit and loss per unit for one month (D-44): the JSON for the screen and a CSV download.
// Owners and managers only. Managers see only the properties they are assigned to.

const express = require('express');
const { requireRole } = require('../lib/auth');
const { loadProperty } = require('../lib/access');
const { HttpError, ah } = require('../lib/http');
const { UUID_RE } = require('../lib/validate');
const { unitPnl } = require('../lib/pnl');

const router = express.Router();
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Month (required) and optional property. A property the caller can't see is a 404.
async function pnlArgs(req) {
  const { month } = req.query;
  if (typeof month !== 'string' || !MONTH_RE.test(month)) {
    throw new HttpError(400, 'Choose a month.', { code: 'VALIDATION', fields: { month: 'Use the format YYYY-MM' } });
  }
  const propertyId = req.query.property_id || null;
  if (propertyId !== null && (typeof propertyId !== 'string' || !UUID_RE.test(propertyId))) {
    throw new HttpError(400, 'Choose a valid property.', { code: 'VALIDATION', fields: { property_id: 'Invalid property' } });
  }
  if (propertyId) await loadProperty(req.user, propertyId);
  return { month, propertyId };
}

router.get('/reports/pnl', requireRole('owner', 'manager'), ah(async (req, res) => {
  const { month, propertyId } = await pnlArgs(req);
  res.json(await unitPnl(req.user.organization_id, month, { user: req.user, propertyId }));
}));

// Same escaping as the other CSV exports in reports.js.
function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

router.get('/reports/pnl.csv', requireRole('owner', 'manager'), ah(async (req, res) => {
  const { month, propertyId } = await pnlArgs(req);
  const r = await unitPnl(req.user.organization_id, month, { user: req.user, propertyId });
  const t = r.totals;
  const lines = [
    ['BalayHub profit and loss'], ['Workspace', req.user.organization_name], ['Month', month],
    ['Generated', new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })], ['Currency', 'PHP'], [],
    ['Property', 'Unit', 'Stays', 'Nights', 'Gross', 'Channel fees', 'Refunds', 'Expenses', 'Net'],
    ...r.rows.map((x) => [x.property_name, x.unit_name, x.stays, x.nights, x.gross, x.channel_fees, x.refunds, x.expenses, x.net]),
    ['Total', '', t.stays, t.nights, t.gross, t.channel_fees, t.refunds, t.expenses, t.net],
  ];
  const body = lines.map((row) => row.map(csvCell).join(',')).join('\r\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="balayhub-pnl-${month}.csv"`);
  res.send(`﻿${body}\r\n`);
}));

module.exports = router;
