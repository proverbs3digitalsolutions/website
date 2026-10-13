// Pricing rules: how nightly prices are worked out, seasons, and the PH holiday calendar.

import { get, post, patch, qs } from '../api.js';
import { h, peso, fmtDate, field, formModal, openModal, confirmDialog, emptyState, pageHead, toast, todayManila } from '../ui.js';
import { state } from '../app.js';
import { addDays } from './reservations.js';

const RULE_KINDS = {
  last_minute: { label: 'Last-minute', min: 0, max: 30, daysLabel: 'Stay starts within (days)', hint: 'From 0 to 30 days from today.' },
  far_out: { label: 'Far-out', min: 31, max: 540, daysLabel: 'Stay starts more than (days) away', hint: 'From 31 to 540 days from today.' },
  gap_night: { label: 'Gap night', min: 1, max: 7, daysLabel: 'Gap is up to (nights)', hint: 'A free gap of 1 to 7 nights between two bookings. The minimum stay is waived for it.' },
};
const pctWords = (p) => (Number(p) < 0 ? `${Math.abs(p)}% off` : `${p}% more`);
export function ruleSummary(r) {
  const n = Number(r.days);
  if (r.kind === 'last_minute') return `Stays starting within ${n} day${n === 1 ? '' : 's'}: ${pctWords(r.adjust_pct)}`;
  if (r.kind === 'far_out') return `Stays starting more than ${n} days away: ${pctWords(r.adjust_pct)}`;
  return `Gaps of up to ${n} night${n === 1 ? '' : 's'} between bookings: ${pctWords(r.adjust_pct)}`;
}
const KIND_LABEL = { custom: 'Custom price', holiday: 'Holiday', season: 'Season', weekend: 'Weekend', base: 'Base rate' };
const pctNum = (v) => (v === '' || v === undefined || v === null ? v : Number(v));

