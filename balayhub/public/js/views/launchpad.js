// Launchpad: a guided, step-by-step setup for new owners, plus quick how-to guides.

import { get, post } from '../api.js';
import { h, icon, toast } from '../ui.js';
import { state } from '../app.js';

// Everyday how-tos, always available here.
const GUIDES = [
  ['Check a guest in and out', ['Open Home: today\'s arrivals and departures are listed with Check in / Check out buttons.', 'Checking out marks the unit for cleaning and creates a cleaning task.']],
  ['Record a payment and send a receipt', ['Open the reservation and click Record payment.', 'Choose GCash, Maya, cash or bank transfer and tick "Email a receipt".', 'The balance updates right away.']],
  ['Block dates or change a price', ['Open the Calendar and tap an open night.', 'Choose Block (owner stay, repairs) or Set nightly price for that night.']],
  ['Charge more on weekends and holidays', ['Edit a listing and fill in Price extras: weekend rate, holiday rate, weekly and monthly discounts.', 'For peak months or a minimum stay over Holy Week or Christmas, open Calendar → Pricing rules → Add season.', 'PH holidays are applied automatically.']],
  ['Reply to a guest', ['Open Inbox, choose the conversation and type your message, or insert a template.', 'Use ✨ Draft reply with AI if it is turned on. Always read before sending.']],
  ['Send the gate pass to your condo admin', ['Open Listings → Gate pass and enter the building admin\'s email.', 'Turn on automatic sending. BalayHub emails the guests\' names (and IDs from the check-in form) before arrival.', 'The admin clicks "Confirm received" and you see it on the reservation.']],
  ['Handle cleaning', ['Open Housekeeping to see today\'s cleanings and the next guest\'s arrival.', 'Use "Copy for cleaner" to send the checklist by Messenger or Viber.']],
  ['Use BalayHub on your phone', ['Open BalayHub in your phone\'s browser and log in.', 'iPhone: Share → Add to Home Screen. Android: menu ⋮ → Add to Home screen.', 'It then opens like an app.']],
];

// A skipped step is not done. The counts keep the two apart, so the text can say "9 of 11 steps done · 1 skipped".
const countDone = (steps) => steps.filter((x) => x.done).length;
const skippedNote = (steps) => { const n = steps.filter((x) => x.skipped).length; return n ? ` · ${n} skipped` : ''; };
export const progressLine = (o) => `${countDone(o.steps)} of ${o.total} steps done${skippedNote(o.steps)}`;
export const phaseCount = (steps) => `${countDone(steps)}/${steps.length}${skippedNote(steps)}`;

// Steps the person has skipped, un-skipped or opened stay open across the redraw that follows (module level: a redraw rebuilds the view).
const opened = new Set();
// Small hosts see the current phase and the ones before it; later phases fold under "Later". The current phase is the first with a step left to do.
const isOpen = (x) => !x.done && !x.skipped;
export function splitPhases(phases, steps) {
  const cur = phases.findIndex((ph) => steps.some((x) => x.phase === ph.key && isOpen(x)));
  if (cur < 0) return { shown: phases, later: [], laterCount: 0 };
  const later = phases.slice(cur + 1);
  const laterCount = steps.filter((x) => isOpen(x) && later.some((ph) => ph.key === x.phase)).length;
  return { shown: phases.slice(0, cur + 1), later, laterCount };
}
// Module level, like opened: a redraw rebuilds the view.
let laterOpen = false;
export const stepOpen = ({ key, isNext, isStuck }, set) => isNext || isStuck || set.has(key);

