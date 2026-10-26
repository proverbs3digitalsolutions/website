// Pricing rules: how nightly prices are worked out, seasons, and the PH holiday calendar.

import { get, post, patch, qs } from '../api.js';
import { h, peso, parseAmount, fmtDate, field, formModal, openModal, confirmDialog, emptyState, pageHead, toast, todayManila, showErrors, clearErrors } from '../ui.js';
import { highRateOk } from '../rates.js';
import { state } from '../app.js';
import { addDays } from './reservations.js';

const RULE_KINDS = {
  last_minute: { label: 'Last-minute', min: 0, max: 30, daysLabel: 'Stay starts within this many days', hint: 'From 0 to 30 days from today.' },
  far_out: { label: 'Far-out', min: 31, max: 540, daysLabel: 'Stay starts more than this many days away', hint: 'From 31 to 540 days from today.' },
  gap_night: { label: 'Gap night', min: 1, max: 7, daysLabel: 'Gap is up to this many nights', hint: 'A free gap of 1 to 7 nights between two bookings. The minimum stay is waived for it.' },
};
const pctWords = (p) => (Number(p) < 0 ? `${Math.abs(p)}% off` : `${p}% more`);
export function ruleSummary(r) {
  const n = Number(r.days);
  if (r.kind === 'last_minute') return `Stays starting within ${n} day${n === 1 ? '' : 's'}: ${pctWords(r.adjust_pct)}`;
  if (r.kind === 'far_out') return `Stays starting more than ${n} days away: ${pctWords(r.adjust_pct)}`;
  return `Gaps of up to ${n} night${n === 1 ? '' : 's'} between bookings: ${pctWords(r.adjust_pct)}`;
}
// What changes when a rule takes the place of the rule of its kind already on the same listing (or on every listing).
export function replaceRuleText(old, next) {
  return `${old.unit_name || 'All listings'} already has a ${RULE_KINDS[next.kind].label} rule: “${ruleSummary(old)}”. It will change to “${ruleSummary(next)}”.${old.active ? '' : ' It is off now, so this turns it on.'}`;
}
// The checks the server makes on a rule (src/routes/pricing.js and its validate spec), with the same messages, so a
// value it would refuse is refused at its field before the browser asks about changing an existing rule.
export function ruleProblems(kind, days, pct) {
  const k = RULE_KINDS[kind];
  const fields = {};
  if (!Number.isInteger(days)) fields.days = 'Days must be a whole number.';
  else if (days < 0 || days > 540) fields.days = days < 0 ? 'Days must be at least 0.' : 'Days must be at most 540.';
  else if (days < k.min || days > k.max) fields.days = `For this kind of rule, use ${k.min} to ${k.max} days.`;
  if (!Number.isInteger(pct)) fields.adjust_pct = 'Percentage change must be a whole number.';
  else if (pct < -90 || pct > 300) fields.adjust_pct = pct < -90 ? 'Percentage change must be at least -90.' : 'Percentage change must be at most 300.';
  else if (pct === 0) fields.adjust_pct = 'Enter a percentage other than 0.';
  return fields;
}
const KIND_LABEL = { custom: 'Custom price', holiday: 'Holiday', season: 'Season', weekend: 'Weekend', base: 'Base rate' };

