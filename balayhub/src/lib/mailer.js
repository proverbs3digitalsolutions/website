'use strict';

const config = require('../config');

// Messages "sent" when SMTP_URL=test:// (automated tests only).
const outbox = [];

// A mistyped SMTP_URL must never stop the app: log a clear message instead.
let transport = null;
if (config.smtpUrl === 'test://' && process.env.NODE_ENV === 'test') {
  transport = { sendMail: async (msg) => { outbox.push(msg); if (/fail-me/.test(msg.to)) throw new Error('550 mailbox unavailable'); return { messageId: msg.messageId }; } };
} else if (config.smtpUrl) {
  if (!/^smtps?:\/\/[^\s:@]+:[^\s@]+@[^\s:@]+:\d+\/?$/.test(config.smtpUrl)) {
    console.error('[mail] SMTP_URL looks wrong. Expected smtps://EMAIL%40DOMAIN:APP_PASSWORD@smtp.gmail.com:465 '
      + '(email "@" written as %40, no spaces). Email is disabled until it is fixed.');
  } else {
    try {
      transport = require('nodemailer').createTransport(config.smtpUrl);
    } catch (err) {
      console.error(`[mail] Could not use SMTP_URL (${err.message}). Email is disabled until it is fixed.`);
    }
  }
}

const mailEnabled = () => Boolean(transport);

// Send an email. Without SMTP configured, the message is logged (development
// only) so flows can still be exercised locally. Never throws.
async function sendMail({ to, subject, text, from, replyTo, messageId, headers }) {
  if (transport) {
    try {
      await transport.sendMail({ from: from || config.mailFrom, to, subject, text, replyTo, messageId, headers });
      return { delivered: true };
    } catch (err) {
      const reason = String(err.response || err.message);
      // Logged for the operator; callers continue so sign-up/reset flows still respond.
      console.error(`[mail] Sending to ${to} failed: ${reason}`);
      return { delivered: false, error: true, reason: `The email server refused it: ${reason.slice(0, 160)}` };
    }
  }
  if (config.isProd) return { delivered: false, notConfigured: true };
  if (process.env.NODE_ENV !== 'test') {
    console.log(`\n[mail] to=${to}\n[mail] subject=${subject}\n${text}\n`);
  }
  return { delivered: false };
}

module.exports = { sendMail, mailEnabled, outbox };
