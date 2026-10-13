// Security deposit card on a reservation, and the Home reminder for deposits to return.

import { get, post, uploadFile, qs } from '../api.js';
import { h, peso, fmtDate, fmtDateTime, field, formModal, confirmDialog, toast, badge, todayManila, emptyState } from '../ui.js';
import { initFilters, filterBar, changed } from '../filters.js';
import { state } from '../app.js';

const METHODS = [['cash', 'Cash'], ['gcash', 'GCash'], ['maya', 'Maya'], ['bank_transfer', 'Bank transfer'], ['card', 'Card'], ['other', 'Other']];
const label = (m) => METHODS.find(([k]) => k === m)?.[1] || m;
const STATUS = { held: ['partial', 'Held'], refunded: ['paid', 'Returned'], partly_refunded: ['paid', 'Partly returned'], kept: ['overdue', 'Kept'] };

export async function depositCard(r, rerender) {
  let d;
  try { d = await get(`/reservations/${r.booking_id}/deposit`); } catch { return null; }
  const dep = d.deposit;
  const isManager = state.user.role !== 'staff';
  const sent = (res, what) => toast(res.receipt ? (res.receipt.sent ? `${what} Email sent to ${res.receipt.to}.` : `${what} Email not sent: ${res.receipt.error}`) : what);

  const record = () => formModal({
    title: 'Security deposit received', submitText: 'Save',
    fields: [
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'amount', label: 'Amount', type: 'money', required: true, value: d.suggested || '' }),
        field({ name: 'received_date', label: 'Date received', type: 'date', required: true, value: todayManila() })),
      h('div', { class: 'form-row form-row--2' },
        field({ name: 'method', label: 'Method', type: 'select', required: true, value: 'cash', placeholderOption: false, options: METHODS }),
        field({ name: 'reference_number', label: 'Reference (optional)', maxlength: 100 })),
      r.guest_email && field({ name: 'send_receipt', label: `Email an acknowledgement to ${r.guest_email}`, type: 'checkbox', value: true }),
    ],
    onSubmit: async (v) => { sent(await post(`/reservations/${r.booking_id}/deposit`, v), 'Deposit recorded.'); rerender(); },
  });

  const settle = () => {
    const dedInput = field({ name: 'deduction_amount', label: 'Deduction for damage / missing items', type: 'money', value: '0', hint: `Deposit: ${peso(dep.amount)}. Leave 0 to return it all.` });
    const refundLine = h('p', { class: 'small' });
    const update = () => {
      const ded = Math.min(Number(dedInput.querySelector('input').value.replace(/,/g, '')) || 0, Number(dep.amount));
      refundLine.textContent = `Return to guest: ${peso(Number(dep.amount) - ded)}`;
    };
    dedInput.querySelector('input').addEventListener('input', update);
    update();
    formModal({
      title: 'Return the deposit', submitText: 'Save',
      fields: [
        dedInput,
        field({ name: 'deduction_reason', label: 'Reason (the guest sees this)', type: 'textarea', maxlength: 1000, placeholder: 'e.g. Broken drinking glass (₱150) and late check-out (₱300).' }),
        refundLine,
        h('div', { class: 'form-row form-row--2' },
          field({ name: 'refund_method', label: 'Returned by', type: 'select', value: dep.method === 'card' ? 'bank_transfer' : dep.method, placeholderOption: false, options: METHODS }),
          field({ name: 'refund_reference', label: 'Reference (optional)', maxlength: 100 })),
        h('p', { class: 'muted small' }, 'Damage photos: use "Add photo" on the deposit card (before or after saving).'),
        r.guest_email && field({ name: 'send_receipt', label: `Email the summary to ${r.guest_email}`, type: 'checkbox', value: true }),
      ],
      onSubmit: async (v) => { sent(await post(`/reservations/${r.booking_id}/deposit/settle`, v), 'Deposit settled.'); rerender(); },
    });
  };
  const reopen = async () => {
    if (!await confirmDialog({ title: 'Undo the return?', text: 'The deposit goes back to "Held" so you can record the return again. Emails already sent are not recalled.', confirmText: 'Undo' })) return;
    try { await post(`/reservations/${r.booking_id}/deposit/reopen`); toast('Back to held.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };
  const upload = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', class: 'input', 'aria-label': 'Damage photo' });

  if (!dep) {
    if (r.status !== 'confirmed') return null;
    return h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, 'Security deposit'), badge('voided', 'None')),
      h('p', { class: 'muted small' }, 'Took a refundable deposit (e.g. ₱1,000)? Record it so you remember to return it after check-out.'),
      h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: record }, 'Record deposit'));
  }
  const [cls, text] = STATUS[dep.status];
  const due = dep.status === 'held' && (r.check_out <= todayManila() || Boolean(r.checked_out_at));
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Security deposit'), badge(due ? 'overdue' : cls, due ? 'To return' : text)),
    h('dl', { class: 'dl' },
      h('dt', null, 'Received'), h('dd', null, `${peso(dep.amount)} · ${label(dep.method)} · ${fmtDate(dep.received_date)}${dep.reference_number ? ` · ref. ${dep.reference_number}` : ''}`),
      Number(dep.deduction_amount) > 0 && [h('dt', null, 'Deducted'), h('dd', null, peso(dep.deduction_amount), h('div', { class: 'muted small', style: { whiteSpace: 'pre-wrap' } }, dep.deduction_reason))],
      dep.refund_amount !== null && [h('dt', null, 'Returned'), h('dd', null, `${peso(dep.refund_amount)}${Number(dep.refund_amount) > 0 ? ` · ${label(dep.refund_method)}${dep.refund_reference ? ` · ref. ${dep.refund_reference}` : ''}` : ''}`, h('div', { class: 'muted small' }, fmtDateTime(dep.settled_at)))]),
    dep.files.length > 0 && h('div', { class: 'gc__ids' }, dep.files.map((f) => h('a', { href: `/api/files/${f.file_id}`, target: '_blank', rel: 'noopener' }, h('img', { src: `/api/files/${f.file_id}`, alt: f.file_name, loading: 'lazy' })))),
    h('div', { class: 'chips', style: { marginTop: '12px' } },
      dep.status === 'held' && isManager && h('button', { class: `btn ${due ? 'btn--primary' : 'btn--secondary'} btn--sm`, type: 'button', onclick: settle }, 'Return deposit'),
      dep.status !== 'held' && state.user.role === 'owner' && h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: reopen }, 'Undo')),
    h('div', { class: 'form', style: { marginTop: '10px' } },
      h('label', { class: 'small muted' }, 'Damage / condition photos'), upload,
      h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: async (e) => {
        if (!upload.files[0]) { toast('Choose a photo first.', 'error'); return; }
        e.target.disabled = true;
        try { await uploadFile('deposit', dep.deposit_id, upload.files[0]); toast('Photo added.'); rerender(); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
      } }, 'Add photo')));
}

