'use strict';

// Email the platform admins when something breaks: server errors and
// background jobs that keep failing. At most one email per kind every 30 minutes.

const config = require('../config');
const { sendMail } = require('./mailer');

const last = new Map();
const pending = new Map(); // kind → count since the last email
const QUIET_MS = 30 * 60 * 1000;

async function alert(kind, subject, text) {
  if (!config.platformAdmins.length || process.env.NODE_ENV === 'test') return false;
  pending.set(kind, (pending.get(kind) || 0) + 1);
  if (Date.now() - (last.get(kind) || 0) < QUIET_MS) return false;
  const count = pending.get(kind);
  last.set(kind, Date.now());
  pending.set(kind, 0);
  try {
    await sendMail({
      to: config.platformAdmins.join(', '),
      subject: `[BalayHub alert] ${subject}`,
      text: `${text}\n\n${count > 1 ? `(${count} times since the last alert.)\n\n` : ''}Server: ${config.appUrl}\nTime: ${new Date().toISOString()}\n\nSee the logs: docker compose -f docker-compose.prod.yml --env-file deploy/.env logs app --tail 100`,
    });
    return true;
  } catch { return false; }
}

module.exports = { alert };
