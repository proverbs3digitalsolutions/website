// Group bookings: one lead guest, several listings, normal reservations linked together (D-70).

import { get, post, patch, qs, ApiError } from '../api.js';
import { h, icon, peso, fmtDate, parseAmount, field, formModal, openModal, makeForm, confirmDialog, emptyState, toast, todayManila } from '../ui.js';
import { state, navigate } from '../app.js';
import { initFilters, filterBar, changed } from '../filters.js';
import { addDays, boxValue, guestsProblem, matchedGuestNote } from './reservations.js';

const canManageNow = () => !['staff', 'cleaner'].includes(state.user.role);
const nightsOf = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const isCancelled = (g) => g.status === 'cancelled';
// The detail header's room count. A cancelled group counts every room it had and says so; an active group counts the rooms still booked.
export const roomsLine = (rooms, cancelled) => {
  const n = cancelled ? rooms.length : rooms.filter((r) => r.status !== 'cancelled').length;
  return `${n} room${n === 1 ? '' : 's'}${cancelled ? ', cancelled' : ''}`;
};

// The message for a room row with no room type chosen; it names the room when the form numbers its rows (0 = the add-a-room dialog).
export function roomTypeProblem(num) {
  return num ? `Choose a room type for room ${num}.` : 'Choose a room type for this room.';
}

