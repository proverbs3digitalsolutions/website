'use strict';

// Background jobs. Each job never overlaps itself; errors are logged and the
// job tries again on its next tick.

function every(ms, name, fn, firstDelayMs = ms) {
  let busy = false;
  let failures = 0;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      await fn();
      failures = 0;
    } catch (err) {
      console.error(`[${name}]`, err.message);
      failures += 1;
      if (failures === 3) require('./alerts').alert(`job-${name}`, `Background job "${name}" keeps failing`, `It failed 3 times in a row. Last error: ${err.message}`).catch(() => {});
    } finally { busy = false; }
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
  // Recurring preventive maintenance: open a request when a schedule falls due.
  every(60 * 60 * 1000, 'maintenance-schedules', require('./maintschedule').runSchedules, 110 * 1000);
  // Condo gate passes due to building admins.
  every(15 * 60 * 1000, 'gate-pass', require('../routes/gatepass').sendDuePasses, 55 * 1000);
  // Delete guest ID photos after the retention period.
  every(6 * 60 * 60 * 1000, 'guest-ids', require('../routes/checkin').purgeOldIds, 70 * 1000);
  // Online plan payments whose webhook never arrived.
  every(10 * 60 * 1000, 'billing', require('./billing').reconcile, 80 * 1000);
  // Guests' online bookings whose payment went through but who didn't return to the page.
  every(2 * 60 * 1000, 'direct-booking', require('../routes/directbooking').reconcileDirect, 25 * 1000);
  // Guests who started a direct booking and didn't pay get one follow-up email, two hours later (D-62).
  every(15 * 60 * 1000, 'abandoned-followup', () => require('../routes/directbooking').sendAbandonedFollowups(new Date()), 45 * 1000);
  // Balance payments whose guest didn't return to the page.
  every(3 * 60 * 1000, 'balance-pay', require('../routes/balancepay').reconcileBalance, 35 * 1000);
  // Workspaces whose owner asked for deletion, after the grace period.
  every(60 * 60 * 1000, 'support', require('../routes/support').autoClose, 95 * 1000);

  every(60 * 60 * 1000, 'account', require('./account').purgeDue, 90 * 1000);
  // Expired or idle sessions and old one-time sign-in tokens.
  every(60 * 60 * 1000, 'auth-cleanup', require('./auth').purgeExpiredAuth, 100 * 1000);
  // Keep the public demo's dates current.
  every(60 * 60 * 1000, 'demo', require('./demo').refreshDemo, 50 * 1000);
  // From the 3rd of the month: draft last month's owner statements and email the workspace owner to review them.
  every(60 * 60 * 1000, 'owner-statements-reminder', require('./ownerreminder').sendStatementReminders, 105 * 1000);
}

module.exports = { startScheduler, every };