function stepCard(st, isNext, rerender, syncFailing) {
  // A calendar that failed its last sync keeps the channels step open, so the reason is not missed.
  const stuck = syncFailing && st.key === 'channels';
  const status = st.done ? h('span', { class: 'lp-status lp-status--done' }, '✓ Done')
    : st.skipped ? h('span', { class: 'lp-status lp-status--skip' }, 'Skipped')
      : isNext ? h('span', { class: 'lp-status lp-status--next' }, 'Next step')
        : h('span', { class: 'lp-status' }, `${st.minutes} min`);
  const skip = async (undo) => {
    try { await post('/onboarding/skip', { step: st.key, undo }); opened.add(st.key); rerender(); } catch (err) { toast(err.message, 'error'); }
  };
  const card = h('details', { class: `lpad-step${st.done ? ' is-done' : ''}${isNext ? ' is-next' : ''}`, open: stepOpen({ key: st.key, isNext, isStuck: stuck }, opened) ? true : null },
    h('summary', null,
      h('span', { class: 'lpad-step__check', 'aria-hidden': 'true' }, st.done ? '✓' : ''),
      h('span', { class: 'lpad-step__title' }, st.title, st.optional && h('span', { class: 'muted small' }, ' · optional')),
      status),
    h('div', { class: 'lpad-step__body' },
      h('p', null, st.why),
      stuck && h('p', { class: 'alert alert--warn' }, 'Connected, but the calendar isn\'t syncing. Check the link.'),
      h('ol', { class: 'lpad-how' }, st.how.map((x) => h('li', null, x))),
      h('div', { class: 'chips' },
        !st.done && h('a', { class: `btn btn--sm ${isNext ? 'btn--primary' : 'btn--secondary'}`, href: st.href }, st.action),
        st.done && h('a', { class: 'btn btn--ghost btn--sm', href: st.href, 'aria-label': `Open ${st.title}` }, 'Open'),
        st.optional && !st.done && !st.skipped && h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-focus-key': `lp-step-${st.key}`, onclick: () => skip(false), 'aria-label': `Skip for now, ${st.title}` }, 'Skip for now'),
        st.skipped && h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-focus-key': `lp-step-${st.key}`, onclick: () => skip(true), 'aria-label': `Show again, ${st.title}` }, 'Show again'))));
  card.addEventListener('toggle', () => { if (card.open) opened.add(st.key); else opened.delete(st.key); });
  return card;
}

export async function launchpadView(el, { rerender }) {
  if (state.user.role !== 'owner') {
    el.replaceChildren(h('div', { class: 'card' }, h('h1', null, 'Launchpad'), h('p', { class: 'muted' }, 'The workspace owner sets up BalayHub here. Ask them if something is missing.')));
    return;
  }
  const o = await get('/onboarding');
  const next = o.steps.find((x) => !x.done && !x.skipped);
  const pct = Math.round((100 * countDone(o.steps)) / o.total);
  const first = state.user.full_name.split(' ')[0];
  const showReminder = async () => { try { await post('/onboarding/dismiss', { show: true }); rerender(); } catch (err) { toast(err.message, 'error'); } };

  const phaseCard = (ph) => {
    const i = o.phases.indexOf(ph);
    const steps = o.steps.filter((x) => x.phase === ph.key);
    // A phase ticks off once nothing in it is left to do. Its count still shows only the steps that are done.
    const settled = steps.every((x) => x.done || x.skipped);
    return h('section', { class: 'lpad-phase card' },
      h('div', { class: 'lpad-phase__head' },
        h('span', { class: `lpad-phase__num${settled ? ' is-done' : ''}` }, settled ? '✓' : String(i + 1)),
        h('div', null, h('h2', null, ph.title), h('p', { class: 'muted small' }, ph.text)),
        h('span', { class: 'muted small lpad-phase__count' }, phaseCount(steps))),
      h('div', { class: 'lpad-steps' }, steps.map((st) => stepCard(st, st === next, rerender, o.channels_failing))));
  };
  const { shown, later, laterCount } = splitPhases(o.phases, o.steps);
  // The fold opens by itself when a later step is stuck (calendar not syncing) or the person opened it.
  const laterKeys = new Set(later.map((ph) => ph.key));
  const laterNeedsEye = (o.channels_failing && o.steps.some((x) => x.key === 'channels' && laterKeys.has(x.phase))) || o.steps.some((x) => laterKeys.has(x.phase) && opened.has(x.key));
  const laterFold = h('details', { class: 'lpad-later card', open: laterOpen || laterNeedsEye ? true : null },
    h('summary', null, `Later (${laterCount} more step${laterCount === 1 ? '' : 's'})`),
    later.map(phaseCard));
  laterFold.addEventListener('toggle', () => { laterOpen = laterFold.open; });

  el.replaceChildren(
    h('div', { class: 'lpad-hero card' },
      h('div', { class: 'lpad-hero__text' },
        h('p', { class: 'lpad-eyebrow' }, 'Launchpad'),
        h('h1', null, o.complete ? `You're all set, ${first}! 🎉` : `Let's get BalayHub ready, ${first}`),
        h('p', { class: 'muted' }, o.complete
          ? 'Everything important is set up. You can come back here any time for the how-to guides below.'
          : 'Follow these steps in order. Each one takes a few minutes, and they tick themselves off as you go.'),
        h('div', { class: 'lpad-progress' },
          h('div', { class: 'bar' }, h('span', { style: { width: `${pct}%` } })),
          h('span', { class: 'small' }, progressLine(o))),
        next && h('a', { class: 'btn btn--primary', href: next.href }, icon('plus'), `Next: ${next.title}`),
        o.dismissed && !o.complete && h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: showReminder }, 'Show the reminder on Home')),
      h('div', { class: 'lpad-hero__art', 'aria-hidden': 'true' }, icon('rocket'))),
    shown.map(phaseCard),
    later.length > 0 && laterCount > 0 && laterFold,
    h('section', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, 'How do I…?')),
      h('div', { class: 'lpad-guides' }, GUIDES.map(([t, lines]) => h('details', { class: 'lpad-guide' },
        h('summary', null, t), h('ol', { class: 'lpad-how' }, lines.map((x) => h('li', null, x))))))),
    h('p', { class: 'muted small center', style: { marginTop: '16px' } }, 'Need help? Reply to any email from BalayHub, or ', h('a', { href: '#/help' }, 'contact us from Help & support'), '.'));
}

// Small reminder on Home until setup is finished (owners only).
export async function launchpadReminder(rerender) {
  if (state.user.role !== 'owner' || state.user.plan?.is_demo) return null;
  let o;
  try { o = await get('/onboarding'); } catch { return null; }
  if (o.complete || o.dismissed) return null;
  const next = o.steps.find((x) => !x.done && !x.skipped);
  const hide = async () => { try { await post('/onboarding/dismiss'); rerender(); } catch (err) { toast(err.message, 'error'); } };
  return h('div', { class: 'card lpad-reminder' },
    h('span', { class: 'lpad-reminder__icon', 'aria-hidden': 'true' }, icon('rocket')),
    h('div', { class: 'lpad-reminder__text' },
      h('strong', null, `Finish setting up BalayHub: ${progressLine(o)}`),
      next && h('span', { class: 'muted small' }, `Next: ${next.title}`),
      h('div', { class: 'bar' }, h('span', { style: { width: `${Math.round((100 * countDone(o.steps)) / o.total)}%` } }))),
    h('div', { class: 'chips' },
      h('a', { class: 'btn btn--primary btn--sm', href: '#/launchpad' }, 'Open Launchpad'),
      h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: hide }, 'Hide')));
}
