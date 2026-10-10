'use strict';

const env = process.env;
const isProd = env.NODE_ENV === 'production';

const config = {
  isProd,
  port: Number(env.PORT || 3000),
  databaseUrl: env.DATABASE_URL || 'postgres://balayhub:balayhub@localhost:5432/balayhub',
  appUrl: (env.APP_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  storageDir: env.STORAGE_DIR || require('path').join(__dirname, '..', 'storage'),
  smtpUrl: env.SMTP_URL || '',
  mailFrom: env.MAIL_FROM || 'BalayHub <no-reply@balayhub.local>',
  // When true, users must click the emailed link before using the app.
  requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION !== 'false',
  // Dev convenience: return verification/reset links in API responses.
  // Never enabled in production.
  exposeDevLinks: !isProd && env.EXPOSE_DEV_LINKS !== 'false',
  sessionTtlHours: Number(env.SESSION_TTL_HOURS || 24 * 7),
  sessionIdleHours: Number(env.SESSION_IDLE_HOURS || 12),
  maxUploadBytes: 10 * 1024 * 1024,
  privacyPolicyVersion: '2026-10-01',
  timezone: 'Asia/Manila',
};

if (isProd && !config.smtpUrl && config.requireEmailVerification) {
  console.warn('[balayhub] SMTP_URL is not set: verification and reset emails cannot be delivered.');
}

module.exports = config;
