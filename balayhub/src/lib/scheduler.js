'use strict';

// Background jobs. Each job never overlaps itself; errors are logged and the
// job tries again on its next tick.

function every(ms, name, fn, firstDelayMs = ms) {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try { await fn(); } catch (err) { console.error(`[${name}]`, err.message); } finally { busy = false; }
  };
  setTimeout(run, firstDelayMs).unref();
  setInterval(run, ms).unref();
}

function startScheduler() {
  const { syncAllFeeds } = require('./ical');
  const messaging = require('./messaging');
  const { pollInbox } = require('./inbound');
  const housekeeping = require('./housekeeping');

  // Airbnb / Booking.com / Agoda calendars.
  every(30 * 60 * 1000, 'ical', syncAllFeeds, 60 * 1000);
  // Scheduled and automatic guest messages.
  every(60 * 1000, 'messages', async () => {
    await messaging.sendDueMessages();
    await messaging.runAutomations();
  }, 20 * 1000);
  // Guest replies (only when IMAP_URL is set).
  every(2 * 60 * 1000, 'inbox', pollInbox, 30 * 1000);
  // Cleaning tasks for today's and tomorrow's departures.
  every(15 * 60 * 1000, 'housekeeping', housekeeping.createDueTasks, 40 * 1000);
  // Delete guest ID photos after the retention period.
  every(6 * 60 * 60 * 1000, 'guest-ids', require('../routes/checkin').purgeOldIds, 70 * 1000);
  // Online plan payments whose webhook never arrived.
  every(10 * 60 * 1000, 'billing', require('./billing').reconcile, 80 * 1000);
  // Keep the public demo's dates current.
  every(60 * 60 * 1000, 'demo', require('./demo').refreshDemo, 50 * 1000);
}

module.exports = { startScheduler, every };
