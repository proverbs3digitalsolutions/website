// Group bookings: one lead guest, several listings, normal reservations linked together (D-70).

import { get, post, patch, qs, ApiError } from '../api.js';
import { h, icon, peso, fmtDate, field, formModal, openModal, makeForm, confirmDialog, emptyState, toast, todayManila } from '../ui.js';
import { state, navigate } from '../app.js';
import { initFilters, filterBar, changed } from '../filters.js';
import { addDays, boxValue } from './reservations.js';

const canManageNow = () => !['staff', 'cleaner'].includes(state.user.role);
const nightsOf = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const isCancelled = (g) => g.status === 'cancelled';

// ---------------------------------------------------------------- one room row (used by "new group" and "add a room")
function roomRow({ listings, roomTypes, defaults, onRemove }) {
  const uid = Math.random().toString(36).slice(2, 7);
  const propName = new Map(listings.map((l) => [l.property_id, l.property_name]));
  const mk = (name, lbl, input) => h('div', { class: 'field' }, h('label', { for: `gr-${name}-${uid}` }, lbl), input);
  const mode = h('select', { class: 'input', id: `gr-mode-${uid}`, 'aria-label': 'Room choice' },
    h('option', { value: 'unit' }, 'A specific listing'),
    roomTypes.length > 0 && h('option', { value: 'type' }, 'Any free room of a type'));
  const unit = h('select', { class: 'input', id: `gr-unit-${uid}` },
    h('option', { value: '' }, 'Choose a listing…'),
    listings.map((l) => h('option', { value: l.unit_id }, `${l.unit_name} — ${l.property_name}`)));
  const type = h('select', { class: 'input', id: `gr-type-${uid}` },
    h('option', { value: '' }, 'Choose a room type…'),
    roomTypes.map((t) => h('option', { value: `${t.property_id}|${t.room_type}` }, `${t.room_type} · ${propName.get(t.property_id) || 'Property'} (${t.count})`)));
  const count = h('input', { class: 'input', id: `gr-count-${uid}`, type: 'number', min: 1, max: 20, value: 1, inputmode: 'numeric' });
  const ci = h('input', { class: 'input', id: `gr-ci-${uid}`, type: 'date', value: defaults.check_in });
  const co = h('input', { class: 'input', id: `gr-co-${uid}`, type: 'date', value: defaults.check_out });
  const guests = h('input', { class: 'input', id: `gr-guests-${uid}`, type: 'number', min: 1, max: 50, value: defaults.num_guests || 2, inputmode: 'numeric' });
  const price = h('input', { class: 'input', id: `gr-price-${uid}`, type: 'text', inputmode: 'decimal', placeholder: 'Per room' });
  const cleaning = h('input', { class: 'input', id: `gr-clean-${uid}`, type: 'text', inputmode: 'decimal', placeholder: '0' });
  const note = h('p', { class: 'hint', 'aria-live': 'polite' });
  // Each money box has its own flag: a box the host typed in is never overwritten by a suggestion, and a blank box is open to one again.
  let priceEdited = false; let cleaningEdited = false;
  price.addEventListener('input', () => { priceEdited = price.value.trim() !== ''; });
  cleaning.addEventListener('input', () => { cleaningEdited = cleaning.value.trim() !== ''; });

  const typeBox = mk('type', 'Room type', type);
  const countBox = mk('count', 'How many', count);
  const unitBox = mk('unit', 'Listing', unit);
  const sync = () => {
    const t = mode.value === 'type';
    unitBox.hidden = t; typeBox.hidden = !t; countBox.hidden = !t;
  };
  let seq = 0;
  async function suggest() {
    // A price hint needs a listing: the chosen one, or the first listing of the chosen type when listings say their type.
    let uId = mode.value === 'unit' ? unit.value : '';
    if (mode.value === 'type' && type.value) {
      const [pid, ...rt] = type.value.split('|');
      uId = listings.find((l) => l.property_id === pid && l.room_type === rt.join('|'))?.unit_id || '';
    }
    // Without a quote, a box the host did not type in must not keep an old suggestion.
    const fill = (q) => {
      const m = mode.value === 'type' ? 'type' : 'unit';
      price.value = boxValue({ typed: priceEdited, mode: m, suggestion: q && !q.missing_rates ? q.accommodation_total : null, current: price.value });
      cleaning.value = boxValue({ typed: cleaningEdited, mode: m, suggestion: q ? q.cleaning_fee : null, current: cleaning.value });
    };
    if (!uId || !ci.value || !co.value || co.value <= ci.value) { fill(null); note.textContent = ''; return; }
    const mine = ++seq;
    try {
      const q = await get(`/reservations/quote${qs({ unit_id: uId, check_in: ci.value, check_out: co.value })}`);
      if (mine !== seq) return;
      fill(q);
      const nights = `${q.nights.length} night${q.nights.length === 1 ? '' : 's'}`;
      note.textContent = q.missing_rates ? 'No nightly rate for some nights. Enter the price yourself.'
        : mode.value === 'type' ? `From about ${peso(q.accommodation_total)}${Number(q.cleaning_fee) ? ` + ${peso(q.cleaning_fee)} cleaning` : ''} for ${nights} (first listing of this type). Each room is priced from the listing BalayHub picks; leave the boxes empty to use that price.`
          : `Suggested ${peso(q.accommodation_total)} for ${nights}. You can change it.`;
    } catch (err) { if (mine === seq) { fill(null); note.textContent = err.message; } }
  }
  mode.addEventListener('change', () => { sync(); suggest(); });
  for (const el of [unit, type, ci, co]) el.addEventListener('change', suggest);
  sync();

  const el = h('fieldset', { class: 'grp-room' },
    h('legend', null, 'Room'),
    h('div', { class: 'grp-room__grid' },
      roomTypes.length > 0 && mk('mode', 'Pick', mode), unitBox, typeBox, countBox,
      mk('ci', 'Check-in', ci), mk('co', 'Check-out', co), mk('guests', 'Guests in this room', guests),
      mk('price', 'Accommodation total', h('div', { class: 'input-money' }, price)), mk('clean', 'Cleaning fee', h('div', { class: 'input-money' }, cleaning))),
    note,
    onRemove && h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => onRemove(el) }, 'Remove this room'));

  return {
    el,
    // Returns the rooms to send (a room type with a count becomes that many rows), or throws a message.
    rooms() {
      if (!ci.value || !co.value) throw new Error('Enter the check-in and check-out dates.');
      if (co.value <= ci.value) throw new Error('Check-out must be after check-in.');
      const base = { check_in: ci.value, check_out: co.value, num_guests: Number(guests.value) || 1 };
      // A typed 0 would make the night free. A blank total still means "use the listing's price".
      if (price.value.trim() && Number(price.value) === 0) throw new Error("Accommodation total must be greater than zero. Leave it blank to use the listing's price.");
      if (price.value.trim()) base.accommodation_total = price.value.trim();
      if (cleaning.value.trim()) base.cleaning_fee = cleaning.value.trim();
      if (mode.value === 'type') {
        if (!type.value) throw new Error('Choose a room type for each room row.');
        const [property_id, ...rt] = type.value.split('|');
        // Never adjusted into range: a count the owner did not mean would book real rooms.
        const n = Number(count.value);
        if (!Number.isInteger(n) || n < 1 || n > 20) throw new Error('Count must be a whole number from 1 to 20.');
        return Array.from({ length: n }, () => ({ ...base, property_id, room_type: rt.join('|') }));
      }
      if (!unit.value) throw new Error('Choose a listing for each room row.');
      return [{ ...base, unit_id: unit.value }];
    },
  };
}