// Home: deposits still held after check-out.
export async function depositsDueCard() {
  let d;
  try { d = await get('/deposits/due'); } catch { return null; }
  if (!d.deposits.length) return null;
  const total = d.deposits.reduce((s, x) => s + Number(x.amount), 0);
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Deposits to return'), h('span', { class: 'muted small' }, peso(total),
      state.user.role !== 'staff' && [' · ', h('a', { href: '#/stay-reports?tab=deposits&status=due' }, 'See all')])),
    h('ul', { class: 'list' }, d.deposits.map((x) => h('li', null, h('a', { class: 'row', href: `#/reservations/${x.booking_id}` },
      h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, x.guest_name || 'Guest'), h('span', { class: 'row__sub' }, `${x.unit_name} · checked out ${fmtDate(x.check_out)}`)),
      h('div', { class: 'row__end' }, h('span', { class: 'amount' }, peso(x.amount))))))));
}

// Reports → Deposits: every deposit with filters. Owners and managers.
// `onUrl(q)` is called with the changed filters so the page can update its URL.
export async function depositsPanel({ query = {}, onUrl }) {
  const defaults = { q: '', status: '', property_id: '', unit_id: '', method: '', from: '', to: '', deducted: '', sort: '' };
  const filters = initFilters('deposits', query, defaults);
  const { listings } = await get('/listings');
  const properties = [...new Map(listings.map((l) => [l.property_id, l.property_name])).entries()];
  const listBox = h('div', { class: 'card card--flush' });

  async function load() {
    onUrl?.(changed(filters, defaults));
    const { deposits } = await get(`/deposits${qs(changed(filters, defaults))}`);
    const filtered = Object.keys(changed(filters, defaults)).some((k) => k !== 'sort');
    if (!deposits.length) {
      listBox.replaceChildren(emptyState({
        iconName: 'file',
        title: filtered ? 'No results found' : 'No deposits yet',
        text: filtered ? 'No deposit matches these filters. Try removing a filter.' : 'Record a security deposit on a reservation and it shows up here until you return it.',
      }));
      return;
    }
    const sum = (list, k) => list.reduce((s, x) => s + Number(x[k] || 0), 0);
    const held = deposits.filter((x) => x.status === 'held');
    listBox.replaceChildren(
      h('p', { class: 'muted small', style: { padding: '12px 16px 0' } },
        `${deposits.length} deposit${deposits.length === 1 ? '' : 's'} · ${peso(sum(deposits, 'amount'))} received · ${peso(sum(held, 'amount'))} still held · ${peso(sum(deposits, 'deduction_amount'))} deducted`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table table--compact' },
        h('thead', null, h('tr', null, ['Guest', 'Listing', 'Stay', 'Received', 'Status'].map((x) => h('th', null, x)), h('th', { class: 'num' }, 'Amount'), h('th', { class: 'num' }, 'Returned'))),
        h('tbody', null, deposits.map((x) => {
          const [cls, text] = STATUS[x.status];
          return h('tr', null,
            h('td', null, h('a', { href: `#/reservations/${x.booking_id}` }, x.guest_name || 'Guest'), h('div', { class: 'muted small' }, x.confirmation_code)),
            h('td', null, x.unit_name, properties.length > 1 && h('div', { class: 'muted small' }, x.property_name)),
            h('td', { class: 'small' }, `${fmtDate(x.check_in)} – ${fmtDate(x.check_out)}`),
            h('td', { class: 'small' }, fmtDate(x.received_date), h('div', { class: 'muted small' }, label(x.method))),
            h('td', null, x.due ? badge('overdue', 'To return') : badge(cls, text)),
            h('td', { class: 'num' }, peso(x.amount)),
            h('td', { class: 'num' }, x.refund_amount === null ? '—' : peso(x.refund_amount)));
        })))));
  }
  const bar = filterBar({
    key: 'deposits', values: filters, defaults, onChange: load,
    search: { placeholder: 'Search guest or booking code' },
    quick: [
      { name: 'status', label: 'Status', all: 'All deposits', options: [['due', 'Due to return'], ['held', 'Held'], ['settled', 'Settled (any)'], ['refunded', 'Returned in full'], ['partly_refunded', 'Partly returned'], ['kept', 'Kept']] },
      listings.length > 1 && { name: 'unit_id', label: 'Listing', all: 'All listings', options: listings.map((l) => [l.unit_id, `${l.unit_name}${properties.length > 1 ? ` · ${l.property_name}` : ''}`]) },
    ].filter(Boolean),
    more: [
      properties.length > 1 && { name: 'property_id', label: 'Property', all: 'All properties', options: properties },
      { name: 'date', keys: ['from', 'to'], label: 'Received between', type: 'daterange' },
      { name: 'method', label: 'Received by', all: 'Any method', options: METHODS },
      { name: 'deducted', label: 'With a deduction', type: 'check' },
      { name: 'sort', label: 'Sort by', all: 'Newest received first', options: [['received_asc', 'Oldest received first'], ['checkout', 'Latest check-out'], ['amount', 'Biggest amount']] },
    ].filter(Boolean),
  });
  await load();
  return h('div', null, bar, listBox);
}