// ---------------------------------------------------------------- one room row (used by "new group" and "add a room")
function roomRow({ listings, roomTypes, defaults, onRemove, number = 0 }) {
  const uid = Math.random().toString(36).slice(2, 7);
  // The room's number in a new group (0 in the add-a-room dialog, which shows no number). setNumber keeps it current after a removal.
  let num = number;
  const propName = new Map(listings.map((l) => [l.property_id, l.property_name]));
  const mk = (name, lbl, input) => h('div', { class: 'field' }, h('label', { for: `gr-${name}-${uid}` }, lbl), input);
  const mode = h('select', { class: 'input', id: `gr-mode-${uid}`, 'aria-label': 'Room choice' },
    h('option', { value: 'unit' }, 'A specific listing'),
    roomTypes.length > 0 && h('option', { value: 'type' }, 'Any free room of a type'));
  const unit = h('select', { class: 'input', id: `gr-unit-${uid}`, 'aria-describedby': `gr-unit-${uid}-err` },
    h('option', { value: '' }, 'Choose a listing…'),
    listings.map((l) => h('option', { value: l.unit_id }, `${l.unit_name} — ${l.property_name}`)));
  const type = h('select', { class: 'input', id: `gr-type-${uid}`, 'aria-describedby': `gr-type-${uid}-err` },
    h('option', { value: '' }, 'Choose a room type…'),
    roomTypes.map((t) => h('option', { value: `${t.property_id}|${t.room_type}` }, `${t.room_type} · ${propName.get(t.property_id) || 'Property'} (${t.count})`)));
  const count = h('input', { class: 'input', id: `gr-count-${uid}`, type: 'number', min: 1, max: 20, value: 1, inputmode: 'numeric', 'aria-describedby': `gr-count-${uid}-err` });
  const ci = h('input', { class: 'input', id: `gr-ci-${uid}`, type: 'date', value: defaults.check_in, 'aria-describedby': `gr-ci-${uid}-err` });
  const co = h('input', { class: 'input', id: `gr-co-${uid}`, type: 'date', value: defaults.check_out, 'aria-describedby': `gr-co-${uid}-err` });
  const guests = h('input', { class: 'input', id: `gr-guests-${uid}`, type: 'number', min: 1, max: 50, value: defaults.num_guests || 2, inputmode: 'numeric', 'aria-describedby': `gr-guests-${uid}-err` });
  // The key names this row, so a refused count is marked at its own guests box (showErrors finds the first box with the key).
  const guestsKey = `num_guests-${uid}`;
  const guestsBox = h('div', { class: 'field', dataset: { field: guestsKey } }, h('label', { for: `gr-guests-${uid}` }, 'Guests in this room'), guests, h('div', { class: 'error', id: `gr-guests-${uid}-err`, role: 'alert' }));
  // The check-out box is a field the form can mark, so a stay that runs no night shows at its own row (see found()).
  const coKey = `check_out-${uid}`;
  const coBox = h('div', { class: 'field', dataset: { field: coKey } }, h('label', { for: `gr-co-${uid}` }, 'Check-out'), co, h('div', { class: 'error', id: `gr-co-${uid}-err`, role: 'alert' }));
  const price = h('input', { class: 'input', id: `gr-price-${uid}`, type: 'text', inputmode: 'decimal', placeholder: 'Per room', 'aria-describedby': `gr-price-${uid}-err` });
  const cleaning = h('input', { class: 'input', id: `gr-clean-${uid}`, type: 'text', inputmode: 'decimal', placeholder: '0', 'aria-describedby': `gr-clean-${uid}-err` });
  const note = h('p', { class: 'hint', 'aria-live': 'polite' });
  // Each money box has its own flag: a box the host typed in is never overwritten by a suggestion, and a blank box is open to one again.
  let priceEdited = false; let cleaningEdited = false;
  price.addEventListener('input', () => { priceEdited = price.value.trim() !== ''; });
  cleaning.addEventListener('input', () => { cleaningEdited = cleaning.value.trim() !== ''; });

  // The room type box is a field the form can mark, like the listing box below, so a row with no type shows its message on this row (see rooms()).
  const typeKey = `room_type-${uid}`;
  const typeBox = h('div', { class: 'field', dataset: { field: typeKey } }, h('label', { for: `gr-type-${uid}` }, 'Room type'), type, h('div', { class: 'error', id: `gr-type-${uid}-err`, role: 'alert' }));
  // The count, check-in and total boxes are fields the form can mark too, so every problem of a row shows on its own box (see found()).
  const keyed = (name, lbl, input, wrap) => h('div', { class: 'field', dataset: { field: `${name}-${uid}` } }, h('label', { for: `gr-${wrap}-${uid}` }, lbl), input, h('div', { class: 'error', id: `gr-${wrap}-${uid}-err`, role: 'alert' }));
  const countKey = `count-${uid}`; const ciKey = `check_in-${uid}`; const priceKey = `accommodation_total-${uid}`; const cleanKey = `cleaning_fee-${uid}`;
  const countBox = keyed('count', 'How many', count, 'count');
  const ciBox = keyed('check_in', 'Check-in', ci, 'ci');
  const priceBox = keyed('accommodation_total', 'Accommodation total', h('div', { class: 'input-money' }, price), 'price');
  const cleanBox = keyed('cleaning_fee', 'Cleaning fee', h('div', { class: 'input-money' }, cleaning), 'clean');
  // The listing box is a field the form can mark, so a row with no listing shows its message on this row (see rooms()).
  const unitKey = `unit_id-${uid}`;
  const unitBox = h('div', { class: 'field', dataset: { field: unitKey } }, h('label', { for: `gr-unit-${uid}` }, 'Listing'), unit, h('div', { class: 'error', id: `gr-unit-${uid}-err`, role: 'alert' }));
  const sync = () => {
    const t = mode.value === 'type';
    unitBox.hidden = t; typeBox.hidden = !t; countBox.hidden = !t;
  };
  let seq = 0;
  async function suggest() {
    // A price hint needs a listing or a room type. For a room type the server prices the listing BalayHub would pick now, and names it.
    let pick = mode.value === 'unit' && unit.value ? { unit_id: unit.value } : null;
    if (mode.value === 'type' && type.value) {
      const [property_id, ...rt] = type.value.split('|');
      pick = { property_id, room_type: rt.join('|') };
    }
    // Without a quote, a box the host did not type in must not keep an old suggestion.
    const fill = (q) => {
      const m = mode.value === 'type' ? 'type' : 'unit';
      price.value = boxValue({ typed: priceEdited, mode: m, suggestion: q && !q.missing_rates ? q.accommodation_total : null, current: price.value });
      cleaning.value = boxValue({ typed: cleaningEdited, mode: m, suggestion: q ? q.cleaning_fee : null, current: cleaning.value });
    };
    if (!pick || !ci.value || !co.value || co.value <= ci.value) { fill(null); note.textContent = ''; return; }
    const mine = ++seq;
    try {
      const q = await get(`/reservations/quote${qs({ ...pick, check_in: ci.value, check_out: co.value })}`);
      if (mine !== seq) return;
      fill(q);
      const nights = `${q.nights.length} night${q.nights.length === 1 ? '' : 's'}`;
      note.textContent = q.missing_rates ? 'No nightly rate for some nights. Enter the price yourself.'
        : mode.value === 'type' ? `From about ${peso(q.accommodation_total)}${Number(q.cleaning_fee) ? ` + ${peso(q.cleaning_fee)} cleaning` : ''} for ${nights} (${q.unit_name}, the free listing BalayHub would pick now). Each room is priced from the listing BalayHub picks; leave the boxes empty to use that price.`
          : `Suggested ${peso(q.accommodation_total)} for ${nights}. You can change it.`;
    } catch (err) { if (mine === seq) { fill(null); note.textContent = err.message; } }
  }
  mode.addEventListener('change', () => { sync(); suggest(); });
  for (const el of [unit, type, ci, co]) el.addEventListener('change', suggest);
  sync();

  // The remove button names its row by position ("Remove this room, room 2") so the buttons of a group are told apart.
  const removeBtn = onRemove && h('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': `Remove this room, room ${number}`, onclick: () => onRemove(el) }, 'Remove this room');
  const el = h('fieldset', { class: 'grp-room' },
    h('legend', null, 'Room'),
    h('div', { class: 'grp-room__grid' },
      roomTypes.length > 0 && mk('mode', 'Pick', mode), unitBox, typeBox, countBox,
      ciBox, coBox, guestsBox,
      priceBox, cleanBox),
    note,
    removeBtn);

  // The row's problems in the order the boxes read, each with the error rooms() throws for it. A message on a box shows the summary once,
  // not the sentence twice; the guests and date messages keep their own wording.
  function found() {
    const out = [];
    const add = (key, msg, err) => out.push({ key, msg, err: err || new ApiError('Please check the highlighted fields.', { status: 400, fields: { [key]: msg } }) });
    if (!ci.value || !co.value) {
      const msg = 'Enter the check-in and check-out dates.';
      for (const k of [!ci.value && ciKey, !co.value && coKey]) if (k) add(k, msg, new Error(msg));
    } else if (co.value <= ci.value) add(coKey, 'Check-out must be after check-in.', new Error('Check-out must be after check-in.'));
    // A blank, zero, negative or decimal count is refused at this room's guests box, the same rule the reservation form uses.
    const problem = guestsProblem(guests.value);
    if (problem) add(guestsKey, problem, new ApiError(problem, { status: 400, fields: { [guestsKey]: problem } }));
    // The server's money rule (src/lib/validate.js), checked here so the bad box is marked itself, not left to a banner.
    const money = (box, key, label) => {
      const v = box.value.trim();
      if (!v) return false;
      const n = parseAmount(v);
      if (Number.isNaN(n)) { add(key, `${label} must be a valid amount (e.g. 8500 or 8500.50).`); return true; }
      if (n < 0) { add(key, `${label} cannot be negative.`); return true; }
      return false;
    };
    const priceBad = money(price, priceKey, 'Accommodation total');
    money(cleaning, cleanKey, 'Cleaning fee');
    // A typed 0 would make the night free. A blank total still means "use the listing's price".
    if (!priceBad && price.value.trim() && Number(price.value) === 0) {
      const msg = "Accommodation total must be greater than zero. Leave it blank to use the listing's price.";
      add(priceKey, msg, new Error(msg));
    }
    if (mode.value === 'type') {
      if (!type.value) add(typeKey, roomTypeProblem(num));
      const n = Number(count.value);
      if (!Number.isInteger(n) || n < 1 || n > 20) add(countKey, 'Count must be a whole number from 1 to 20.', new Error('Count must be a whole number from 1 to 20.'));
    } else if (!unit.value) add(unitKey, num ? `Choose a listing for room ${num}.` : 'Choose a listing for this room.');
    return out;
  }

  return {
    el,
    // The key of this row's box for a server field name, or null when the row has no box for it.
    fieldKey: (name) => ({ num_guests: guestsKey, unit_id: unitKey, check_out: coKey, check_in: ciKey, accommodation_total: priceKey, cleaning_fee: cleanKey, room_type: typeKey })[name] ?? null,
    // Renumbers the row after a room above it is removed.
    setNumber(n) { num = n; removeBtn?.setAttribute('aria-label', `Remove this room, room ${n}`); },
    // Every problem this row can name, each keyed to its own box, in the order the boxes read; {} when the row is fine.
    problems() { return Object.fromEntries(found().map((x) => [x.key, x.msg])); },
    // How many rooms this row books (a room type with a count books that many); a count that is not usable counts as one.
    roomCount() { const n = Number(count.value); return mode.value === 'type' && Number.isInteger(n) && n >= 1 && n <= 20 ? n : 1; },
    // Returns the rooms to send (a room type with a count becomes that many rows), or throws the first problem.
    rooms() {
      const [first] = found();
      if (first) throw first.err;
      const base = { check_in: ci.value, check_out: co.value, num_guests: Number(guests.value) };
      if (price.value.trim()) base.accommodation_total = price.value.trim();
      if (cleaning.value.trim()) base.cleaning_fee = cleaning.value.trim();
      if (mode.value === 'type') {
        const [property_id, ...rt] = type.value.split('|');
        // Never adjusted into range: a count the owner did not mean would book real rooms.
        const n = Number(count.value);
        return Array.from({ length: n }, () => ({ ...base, property_id, room_type: rt.join('|') }));
      }
      return [{ ...base, unit_id: unit.value }];
    },
  };
}

