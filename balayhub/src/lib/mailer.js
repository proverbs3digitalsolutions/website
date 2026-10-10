'use strict';

const config = require('../config');

let transport = null;
if (config.smtpUrl) {
  transport = require('nodemailer').createTransport(config.smtpUrl);
}

// Send a transactional email. Without SMTP configured, the message is logged
// (development only) so the flow can still be exercised locally.
async function sendMail({ to, subject, text }) {
  if (transport) {
    await transport.sendMail({ from: config.mailFrom, to, subject, text });
    return { delivered: true };
  }
  if (!config.isProd && process.env.NODE_ENV !== 'test') {
    console.log(`\n[mail] to=${to}\n[mail] subject=${subject}\n${text}\n`);
  }
  return { delivered: false };
}

module.exports = { sendMail };