// A 409 is ROOMS_TAKEN (data.rooms lists the taken listings and nights) or NO_FREE_ROOM (message only).
// The form's error line already shows the message, so this box only lists the taken rooms, and is left out when there are none.
function conflictList(err) {
  const items = err.code === 'ROOMS_TAKEN' ? err.data.rooms : [];
  if (!items.length) return [];
  return [h('div', { class: 'alert alert--error', role: 'alert' },
    h('div', null, 'These rooms are taken:'),
    h('ul', { class: 'grp-taken' }, items.map((x) => h('li', null, `${x.unit_name} · ${fmtDate(x.check_in)} – ${fmtDate(x.check_out)}`))))];
}

async function loadChoices() {
  const [{ listings }, rt] = await Promise.all([get('/listings'), get('/room-types').catch(() => ({ room_types: [] }))]);
  return { listings, roomTypes: rt.room_types || [] };
}

// ---------------------------------------------------------------- new group booking
export async function newGroupModal({ onSaved } = {}) {
  let choices;
  try { choices = await loadChoices(); } catch (err) { toast(err.message, 'error'); return; }
  if (!choices.listings.length) { toast('Add a listing first.', 'error'); return; }
  const start = todayManila();
  const defaults = { check_in: start, check_out: addDays(start, 1), num_guests: 2 };

  // Lead guest: pick an existing guest or type a new one.
  let picked = null;
  const guestMode = h('select', { class: 'input', 'aria-label': 'Lead guest' }, h('option', { value: 'new' }, 'New guest'), h('option', { value: 'existing' }, 'Existing guest'));
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search by name, email or mobile', 'aria-label': 'Search guests' });
  const results = h('ul', { class: 'list grp-guest-results', 'aria-live': 'polite' });
  const chosen = h('div', { class: 'chips' });
  const existingBox = h('div', { class: 'stack', hidden: true }, search, results, chosen);
  const newBox = h('div', { class: 'stack' },
    field({ name: 'guest_name', label: 'Lead guest name', maxlength: 120 }),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'guest_phone', label: 'Mobile', type: 'tel', inputmode: 'tel' }),
      field({ name: 'guest_email', label: 'Email', type: 'email' })));
  guestMode.addEventListener('change', () => { existingBox.hidden = guestMode.value !== 'existing'; newBox.hidden = guestMode.value !== 'new'; });
  let t; let seq = 0;
  search.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = search.value.trim();
      if (q.length < 2) { results.replaceChildren(); return; }
      const mine = ++seq;
      try {
        const { guests } = await get(`/guests${qs({ q })}`);
        if (mine !== seq) return;
        results.replaceChildren(...(guests.length ? guests.slice(0, 8).map((g) => h('li', null, h('button', {
          type: 'button', class: 'grp-guest', onclick: () => {
            picked = g; results.replaceChildren();
            chosen.replaceChildren(h('span', { class: 'badge badge--active' }, g.full_name), h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => { picked = null; chosen.replaceChildren(); } }, 'Change'));
          },
        }, h('strong', null, g.full_name), g.email || g.phone ? h('span', { class: 'muted small' }, ` · ${g.email || g.phone}`) : null))) : [h('li', { class: 'muted small' }, 'No guest found. Switch to "New guest".')]));
      } catch (err) { results.replaceChildren(h('li', { class: 'error' }, err.message)); }
    }, 300);
  });

  const rowsBox = h('div', { class: 'stack' });
  const rows = [];
  const addRow = () => {
    const r = roomRow({
      ...choices, defaults,
      onRemove: (el) => { if (rows.length <= 1) { toast('A group needs at least one room row.', 'error'); return; } rows.splice(rows.findIndex((x) => x.el === el), 1); el.remove(); },
    });
    rows.push(r); rowsBox.append(r.el);
  };
  addRow(); addRow();
  const conflicts = h('div');

  let modal;
  const form = makeForm({
    submitText: 'Create group booking',
    cancel: () => modal.close(),
    fields: [
      field({ name: 'name', label: 'Group name', required: true, maxlength: 120, placeholder: 'Santos family reunion' }),
      h('div', { class: 'field' }, h('label', null, 'Lead guest'), guestMode),
      newBox, existingBox,
      h('h3', { class: 'subhead' }, 'Rooms (2 to 20)'),
      rowsBox,
      h('button', { type: 'button', class: 'btn btn--secondary btn--sm', onclick: addRow }, icon('plus'), 'Add another room row'),
      field({ name: 'notes', label: 'Notes', type: 'textarea', maxlength: 1000 }),
      conflicts,
    ],
    onSubmit: async (d) => {
      conflicts.replaceChildren();
      const fail = (m, fields) => { throw new ApiError(m, { status: 400, fields }); };
      let guest;
      if (guestMode.value === 'existing') {
        if (!picked) fail('Search for the lead guest and pick them, or switch to "New guest".');
        guest = { guest_id: picked.guest_id };
      } else {
        if (!d.guest_name.trim()) fail('Enter the lead guest name.', { guest_name: 'Lead guest name is required.' });
        guest = { full_name: d.guest_name.trim(), ...(d.guest_phone && { phone: d.guest_phone }), ...(d.guest_email && { email: d.guest_email }) };
      }
      let list;
      try { list = rows.flatMap((r) => r.rooms()); } catch (e) { fail(e.message); }
      if (list.length < 2 || list.length > 20) fail('A group needs between 2 and 20 rooms.');
      try {
        const res = await post('/booking-groups', { name: d.name.trim(), guest, rooms: list, ...(d.notes && { notes: d.notes }) });
        toast('Group booking created.');
        modal.close();
        if (onSaved) onSaved(res); else navigate(`#/groups/${res.group.group_id}`);
      } catch (err) {
        if (err.status === 409) { conflicts.replaceChildren(...conflictList(err)); conflicts.scrollIntoView?.({ block: 'nearest' }); }
        throw err;
      }
    },
  });
  modal = openModal({ title: 'New group booking', body: form, wide: true });
}

