// Cleaner pay: owners and managers see what each cleaner earned in a month, tick the unpaid cleans and
// mark them paid; owners also set rates. `myPayView` is the cleaner's own phone-first list.

import { get, post, patch, api, qs, ApiError } from '../api.js';
import { h, peso, manilaDay, fmtDate, fmtMonth, field, formModal, makeForm, openModal, confirmDialog, emptyState, pageHead, toast, todayManila, options, label, errorState, skeleton } from '../ui.js';
import { state } from '../app.js';
import { initFilters, filterBar, rememberFilters, changed } from '../filters.js';
import { t, initGuestLang, extendTranslations, fmtDateL } from '../i18n.js';

const METHODS = ['cash', 'gcash', 'maya', 'bank_transfer'];
const cents = (v) => Math.round(Number(v || 0) * 100);
const fromCents = (c) => c / 100;
const monthOk = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m || '');
const whoOf = (x) => x.cleaner_name || 'Not assigned';
const unitOf = (x) => `${x.unit_name || 'Unit'}${x.property_name ? ` · ${x.property_name}` : ''}`;
const doneDay = (x) => manilaDay(x.completed_at || x.cleaning_date || x.due_date);
// The rate a new one would replace: the same team member, or the same outside name (trimmed, any case).
// Mirrors the server's keys in PUT /cleaner-rates.
const norm = (s) => String(s || '').trim().toLowerCase();
export const existingRate = (rates, body) => rates.find((r) => (body.user_id
  ? r.user_id === body.user_id
  : !r.user_id && norm(body.assignee_name) && norm(r.assignee_name) === norm(body.assignee_name)));

// A typed rate amount as the server reads it ("1,000", "₱1,250.50"), or NaN when it can't be read.
export const readRate = (text) => {
  const plain = String(text).replace(/[₱\s]/g, '').replace(/^PHP/i, '');
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(plain)) return NaN;
  return Number(plain.replace(/,/g, ''));
};

// The most a rate can be, with the words for it: the same ceilings as PUT /cleaner-rates (D-87).
const RATE_CEILING = {
  per_clean: { cents: 1000000, text: '₱10,000.00 per clean' },
  per_hour: { cents: 100000, text: '₱1,000.00 per hour' },
};

// The server's sentence for a typed rate above its ceiling, or null. An amount that cannot be read is left to the server.
export const rateCeilingProblem = (rateType, text) => {
  const amount = readRate(text);
  const ceiling = RATE_CEILING[rateType];
  if (!ceiling || !Number.isFinite(amount) || Math.round(amount * 100) <= ceiling.cents) return null;
  return `That's more than ${ceiling.text}. Check for an extra zero.`;
};

export const rateText = (r) => `${peso(r.amount)} ${r.rate_type === 'per_hour' ? 'per hour' : 'per clean'}`;

// The rate a person is adding again is the same basis and amount: nothing would change, so nothing is asked or sent (#42).
export const sameRate = (prior, rateType, amount) => !!prior && prior.rate_type === rateType && Number(prior.amount) === amount;

// What the Pay column says when a clean has no amount yet: the owner's own clean, a name with no rate, or a clean still to price.
const SELF_PAY = 'Done by you, no pay';
// Managers can't see or add rates (owner-only routes), so they are told to ask the owner.
const noPayText = (x, owner) => (x.pay_status === 'self' ? SELF_PAY : x.no_rate ? (owner ? 'No rate for this name. Add a rate or pick the team member.' : 'No rate for this name. Ask the owner to add a rate.') : 'Pay not set. Use Set pay.');

// One cleaner's status in the By cleaner card. A clean with no pay set is never "All paid"; a group of only the owner's own cleans owes nothing and says so.
export const cleanerStatus = (c) => {
  const parts = [];
  if (cents(c.unpaid)) parts.push(`${peso(c.unpaid)} to pay`);
  if (c.unpriced) parts.push(`${c.unpriced} with pay not set`);
  return parts.join(' · ') || (c.self && c.self === c.count ? SELF_PAY : 'All paid');
};