const prices = (s) => s.nightly_rate !== null || s.adjust_pct !== null;
// Which season prices a shared night (D-66, D-76): a listing season beats an all-listings season on that listing;
// within one scope the season that starts later wins, and on equal starts the one created later.
// Returns the seasons that overlap `s` with who wins (`wins` is null when it is not a price clash). `on` names the
// listing when the overlap is with an all-listings season, so it only touches that one listing. `takeovers` names the
// third seasons that beat both on some of the nights they share, so the winner does not win all of them.
const beats = (a, b) => (Boolean(a.unit_id) !== Boolean(b.unit_id) ? Boolean(a.unit_id) : (a.start_date !== b.start_date ? a.start_date > b.start_date : a.created_at > b.created_at));
export function seasonClashes(s, seasons) {
  return seasons.filter((o) => o !== s && o.start_date <= s.end_date && o.end_date >= s.start_date && (!s.unit_id || !o.unit_id || o.unit_id === s.unit_id))
    .map((o) => {
      const mixed = Boolean(s.unit_id) !== Boolean(o.unit_id);
      let wins = null;
      let takeovers = [];
      if (prices(s) && prices(o)) {
        wins = beats(s, o) ? 'this' : 'other';
        const listing = s.unit_id || o.unit_id;
        const from = s.start_date > o.start_date ? s.start_date : o.start_date;
        const to = s.end_date < o.end_date ? s.end_date : o.end_date;
        takeovers = seasons.filter((t) => t !== s && t !== o && prices(t) && (!t.unit_id || !listing || t.unit_id === listing)
          && t.start_date <= to && t.end_date >= from && beats(t, s) && beats(t, o)).map((t) => t.name);
      }
      return { name: o.name, on: mixed ? (s.unit_id ? s.unit_name : o.unit_name) : null, wins, takeovers };
    });
}
// The other season is named once (D-111).
export const clashText = (c) => {
  const head = `Overlaps ${c.name}${c.on ? ` on ${c.on}` : ''}`;
  if (c.wins === null) return `${head}.`;
  const them = c.wins !== 'this';
  if (c.takeovers.length) return them ? `${head}, which wins the nights they share, except where ${c.takeovers.join(' or ')} takes over.` : `${head}: this season wins the nights they share, except where ${c.takeovers.join(' or ')} takes over.`;
  return them ? `${head}, which wins the shared nights.` : `${head}: this season wins the shared nights.`;
};
// The preview line for a shared night: the season that lost first, the one that won last ("A also covers this night, but B takes it.").
export const overlapLine = (winner, ...losers) => `${losers.join(', ')} also cover${losers.length === 1 ? 's' : ''} this night, but ${winner} takes it.`;
// The chosen price mode needs its own box filled; the server can't see the mode, so the view says which box (QA round 13, #31).
export function seasonModeProblem({ mode, nightly_rate: rate, adjust_pct: pct }) {
  const blank = (v) => v === undefined || v === null || String(v).trim() === '';
  if (mode === 'fixed' && blank(rate)) return { nightly_rate: 'Enter a nightly rate for a fixed price.' };
  // The server's positive rule, so a price of 0 is reported with the other problems (QA round 26, MNY-2).
  if (mode === 'fixed' && parseAmount(rate) <= 0) return { nightly_rate: 'Nightly rate must be greater than zero.' };
  if (mode === 'pct' && blank(pct)) return { adjust_pct: 'Enter a percentage change.' };
  return null;
}
// The price-box problem and the date-order problem together, so one Save shows both (QA round 22, MNY-1b).
export function seasonProblems(d) {
  const p = { ...seasonModeProblem({ mode: d.price_mode, ...d }) };
  if (d.start_date && d.end_date && d.end_date < d.start_date) p.end_date = 'The last night must be on or after the first night.';
  return Object.keys(p).length ? p : null;
}
const pctNum =(v) => (v === '' || v === undefined || v === null ? v : Number(v));