// ---------------------------------------------------------------- add a room to an existing group
async function addRoomModal(g, onDone) {
  let choices;
  try { choices = await loadChoices(); } catch (err) { toast(err.message, 'error'); return; }
  const first = (g.rooms || [])[0];
  const ci = first?.check_in || todayManila();
  const row = roomRow({ ...choices, defaults: { check_in: ci, check_out: first?.check_out || addDays(ci, 1), num_guests: 2 } });
  const conflicts = h('div');
  // A failed add keeps the dialog open with its message. Re-reading the page would remove the open dialog,
  // so after a failure the table is re-read when the dialog closes instead.
  let refreshOnClose = false;
  let modal;
  const form = makeForm({
    submitText: 'Add room', cancel: () => modal.close(),
    fields: [row.el, conflicts],
    onSubmit: async () => {
      conflicts.replaceChildren();
      let list;
      try { list = row.rooms(); } catch (e) { throw new ApiError(e.message, { status: 400 }); }
      try {
        // One request: the server adds every room or none.
        await post(`/booking-groups/${g.group_id}/rooms`, { rooms: list });
      } catch (err) {
        if (err.status === 409) conflicts.replaceChildren(...conflictList(err));
        if (!err.offline && !/Nothing was saved/.test(err.message)) err.message = `${err.message} Nothing was saved.`;
        // A dropped connection can hide a save that did happen, so the table is re-read when the dialog closes.
        refreshOnClose = true;
        throw err;
      }
      refreshOnClose = false;
      toast('Room added.'); modal.close(); onDone();
    },
  });
  modal = openModal({ title: 'Add a room', body: form, wide: true, onClose: () => { if (refreshOnClose) onDone(); } });
}