// The ticks that still count after a filter change: a ticked clean the filter hides is dropped, so the count,
// the total and Mark paid only ever cover rows on screen.
// The count beside "Select all unpaid" counts unpaid cleans only; paid ones in the list do not make it read "3 cleans".
export const unpaidCount = (n) => (n ? `${n} unpaid` : 'Nothing unpaid');
export const visibleSelection = (selected, rows) => new Set(rows.filter((x) => selected.has(x.task_id)).map((x) => x.task_id));

// The Pay card and the empty list say "this month" for the current month, and name any other month (#41).
export const monthWords = (month, today = todayManila()) => (month === today.slice(0, 7)
  ? { paid: 'Paid this month', empty: 'No finished cleans this month' }
  : { paid: `Paid in ${fmtMonth(month)}`, empty: `No finished cleans in ${fmtMonth(month)}` });

function stat(lbl, value, sub, cls = '') {
  return h('div', { class: `stat stat--flat ${cls}` }, h('div', { class: 'stat__value' }, value), h('div', { class: 'stat__label' }, lbl), sub && h('div', { class: 'muted small' }, sub));
}

// ---------------------------------------------------------------- owners and managers
export async function cleanerPayView(el, { query = {} } = {}) {
  const defaults = { month: '', cleaner: '', status: '' };
  const filters = initFilters('cleaner-pay', query, defaults);
  const thisMonth = todayManila().slice(0, 7);
  const isOwner = state.user.role === 'owner';
  const box = h('div', null, skeleton(3)); // a whole table is never a live region; Mark paid is said by its toast (D-114)
  const ratesBox = h('div');
  const barBox = h('div');
  const selected = new Set();
  let data = { tasks: [] };
  // null until the first load: the bar keeps an unknown cleaner value until the names are known, even when there are none.
  let cleanerOpts = null;

  const month = () => (monthOk(filters.month) ? filters.month : thisMonth);

  async function load() {
    selected.clear();
    try { data = await get(`/cleaner-pay${qs({ month: month() })}`); } catch (err) {
      box.replaceChildren(errorState(err, () => load()));
      return;
    }
    data.tasks = data.tasks || [];
    const opts = (data.cleaners || []).map((c) => [c.key, c.name || 'Not assigned']);
    if (JSON.stringify(opts) !== JSON.stringify(cleanerOpts)) { cleanerOpts = opts; renderBar(); }
    // Written after the bar has dropped any cleaner the list does not have, so the address never keeps it (K13).
    history.replaceState(null, '', `#/cleaner-pay${qs(changed(filters, defaults))}`);
    paint();
  }

  const shown = () => data.tasks.filter((x) => (!filters.cleaner || x.cleaner_key === filters.cleaner) && (!filters.status || x.pay_status === filters.status));
  // The ticked clean rows on screen. Mark paid pays only these.
  const ticked = () => shown().filter((x) => selected.has(x.task_id));

  function markPaid() {
    const rows = ticked();
    if (!rows.length) return;
    const total = rows.reduce((s, x) => s + cents(x.pay_amount), 0);
    formModal({
      title: `Mark ${rows.length} clean${rows.length === 1 ? '' : 's'} paid`, submitText: `Mark ${peso(fromCents(total))} paid`, idempotent: true,
      fields: [
        h('p', { class: 'muted small' }, `${[...new Set(rows.map(whoOf))].join(', ')} · ${peso(fromCents(total))} in total`),
        h('div', { class: 'form-row form-row--2' },
          field({ name: 'paid_on', label: 'Date paid', type: 'date', required: true, value: todayManila(), max: todayManila() }),
          field({ name: 'method', label: 'How you paid', type: 'select', placeholderOption: 'Choose…', options: options(METHODS) })),
        field({ name: 'reference', label: 'Reference (optional)', placeholder: 'GCash or bank reference number', maxlength: 100 }),
        field({ name: 'record_expense', label: 'Also record as cleaning expenses', type: 'checkbox', value: false }),
        h('p', { class: 'hint' }, 'Adds one cleaning expense per unit, so it shows on profit and loss and owner statements.'),
      ],
      // No default method: a one-tap save must never record cash by accident (D-92 O4).
      check: (d) => (!d.method ? { method: 'Choose how you paid the cleaner.' } : null),
      onSubmit: async (d, { idempotencyKey }) => {
        await post('/cleaner-pay/mark-paid', { task_ids: rows.map((x) => x.task_id), paid_on: d.paid_on, method: d.method, reference: d.reference || undefined, record_expense: !!d.record_expense }, { idempotencyKey });
        toast('Marked as paid.');
        load();
      },
    });
  }

  const editPay = (x) => formModal({
    title: 'Change pay for this clean', submitText: 'Save',
    fields: [h('p', { class: 'muted small' }, `${unitOf(x)} · ${whoOf(x)}`), field({ name: 'pay_amount', label: 'Pay', type: 'money', required: true, value: x.pay_amount })],
    onSubmit: async (d) => { await patch(`/cleaning-tasks/${x.task_id}`, { pay_amount: d.pay_amount }); toast('Pay updated.'); load(); },
  });

  async function unpay(x) {
    if (!await confirmDialog({ title: 'Mark as unpaid?', text: `${whoOf(x)}'s ${peso(x.pay_amount)} for ${unitOf(x)} goes back to unpaid. A cleaning expense recorded for it is voided.`, confirmText: 'Mark unpaid', danger: true })) return;
    try {
      try { await post(`/cleaner-pay/${x.task_id}/unpay`); } catch (err) {
        const others = err.code === 'EXPENSE_SHARED' && err.data?.other_task_ids;
        if (!others) throw err;
        if (!await confirmDialog({ title: 'Undo all together?', text: `These cleans were paid together and share one expense. Undo all ${others.length + 1}?`, confirmText: `Undo all ${others.length + 1}`, danger: true })) return;
        await post(`/cleaner-pay/${x.task_id}/unpay`, { task_ids: [x.task_id, ...others] });
      }
      toast('Marked unpaid.'); load();
    } catch (err) { toast(err.message, 'error'); }
  }

  function paint() {
    const rows = shown();
    // A filter can hide a ticked clean. Its tick goes now, so the count, the total and Mark paid cover only rows on screen.
    const kept = visibleSelection(selected, rows);
    selected.clear();
    kept.forEach((id) => selected.add(id));
    const totals = data.totals || {};
    const words = monthWords(month());
    const unpaidC = cents(totals.unpaid); const paidC = cents(totals.paid);
    const missing = data.tasks.filter((x) => x.pay_amount == null && x.pay_status !== 'self').length;
    const payable = rows.filter((x) => x.pay_status === 'unpaid' && x.pay_amount != null);
    const selTotal = ticked().reduce((s, x) => s + cents(x.pay_amount), 0);
    // One key whatever its count, and aria-disabled, not disabled, so focus can come back here after Mark paid (D-117).
    const markBtn = h('button', { class: 'btn btn--primary', type: 'button', 'data-focus-key': 'cp-mark', 'aria-disabled': selected.size ? null : 'true', onclick: markPaid }, selected.size ? `Mark ${selected.size} paid · ${peso(fromCents(selTotal))}` : 'Mark paid');
    const refresh = () => {
      const n = ticked().length;
      const c = ticked().reduce((s, x) => s + cents(x.pay_amount), 0);
      if (n) markBtn.removeAttribute('aria-disabled'); else markBtn.setAttribute('aria-disabled', 'true');
      markBtn.textContent = n ? `Mark ${n} paid · ${peso(fromCents(c))}` : 'Mark paid';
    };
    const all = h('input', { type: 'checkbox', disabled: !payable.length,
      onchange: (e) => { payable.forEach((x) => (e.target.checked ? selected.add(x.task_id) : selected.delete(x.task_id))); box.querySelectorAll('input[data-task]').forEach((i) => { i.checked = selected.has(i.dataset.task); }); refresh(); } });
    const perCleaner = data.cleaners || [];

    box.replaceChildren(
      h('div', { class: 'grid grid--3 stats' },
        stat('Still to pay', peso(fromCents(unpaidC)), missing ? `${missing} clean${missing === 1 ? '' : 's'} with no pay set yet. Use Set pay.` : null, unpaidC ? 'stat--alert' : ''),
        stat(words.paid, peso(fromCents(paidC))),
        stat('Cleans done', String(data.tasks.length), perCleaner.length ? `${perCleaner.length} cleaner${perCleaner.length === 1 ? '' : 's'}` : null)),
      perCleaner.length > 1 && h('div', { class: 'card ops-card' }, h('h2', null, 'By cleaner'),
        h('ul', { class: 'list' }, perCleaner.map((c) => h('li', { class: 'ops-line' },
          h('span', { class: 'ops-line__main' }, h('strong', null, c.name || 'Not assigned'), h('span', { class: 'muted small', style: { whiteSpace: 'nowrap' } }, ` ${c.count} clean${c.count === 1 ? '' : 's'}`)),
          h('span', { class: 'ops-line__end' }, cleanerStatus(c), cents(c.paid) ? h('span', { class: 'muted small' }, ` · ${peso(c.paid)} paid`) : null))))),
      rows.length
        ? h('div', { class: 'card card--flush' },
          h('div', { class: 'ops-bar' }, h('label', { class: 'check' }, all, h('span', null, 'Select all unpaid')), h('span', { class: 'muted small', style: { whiteSpace: 'nowrap' } }, unpaidCount(rows.filter((x) => x.pay_status === 'unpaid').length)), markBtn),
          h('div', { class: 'table-wrap' }, h('table', { class: 'table ops-stack' },
            h('caption', { class: 'sr-only' }, `Cleaner pay for ${month()}`),
            h('thead', null, h('tr', null, h('th', { scope: 'col', class: 'ops-check' }, h('span', { class: 'sr-only' }, 'Select')), ['Date', 'Unit', 'Cleaner'].map((c) => h('th', { scope: 'col' }, c)), h('th', { scope: 'col', class: 'num' }, 'Pay'), h('th', { scope: 'col' }, 'Status'), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Actions')))),
            h('tbody', null, rows.map((x) => {
              const canPick = x.pay_status === 'unpaid' && x.pay_amount != null;
              const box1 = h('input', { type: 'checkbox', disabled: !canPick, checked: selected.has(x.task_id), dataset: { task: x.task_id }, 'aria-label': `Select ${unitOf(x)} on ${fmtDate(doneDay(x))}`,
                onchange: (e) => { if (e.target.checked) selected.add(x.task_id); else selected.delete(x.task_id); refresh(); } });
              return h('tr', null,
                h('td', { class: 'ops-check' }, h('label', { class: 'ops-check__tap' }, box1)),
                h('td', { dataset: { label: 'Date' } }, fmtDate(doneDay(x))),
                h('td', { dataset: { label: 'Unit' } }, unitOf(x)),
                h('td', { dataset: { label: 'Cleaner' } }, whoOf(x)),
                h('td', { class: 'num', dataset: { label: 'Pay' } }, x.pay_amount == null ? h('span', { class: 'muted' }, noPayText(x, isOwner)) : peso(x.pay_amount)),
                h('td', { dataset: { label: 'Status' } }, x.pay_status === 'paid'
                  ? h('span', null, h('span', { class: 'badge badge--paid' }, 'Paid'), h('span', { class: 'muted small ops-note' }, ` ${x.paid_on ? fmtDate(manilaDay(x.paid_on)) : ''}${x.paid_method ? ` · ${label(x.paid_method)}` : ''}`))
                  : x.pay_status === 'unpaid' && h('span', { class: 'badge badge--unpaid' }, 'Unpaid')),
                h('td', { class: 'ops-actions' },
                  x.pay_status === 'unpaid' && h('button', { class: 'btn btn--secondary btn--sm', type: 'button', 'data-focus-key': `cp-pay-${x.task_id}`, onclick: () => editPay(x), 'aria-label': `${x.pay_amount == null ? 'Set pay' : 'Edit pay'} for ${unitOf(x)} on ${fmtDate(doneDay(x))}` }, x.pay_amount == null ? 'Set pay' : 'Edit pay'),
                  x.pay_status === 'paid' && isOwner && h('button', { class: 'btn btn--secondary btn--sm', type: 'button', 'data-focus-key': `cp-pay-${x.task_id}`, onclick: () => unpay(x), 'aria-label': `Undo paid for ${unitOf(x)} on ${fmtDate(doneDay(x))}` }, 'Undo paid')));
            })))))
        : h('div', { class: 'card' }, emptyState({ iconName: 'inbox', title: data.tasks.length ? 'No cleans match these filters' : words.empty, text: data.tasks.length ? 'Try removing a filter.' : isOwner ? 'Pay shows up here once a cleaner marks a clean as done. Check the rates below if amounts are missing.' : 'Pay shows up here once a cleaner marks a clean as done.' })));
  }

  function renderBar() {
    barBox.replaceChildren(filterBar({
      key: 'cleaner-pay', values: filters, defaults,
      onChange: () => paint(),
      extra: h('input', { class: 'input input--sm', type: 'month', value: month(), 'aria-label': 'Month', max: thisMonth,
        onchange: (e) => { if (e.target.value) { filters.month = e.target.value; rememberFilters('cleaner-pay', filters); load(); } } }),
      quick: [
        // Kept only while no names are known yet; once they load the bar is drawn again and an unknown key is dropped.
        { name: 'cleaner', label: 'Cleaner', all: 'All cleaners', options: cleanerOpts, keepUnknown: !cleanerOpts },
        { name: 'status', label: 'Status', all: 'Paid and unpaid', options: [['unpaid', 'Unpaid'], ['paid', 'Paid']] },
      ],
    }));
  }

  // ---- rates (owners)
  async function loadRates() {
    let rates; let members = [];
    try {
      [{ rates }, { members }] = await Promise.all([get('/cleaner-rates'), get('/team').catch(() => ({ members: [] }))]);
    } catch (err) { ratesBox.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'muted' }, err.message))); return; }
    const cleaners = members.filter((m) => m.role === 'cleaner');
    const nameOf = (r) => r.name || 'Cleaner';
    const edit = (r) => {
      const outside = r ? !r.user_id : !cleaners.length;
      const who = field({ name: 'user_id', label: 'Cleaner', type: 'select', value: r?.user_id || '', placeholderOption: 'Someone outside the team', options: cleaners.map((m) => [m.user_id, m.full_name]) });
      // The Name box is needed only while "Someone outside the team" is chosen; a team member is picked from the list instead.
      const nameF = field({ name: 'assignee_name', label: 'Name', required: true, value: r?.assignee_name || '', maxlength: 120, hint: 'Match the name you type when assigning a clean.' });
      const nameBox = nameF.querySelector('input');
      const sync = () => { const outside = !who.querySelector('select').value; nameF.hidden = !outside; nameBox.required = outside; };
      who.querySelector('select').addEventListener('change', sync);
      // makeForm, not formModal: a Cancel on the question below must leave this dialog open.
      let modal;
      const form = makeForm({
        fields: [
          !r && who, !r && nameF,
          // An outside cleaner's name is the key their past pay is filed under, so an existing rate shows it as text, not a box.
          r && outside && h('div', null, h('p', null, 'Name: ', h('strong', null, r.assignee_name)), h('p', { class: 'hint' }, 'To rename, remove this rate and add it again.')),
          h('div', { class: 'form-row form-row--2' },
            field({ name: 'rate_type', label: 'Rate type', type: 'select', required: true, value: r?.rate_type || 'per_clean', placeholderOption: false, options: [['per_clean', 'Per clean'], ['per_hour', 'Per hour']] }),
            field({ name: 'amount', label: 'Amount', type: 'money', required: true, positive: true, value: r?.amount })),
        ],
        submitText: 'Save rate',
        // Runs in the same pass as the required boxes, so the ceiling shows on the first Save with the other messages (OPS-1).
        check: (d) => { const over = rateCeilingProblem(d.rate_type, d.amount); return over ? { amount: over } : null; },
        cancel: () => modal.close(),
        onSubmit: async (d, { form: dialogForm }) => {
          // The ceiling is checked first and refused at the amount field with the server's sentence, so the question
          // below is only asked about an amount the server will take (#49).
          const over = rateCeilingProblem(d.rate_type, d.amount);
          if (over) throw new ApiError('Please check the highlighted fields.', { status: 400, code: 'VALIDATION', fields: { amount: over } });
          const body = { rate_type: d.rate_type, amount: d.amount };
          if (r) { if (r.user_id) body.user_id = r.user_id; else body.assignee_name = r.assignee_name; } else if (d.user_id) body.user_id = d.user_id; else body.assignee_name = d.assignee_name;
          // Adding a rate for a cleaner who already has one replaces it, so ask first. Only a readable positive
          // amount is asked about; anything else is sent so the server's message shows at the field (#35).
          const prior = !r && existingRate(rates, body);
          if (sameRate(prior, d.rate_type, readRate(d.amount))) {
            toast(`${nameOf(prior)} already has ${rateText(prior)}.`);
            modal.close();
            return;
          }
          if (prior && readRate(d.amount) > 0) {
            // makeForm has set the button to "Saving…" already; put "Save rate" back while the question waits.
            const submit = dialogForm.querySelector('[type=submit]');
            submit.textContent = 'Save rate';
            if (!await confirmDialog({ title: 'Change this rate?', text: `${nameOf(prior)} already has ${rateText(prior)}. Change it to ${rateText({ amount: readRate(d.amount), rate_type: d.rate_type })}?`, confirmText: 'Change rate' })) return false;
            submit.textContent = 'Saving…';
          }
          await api('PUT', '/cleaner-rates', body);
          toast('Rate saved.'); loadRates(); load();
          modal.close();
        },
      });
      modal = openModal({ title: r ? `Rate for ${nameOf(r)}` : 'Add a cleaner rate', body: form });
      if (!r) sync();
    };
    const remove = async (r) => {
      // Another rate under the same name (a team rate and an outside one) keeps the person priced.
      const stays = rates.some((x) => x !== r && nameOf(x).trim().toLowerCase() === nameOf(r).trim().toLowerCase());
      const who = `${nameOf(r)}${r.user_id ? '' : ' (outside cleaner)'}`;
      const text = `Remove the ${rateText(r)} rate for ${who}?${stays ? '' : ` ${nameOf(r)} will have no rate.`} Finished cleans keep the pay already worked out.`;
      if (!await confirmDialog({ title: 'Remove this rate?', text, confirmText: 'Remove', danger: true })) return;
      try { await api('DELETE', `/cleaner-rates/${r.rate_id}`); toast('Rate removed.'); loadRates(); } catch (err) { toast(err.message, 'error'); }
    };
    ratesBox.replaceChildren(h('div', { class: 'card ops-card' },
      h('div', { class: 'card__head' }, h('h2', null, 'Cleaner rates'), h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => edit(null) }, '+ Add rate')),
      h('p', { class: 'muted small' }, 'Pay for a clean is worked out from the rate when the cleaner marks it done. Per-hour pay rounds up to the next 15 minutes.'),
      rates.length ? h('ul', { class: 'list' }, rates.map((r) => h('li', { class: 'ops-line' },
        h('span', { class: 'ops-line__main' }, h('strong', null, nameOf(r)), h('span', { class: 'muted small' }, ` ${rateText(r)}`)),
        h('span', { class: 'ops-line__end' },
          h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => edit(r), 'aria-label': `Edit rate for ${nameOf(r)}` }, 'Edit'),
          h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => remove(r), 'aria-label': `Remove rate for ${nameOf(r)}` }, 'Remove')))))
        : h('p', { class: 'muted' }, 'No rates yet. Add one so cleans are priced when they are done.')));
  }

  renderBar();
  el.replaceChildren(pageHead({ title: 'Cleaner pay', sub: 'What your cleaners earned, and what you still owe' }), barBox, box, ratesBox);
  await load();
  if (isOwner) loadRates();
}

