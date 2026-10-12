'use strict';

const config = require('../config');

// A mistyped SMTP_URL must never stop the app: log a clear message instead.
let transport = null;
if (config.smtpUrl) {
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

// Send a transactional email. Without SMTP configured, the message is logged
// (development only) so the flow can still be exercised locally.
async function sendMail({ to, subject, text }) {
  if (transport) {
    try {
      await transport.sendMail({ from: config.mailFrom, to, subject, text });
      return { delivered: true };
    } catch (err) {
      // Logged for the operator; callers continue so sign-up/reset flows still respond.
      console.error(`[mail] Sending to ${to} failed: ${err.response || err.message}`);
      return { delivered: false, error: true };
    }
  }
  if (config.isProd) return { delivered: false, notConfigured: true };
  if (process.env.NODE_ENV !== 'test') {
    console.log(`\n[mail] to=${to}\n[mail] subject=${subject}\n${text}\n`);
  }
  return { delivered: false };
}

module.exports = { sendMail };