// ---------------------------------------------------------------- list
export async function groupsView(el, { query }) {
  const canManage = canManageNow();
  const defaults = { q: '', status: 'active' };
  const filters = initFilters('groups', query, defaults);
  const box = h('div', { class: 'card' });

  async function load() {
    history.replaceState(null, '', `#/groups${qs(changed(filters, defaults))}`);
    const { groups } = await get(`/booking-groups${qs({ status: filters.status === 'all' ? '' : filters.status })}`);
    const q = filters.q.toLowerCase();
    const shown = q ? groups.filter((g) => `${g.name} ${g.guest_name || ''}`.toLowerCase().includes(q)) : groups;
    if (!shown.length) {
      const filtered = Boolean(q) || filters.status !== defaults.status;
      box.replaceChildren(emptyState({
        iconName: 'users', title: filtered ? 'No results found' : 'No group bookings yet',
        text: filtered ? 'Try removing a filter.' : 'Book several listings for one guest, like a family reunion or a team outing.',
        action: !filtered && canManage && h('button', { class: 'btn btn--primary', onclick: () => newGroupModal() }, icon('plus'), 'New group booking'),
      }));
      return;
    }
    box.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, ['Group', 'Lead guest', 'Dates', 'Rooms', 'Status'].map((x) => h('th', null, x)), canManage && h('th', { class: 'num' }, 'Total'), canManage && h('th', { class: 'num' }, 'Balance'))),
      h('tbody', null, shown.map((g) => {
        const go = () => navigate(`#/groups/${g.group_id}`);
        const bal = Number(g.balance);
        return h('tr', { class: 'row-link', tabindex: 0, onclick: go, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } } },
          h('td', null, h('strong', null, g.name)),
          h('td', null, g.guest_name || '—'),
          h('td', null, g.check_in ? `${fmtDate(g.check_in)} – ${fmtDate(g.check_out)}` : '—'),
          h('td', null, isCancelled(g) ? '—' : String(g.rooms)),
          h('td', null, isCancelled(g) ? h('span', { class: 'badge badge--voided' }, 'Cancelled') : h('span', { class: 'badge badge--active' }, 'Active')),
          canManage && h('td', { class: 'num' }, peso(g.total)),
          canManage && h('td', { class: `num${bal > 0 ? ' amount--neg' : ''}` }, isCancelled(g) ? '—' : peso(bal)));
      })))));
  }
  const bar = filterBar({
    key: 'groups', values: filters, defaults, onChange: load,
    search: { placeholder: 'Search group or guest' },
    quick: [{ name: 'status', label: 'Status', all: false, options: [['active', 'Active'], ['cancelled', 'Cancelled'], ['all', 'All']] }],
  });
  el.replaceChildren(
    h('div', { class: 'page-head' },
      h('div', { class: 'page-head__title' }, h('h1', null, 'Group bookings'), h('p', null, 'Several listings for one guest or party')),
      canManage && h('div', { class: 'page-head__actions' }, h('button', { class: 'btn btn--primary', onclick: () => newGroupModal() }, icon('plus'), 'New group booking'))),
    bar, box);
  await load();
  if (query.new && canManage) newGroupModal();
}