export async function pricingView(el, { rerender }) {
  const { listings, seasons, holidays, rules } = await get('/pricing');
  const canManage = ['owner', 'manager'].includes(state.user.role);
  const isOwner = state.user.role === 'owner';

  const addSeason = () => modeSync(formModal({
    title: 'Add a season', submitText: 'Save season',
    fields: [
      field({ name: 'name', label: 'Name', required: true, maxlength: 80, placeholder: 'e.g. Summer peak, Holy Week, Sinulog' }),
      field({ name: 'unit_id', label: 'Listing', type: 'select', required: !isOwner, placeholderOption: false,
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
    onSubmit: async (d) => {
      const { price_mode: mode, ...body } = d;
      if (mode !== 'fixed') body.nightly_rate = '';
      if (mode !== 'pct') body.adjust_pct = '';
      else body.adjust_pct = pctNum(body.adjust_pct);
      if (body.adjust_pct === '') delete body.adjust_pct;
      await post('/pricing/seasons', body); toast('Season saved.'); rerender();
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

  const editRule = (r) => {
    const kindSel = field({ name: 'kind', label: 'Rule', type: 'select', required: true, value: r?.kind || 'last_minute', placeholderOption: false,
      options: Object.entries(RULE_KINDS).map(([k, v]) => [k, v.label]) });
    const daysHint = h('p', { class: 'muted small', 'aria-live': 'polite' });
    const daysField = field({ name: 'days', label: 'Days', type: 'number', required: true, value: r?.days ?? 3, step: 1, inputmode: 'numeric' });
    const scopeField = field({ name: 'unit_id', label: 'Applies to', type: 'select', required: !isOwner, value: r?.unit_id || '', placeholderOption: false,
      options: [...(isOwner ? [['', 'All listings']] : []), ...listings.map((l) => [l.unit_id, `${l.unit_name} · ${l.property_name}`])] });
    const m = formModal({
      title: r ? 'Edit pricing rule' : 'Add a pricing rule', submitText: 'Save rule',
      fields: [kindSel, daysField, daysHint,
        field({ name: 'adjust_pct', label: 'Price change (%)', type: 'number', required: true, min: -90, max: 300, step: 1, value: r?.adjust_pct, inputmode: 'numeric',
          hint: 'Use a minus for a discount, e.g. -15 for 15% off. From -90 to 300.' }),
        scopeField,
        h('p', { class: 'muted small' }, 'A rule for one listing replaces the all-listings rule of the same kind. Prices you set by hand on the calendar are never changed.')],
      onSubmit: async (d) => {
        const body = { kind: d.kind, days: Number(d.days), adjust_pct: Number(d.adjust_pct), unit_id: d.unit_id || null };
        if (r) await patch(`/pricing/rules/${r.rule_id}`, { days: body.days, adjust_pct: body.adjust_pct });
        else {
          const dup = rules.find((x) => x.kind === body.kind && (x.unit_id || null) === body.unit_id);
          if (dup) await patch(`/pricing/rules/${dup.rule_id}`, { days: body.days, adjust_pct: body.adjust_pct, active: true });
          else {
            try { await post('/pricing/rules', body); } catch (err) {
              if (err.status !== 409 || err.code !== 'DUPLICATE') throw err;
              // Someone added the same rule meanwhile: change that one instead.
              const fresh = (await get('/pricing')).rules.find((x) => x.kind === body.kind && (x.unit_id || null) === body.unit_id);
              if (!fresh) throw err;
              await patch(`/pricing/rules/${fresh.rule_id}`, { days: body.days, adjust_pct: body.adjust_pct, active: true });
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
    if (r) { form.elements.kind.disabled = true; form.elements.unit_id.disabled = true; }
    form.elements.kind.addEventListener('change', syncKind); syncKind();
  };
  const removeRule = async (r) => {
    if (!await confirmDialog({ title: 'Remove this rule?', text: `${ruleSummary(r)}. New quotes go back to the usual prices. Existing reservations don't change.`, confirmText: 'Remove rule' })) return;
    try { await post(`/pricing/rules/${r.rule_id}/remove`); toast('Rule removed.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };
  const canEditRule = (r) => canManage && (r.unit_id || isOwner);

  const ruleRows = listings.map((l) => h('tr', null,
    h('td', null, h('a', { href: `#/listings?focus=${l.unit_id}` }, l.unit_name), h('div', { class: 'muted small' }, l.property_name)),
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
      h('div', { class: 'card__head' }, h('h2', null, 'How a night is priced')),
      h('ol', { class: 'pricing-order' },
        h('li', null, h('strong', null, 'A price you set on the calendar'), ' for that exact night'),
        h('li', null, h('strong', null, 'Holiday rate'), ' on the nights before and during PH holiday long weekends'),
        h('li', null, h('strong', null, 'Season'), ' (a fixed nightly price, or a % change on the price the night would have had; a season for one listing beats one for all listings)'),
        h('li', null, h('strong', null, 'Weekend rate'), ' on Friday and Saturday nights'),
        h('li', null, h('strong', null, 'Base nightly rate'))),
      h('p', { class: 'muted small' }, 'Then the booking-window rules apply, the price never goes below a listing\'s lowest price, and the 14+, weekly (7+) or monthly (28+) night discount comes off the stay. These rules price new quotes, new reservations and your booking page; existing reservations keep their price. Channel prices (Airbnb, Booking.com…) are set on each channel.')),
    h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, 'Booking-window rules'),
        canManage && h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => editRule() }, '+ Add rule')),
      h('p', { class: 'muted small' }, 'Change the price automatically for last-minute stays, stays far in the future, and short gaps between bookings. They work on top of the rates and seasons below.'),
      rules.length ? h('ul', { class: 'list pr-rules' }, rules.map((r) => h('li', null, h('div', { class: 'row' },
        h('div', { class: 'row__main' },
          h('span', { class: 'row__title' }, ruleSummary(r)),
          h('span', { class: 'row__sub' }, `${RULE_KINDS[r.kind]?.label || r.kind} · ${r.unit_name || 'All listings'}${!r.active ? ' · off' : ''}`)),
        canEditRule(r) && h('div', { class: 'row__end' }, h('div', { class: 'chips' },
          h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => editRule(r) }, 'Edit'),
          h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => removeRule(r) }, 'Remove')))))))
        : h('p', { class: 'muted' }, 'No rules yet. For example: 15% off stays starting within 3 days, or 10% off bookings more than 200 days away.')),
    h('div', { class: 'card card--flush' },
      h('div', { class: 'card__head', style: { padding: '16px 16px 0' } }, h('h2', null, 'Listing rates')),
      listings.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['Listing', 'Base', 'Weekend', 'Holiday', 'Discounts', 'Min. nights'].map((t) => h('th', null, t)))),
        h('tbody', null, ruleRows)))
        : emptyState({ iconName: 'building', title: 'No listings yet', text: 'Add a listing with a nightly rate first.' }),
      h('p', { class: 'muted small', style: { padding: '0 16px 12px' } }, 'Change these in Listings → Edit → Pricing helpers.')),
    h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, 'Seasons')),
      seasons.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, ['Season', 'Nights', 'Listing', 'Price', 'Min. nights', ''].map((t) => h('th', null, t)))),
        h('tbody', null, seasons.map((s) => h('tr', null,
          h('td', null, s.name),
          h('td', null, `${fmtDate(s.start_date)} – ${fmtDate(s.end_date)}`),
          h('td', null, s.unit_name || 'All listings'),
          h('td', null, s.nightly_rate ? peso(s.nightly_rate) : (s.adjust_pct === null ? '—' : `${s.adjust_pct > 0 ? '+' : ''}${s.adjust_pct}%`)),
          h('td', null, s.min_nights ? String(s.min_nights) : '—'),
          h('td', null, canManage && (s.unit_id || isOwner) && h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => remove(s) }, 'Remove')))))))
        : h('p', { class: 'muted' }, 'No seasons yet. Add one for peak months (e.g. March to May), local fiestas, or a minimum stay over Holy Week and Christmas.')),
    previewCard(listings),
    h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, 'Philippine holidays (next 12 months)')),
      h('p', { class: 'muted small' }, 'Holiday rates use these dates. Some dates (Chinese New Year, Eid) are set each year by proclamation and may move; set a price on the calendar for any night that needs it.'),
      h('ul', { class: 'holiday-list' }, holidays.map((x) => h('li', null, h('span', null, x.name), h('span', { class: 'muted' }, fmtDate(x.date)))))));
}