export async function pricingView(el, { rerender }) {
  const { listings, seasons, holidays, rules } = await get('/pricing');
  const canManage = ['owner', 'manager'].includes(state.user.role);
  const isOwner = state.user.role === 'owner';

  const addSeason = () => modeSync(formModal({
    title: 'Add a season', submitText: 'Save season',
    fields: [
      field({ name: 'name', label: 'Name', required: true, maxlength: 80, placeholder: 'e.g. Summer peak, Holy Week, Sinulog' }),
      // A manager has no "All listings": the box starts on "Select…", never on a listing nobody chose (D-113).
      field({ name: 'unit_id', label: 'Listing', type: 'select', required: !isOwner, placeholderOption: isOwner ? false : undefined,
        options: [...(isOwner ? [['', 'All listings']] : []), ...listings.map((l) => [l.unit_id, `${l.unit_name} · ${l.property_name}`])] }),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'start_date', label: 'First night', type: 'date', required: true }),
        field({ name: 'end_date', label: 'Last night', type: 'date', required: true })),
      field({ name: 'price_mode', label: 'Price for these nights', type: 'select', value: 'fixed', placeholderOption: false,
        options: [['fixed', 'Fixed nightly price'], ['pct', '% change on the usual price'], ['none', 'Keep the usual price (minimum stay only)']] }),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'nightly_rate', label: 'Nightly price', type: 'money', hint: 'Replaces the usual rate for these nights.' }),
        field({ name: 'adjust_pct', label: 'Change (%)', type: 'number', min: -90, max: 300, step: 1, inputmode: 'numeric', hint: 'From -90 to 300. Use a minus for a discount, e.g. -10.' })),
      field({ name: 'min_nights', label: 'Minimum nights', type: 'number', min: 1, max: 60, inputmode: 'numeric', hint: 'For stays that include any of these nights.' }),
    ],
    check: (d) => seasonProblems(d),
    onSubmit: async (d, { form }) => {
      const { price_mode: mode, ...body } = d;
      if (mode !== 'fixed') body.nightly_rate = '';
      if (mode !== 'pct') body.adjust_pct = '';
      else body.adjust_pct = pctNum(body.adjust_pct);
      if (body.adjust_pct === '') delete body.adjust_pct;
      // A fixed price above the ceiling is asked about first; "Change it" keeps this dialog open with the price box focused.
      if (mode === 'fixed' && !await highRateOk(parseAmount(body.nightly_rate))) { form.elements.nightly_rate.focus(); return false; }
      const { overlaps } = await post('/pricing/seasons', body);
      const clash = overlaps.map((o) => `${o.name}${o.on ? ` on ${o.on}` : ''}`);
      toast(clash.length ? `Season saved. It overlaps ${clash.join(', ')}.` : 'Season saved.'); rerender();
    },
  }));
  const modeSync = (m) => {
    const form = m.el.querySelector('form');
    const sel = form.elements.price_mode;
    const sync = () => {
      for (const [n, on] of [['nightly_rate', sel.value === 'fixed'], ['adjust_pct', sel.value === 'pct']]) {
        form.elements[n].disabled = !on;
        form.querySelector(`[data-field="${n}"]`)?.classList.toggle('field--off', !on);
      }
    };
    sel.addEventListener('change', sync); sync();
  };
  const remove = async (s) => {
    if (!await confirmDialog({ title: `Remove “${s.name}”?`, text: 'Quotes go back to the usual rates for these dates. Existing reservations don\'t change.', confirmText: 'Remove season' })) return;
    try { await post(`/pricing/seasons/${s.season_id}/remove`); toast('Season removed.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };

  // A rule of a kind that already exists on this listing is changed, not added: say what changes, and ask first.
  const replaceRule = async (old, next) => {
    if (!await confirmDialog({ title: 'Change the existing rule?', text: replaceRuleText(old, next), confirmText: 'Change rule' })) return false;
    await patch(`/pricing/rules/${old.rule_id}`, { days: next.days, adjust_pct: next.adjust_pct, active: true });
    return true;
  };
  const editRule = (r) => {
    const kindSel = field({ name: 'kind', label: 'Rule', type: 'select', required: true, value: r?.kind || 'last_minute', placeholderOption: false,
      options: Object.entries(RULE_KINDS).map(([k, v]) => [k, v.label]) });
    const daysHint = h('p', { class: 'muted small', 'aria-live': 'polite' });
    const daysField = field({ name: 'days', label: 'Days', msgLabel: 'Days', type: 'number', required: true, value: r?.days ?? 3, step: 1, inputmode: 'numeric' });
    const scopeField = field({ name: 'unit_id', label: 'Applies to', type: 'select', required: !isOwner, value: r?.unit_id || '', placeholderOption: isOwner ? false : undefined,
      options: [...(isOwner ? [['', 'All listings']] : []), ...listings.map((l) => [l.unit_id, `${l.unit_name} · ${l.property_name}`])] });
    if (r) { kindSel.querySelector('select').disabled = true; scopeField.querySelector('select').disabled = true; }
    const m = formModal({
      title: r ? 'Edit pricing rule' : 'Add a pricing rule', submitText: 'Save rule',
      fields: [kindSel, daysField, daysHint,
        field({ name: 'adjust_pct', label: 'Price change (%)', type: 'number', required: true, min: -90, max: 300, step: 1, value: r?.adjust_pct, inputmode: 'numeric',
          hint: 'Use a minus for a discount, e.g. -15 for 15% off. From -90 to 300.' }),
        scopeField,
        h('p', { class: 'muted small' }, 'A rule for one listing replaces the all-listings rule of the same kind. Prices you set by hand on the calendar are never changed.')],
      onSubmit: async (d, { form }) => {
        const body = { kind: d.kind, days: Number(d.days), adjust_pct: Number(d.adjust_pct), unit_id: d.unit_id || null };
        const problems = ruleProblems(body.kind, body.days, body.adjust_pct);
        if (Object.keys(problems).length) { showErrors(form, problems); return false; }
        if (r) await patch(`/pricing/rules/${r.rule_id}`, { days: body.days, adjust_pct: body.adjust_pct });
        else {
          const dup = rules.find((x) => x.kind === body.kind && (x.unit_id || null) === body.unit_id);
          if (dup) { if (!await replaceRule(dup, body)) return false; }
          else {
            try { await post('/pricing/rules', body); } catch (err) {
              if (err.status !== 409 || err.code !== 'DUPLICATE') throw err;
              // Someone added the same rule meanwhile: ask, then change that one instead.
              const fresh = (await get('/pricing')).rules.find((x) => x.kind === body.kind && (x.unit_id || null) === body.unit_id);
              if (!fresh) throw err;
              if (!await replaceRule(fresh, body)) return false;
            }
          }
        }
        toast('Rule saved.'); rerender();
      },
    });
    const form = m.el.querySelector('form');
    const syncKind = () => {
      const k = RULE_KINDS[form.elements.kind.value];
      form.querySelector('label[for="' + form.elements.days.id + '"]').firstChild.textContent = k.daysLabel;
      form.elements.days.min = k.min; form.elements.days.max = k.max;
      daysHint.textContent = k.hint;
    };
    form.elements.kind.addEventListener('change', syncKind); syncKind();
  };
  const removeRule = async (r) => {
    if (!await confirmDialog({ title: 'Remove this rule?', text: `${ruleSummary(r)}. New quotes go back to the usual prices. Existing reservations don't change.`, confirmText: 'Remove rule' })) return;
    try { await post(`/pricing/rules/${r.rule_id}/remove`); toast('Rule removed.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };
  const canEditRule = (r) => canManage && (r.unit_id || isOwner);

  const ruleRows = listings.map((l) => h('tr', null,
    h('td', null, h('a', { href: `#/listings?focus=${l.unit_id}`, class: 'link-tap', 'aria-label': `${l.unit_name}, ${l.property_name}` }, l.unit_name), h('div', { class: 'muted small' }, l.property_name)),
    h('td', null, peso(l.nightly_rate)),
    h('td', null, l.weekend_rate ? peso(l.weekend_rate) : '—'),
    h('td', null, l.holiday_rate ? peso(l.holiday_rate) : '—'),
    h('td', null, [Number(l.fortnight_discount) ? `${l.fortnight_discount}% 14+ nights` : null, l.weekly_discount ? `${l.weekly_discount}% weekly` : null, l.monthly_discount ? `${l.monthly_discount}% monthly` : null].filter(Boolean).join(', ') || '—'),
    h('td', null, String(l.min_nights || 1))));

  el.replaceChildren(
    pageHead({
      title: 'Pricing rules', sub: 'Weekend and holiday rates, seasons and long-stay discounts',
      back: { href: '#/calendar', label: 'Calendar' },
      actions: canManage && h('div', { class: 'chips' },
        h('button', { class: 'btn btn--secondary', type: 'button', onclick: () => bulkModal({ listings, rerender }) }, 'Bulk changes'),
        h('button', { class: 'btn btn--primary', type: 'button', onclick: addSeason }, '+ Add season')),
    }),
    h('div', { class: 'card' },
      h('details', { class: 'form-section' },
        h('summary', null, h('h2', null, 'How pricing works')),
        h('ol', { class: 'pricing-order' },
          h('li', null, h('strong', null, 'A price you set on the calendar'), ' for that exact night'),
          h('li', null, h('strong', null, 'Holiday rate'), ' on the nights before and during PH holiday long weekends'),
          h('li', null, h('strong', null, 'Season'), ' (a fixed nightly price, or a % change on the price the night would have had; a season for one listing beats one for all listings)'),
          h('li', null, h('strong', null, 'Weekend rate'), ' on Friday and Saturday nights'),
          h('li', null, h('strong', null, 'Base nightly rate'))),
        h('p', { class: 'muted small' }, 'Then the booking-window rules apply, the price never goes below a listing\'s lowest price, and the 14+, weekly (7+) or monthly (28+) night discount comes off the stay. These rules price new quotes, new reservations and your booking page; existing reservations keep their price. Channel prices (Airbnb, Booking.com…) are set on each channel.'))),
    h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, 'Booking-window rules'),
        canManage && h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => editRule() }, '+ Add rule')),
      h('p', { class: 'muted small' }, 'Change the price automatically for last-minute stays, stays far in the future, and short gaps between bookings. They work on top of the rates and seasons below.'),
      rules.length ? h('ul', { class: 'list pr-rules' }, rules.map((r) => h('li', null, h('div', { class: 'row' },
        h('div', { class: 'row__main' },
          h('span', { class: 'row__title' }, ruleSummary(r)),
          h('span', { class: 'row__sub' }, `${RULE_KINDS[r.kind]?.label || r.kind} · ${r.unit_name || 'All listings'}${!r.active ? ' · off' : ''}`)),
        canEditRule(r) && h('div', { class: 'row__end' }, h('div', { class: 'chips' },
          // A save changes the rule summary in this button's name: a fixed key (D-118).
          h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-focus-key': `rule-edit-${r.rule_id}`, 'aria-label': `Edit rule: ${ruleSummary(r)}, ${r.unit_name || 'All listings'}`, onclick: () => editRule(r) }, 'Edit'),
          h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `Remove rule: ${ruleSummary(r)}, ${r.unit_name || 'All listings'}`, onclick: () => removeRule(r) }, 'Remove')))))))
        : h('p', { class: 'muted' }, 'No rules yet. For example: 15% off stays starting within 3 days, or 10% off bookings more than 200 days away.')),
    h('div', { class: 'card card--flush' },
      h('div', { class: 'card__head', style: { padding: '16px 16px 0' } }, h('h2', null, 'Listing rates')),
      listings.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['Listing', 'Base', 'Weekend', 'Holiday', 'Discounts', 'Min. nights'].map((t) => h('th', null, t)))),
        h('tbody', null, ruleRows)))
        : emptyState({ iconName: 'building', title: 'No listings yet', text: 'Add a listing with a nightly rate first.' }),
      h('p', { class: 'muted small', style: { padding: '0 16px 12px' } }, 'Change these in Listings → Edit.')),
    h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, 'Seasons')),
      seasons.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['Season', 'Dates', 'Listing', 'Price', 'Min. nights'].map((t) => h('th', null, t)), h('th', null, h('span', { class: 'sr-only' }, 'Actions')))),
        h('tbody', null, seasons.map((s) => h('tr', null,
          h('td', null, s.name, seasonClashes(s, seasons).map((c) => h('div', { class: 'muted small' }, clashText(c)))),
          h('td', null, `${fmtDate(s.start_date)} – ${fmtDate(s.end_date)}`),
          h('td', null, s.unit_name || 'All listings'),
          h('td', null, s.nightly_rate ? peso(s.nightly_rate) : (s.adjust_pct === null ? '—' : `${s.adjust_pct > 0 ? '+' : ''}${s.adjust_pct}%`)),
          h('td', null, s.min_nights ? String(s.min_nights) : '—'),
          h('td', null, canManage && (s.unit_id || isOwner) && h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `Remove season: ${s.name}, ${s.unit_name || 'All listings'}`, onclick: () => remove(s) }, 'Remove')))))))
        : h('p', { class: 'muted' }, 'No seasons yet. Add one for peak months (e.g. March to May), local fiestas, or a minimum stay over Holy Week and Christmas.')),
    previewCard(listings, seasons),
    h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, 'Philippine holidays (next 12 months)')),
      h('p', { class: 'muted small' }, 'Holiday rates use these dates. Some dates (Chinese New Year, Eid) are set each year by proclamation and may move; set a price on the calendar for any night that needs it.'),
      h('ul', { class: 'holiday-list' }, holidays.map((x) => h('li', null, h('span', null, x.name), h('span', { class: 'muted' }, fmtDate(x.date)))))));
}