// Everything wrong with a new group in one pass: the lead guest problems ({ field: message }), every row's problems and the room count.
// The count line has no box, so it shows in the form's summary.
export function groupProblems(guestProblems, rows) {
  const out = { ...guestProblems };
  for (const r of rows) Object.assign(out, r.problems());
  const total = rows.reduce((n, r) => n + r.roomCount(), 0);
  if (total < 2 || total > 20) out._rooms = 'A group needs between 2 and 20 rooms.';
  return out;
}

// A server 400 names the failing room by its place in the list sent (room_index). Moves its field messages onto that row's own boxes;
// a key with no box stays as it is (the form's summary shows it). Any other error comes back unchanged.
export function mapRoomError(err, owners) {
  const owner = err?.status === 400 && Number.isInteger(err.data?.room_index) ? owners[err.data.room_index] : null;
  if (!owner || !err.fields) return err;
  const fields = Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [owner.fieldKey(k) ?? k, v]));
  return new ApiError('Please check the highlighted fields.', { status: 400, fields });
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
  // The existing-guest area is a keyed field box, so the "pick them" sentence and the red mark land on it (showErrors drops a key with no box).
  const GUEST_KEY = 'lead_guest_pick';
  const guestErrId = `gr-lead-guest-${Math.random().toString(36).slice(2, 7)}-err`;
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search by name, email or mobile', 'aria-label': 'Search guests', 'aria-describedby': guestErrId });
  const results = h('ul', { class: 'list grp-guest-results', 'aria-live': 'polite' });
  const chosen = h('div', { class: 'chips' });
  const existingBox = h('div', { class: 'stack field', hidden: true, dataset: { field: GUEST_KEY } }, search, results, chosen, h('div', { class: 'error', id: `${guestErrId}`, role: 'alert' }));
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
        const shown = guests.slice(0, 8);
        // More matches than the list shows get a line saying so, so the host knows to type more.
        const more = guests.length > shown.length ? [h('li', { class: 'muted small' }, `Showing ${shown.length} of ${guests.length}. Type more to narrow the search.`)] : [];
        results.replaceChildren(...(guests.length ? shown.map((g) => h('li', null, h('button', {
          type: 'button', class: 'grp-guest', onclick: () => {
            picked = g; results.replaceChildren();
            search.dispatchEvent(new Event('change', { bubbles: true })); // clears the "pick them" mark through the form's change handler
            chosen.replaceChildren(h('span', { class: 'badge badge--active' }, g.full_name), h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => { picked = null; chosen.replaceChildren(); } }, 'Change'));
          },
        }, h('strong', null, g.full_name), g.email || g.phone ? h('span', { class: 'muted small' }, ` · ${g.email || g.phone}`) : null))) : [h('li', { class: 'muted small' }, 'No guest found. Switch to "New guest".')]), ...more);
      } catch (err) { results.replaceChildren(h('li', { class: 'error' }, err.message)); }
    }, 300);
  });

  const rowsBox = h('div', { class: 'stack' });
  const rows = [];
  const addRow = () => {
    const r = roomRow({
      ...choices, defaults, number: rows.length + 1,
      onRemove: (el) => {
        if (rows.length <= 1) { toast('A group needs at least one room row.', 'error'); return; }
        rows.splice(rows.findIndex((x) => x.el === el), 1); el.remove();
        rows.forEach((x, i) => x.setNumber(i + 1));
      },
    });
    rows.push(r); rowsBox.append(r.el);
  };
  addRow(); addRow();
  const conflicts = h('div');
  let takenBanner = false; // the form's error line is the ROOMS_TAKEN message

  // The lead guest's own problems: a new guest needs a name; an existing guest must be picked (on the keyed existing-guest box).
  const collect = (d) => groupProblems(
    guestMode.value === 'existing'
      ? (picked ? {} : { [GUEST_KEY]: 'Search for the lead guest and pick them, or switch to "New guest".' })
      : (String(d.guest_name ?? '').trim() ? {} : { guest_name: 'Lead guest name is required.' }),
    rows);

  let modal;
  const form = makeForm({
    submitText: 'Create group booking',
    cancel: () => modal.close(),
    // The lead guest, every room row and the room count are checked in the first pass, so a blank group name can't hide any of them.
    check: (d) => { const bad = collect(d); return Object.keys(bad).length ? bad : null; },
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
      const bad = collect(d);
      if (Object.keys(bad).length) throw new ApiError('Please check the highlighted fields.', { status: 400, fields: bad });
      const guest = guestMode.value === 'existing'
        ? { guest_id: picked.guest_id }
        : { full_name: d.guest_name.trim(), ...(d.guest_phone && { phone: d.guest_phone }), ...(d.guest_email && { email: d.guest_email }) };
      // rooms() cannot throw now: collect() found no row problems.
      const list = rows.flatMap((r) => r.rooms());
      const owners = rows.flatMap((r) => r.rooms().map(() => r));
      try {
        const res = await post('/booking-groups', { name: d.name.trim(), guest, rooms: list, ...(d.notes && { notes: d.notes }) });
        // The server joins a typed lead guest to a saved one with the same email and first name; say so (D-99 S1).
        const note = guest.full_name ? matchedGuestNote(guest.full_name, res.guest_name) : null;
        toast(note ? `Group booking created. ${note}` : 'Group booking created.');
        if (res.guest_do_not_rebook) toast(`Heads up: ${res.guest_do_not_rebook_name || res.guest_name || 'this guest'} is marked "Do not rebook" in Guests.`, 'error');
        modal.close();
        if (onSaved) onSaved(res); else navigate(`#/groups/${res.group.group_id}`);
      } catch (err) {
        takenBanner = err.code === 'ROOMS_TAKEN';
        if (err.status === 409) { conflicts.replaceChildren(...conflictList(err)); conflicts.scrollIntoView?.({ block: 'nearest' }); }
        throw mapRoomError(err, owners);
      }
    },
  });
  // Moving a room to free dates makes the taken list stale: drop it (and its banner line); the next save checks again.
  for (const ev of ['input', 'change']) rowsBox.addEventListener(ev, () => {
    if (conflicts.children.length) conflicts.replaceChildren();
    if (takenBanner) form.querySelector('.form-error')?.replaceChildren();
    takenBanner = false;
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
      try { list = row.rooms(); } catch (e) { throw e instanceof ApiError ? e : new ApiError(e.message, { status: 400 }); }
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
          // A cancelled group has no total owed (its rooms are cancelled); the money they still hold is named under it.
          canManage && h('td', { class: 'num' }, isCancelled(g) ? [h('span', { class: 'muted' }, 'Cancelled'), h('div', { class: 'muted small' }, Number(g.held) > 0 ? `${peso(g.held)} held` : '—')] : peso(g.total)),
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
    const reason = await confirmDialog({ title: 'Remove this room?', text: `${r.unit_name}, ${fmtDate(r.check_in)} – ${fmtDate(r.check_out)} will be cancelled. Payments stay on record.${low}`, confirmText: 'Remove room', danger: true, reason: true,
      // The request runs inside the dialog: a refusal is said there and the typed reason stays (D-115).
      onConfirm: (why) => post(`/booking-groups/${g.group_id}/rooms/${r.booking_id}/remove`, { reason: why }) });
    if (!reason) return;
    toast('Room removed.'); rerender();
  };
  const cancelGroup = async () => {
    const reason = await confirmDialog({ title: 'Cancel the whole group?', text: `${active.length === 1 ? 'The 1 room' : `All ${active.length} rooms`} will be cancelled and the dates become available again. Payments stay on record.`, confirmText: 'Cancel group', cancelText: 'Keep group', danger: true, reason: true,
      // The request runs inside the dialog: a refusal is said there and the typed reason stays (D-115).
      onConfirm: (why) => post(`/booking-groups/${g.group_id}/cancel`, { reason: why }) });
    if (!reason) return;
    toast('Group cancelled.'); rerender();
  };

  const cols = ['Listing', 'Dates', 'Guests'];
  el.replaceChildren(
    h('a', { class: 'back', href: '#/groups' }, '‹ Group bookings'),
    h('div', { class: 'page-head' },
      h('div', { class: 'page-head__title' },
        h('h1', null, g.name),
        h('p', null, `${guest ? `Lead guest ${guest.full_name} · ` : ''}${roomsLine(rooms, cancelled)}`)),
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
          // Rooms of one listing repeat, so each row's controls are named by listing and dates (and room number if even those match).
          const which = `${r.unit_name}, ${fmtDate(r.check_in)} – ${fmtDate(r.check_out)}`;
          const twin = rooms.filter((x) => `${x.unit_name}|${x.check_in}|${x.check_out}` === `${r.unit_name}|${r.check_in}|${r.check_out}`).length > 1;
          const rowName = twin ? `${which}, room ${rooms.indexOf(r) + 1}` : which;
          return h('tr', null,
            h('td', null, h('a', { class: 'link-tap', href: `#/reservations/${r.booking_id}`, 'aria-label': rowName }, h('strong', null, r.unit_name)), off && h('span', { class: 'badge badge--voided' }, 'Cancelled')),
            h('td', null, `${fmtDate(r.check_in)} – ${fmtDate(r.check_out)}`, h('div', { class: 'muted small' }, (n => `${n} night${n === 1 ? '' : 's'}`)(nightsOf(r.check_in, r.check_out)))),
            h('td', null, r.num_guests ? String(r.num_guests) : '—'),
            // A cancelled room is not in the group total, so its amount is not shown as owed (the balance column does the same).
            canManage && h('td', { class: 'num' }, off ? ['—', h('span', { class: 'sr-only' }, ' Cancelled')] : peso(r.total_amount)),
            canManage && h('td', { class: 'num' }, peso(r.amount_paid)),
            canManage && h('td', { class: `num${Number(r.balance) > 0 && !off ? ' amount--neg' : ''}` }, off ? '—' : peso(r.balance)),
            canManage && !cancelled && h('td', null, !off && h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': `Remove ${rowName}, from the group`, onclick: () => removeRoom(r) }, 'Remove')));
        })),
        canManage && h('tfoot', null, h('tr', null, h('td', { colspan: 3 }, 'Group total'),
          h('td', { class: 'num' }, peso(totals.total)), h('td', { class: 'num' }, peso(totals.amount_paid)),
          h('td', { class: `num${Number(totals.balance) > 0 ? ' amount--neg' : ''}` }, peso(totals.balance)), !cancelled && h('td')),
          // Money still held on rooms that were removed or cancelled. It is on record but not part of the total above.
          Number(totals.held) > 0 && h('tr', null, h('td', { colspan: cancelled ? 6 : 7, class: 'muted' }, `Held from cancelled rooms ${peso(totals.held)}`)))))
        : h('p', { class: 'muted' }, 'No rooms in this group.')),
    canManage && h('p', { class: 'muted small' }, 'Payments are recorded on each room\'s reservation. Open a room to record one.'));
}