// ---------------------------------------------------------------- price preview
function previewCard(listings) {
  const out = h('div', { 'aria-live': 'polite' });
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
        applied.length ? h('ul', { class: 'small' }, applied.map((a) => h('li', null, `${a.label}${a.adjust_pct !== null ? ` (${Number(a.adjust_pct) > 0 ? '+' : ''}${a.adjust_pct}%)` : ''}`)))
          : h('p', { class: 'muted small' }, 'No booking-window rules applied.'));
    };
    const lead = nights.length ? (new Date(`${nights[0].date}T00:00:00Z`).getUTCDay()) : 0;
    const cells = [...Array(lead)].map(() => h('div', { class: 'pr-blank', 'aria-hidden': 'true' }));
    for (const n of nights) {
      const kind = KIND_LABEL[n.kind] ? n.kind : 'base';
      const day = new Date(`${n.date}T00:00:00Z`).getUTCDate();
      const mon = new Date(`${n.date}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'short', timeZone: 'UTC' });
      const b = h('button', { type: 'button', class: `pr-night pr-night--${n.booked ? 'booked' : kind}`, 'aria-pressed': 'false',
        'aria-label': `${fmtDate(n.date)}, ${peso(n.price)}, ${n.booked ? 'booked, ' : ''}${KIND_LABEL[kind]}${(n.applied || []).length ? ', rules applied' : ''}` },
        h('span', { class: 'pr-night__d' }, day === 1 || n === nights[0] ? `${mon} ${day}` : String(day), (n.applied || []).length ? h('span', { class: 'pr-i', 'aria-hidden': 'true' }, 'i') : null),
        h('span', { class: 'pr-night__p' }, peso(n.price)),
        h('span', { class: 'pr-night__k' }, n.booked ? 'Booked' : KIND_LABEL[kind]));
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
    h('p', { class: 'muted small' }, 'The next 60 nights as guests would be quoted them. Select a night to see why.'),
    h('div', { class: 'form-row form-row--2 pr-controls' },
      h('div', { class: 'field' }, h('label', { for: 'pr-unit' }, 'Listing'), sel),
      h('div', { class: 'field' }, h('label', { for: 'pr-from' }, 'Starting'), from)),
    out);
}

// ---------------------------------------------------------------- bulk changes
const BULK_ACTIONS = [['set', 'Set a price'], ['percent', 'Change prices by %'], ['clear', 'Clear custom prices'], ['block', 'Block dates'], ['unblock', 'Unblock dates']];

async function bulkModal({ listings, rerender }) {
  let tags = [];
  try { tags = (await get('/tags')).tags || []; } catch { /* tag picking is optional */ }
  const checks = listings.map((l) => h('label', { class: 'check pr-pick' }, h('input', { type: 'checkbox', name: 'unit', value: l.unit_id }), h('span', null, `${l.unit_name} · ${l.property_name}`)));
  const tagSel = h('select', { class: 'input', name: 'tag', 'aria-label': 'Tag' }, h('option', { value: '' }, 'Choose a tag'), tags.map((t) => h('option', { value: t.tag }, `${t.tag} (${t.count})`)));
  const byRadio = (v, text, on) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'by', value: v, checked: on }), h('span', null, text));
  const listBox = h('div', { class: 'pr-picklist' }, checks);
  const tagBox = h('div', { class: 'field', hidden: true }, tagSel);
  const actSel = h('select', { class: 'input', name: 'action', id: 'bk-action' }, BULK_ACTIONS.map(([v, t]) => h('option', { value: v }, t)));
  const price = h('input', { class: 'input', name: 'price', id: 'bk-price', inputmode: 'decimal', placeholder: '2,500' });
  const pct = h('input', { class: 'input', name: 'percent', id: 'bk-pct', type: 'number', min: -90, max: 300, step: 1, placeholder: '-10' });
  const reason = h('input', { class: 'input', name: 'reason', id: 'bk-reason', maxlength: 200, placeholder: 'e.g. Repairs, family stay' });
  const from = h('input', { class: 'input', type: 'date', name: 'from', id: 'bk-from', value: todayManila() });
  const to = h('input', { class: 'input', type: 'date', name: 'to', id: 'bk-to', value: addDays(todayManila(), 30) });
  const wrap = (id, label, input, hint, extra) => h('div', { class: 'field', hidden: extra?.hidden }, h('label', { for: id }, label), input, hint && h('p', { class: 'muted small' }, hint));
  const priceF = wrap('bk-price', 'New price per night', price);
  const pctF = wrap('bk-pct', 'Change (%)', pct, 'Use a minus for a discount, e.g. -10. Works from each night\'s current price.', { hidden: true });
  const reasonF = wrap('bk-reason', 'Reason for the block', reason, 'Required. Kept in the audit log.', { hidden: true });
  const err = h('div', { role: 'alert' });
  const result = h('div', { 'aria-live': 'polite' });
  const previewBtn = h('button', { class: 'btn btn--secondary', type: 'submit' }, 'Preview');
  const applyBtn = h('button', { class: 'btn btn--primary', type: 'button', disabled: true }, 'Apply');
  const form = h('form', { class: 'form', novalidate: true },
    err,
    h('fieldset', { class: 'pr-fieldset' }, h('legend', null, 'Listings'),
      h('div', { class: 'chips' }, byRadio('pick', 'Pick listings', true), tags.length ? byRadio('tag', 'By tag', false) : null),
      listBox, tagBox),
    h('div', { class: 'form-row form-row--2' }, wrap('bk-from', 'First night', from), wrap('bk-to', 'Last night', to)),
    h('div', { class: 'field' }, h('label', { for: 'bk-action' }, 'What to do'), actSel),
    priceF, pctF, reasonF,
    h('div', { class: 'form-actions' }, previewBtn, applyBtn),
    result);

  const isBlocks = () => ['block', 'unblock'].includes(actSel.value);
  const body = (dry) => {
    const b = { from: from.value, to: to.value, action: actSel.value, dry_run: dry };
    if (form.elements.by.value === 'tag') b.tag = tagSel.value; else b.unit_ids = [...form.querySelectorAll('input[name=unit]:checked')].map((c) => c.value);
    if (b.action === 'set') b.price = price.value.replace(/,/g, '').trim();
    if (b.action === 'percent') b.percent = Number(pct.value);
    if (b.action === 'block') b.reason = reason.value.trim();
    return b;
  };
  const check = () => {
    const b = body(true);
    if (b.tag === '' || (b.unit_ids && !b.unit_ids.length)) return 'Choose at least one listing or a tag.';
    if (!b.from || !b.to) return 'Choose the first and last night.';
    if (b.to < b.from) return 'The last night must be on or after the first night.';
    if (b.action === 'set' && !/^\d+(\.\d{1,2})?$/.test(b.price)) return 'Enter the new price per night.';
    if (b.action === 'percent' && (pct.value === '' || !Number.isFinite(b.percent))) return 'Enter a percentage between -90 and 300.';
    if (b.action === 'block' && !b.reason) return 'Add a reason for the block.';
    return '';
  };
  const stale = () => { applyBtn.disabled = true; result.replaceChildren(); };
  const sync = () => {
    priceF.hidden = actSel.value !== 'set'; pctF.hidden = actSel.value !== 'percent'; reasonF.hidden = actSel.value !== 'block';
    const tagMode = form.elements.by.value === 'tag';
    listBox.hidden = tagMode; tagBox.hidden = !tagMode;
    stale();
  };
  form.addEventListener('change', sync);
  form.addEventListener('input', stale);
  const m = openModal({ title: 'Bulk changes', body: form, wide: true });

  const skipped = (list) => list?.length ? h('div', { class: 'alert alert--warn' }, h('strong', null, `Skipped (${list.length})`),
    h('ul', { class: 'small' }, list.map((s) => h('li', null, `${s.unit_name}: ${s.reason}`)))) : null;
  const run = async (dry) => {
    err.replaceChildren();
    const problem = check();
    if (problem) { err.replaceChildren(h('div', { class: 'alert alert--error' }, problem)); return null; }
    try { return await post(isBlocks() ? '/bulk/blocks' : '/bulk/prices', body(dry)); }
    catch (e) { err.replaceChildren(h('div', { class: 'alert alert--error' }, e.fields ? Object.values(e.fields).join(' ') : e.message)); return null; }
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    previewBtn.disabled = true; previewBtn.textContent = 'Checking…';
    const r = await run(true);
    previewBtn.disabled = false; previewBtn.textContent = 'Preview';
    if (!r) return;
    let total;
    if (isBlocks()) {
      const rows = r.created || r.cancelled || [];
      total = r.count;
      result.replaceChildren(
        h('p', null, h('strong', null, `${total} ${actSel.value === 'block' ? 'block' : 'manual block'}${total === 1 ? '' : 's'} would be ${actSel.value === 'block' ? 'created' : 'cancelled'}.`)),
        rows.length ? tableOf(['Listing', 'From', 'To'], rows.map((x) => [x.unit_name, fmtDate(x.check_in), fmtDate(x.check_out)])) : null,
        skipped(r.skipped));
    } else {
      const rows = r.changes;
      total = r.count;
      result.replaceChildren(
        h('p', null, h('strong', null, `${total} night${total === 1 ? '' : 's'} would change.`), total > rows.length ? ` Showing the first ${rows.length}.` : ''),
        rows.length ? tableOf(['Listing', 'Night', 'Now', 'New'], rows.map((x) => [x.unit_name, fmtDate(x.date), x.from_price === null ? '—' : peso(x.from_price), x.to_price === null ? 'Usual price' : peso(x.to_price)])) : null,
        skipped(r.skipped));
    }
    applyBtn.disabled = total === 0;
    if (total === 0) result.append(h('p', { class: 'muted small' }, 'Nothing to change for these choices.'));
  });
  applyBtn.addEventListener('click', async () => {
    applyBtn.disabled = true; applyBtn.textContent = 'Applying…';
    const r = await run(false);
    applyBtn.textContent = 'Apply';
    if (!r) { applyBtn.disabled = false; return; }
    const n = r.count;
    const sk = (r.skipped || []).length;
    toast(`${n} ${isBlocks() ? 'block' : 'night'}${n === 1 ? '' : 's'} ${actSel.value === 'unblock' ? 'cancelled' : actSel.value === 'block' ? 'created' : 'updated'}${sk ? `, ${sk} skipped` : ''}.`);
    m.close(); rerender();
  });
}

function tableOf(head, rows) {
  return h('div', { class: 'table-wrap pr-table' }, h('table', { class: 'table' },
    h('thead', null, h('tr', null, head.map((t) => h('th', null, t)))),
    h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', null, c)))))));
}