// ---------------------------------------------------------------- price preview
// Other seasons that cover a night a season priced, and so lost to it.
function losingSeasons(n, seasons, unitId) {
  const lost = seasons.filter((s) => (!s.unit_id || s.unit_id === unitId) && prices(s) && s.start_date <= n.date && s.end_date >= n.date && s.name !== n.label);
  return lost.length ? h('p', { class: 'muted small' }, overlapLine(n.label, ...lost.map((s) => s.name))) : null;
}
function previewCard(listings, seasons) {
  const out = h('div'); // the 60-night grid is never a live region; the night detail below is (D-114)
  if (!listings.length) return h('div', { class: 'card' }, h('div', { class: 'card__head' }, h('h2', null, 'Price preview')), h('p', { class: 'muted' }, 'Add a listing to see its prices.'));
  const sel = h('select', { class: 'input', id: 'pr-unit', 'aria-label': 'Listing' }, listings.map((l) => h('option', { value: l.unit_id }, `${l.unit_name} · ${l.property_name}`)));
  const from = h('input', { class: 'input', type: 'date', id: 'pr-from', value: todayManila() });
  async function load() {
    out.replaceChildren(h('p', { class: 'muted' }, 'Loading prices…'));
    try {
      const { nights } = await get(`/pricing/preview${qs({ unit_id: sel.value, from: from.value || todayManila(), days: 60 })}`);
      out.replaceChildren(grid(nights));
    } catch (err) { out.replaceChildren(h('div', { class: 'alert alert--error', role: 'alert' }, err.message || 'Could not load prices.')); }
  }
  function grid(nights) {
    const detail = h('div', { class: 'pr-detail card--soft', 'aria-live': 'polite' }, h('p', { class: 'muted small' }, 'Select a night to see how its price was worked out.'));
    const show = (n, btn) => {
      grid_.querySelectorAll('.pr-night[aria-pressed="true"]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      const applied = n.applied || [];
      detail.replaceChildren(
        h('strong', null, `${fmtDate(n.date)}: ${peso(n.price)}`),
        h('p', { class: 'small' }, n.booked ? 'Booked. ' : '', `${n.label || KIND_LABEL[n.kind]}.`),
        n.kind === 'season' ? losingSeasons(n, seasons, sel.value) : null,
        applied.length ? h('ul', { class: 'small' }, applied.map((a) => h('li', null, `${a.label}${a.adjust_pct !== null ? ` (${Number(a.adjust_pct) > 0 ? '+' : ''}${a.adjust_pct}%)` : ''}`)))
          : h('p', { class: 'muted small' }, 'No booking-window rules applied.'));
    };
    const lead = nights.length ? (new Date(`${nights[0].date}T00:00:00Z`).getUTCDay()) : 0;
    const cells = [...Array(lead)].map(() => h('div', { class: 'pr-blank', 'aria-hidden': 'true' }));
    for (const n of nights) {
      const kind = KIND_LABEL[n.kind] ? n.kind : 'base';
      const day = new Date(`${n.date}T00:00:00Z`).getUTCDate();
      const mon = new Date(`${n.date}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', timeZone: 'UTC' });
      // A night a booking-window rule changed reads "Adjusted", not its source kind.
      const adjusted = (n.applied || []).length > 0;
      const b = h('button', { type: 'button', class: `pr-night pr-night--${n.booked ? 'booked' : kind}`, 'aria-pressed': 'false',
        'aria-label': `${fmtDate(n.date)}, ${peso(n.price)}, ${n.booked ? 'booked, ' : ''}${adjusted ? `${KIND_LABEL[kind]}, adjusted by rules` : KIND_LABEL[kind]}` },
        h('span', { class: 'pr-night__d' }, day === 1 || n === nights[0] ? `${mon} ${day}` : String(day), adjusted ? h('span', { class: 'pr-i', 'aria-hidden': 'true' }, 'i') : null),
        h('span', { class: 'pr-night__p' }, peso(n.price)),
        h('span', { class: 'pr-night__k' }, n.booked ? 'Booked' : adjusted ? 'Adjusted' : KIND_LABEL[kind]));
      b.addEventListener('click', () => show(n, b));
      cells.push(b);
    }
    const grid_ = h('div', { class: 'pr-grid' },
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => h('div', { class: 'pr-dow', 'aria-hidden': 'true' }, d)), cells);
    return h('div', null, grid_, detail,
      h('ul', { class: 'pr-legend small' }, Object.entries(KIND_LABEL).map(([k, t]) => h('li', null, h('span', { class: `pr-swatch pr-night--${k}`, 'aria-hidden': 'true' }), t)),
        h('li', null, h('span', { class: 'pr-swatch pr-night--booked', 'aria-hidden': 'true' }), 'Booked'),
        h('li', null, h('span', { class: 'pr-i', 'aria-hidden': 'true' }, 'i'), 'Rules applied')));
  }
  sel.addEventListener('change', load); from.addEventListener('change', load);
  load();
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Price preview')),
    h('p', { class: 'muted small' }, 'Each night priced as a one-night stay. Longer stays can get gap, weekly or monthly prices; the quote shows the exact total. Select a night to see why.'),
    h('div', { class: 'form-row form-row--2 pr-controls' },
      h('div', { class: 'field' }, h('label', { for: 'pr-unit' }, 'Listing'), sel),
      h('div', { class: 'field' }, h('label', { for: 'pr-from' }, 'Starting'), from)),
    out);
}

// ---------------------------------------------------------------- bulk changes
const BULK_ACTIONS = [['set', 'Set a price'], ['percent', 'Change prices by %'], ['clear', 'Clear custom prices'], ['block', 'Block dates'], ['unblock', 'Unblock dates']];

// Every problem with a bulk change at once, keyed by field name; only the boxes the chosen action shows are checked.
export function bulkProblems(b) {
  const p = {};
  if (b.tag === '') p.tag = 'Choose at least one listing or a tag.';
  else if (b.unit_ids && !b.unit_ids.length) p.unit_ids = 'Choose at least one listing or a tag.';
  if (!b.from) p.from = 'Choose the first and last night.';
  if (!b.to) p.to = 'Choose the first and last night.';
  if (b.from && b.to && b.to < b.from) p.to = 'The last night must be on or after the first night.';
  if (b.action === 'set') {
    const n = parseAmount(b.price);
    if (!b.price) p.price = 'Enter the new price per night.';
    else if (Number.isNaN(n)) p.price = 'New price per night must be a valid amount (e.g. 8500 or 8500.50).';
    else if (n < 0) p.price = 'New price per night cannot be negative.';
    else if (n === 0) p.price = 'New price per night must be greater than zero.';
  }
  // The server's own rules and words (src/routes/bulk.js), checked before any request (D-110).
  if (b.action === 'percent') {
    const n = b.percent;
    if (!Number.isFinite(n)) p.percent = 'Enter a percentage between -90 and 300.';
    else if (!Number.isInteger(n)) p.percent = 'Change (%) must be a whole number.';
    else if (n < -90) p.percent = 'Change (%) must be at least -90.';
    else if (n > 300) p.percent = 'Change (%) must be at most 300.';
    else if (n === 0) p.percent = 'Choose a change other than 0%.';
  }
  if (b.action === 'block' && !b.reason) p.reason = 'Add a reason for the block.';
  return p;
}

async function bulkModal({ listings, rerender }) {
  let tags = [];
  try { tags = (await get('/tags')).tags || []; } catch { /* tag picking is optional */ }
  const checks = listings.map((l) => h('label', { class: 'check pr-pick' }, h('input', { type: 'checkbox', name: 'unit', value: l.unit_id, 'data-focus': '' }), h('span', null, `${l.unit_name} · ${l.property_name}`)));
  const tagSel = h('select', { class: 'input', name: 'tag', 'aria-label': 'Tag' }, h('option', { value: '' }, 'Choose a tag'), tags.map((t) => h('option', { value: t.tag }, `${t.tag} (${t.count})`)));
  const byRadio = (v, text, on) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'by', value: v, checked: on }), h('span', null, text));
  const listBox = h('div', { class: 'pr-picklist' }, checks);
  const tagBox = h('div', { class: 'field', 'data-field': 'tag', hidden: true }, tagSel, h('div', { class: 'error', role: 'alert' }));
  const actSel = h('select', { class: 'input', name: 'action', id: 'bk-action' }, BULK_ACTIONS.map(([v, t]) => h('option', { value: v }, t)));
  const price = h('input', { class: 'input', name: 'price', id: 'bk-price', inputmode: 'decimal', placeholder: '2,500' });
  const pct = h('input', { class: 'input', name: 'percent', id: 'bk-pct', type: 'number', min: -90, max: 300, step: 1, placeholder: '-10' });
  const reason = h('input', { class: 'input', name: 'reason', id: 'bk-reason', maxlength: 200, placeholder: 'e.g. Repairs, family stay' });
  const from = h('input', { class: 'input', type: 'date', name: 'from', id: 'bk-from', value: todayManila() });
  const to = h('input', { class: 'input', type: 'date', name: 'to', id: 'bk-to', value: addDays(todayManila(), 30) });
  const wrap = (id, label, input, hint, extra) => {
    input.setAttribute('aria-describedby', `${id}-err`);
    return h('div', { class: 'field', 'data-field': id === 'bk-pct' ? 'percent' : id.slice(3), hidden: extra?.hidden }, h('label', { for: id }, label), input, hint && h('p', { class: 'muted small' }, hint), h('div', { class: 'error', id: `${id}-err`, role: 'alert' }));
  };
  const priceF = wrap('bk-price', 'New price per night', price);
  const pctF = wrap('bk-pct', 'Change (%)', pct, 'Use a minus for a discount, e.g. -10. Works from each night\'s current price.', { hidden: true });
  const reasonF = wrap('bk-reason', 'Reason for the block', reason, 'Required. Kept in the audit log.', { hidden: true });
  const err = h('div', { role: 'alert' });
  // Only the summary line is live; the table of nights is read when the person moves to it (D-114).
  const resultLine = h('div', { 'aria-live': 'polite' });
  const resultRest = h('div');
  const result = h('div', null, resultLine, resultRest);
  const previewBtn = h('button', { class: 'btn btn--secondary', type: 'submit' }, 'Preview');
  const applyBtn = h('button', { class: 'btn btn--primary', type: 'button', disabled: true }, 'Apply');
  const form = h('form', { class: 'form', novalidate: true },
    err,
    h('fieldset', { class: 'pr-fieldset', 'data-field': 'unit_ids' }, h('legend', null, 'Listings'),
      h('div', { class: 'chips' }, byRadio('pick', 'Pick listings', true), tags.length ? byRadio('tag', 'By tag', false) : null),
      listBox, h('div', { class: 'error', role: 'alert' }), tagBox),
    h('div', { class: 'form-row form-row--2' }, wrap('bk-from', 'First night', from), wrap('bk-to', 'Last night', to)),
    h('div', { class: 'field' }, h('label', { for: 'bk-action' }, 'What to do'), actSel),
    priceF, pctF, reasonF,
    h('div', { class: 'form-actions' }, previewBtn, applyBtn),
    result);

  const isBlocks = () => ['block', 'unblock'].includes(actSel.value);
  const body = (dry) => {
    const b = { from: from.value, to: to.value, action: actSel.value, dry_run: dry };
    if (form.elements.by.value === 'tag') b.tag = tagSel.value; else b.unit_ids = [...form.querySelectorAll('input[name=unit]:checked')].map((c) => c.value);
    if (b.action === 'set') b.price = price.value.trim();
    if (b.action === 'percent') b.percent = pct.value.trim() === '' ? NaN : Number(pct.value);
    if (b.action === 'block') b.reason = reason.value.trim();
    return b;
  };
  const stale = () => { applyBtn.disabled = true; resultLine.replaceChildren(); resultRest.replaceChildren(); };
  const sync = () => {
    priceF.hidden = actSel.value !== 'set'; pctF.hidden = actSel.value !== 'percent'; reasonF.hidden = actSel.value !== 'block';
    const tagMode = form.elements.by.value === 'tag';
    listBox.hidden = tagMode; tagBox.hidden = !tagMode;
    stale();
  };
  // An edit clears that box's mark and message (the dates and the listing choice clear together); the banner goes with the last one.
  const clearEdited = (e) => {
    const t = e.target;
    const names = ['from', 'to'].includes(t.name) ? ['from', 'to'] : ['by', 'tag', 'unit'].includes(t.name) ? ['unit_ids', 'tag'] : [t.closest?.('[data-field]')?.dataset.field];
    for (const n of names) {
      const w = form.querySelector(`[data-field="${n}"]`);
      if (!w) continue;
      w.classList.remove('field--invalid');
      w.querySelector('.error').textContent = '';
      w.querySelectorAll('[aria-invalid]').forEach((c) => c.removeAttribute('aria-invalid'));
      w.removeAttribute('aria-invalid');
    }
    if (!form.querySelector('.field--invalid')) err.replaceChildren();
  };
  form.addEventListener('change', (e) => { clearEdited(e); sync(); });
  form.addEventListener('input', (e) => { clearEdited(e); stale(); });
  const m = openModal({ title: 'Bulk changes', body: form, wide: true });

  const skipped = (list) => list?.length ? h('div', { class: 'alert alert--warn' }, h('strong', null, `Skipped (${list.length})`),
    h('ul', { class: 'small' }, list.map((s) => h('li', null, `${s.unit_name}: ${s.reason}`)))) : null;
  const run = async (dry) => {
    clearErrors(form); err.replaceChildren();
    const banner = (text) => err.replaceChildren(h('div', { class: 'alert alert--error' }, text));
    const problems = bulkProblems(body(true));
    if (Object.keys(problems).length) { banner('Please check the highlighted fields.'); showErrors(form, problems); return null; }
    try { return await post(isBlocks() ? '/bulk/blocks' : '/bulk/prices', body(dry)); }
    catch (e) {
      // ApiError always carries a fields object, so test for an entry; a refusal with none says the server's own words.
      const rest = e.fields && Object.keys(e.fields).length ? showErrors(form, e.fields) : [e.message];
      if (rest.length) banner(rest.join(' '));
      else banner('Please check the highlighted fields.');
      return null;
    }
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (previewBtn.getAttribute('aria-disabled') === 'true') return; // busy with its own request: a second press does nothing
    // aria-disabled, not disabled: a disabled control drops focus to the page while it waits (D-97, D-105, D-120).
    previewBtn.setAttribute('aria-disabled', 'true'); previewBtn.textContent = 'Checking…';
    const r = await run(true);
    previewBtn.removeAttribute('aria-disabled'); previewBtn.textContent = 'Preview';
    if (!r) return;
    let total;
    if (isBlocks()) {
      const rows = r.created || r.cancelled || [];
      total = r.count;
      resultLine.replaceChildren(
        h('p', null, h('strong', null, `${total} ${actSel.value === 'block' ? 'block' : 'manual block'}${total === 1 ? '' : 's'} would be ${actSel.value === 'block' ? 'created' : 'cancelled'}.`)));
      resultRest.replaceChildren(
        rows.length ? tableOf(['Listing', 'From', 'Last night'], rows.map((x) => [x.unit_name, fmtDate(x.check_in), fmtDate(addDays(x.check_out, -1))])) : null,
        skipped(r.skipped));
    } else {
      const rows = r.changes;
      total = r.count;
      resultLine.replaceChildren(
        h('p', null, h('strong', null, total ? `${total} night${total === 1 ? '' : 's'} would change.` : 'None of these nights would change.'), total > rows.length ? ` Showing the first ${rows.length}.` : ''),
        r.below_lowest ? h('div', { class: 'alert alert--warn' }, `${r.below_lowest} night${r.below_lowest === 1 ? '' : 's'} will be below their listing's lowest price. Those prices will be used as set.`) : null);
      resultRest.replaceChildren(
        rows.length ? tableOf(['Listing', 'Night', 'Now', 'New'], rows.map((x) => [x.unit_name, fmtDate(x.date), x.from_price === null ? '—' : peso(x.from_price), x.to_price === null ? 'Usual price' : peso(x.to_price)])) : null,
        skipped(r.skipped));
    }
    applyBtn.disabled = total === 0;
    if (total === 0 && isBlocks()) resultLine.append(h('p', { class: 'muted small' }, 'Nothing to change for these choices.'));
  });
  applyBtn.addEventListener('click', async () => {
    if (applyBtn.getAttribute('aria-disabled') === 'true') return; // busy with its own request: a second press does nothing
    // A typed price above the ceiling is asked about before it is applied; "Change it" puts focus back in the price box.
    if (actSel.value === 'set' && !await highRateOk(parseAmount(price.value))) { price.focus(); return; }
    applyBtn.setAttribute('aria-disabled', 'true'); applyBtn.textContent = 'Applying…';
    const r = await run(false);
    applyBtn.textContent = 'Apply';
    // Only the busy mark goes: an Apply that an edit switched off (no fresh preview, stale()) stays off after a refusal.
    if (!r) { applyBtn.removeAttribute('aria-disabled'); return; }
    const n = r.count;
    const sk = (r.skipped || []).length;
    const said = actSel.value === 'clear'
      ? `Set prices cleared for ${n} night${n === 1 ? '' : 's'}`
      : `${n} ${isBlocks() ? 'block' : 'night'}${n === 1 ? '' : 's'} ${actSel.value === 'unblock' ? 'cancelled' : actSel.value === 'block' ? 'created' : 'updated'}`;
    toast(`${said}${sk ? `, ${sk} skipped` : ''}.`);
    m.close(); rerender();
  });
}

function tableOf(head, rows) {
  return h('div', { class: 'table-wrap pr-table' }, h('table', { class: 'table' },
    h('thead', null, h('tr', null, head.map((t) => h('th', null, t)))),
    h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, c)))))));
}