// ---------------------------------------------------------------- detail
export async function groupDetailView(el, { params, rerender }) {
  const canManage = canManageNow();
  const { group: g, guest, rooms, totals } = await get(`/booking-groups/${params.id}`);
  const cancelled = isCancelled(g);
  const active = rooms.filter((r) => r.status !== 'cancelled');
  const run = async (fn, msg) => { try { await fn(); toast(msg); rerender(); } catch (err) { toast(err.message, 'error'); } };

  const edit = () => formModal({
    title: 'Edit group', submitText: 'Save changes',
    fields: [
      field({ name: 'name', label: 'Group name', required: true, value: g.name, maxlength: 120 }),
      field({ name: 'notes', label: 'Notes', type: 'textarea', value: g.notes, maxlength: 1000 }),
    ],
    onSubmit: async (d) => { await patch(`/booking-groups/${g.group_id}`, d); toast('Group updated.'); rerender(); },
  });
  const removeRoom = async (r) => {
    const low = active.length <= 2 ? ' The group will have fewer than two rooms left.' : '';
    const reason = await confirmDialog({ title: 'Remove this room?', text: `${r.unit_name}, ${fmtDate(r.check_in)} – ${fmtDate(r.check_out)} will be cancelled. Payments stay on record.${low}`, confirmText: 'Remove room', danger: true, reason: true });
    if (!reason) return;
    run(() => post(`/booking-groups/${g.group_id}/rooms/${r.booking_id}/remove`, { reason }), 'Room removed.');
  };
  const cancelGroup = async () => {
    const reason = await confirmDialog({ title: 'Cancel the whole group?', text: `All ${active.length} room${active.length === 1 ? '' : 's'} will be cancelled and the dates become available again. Payments stay on record.`, confirmText: 'Cancel group', cancelText: 'Keep group', danger: true, reason: true });
    if (!reason) return;
    run(() => post(`/booking-groups/${g.group_id}/cancel`, { reason }), 'Group cancelled.');
  };

  const cols = ['Listing', 'Dates', 'Guests'];
  el.replaceChildren(
    h('a', { class: 'back', href: '#/groups' }, '‹ Group bookings'),
    h('div', { class: 'page-head' },
      h('div', { class: 'page-head__title' },
        h('h1', null, g.name),
        h('p', null, `${guest ? `Lead guest ${guest.full_name} · ` : ''}${active.length} room${active.length === 1 ? '' : 's'}`)),
      canManage && !cancelled && h('div', { class: 'page-head__actions' },
        h('button', { class: 'btn btn--secondary', onclick: () => addRoomModal({ ...g, rooms }, rerender) }, icon('plus'), 'Add room'),
        h('button', { class: 'btn btn--secondary', onclick: edit }, 'Edit'),
        h('button', { class: 'btn btn--danger', onclick: cancelGroup }, 'Cancel group'))),
    cancelled && h('div', { class: 'alert alert--error' }, 'This group is cancelled.'),
    g.notes && h('div', { class: 'card' }, h('h2', { class: 'subhead' }, 'Notes'), h('p', { style: { whiteSpace: 'pre-wrap' } }, g.notes)),
    h('div', { class: 'card' },
      h('div', { class: 'card__head' }, h('h2', null, 'Rooms')),
      rooms.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, cols.map((x) => h('th', null, x)), canManage && ['Total', 'Paid', 'Balance'].map((x) => h('th', { class: 'num' }, x)), canManage && !cancelled && h('th', null, h('span', { class: 'sr-only' }, 'Actions')))),
        h('tbody', null, rooms.map((r) => {
          const off = r.status === 'cancelled';
          return h('tr', null,
            h('td', null, h('a', { href: `#/reservations/${r.booking_id}` }, h('strong', null, r.unit_name)), off && h('span', { class: 'badge badge--voided' }, 'Cancelled')),
            h('td', null, `${fmtDate(r.check_in)} – ${fmtDate(r.check_out)}`, h('div', { class: 'muted small' }, `${nightsOf(r.check_in, r.check_out)} nights`)),
            h('td', null, r.num_guests ? String(r.num_guests) : '—'),
            canManage && h('td', { class: 'num' }, peso(r.total_amount)),
            canManage && h('td', { class: 'num' }, peso(r.amount_paid)),
            canManage && h('td', { class: `num${Number(r.balance) > 0 && !off ? ' amount--neg' : ''}` }, off ? '—' : peso(r.balance)),
            canManage && !cancelled && h('td', null, !off && h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `Remove ${r.unit_name} from the group`, onclick: () => removeRoom(r) }, 'Remove')));
        })),
        canManage && h('tfoot', null, h('tr', null, h('td', { colspan: 3 }, 'Group total'),
          h('td', { class: 'num' }, peso(totals.total)), h('td', { class: 'num' }, peso(totals.amount_paid)),
          h('td', { class: `num${Number(totals.balance) > 0 ? ' amount--neg' : ''}` }, peso(totals.balance)), !cancelled && h('td')))))
        : h('p', { class: 'muted' }, 'No rooms in this group.')),
    canManage && h('p', { class: 'muted small' }, 'Payments are recorded on each room\'s reservation. Open a room to record one.'));
}