// ---------------------------------------------------------------- the cleaner's own pay
extendTranslations({
  'My pay': 'Aking sahod',
  'Your pay for the cleans you finished.': 'Sahod mo sa mga nilinis mo.',
  'Previous month': 'Nakaraang buwan',
  'Next month': 'Susunod na buwan',
  'Total this month': 'Kabuuan ngayong buwan',
  'Still to be paid': 'Hindi pa nababayaran',
  'Already paid': 'Bayad na',
  'Paid': 'Bayad na',
  'Not paid yet': 'Hindi pa bayad',
  'Paid on {date}': 'Binayaran noong {date}',
  'No cleans finished this month': 'Walang natapos na linis ngayong buwan',
  'When you finish a clean, your pay shows up here.': 'Kapag natapos mo ang isang linis, lalabas dito ang sahod mo.',
  'Pay not set yet': 'Hindi pa naitatakda ang sahod',
  'Paid to another cleaner': 'Bayad sa ibang tagalinis',
  "Couldn't load your pay": 'Hindi ma-load ang sahod mo',
  'Try again': 'Subukan ulit',
  'Loading…': 'Naglo-load…',
});

export async function myPayView(el, { query = {} } = {}) {
  initGuestLang(state.user?.guest_language);
  const thisMonth = todayManila().slice(0, 7);
  let month = monthOk(query.month) ? query.month : thisMonth;
  const box = h('div', { class: 'mypay' });
  const shift = (m, d) => { const [y, mo] = m.split('-').map(Number); const dt = new Date(Date.UTC(y, mo - 1 + d, 1)); return dt.toISOString().slice(0, 7); };
  const monthName = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(state.user?.guest_language === 'tl' ? 'fil-PH' : 'en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  async function load() {
    history.replaceState(null, '', `#/my-pay${month === thisMonth ? '' : `?month=${month}`}`);
    box.replaceChildren(h('p', { class: 'muted' }, t('Loading…')));
    let d;
    try { d = await get(`/my-pay${qs({ month })}`); } catch (err) {
      box.replaceChildren(h('div', { class: 'card' }, h('p', null, t("Couldn't load your pay")), h('p', { class: 'muted small' }, err.message), h('button', { class: 'btn btn--secondary', type: 'button', onclick: load }, t('Try again'))));
      return;
    }
    const tasks = d.tasks || [];
    const { total = 0, unpaid = 0, paid = 0 } = d.totals || {};
    box.replaceChildren(
      h('div', { class: 'card mypay__total' }, h('div', { class: 'stat__label' }, t('Total this month')), h('div', { class: 'mypay__amount' }, peso(total)),
        h('div', { class: 'mypay__split' }, h('span', null, `${t('Still to be paid')}: `, h('strong', null, peso(unpaid))), h('span', null, `${t('Already paid')}: `, h('strong', null, peso(paid))))),
      tasks.length
        ? h('ul', { class: 'list mypay__list' }, tasks.map((x) => h('li', { class: 'mypay__item' },
          h('div', { class: 'mypay__main' }, h('span', { class: 'row__title' }, unitOf(x)), h('span', { class: 'row__sub' }, fmtDateL(doneDay(x)))),
          h('div', { class: 'mypay__end' },
            x.pay_visible === false
              ? h('span', { class: 'muted' }, t('Paid to another cleaner'))
              : h('strong', null, x.pay_amount == null ? t('Pay not set yet') : peso(x.pay_amount)),
            x.pay_amount != null && (x.pay_status === 'paid'
              ? h('span', { class: 'badge badge--paid' }, t('Paid'))
              : h('span', { class: 'badge badge--unpaid' }, t('Not paid yet'))),
            x.pay_status === 'paid' && x.paid_on && h('span', { class: 'row__sub' }, t('Paid on {date}', { date: fmtDateL(manilaDay(x.paid_on)) }))))))
        : h('div', { class: 'card' }, emptyState({ iconName: 'inbox', title: t('No cleans finished this month'), text: t('When you finish a clean, your pay shows up here.') })));
  }

  const label1 = h('span', { class: 'mypay__month', 'aria-live': 'polite' }); // the month name says which month now shows (D-114)
  const go = (d) => () => { month = shift(month, d); sync(); load(); };
  const prev = h('button', { class: 'btn btn--secondary mypay__nav', type: 'button', 'aria-label': t('Previous month'), onclick: go(-1) }, '‹');
  const next = h('button', { class: 'btn btn--secondary mypay__nav', type: 'button', 'aria-label': t('Next month'), onclick: go(1) }, '›');
  function sync() { label1.textContent = monthName(month); next.disabled = month >= thisMonth; }
  sync();
  el.replaceChildren(pageHead({ title: t('My pay'), sub: t('Your pay for the cleans you finished.') }), h('div', { class: 'mypay__bar' }, prev, label1, next), box);
  await load();
}
