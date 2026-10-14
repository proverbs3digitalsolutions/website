// Listings (units rented per night), cleaning status and channel connections.

import { get, post, patch, qs, api, ApiError } from '../api.js';
import {
  h, icon, peso, pesoShort, fmtDate, fmtDateTime, badge, field, formModal, makeForm, openModal, confirmDialog, emptyState, toast, options, todayManila, manilaDay,
} from '../ui.js';
import { state } from '../app.js';
import { initFilters, filterBar, rememberFilters, changed } from '../filters.js';
import { CHANNEL_LABEL, SOURCE_LABEL, addDays } from './reservations.js';
import { copyText } from './quotes.js';

const UNIT_TYPES = ['studio', 'apartment', 'room', 'house', 'other'];
const PROPERTY_TYPES = ['condominium', 'apartment', 'house', 'boarding_house', 'other'];

// Tags: type and press Enter or comma. Lowercase, up to 10, up to 30 characters each.
const MAX_TAGS = 10;
function tagsField(initial = []) {
  const tags = [];
  const hidden = h('input', { type: 'hidden', name: 'tags', value: '' });
  const chips = h('span', { class: 'tag-chips' });
  const input = h('input', { class: 'input', type: 'text', id: `tg-${Math.random().toString(36).slice(2, 7)}`, maxlength: 31, placeholder: 'e.g. beachfront, pet-friendly', autocomplete: 'off', enterkeyhint: 'done' });
  const msg = h('p', { class: 'muted small', 'aria-live': 'polite' }, 'Press Enter or comma to add. Up to 10 tags, used to filter listings and for bulk changes.');
  const paint = () => {
    hidden.value = tags.join(',');
    hidden.dispatchEvent(new Event('input', { bubbles: true }));
    chips.replaceChildren(tags.map((t) => h('span', { class: 'tag-chip' }, t,
      h('button', { type: 'button', class: 'tag-chip__x', 'aria-label': `Remove tag ${t}`, onclick: () => { tags.splice(tags.indexOf(t), 1); paint(); input.focus(); } }, '×'))));
  };
  const add = (raw) => {
    const t = String(raw).trim().toLowerCase().replace(/\s+/g, '-').slice(0, 30);
    if (!t) return;
    if (tags.includes(t)) { msg.textContent = `"${t}" is already added.`; return; }
    if (tags.length >= MAX_TAGS) { msg.textContent = `You can add up to ${MAX_TAGS} tags.`; return; }
    tags.push(t); paint();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input.value); input.value = ''; }
    else if (e.key === 'Backspace' && !input.value && tags.length) { tags.pop(); paint(); }
  });
  input.addEventListener('input', () => { if (input.value.includes(',')) { input.value.split(',').forEach(add); input.value = ''; } });
  input.addEventListener('blur', () => { add(input.value); input.value = ''; });
  (Array.isArray(initial) ? initial : []).forEach(add);
  const id = input.id;
  return h('div', { class: 'field', dataset: { field: 'tags' } }, h('label', { for: id }, 'Tags'), chips, input, msg, hidden, h('div', { class: 'error', role: 'alert' }));
}

async function roomTypeNames() {
  try { return [...new Set((await get('/room-types')).room_types.map((r) => r.room_type).filter(Boolean))]; } catch { return []; }
}

// The server wants real lists and numbers, not form strings.
function prepUnit(d) {
  return { ...d, tags: d.tags ? d.tags.split(',').filter(Boolean) : [], min_price: d.min_price === '' ? null : d.min_price, room_type: d.room_type?.trim() || null };
}

// A typed amount as a number ("₱5,000" becomes 5000), read the same way the server reads money.
const moneyNumber = (v) => Number(String(v ?? '').replace(/[₱,\s]/g, ''));

// A lowest price above the usual nightly rate means every night costs at least that much, so ask first.
// Resolves true when the save may go ahead; a cancelled question resolves false and nothing is saved.
async function lowPriceOk(d) {
  const floor = moneyNumber(d.min_price); const rate = moneyNumber(d.nightly_rate);
  if (!d.min_price || !(floor > rate)) return true;
  return Boolean(await confirmDialog({ title: 'Check the lowest price?', confirmText: 'Save anyway',
    text: `Your lowest price (${pesoShort(floor)}) is above your usual nightly price (${pesoShort(rate)}), so every night will cost at least ${pesoShort(floor)}. Save anyway?` }));
}

const BUILDING_SAVED = 'The building was saved; fix the listing details and save again.';

function listingFields(u = {}, roomTypes = []) {
  return [
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'unit_name', label: 'Listing name', required: true, value: u.unit_name, placeholder: 'e.g. Tower 1 - 1201 or Studio A', maxlength: 60 }),
      field({ name: 'unit_type', label: 'Type', type: 'select', required: true, value: u.unit_type || 'studio', placeholderOption: false, options: options(UNIT_TYPES) })),
    h('div', { class: 'form-row form-row--2' },
      (() => {
        const f = field({ name: 'room_type', label: 'Room type', value: u.room_type, maxlength: 40, placeholder: 'e.g. Studio, 1-bedroom', hint: 'Lets you pick "any free room of this type" on a booking.' });
        const inp = f.querySelector('input');
        const dl = h('datalist', { id: `rt-${Math.random().toString(36).slice(2, 7)}` }, roomTypes.map((t) => h('option', { value: t })));
        inp.setAttribute('list', dl.id); f.append(dl);
        return f;
      })(),
      tagsField(u.tags)),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'nightly_rate', label: 'Base nightly rate', type: 'money', required: true, value: u.nightly_rate, placeholder: '2,500' }),
      field({ name: 'cleaning_fee', label: 'Cleaning fee per stay', type: 'money', value: u.cleaning_fee, placeholder: '500' })),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'max_guests', label: 'Maximum guests', type: 'number', min: 1, max: 50, value: u.max_guests || 2, inputmode: 'numeric' }),
      field({ name: 'security_deposit_amount', label: 'Security deposit', type: 'money', value: u.security_deposit_amount })),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'checkin_time', label: 'Check-in time', type: 'time', value: u.checkin_time || '14:00' }),
      field({ name: 'checkout_time', label: 'Check-out time', type: 'time', value: u.checkout_time || '12:00' })),
    h('hr', { class: 'divider' }),
    h('h3', { class: 'subhead' }, 'Pricing helpers (optional)'),
    h('p', { class: 'muted small' }, 'Applied automatically to new quotes and your booking page. For date ranges like summer or Holy Week, add a season in Calendar → Pricing rules.'),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'weekend_rate', label: 'Weekend rate (Fri & Sat nights)', type: 'money', value: u.weekend_rate, placeholder: 'Same as base' }),
      field({ name: 'holiday_rate', label: 'Holiday rate', type: 'money', value: u.holiday_rate, placeholder: 'Same as base',
        hint: 'PH holidays and long weekends, e.g. Holy Week, Christmas, New Year.' })),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'weekly_discount', label: 'Weekly discount % (7+ nights)', type: 'number', min: 0, max: 50, value: u.weekly_discount || 0, inputmode: 'numeric' }),
      field({ name: 'monthly_discount', label: 'Monthly discount % (28+ nights)', type: 'number', min: 0, max: 70, value: u.monthly_discount || 0, inputmode: 'numeric' })),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'fortnight_discount', label: '14+ night discount %', type: 'number', min: 0, max: 90, value: u.fortnight_discount || 0, inputmode: 'numeric',
        hint: 'Between the weekly and monthly discounts.' }),
      field({ name: 'min_price', label: 'Lowest price per night (optional)', type: 'money', value: u.min_price, placeholder: 'No floor',
        hint: 'Rules and discounts never take a night below this.' })),
    h('hr', { class: 'divider' }),
    h('h3', { class: 'subhead' }, 'Guest info (used in messages to guests)'),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'wifi_name', label: 'Wi-Fi name', value: u.wifi_name, maxlength: 100 }),
      field({ name: 'wifi_password', label: 'Wi-Fi password', value: u.wifi_password, maxlength: 100 })),
    field({ name: 'checkin_instructions', label: 'Check-in instructions', type: 'textarea', value: u.checkin_instructions, maxlength: 3000,
      placeholder: 'e.g. Show your ID at the lobby, get the key from the guard, unit is on the 12th floor…' }),
    field({ name: 'house_rules', label: 'House rules', type: 'textarea', value: u.house_rules, maxlength: 3000, placeholder: 'e.g. No smoking. No parties. Quiet hours 10 PM – 7 AM.' }),
    h('hr', { class: 'divider' }),
    h('h3', { class: 'subhead' }, 'Direct booking page'),
    field({ name: 'bookable_online', label: 'Show this listing on my booking page', type: 'checkbox', value: Boolean(u.bookable_online) }),
    field({ name: 'description', label: 'Description for guests', type: 'textarea', value: u.description, maxlength: 3000,
      placeholder: 'e.g. Bright studio with a balcony and city view, fast Wi-Fi, smart TV, kitchenette, pool and gym access. 5 minutes from the mall.' }),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'payment_option', label: 'Online payment', type: 'select', value: u.payment_option || 'either', placeholderOption: false, options: [
        ['either', 'Guest chooses: full or deposit'], ['full', 'Full payment only'], ['deposit', 'Deposit only, rest before check-in'],
      ] }),
      field({ name: 'min_nights', label: 'Minimum nights', type: 'number', min: 1, max: 60, value: u.min_nights || 1, inputmode: 'numeric' })),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'deposit_pct', label: 'Deposit (% of the total)', type: 'number', required: true, min: 10, max: 90, value: u.deposit_pct ?? 50, inputmode: 'numeric',
        hint: 'What a guest pays now when they choose a deposit. From 10 to 90.' }),
      field({ name: 'balance_due_days', label: 'Balance due (days before check-in)', type: 'number', min: 0, max: 60, value: u.balance_due_days ?? 3, inputmode: 'numeric',
        hint: 'For deposits. Use your payment reminder message to ask for the rest.' })),
    field({ name: 'cancellation_policy', label: 'Cancellation policy', type: 'select', value: u.cancellation_policy || '', placeholderOption: 'Not set (nothing shown to guests)', options: [
      ['flexible', 'Flexible'], ['moderate', 'Moderate'], ['strict', 'Strict'], ['non_refundable', 'Non-refundable'], ['custom', 'Custom (write your own)'],
    ] }),
    field({ name: 'cancellation_policy_text', label: 'Custom policy text', type: 'textarea', value: u.cancellation_policy_text, maxlength: 1000,
      hint: 'Shown to guests only when the policy is Custom. The presets show their own wording.' }),
  ];
}

async function addListingModal(onSaved) {
  const [{ properties }, roomTypes] = await Promise.all([get('/properties'), roomTypeNames()]);
  const isOwner = state.user.role === 'owner';
  let savedPropertyId = null; // the building this form saved, reused if the listing save fails and is retried
  const newProp = h('div', { class: 'form', hidden: properties.length > 0 },
    field({ name: 'property_name', label: 'Building / property name', placeholder: 'e.g. Azure Urban Residences', maxlength: 120 }),
    field({ name: 'property_type', label: 'Property type', type: 'select', value: 'condominium', placeholderOption: false, options: options(PROPERTY_TYPES) }),
    field({ name: 'address', label: 'Street address', maxlength: 250 }),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'city', label: 'City / municipality', maxlength: 80 }),
      field({ name: 'province', label: 'Province', maxlength: 80, placeholder: 'e.g. Metro Manila' })));
  const propSelect = properties.length ? field({
    name: 'property_id', label: 'Building / property', type: 'select', required: true, value: properties.length === 1 ? properties[0].property_id : '',
    options: [...properties.map((p) => [p.property_id, p.property_name]), ...(isOwner ? [['__new', '+ Add a new building / property']] : [])],
  }) : null;
  propSelect?.querySelector('select').addEventListener('change', (e) => { newProp.hidden = e.target.value !== '__new'; });
  if (!properties.length && !isOwner) { toast('Ask the workspace owner to add a property first.', 'error'); return; }
  // Not formModal: a cancelled question must leave the form open with what was typed.
  const modal = openModal({ title: 'Add listing', body: makeForm({
    submitText: 'Save listing', draftKey: 'listing-new', cancel: () => modal.close(),
    fields: [propSelect, newProp, h('hr', { class: 'divider' }), ...listingFields({}, roomTypes)],
    onSubmit: async (raw) => {
      const d = prepUnit(raw);
      if (!await lowPriceOk(d)) return;
      let propertyId = d.property_id;
      if (!propertyId || propertyId === '__new') {
        // A building saved by an earlier try in this form is reused, never posted twice.
        if (!savedPropertyId) {
          const res = await post('/properties', { property_name: d.property_name, property_type: d.property_type, address: d.address, city: d.city, province: d.province });
          savedPropertyId = res.property.property_id;
          // The form now points at the saved building, so the new-building fields are no longer used.
          const sel = propSelect?.querySelector('select');
          if (sel) {
            sel.querySelector('option[value="__new"]')?.remove();
            sel.append(h('option', { value: savedPropertyId }, d.property_name));
            sel.value = savedPropertyId;
            sel.dispatchEvent(new Event('input', { bubbles: true })); // keeps the saved draft in step
          }
          newProp.hidden = true;
        }
        propertyId = savedPropertyId;
      }
      try {
        await post(`/properties/${propertyId}/units`, d);
      } catch (err) {
        if (propertyId === savedPropertyId && err instanceof ApiError) {
          if (err.offline) throw new ApiError(BUILDING_SAVED, { status: 0 });
          err.onRender = (box) => box.append(h('div', { class: 'alert alert--warn' }, BUILDING_SAVED));
        }
        throw err;
      }
      toast('Listing added. Next: connect your Airbnb or Booking.com calendar.');
      onSaved();
      modal.close();
    },
  }) });
}

// Listing photos for the booking page: upload (shrunk first), choose the cover, delete.
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    if (blob) return blob;
  } catch { /* use the original */ }
  return file;
}

async function photosModal(listing) {
  const box = h('div', { class: 'stack' });
  const m = openModal({ title: `Photos · ${listing.unit_name}`, body: box, wide: true });
  async function draw() {
    const { photos } = await get(`/units/${listing.unit_id}/photos`);
    const input = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'input', 'aria-label': 'Listing photos' });
    const status = h('span', { class: 'muted small', 'aria-live': 'polite' });
    box.replaceChildren(
      h('p', { class: 'muted small' }, 'Shown on your booking page. The first photo is the cover. Up to 12 photos; large photos are resized automatically.'),
      photos.length ? h('div', { class: 'ph-grid' }, photos.map((p, i) => h('figure', { class: 'ph-item' },
        h('img', { src: `/api/files/${p.file_id}`, alt: '', loading: 'lazy' }),
        h('figcaption', null,
          i === 0 ? h('span', { class: 'badge badge--paid' }, 'Cover') : h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: async () => { await post(`/listing-photos/${p.file_id}/cover`); draw(); } }, 'Make cover'),
          h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: async () => { if (!await confirmDialog({ title: 'Delete this photo?', text: 'It is removed from your booking page.', confirmText: 'Delete photo', danger: true })) return; await post(`/listing-photos/${p.file_id}/remove`); draw(); } }, 'Delete')))))
        : h('p', { class: 'muted' }, 'No photos yet.'),
      h('div', { class: 'form' }, input,
        h('div', { class: 'chips' }, h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: async (e) => {
          const files = [...input.files];
          if (!files.length) { toast('Choose photos first.', 'error'); return; }
          e.target.disabled = true;
          try {
            for (const [i, f] of files.entries()) {
              status.textContent = `Uploading ${i + 1} of ${files.length}…`;
              const blob = await shrink(f);
              await api('POST', `/units/${listing.unit_id}/photos`, undefined, { rawBody: blob, headers: { 'Content-Type': blob.type || 'image/jpeg' } });
            }
            toast('Photos uploaded.');
          } catch (err) { toast(err.message, 'error'); }
          draw();
        } }, 'Upload'), status)));
  }
  try { await draw(); } catch (err) { m.close(); toast(err.message, 'error'); }
}

// A failed sync's own text is raw (DNS, HTTP or file errors), so the toast uses the plain sentence the
// channel list shows for that feed. The raw text stays under "Technical details" there (D-76).
async function syncToastText(unitId, feedId, sync) {
  if (sync.ok || String(sync.message).startsWith('Synced:')) return sync.message; // "Synced:" = synced, some overlaps skipped
  const feed = await get(`/units/${unitId}/channels`).then((r) => r.feeds.find((f) => f.feed_id === feedId)).catch(() => null);
  return feed?.problem_message || "Couldn't reach the calendar link. Check the link on the listing's Channels page.";
}

async function channelsModal(listing, onChange) {
  let data;
  try { data = await get(`/units/${listing.unit_id}/channels`); } catch (err) { toast(err.message, 'error'); return; }
  const exportInput = h('input', { class: 'input', readonly: true, value: data.export_url, 'aria-label': 'BalayHub calendar link' });
  const feedRow = (f) => h('li', null, h('div', { class: 'row' },
    h('div', { class: 'row__main' },
      h('span', { class: 'row__title' }, `${CHANNEL_LABEL[f.channel]}${f.host ? ` (${f.host})` : ''}`),
      h('span', { class: 'row__sub', style: { wordBreak: 'break-all' } }, f.url),
      h('span', { class: `row__sub ${f.last_status === 'error' ? 'amount--neg' : ''}` }, f.last_synced_at ? `${fmtDateTime(f.last_synced_at)} — ${f.problem_message || f.last_message || ''}` : 'Not synced yet'),
      // Support still needs the raw text, so it stays under a muted label when a plain message replaced it.
      f.problem_message && f.last_message && h('span', { class: 'row__sub muted small' }, `Technical details: ${f.last_message}`)),
    h('div', { class: 'row__end' }, h('div', { class: 'chips' },
      h('button', { class: 'btn btn--secondary btn--sm', onclick: async (e) => {
        e.target.disabled = true;
        try { const r = await post(`/ical-feeds/${f.feed_id}/sync`); toast(await syncToastText(listing.unit_id, f.feed_id, r.sync), r.sync.ok ? 'info' : 'error'); m.close(); channelsModal(listing, onChange); onChange(); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
      } }, 'Sync now'),
      h('button', { class: 'btn btn--ghost btn--sm', onclick: async () => {
        if (!await confirmDialog({ title: `Disconnect ${CHANNEL_LABEL[f.channel]}?`, text: 'Future stays from this channel are cancelled, and its calendar blocks are removed. Past stays and any stays with payments are kept.', confirmText: 'Disconnect', danger: true })) return;
        try { await post(`/ical-feeds/${f.feed_id}/remove`); toast('Calendar disconnected.'); m.close(); channelsModal(listing, onChange); onChange(); } catch (err) { toast(err.message, 'error'); }
      } }, 'Disconnect')))));
  const status = h('div');
  const addForm = h('form', { class: 'form', novalidate: true },
    status,
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'channel', label: 'Channel', type: 'select', value: 'airbnb', placeholderOption: false, options: [['airbnb', 'Airbnb'], ['booking', 'Booking.com'], ['agoda', 'Agoda'], ['vrbo', 'Vrbo'], ['expedia', 'Expedia'], ['tripcom', 'Trip.com'], ['other', 'Other (any site with a calendar link)']] }),
      field({ name: 'url', label: 'Their calendar (iCal) link', type: 'url', placeholder: 'https://www.airbnb.com/calendar/ical/…' })),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn btn--primary', type: 'submit' }, 'Connect calendar')));
  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = addForm.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Connecting…';
    try {
      const r = await post('/ical-feeds', { unit_id: listing.unit_id, channel: addForm.elements.channel.value, url: addForm.elements.url.value });
      const text = await syncToastText(listing.unit_id, r.feed_id, r.sync);
      toast(r.sync.ok ? `Connected. ${text}` : `Connected, but the first sync failed: ${text}`, r.sync.ok ? 'info' : 'error');
      m.close(); channelsModal(listing, onChange); onChange();
    } catch (err) {
      status.replaceChildren(h('div', { class: 'alert alert--error' }, err.fields?.url || err.message));
      btn.disabled = false; btn.textContent = 'Connect calendar';
    }
  });
  const m = openModal({
    title: `Channels · ${listing.unit_name}`, wide: true,
    body: h('div', { class: 'stack' },
      h('section', null,
        h('h3', null, '1. Give your BalayHub calendar to each channel'),
        h('p', { class: 'muted small' }, 'Paste this link into Airbnb (Calendar → Availability → Connect to another website), Booking.com (Rates & Availability → Sync calendars) or Agoda. They will then block nights booked in BalayHub. Keep the link private.'),
        h('div', { class: 'chips' }, exportInput,
          h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: async () => { exportInput.select(); try { await navigator.clipboard.writeText(data.export_url); toast('Link copied.'); } catch { toast('Select the link and copy it.'); } } }, 'Copy'),
          h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: async () => {
            if (!await confirmDialog({ title: 'Create a new link?', text: 'The old link stops working. You will need to paste the new one into each channel.', confirmText: 'Create new link', danger: true })) return;
            await post(`/units/${listing.unit_id}/channels/rotate`); m.close(); channelsModal(listing, onChange);
          } }, 'Reset link'))),
      h('section', null,
        h('h3', null, '2. Bring in bookings from your channels'),
        h('p', { class: 'muted small' }, 'Copy the "Export calendar" link from Airbnb, Booking.com or Agoda and paste it here. BalayHub checks it every 30 minutes. Calendar links share dates only — add guest names and amounts on each reservation if you want them in your reports.'),
        data.feeds.length ? h('ul', { class: 'list' }, data.feeds.map(feedRow)) : h('p', { class: 'muted small' }, 'No channels connected yet.'),
        addForm)),
  });
}

// Guest pages: the guidebook (English and Taglish), the public page address and share links.
const GUIDE_FIELDS = [
  ['arrival', 'Arrival and directions'], ['parking', 'Parking'], ['building_notes', 'Building and gate notes'],
  ['local_tips', 'Local tips'], ['emergency_contacts', 'Emergency contacts'],
];

async function guestPagesModal(listing) {
  let guide; let unit; let booking = null;
  try {
    const [g, p] = await Promise.all([get(`/units/${listing.unit_id}/guide`), get(`/properties/${listing.property_id}`)]);
    guide = g.guide;
    unit = p.units.find((x) => x.unit_id === listing.unit_id) || {};
    booking = await get('/direct-booking').catch(() => null);
  } catch (err) { toast(err.message, 'error'); return; }

  // ---- guidebook
  let lang = 'en';
  const langBox = { en: h('div', { class: 'stack' }), tl: h('div', { class: 'stack' }) };
  for (const [key, text] of GUIDE_FIELDS) {
    langBox.en.append(field({ name: key, label: text, type: 'textarea', value: guide[key], maxlength: 2000 }));
    langBox.tl.append(field({ name: `${key}_tl`, label: `${text} (Taglish)`, type: 'textarea', value: guide[`${key}_tl`], maxlength: 2000 }));
  }
  const showBtn = h('button', { class: 'btn btn--secondary btn--sm', type: 'button', 'aria-pressed': 'false' }, 'Show');
  const codeInput = h('input', { class: 'input', type: 'password', name: 'door_code', maxlength: 40, autocomplete: 'off', value: guide.door_code || '', 'aria-label': 'Door code' });
  showBtn.addEventListener('click', () => {
    const on = codeInput.type === 'password';
    codeInput.type = on ? 'text' : 'password'; showBtn.textContent = on ? 'Hide' : 'Show'; showBtn.setAttribute('aria-pressed', String(on));
  });
  const langTabs = h('div', { class: 'tabs tabs--compact', role: 'tablist' });
  const setLang = (v) => {
    lang = v; langBox.en.hidden = v !== 'en'; langBox.tl.hidden = v !== 'tl';
    langTabs.replaceChildren(...[['en', 'English'], ['tl', 'Taglish']].map(([k, t]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(lang === k), onclick: () => setLang(k) }, t)));
  };
  setLang('en');
  const guideForm = makeForm({
    submitText: 'Save guidebook',
    fields: [
      h('p', { class: 'muted small' }, 'Guests open this from a private link. The Taglish version is optional; empty parts show the English text. Wi-Fi and check-in instructions come from the listing details (Edit).'),
      langTabs, langBox.en, langBox.tl,
      h('div', { class: 'field' }, h('label', null, 'Door code'), h('div', { class: 'hp-secret' }, codeInput, showBtn),
        h('div', { class: 'hint' }, 'Stored encrypted. Guests see it only from the day before check-in until check-out day. Empty means no code.')),
    ],
    onSubmit: async (d) => { await api('PUT', `/units/${listing.unit_id}/guide`, d); toast('Guidebook saved.'); },
  });

  // ---- page address and share links
  const slugForm = makeForm({
    submitText: 'Save address',
    fields: [field({ name: 'public_slug', label: 'Public page address', value: unit.public_slug, maxlength: 60, hint: 'Lowercase letters, numbers and dashes, 3 to 60. Used in the web address of this listing\'s page.' })],
    onSubmit: async (d) => { const r = await patch(`/units/${listing.unit_id}`, { public_slug: d.public_slug }); unit.public_slug = (r.unit || d).public_slug || d.public_slug; toast('Page address saved.'); drawLinks(); },
  });
  const linksBox = h('div', { class: 'stack' });
  const src = h('select', { class: 'input', id: 'share-src' }, Object.entries(SOURCE_LABEL).filter(([k]) => k !== 'quote').map(([k, t]) => h('option', { value: k }, t)));
  const shareUrl = () => `${booking.url.replace(/#.*$/, '')}#/book/${booking.slug}/${listing.unit_id}?src=${src.value}`;
  const out = h('input', { class: 'input', readonly: true, 'aria-label': 'Share link' });
  function drawLinks() {
    const live = booking?.slug && booking.enabled && listing.bookable_online;
    const pageUrl = booking?.slug && unit.public_slug ? `${location.origin}/stay/${booking.slug}/${unit.public_slug}` : null;
    out.value = booking?.url ? shareUrl() : '';
    linksBox.replaceChildren(
      pageUrl ? h('p', { class: 'small' }, h('a', { class: 'btn btn--secondary btn--sm', href: pageUrl, target: '_blank', rel: 'noopener' }, 'View page'), ' ', h('span', { class: 'muted hp-wrap' }, pageUrl))
        : h('p', { class: 'muted small' }, 'Set your booking page address in Settings and a page address here to get a public page.'),
      !live && h('div', { class: 'alert alert--warn' }, 'This listing is not live on your booking page yet. Turn on your booking page in Settings and tick "Show this listing on my booking page" in Edit.'),
      booking?.url ? h('div', { class: 'field' }, h('label', { for: 'share-src' }, 'Share link for'), src,
        h('div', { class: 'hp-copy' }, out, h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => copyText(out.value) }, 'Copy')),
        h('div', { class: 'hint' }, 'Bookings made from this link are tagged with where it was shared, so Reports can show what works.'))
        : h('p', { class: 'muted small' }, 'Set up your booking page in Settings to get share links.'));
  }
  src.addEventListener('change', () => { if (booking?.url) out.value = shareUrl(); });
  drawLinks();

  const panels = { guide: guideForm, page: h('div', { class: 'stack' }, slugForm, h('hr', { class: 'divider' }), linksBox) };
  const mainTabs = h('div', { class: 'tabs', role: 'tablist' });
  const setTab = (k) => {
    for (const [name, el] of Object.entries(panels)) el.hidden = name !== k;
    mainTabs.replaceChildren(...[['guide', 'Guidebook'], ['page', 'Page and share links']].map(([n, t]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(n === k), onclick: () => setTab(n) }, t)));
  };
  setTab('guide');
  openModal({ title: `Guest pages · ${listing.unit_name}`, wide: true, body: h('div', { class: 'stack' }, mainTabs, panels.guide, panels.page) });
}

// Listings are few (1–10 for most hosts), so they're filtered here in the browser.
const LISTING_SORTS = {
  rate: (a, b) => Number(b.nightly_rate || 0) - Number(a.nightly_rate || 0),
  rate_asc: (a, b) => Number(a.nightly_rate || 0) - Number(b.nightly_rate || 0),
  next: (a, b) => (a.next_check_in || '9999').localeCompare(b.next_check_in || '9999'),
  guests: (a, b) => Number(b.max_guests || 0) - Number(a.max_guests || 0),
};

function matchListing(l, f, bookable) {
  const q = f.q.toLowerCase();
  if (q && ![l.unit_name, l.property_name, l.city].some((x) => (x || '').toLowerCase().includes(q))) return false;
  if (f.cleaning && l.cleaning_status !== f.cleaning) return false;
  if (f.property_id && l.property_id !== f.property_id) return false;
  if (f.unit_type && l.unit_type !== f.unit_type) return false;
  if (f.tag && Array.isArray(l.tags) && !l.tags.includes(f.tag)) return false;
  if (f.occupancy === 'vacant' && l.current_booking_id) return false;
  if (f.occupancy === 'occupied' && !l.current_booking_id) return false;
  if (f.occupancy === 'arriving' && !(l.next_check_in && l.next_check_in <= addDays(todayManila(), 7))) return false;
  if (f.occupancy === 'no_next' && l.next_check_in) return false;
  if (f.channels === 'connected' && !Number(l.channel_count)) return false;
  if (f.channels === 'none' && Number(l.channel_count)) return false;
  if (f.direct === 'on' && !bookable.has(l.unit_id)) return false;
  if (f.direct === 'off' && bookable.has(l.unit_id)) return false;
  if (/^\d+$/.test(f.min_guests) && Number(l.max_guests || 0) < Number(f.min_guests)) return false;
  return true;
}

// Archive keeps a listing's history and hides it from the listings; Restore brings it back. Owners only.
async function changeArchive(listing, action, onDone) {
  if (action === 'archive' && !await confirmDialog({ title: `Archive ${listing.unit_name}?`, text: 'Its history is kept. You can restore it later.', confirmText: 'Archive', danger: true })) return;
  try {
    await post(`/units/${listing.unit_id}/${action}`);
    toast(action === 'archive' ? 'Listing archived.' : 'Listing restored.');
    onDone();
  } catch (err) { toast(err.message, 'error'); }
}

export async function listingsView(el, { query }) {
  const canManage = state.user.role !== 'staff';
  const isOwner = state.user.role === 'owner';
  const defaults = { q: '', cleaning: '', property_id: '', tag: '', unit_type: '', occupancy: '', channels: '', direct: '', min_guests: '', sort: '', status: '' };
  const filters = initFilters('listings', query, defaults);
  if (!['', 'dirty', 'clean'].includes(filters.cleaning)) filters.cleaning = '';
  if (!isOwner || !['', 'archived'].includes(filters.status)) filters.status = '';
  const [{ properties }, tagList] = await Promise.all([get('/properties'), get('/tags').then((r) => r.tags).catch(() => [])]);
  const box = h('div');
  // Archived units are not in GET /listings, so they are read from each building's own page.
  async function loadArchived() {
    bar.hidden = false;
    const perBuilding = await Promise.all(properties.map((p) => get(`/properties/${p.property_id}`).then((r) => r.units
      .filter((u) => u.status === 'archived').map((u) => ({ ...u, property_name: p.property_name, city: p.city })))));
    const q = filters.q.toLowerCase();
    const shown = perBuilding.flat().filter((u) => (!q || [u.unit_name, u.property_name, u.city].some((x) => (x || '').toLowerCase().includes(q)))
      && (!filters.property_id || u.property_id === filters.property_id));
    box.replaceChildren(shown.length
      ? h('div', { class: 'listing-grid' }, shown.map((u) => h('article', { class: 'card listing' },
        h('div', { class: 'card__head' },
          h('div', null, h('h2', null, u.unit_name), h('p', { class: 'muted small' }, `${u.property_name}${u.city ? ` · ${u.city}` : ''}`)),
          badge('voided', 'Archived')),
        h('div', { class: 'chips', style: { marginTop: '12px' } },
          h('button', { class: 'btn btn--secondary btn--sm', 'aria-label': `Restore ${u.unit_name}`, onclick: () => changeArchive(u, 'restore', load) }, 'Restore')))))
      : h('div', { class: 'card' }, emptyState({ iconName: 'building', title: 'No archived listings', text: 'Archived listings are hidden from your listings. Restore one to bring it back.' })));
  }
  async function load() {
    history.replaceState(null, '', `#/listings${qs(changed(filters, defaults))}`);
    if (filters.status === 'archived') return loadArchived();
    const { listings } = await get(`/listings${qs({ tag: filters.tag })}`);
    // Calendar sync problems per listing (owners and managers; the page works without them).
    const problems = new Map();
    if (['owner', 'manager'].includes(state.user.role)) {
      try { for (const p of (await get('/sync-health')).problems) problems.set(p.unit_id, [...(problems.get(p.unit_id) || []), p]); } catch { /* skip warnings */ }
    }
    // Which listings show on the booking page (owners and managers only).
    const bookable = new Set(canManage ? listings.filter((l) => l.bookable_online).map((l) => l.unit_id) : []);
    const others = { ...filters, cleaning: '' };
    const base = listings.filter((l) => matchListing(l, others, bookable));
    let shown = base.filter((l) => !filters.cleaning || l.cleaning_status === filters.cleaning);
    if (LISTING_SORTS[filters.sort]) shown = [...shown].sort(LISTING_SORTS[filters.sort]);
    const dirtyCount = base.filter((l) => l.cleaning_status === 'dirty').length;
    const setCleaning = (v) => { filters.cleaning = v; rememberFilters('listings', filters); load(); };
    const tabs = h('div', { class: 'tabs', role: 'tablist' },
      h('button', { role: 'tab', 'aria-selected': String(!filters.cleaning), onclick: () => setCleaning('') }, `All (${base.length})`),
      h('button', { role: 'tab', 'aria-selected': String(filters.cleaning === 'dirty'), onclick: () => setCleaning('dirty') }, `Needs cleaning (${dirtyCount})`),
      h('button', { role: 'tab', 'aria-selected': String(filters.cleaning === 'clean'), onclick: () => setCleaning('clean') }, `Clean (${base.length - dirtyCount})`));
    // Owners keep the filter bar even with no active listings, so they can reach the archived ones.
    bar.hidden = !listings.length && !isOwner;
    if (!listings.length) {
      box.replaceChildren(h('div', { class: 'card' }, emptyState({ iconName: 'building', title: 'No listings yet', text: 'Add each unit you rent out per night, with its base nightly rate and cleaning fee.', action: canManage && h('button', { class: 'btn btn--primary', onclick: () => addListingModal(load) }, icon('plus'), 'Add listing') })));
      return;
    }
    const otherFilters = Object.keys(changed(filters, defaults)).some((k) => k !== 'sort' && k !== 'cleaning');
    const empty = filters.cleaning === 'dirty' && !otherFilters
      ? emptyState({ title: 'All clean ✨', text: 'No listings need cleaning right now.' })
      : emptyState({ title: 'No results found', text: 'Try removing a filter.' });
    box.replaceChildren(tabs, shown.length ? h('div', { class: 'listing-grid' }, shown.map((l) => h('article', { class: `card listing${query.focus === l.unit_id ? ' is-focus' : ''}` },
      h('div', { class: 'card__head' },
        h('div', null, h('h2', null, l.unit_name), h('p', { class: 'muted small' }, `${l.property_name}${l.city ? ` · ${l.city}` : ''}${l.room_type ? ` · ${l.room_type}` : ''}`),
          l.tags?.length > 0 && h('div', { class: 'tag-chips', role: 'list', 'aria-label': 'Tags' }, l.tags.map((t) => h('span', { class: 'tag-chip', role: 'listitem' }, t)))),
        h('span', { class: `badge badge--${l.cleaning_status === 'dirty' ? 'overdue' : 'paid'}` }, l.cleaning_status === 'dirty' ? '🧹 Dirty' : '✓ Clean')),
      problems.has(l.unit_id) && h('div', { class: 'alert alert--warn sync-alert', role: 'status' },
        h('strong', null, 'Calendar sync problem'),
        h('ul', { class: 'sync-alert__list' }, problems.get(l.unit_id).map((p) => h('li', null,
          `${CHANNEL_LABEL[p.channel]}${p.host ? ` (${p.host})` : ''}: ${p.message}${p.kind === 'overlap' ? ` (${fmtDate(p.check_in)} to ${fmtDate(p.check_out)})` : ''}`))),
        canManage && h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => channelsModal(l, load) }, 'Open channels')),
      h('dl', { class: 'dl' },
        h('dt', null, 'Nightly rate'), h('dd', null, l.nightly_rate ? peso(l.nightly_rate) : '—'),
        h('dt', null, 'Cleaning fee'), h('dd', null, peso(l.cleaning_fee)),
        h('dt', null, 'Guests'), h('dd', null, l.max_guests ? `Up to ${l.max_guests}` : '—'),
        h('dt', null, 'Check-in / out'), h('dd', null, `${l.checkin_time} / ${l.checkout_time}`),
        h('dt', null, 'Now'), h('dd', null, l.current_booking_id ? h('a', { href: `#/reservations/${l.current_booking_id}` }, `${l.current_guest} until ${fmtDate(l.current_check_out)}`) : 'Vacant'),
        h('dt', null, 'Next arrival'), h('dd', null, l.next_check_in ? `${fmtDate(l.next_check_in)} · ${l.next_guest}` : '—'),
        h('dt', null, 'Channels'), h('dd', null, Number(l.channel_count) ? `${l.channel_count} connected` : 'None')),
      h('div', { class: 'chips', style: { marginTop: '12px' } },
        h('button', { class: `btn btn--sm ${l.cleaning_status === 'dirty' ? 'btn--primary' : 'btn--secondary'}`, onclick: async () => {
          await post(`/units/${l.unit_id}/cleaning`, { status: l.cleaning_status === 'dirty' ? 'clean' : 'dirty' });
          toast(l.cleaning_status === 'dirty' ? 'Marked clean.' : 'Marked as needing cleaning.'); load();
        } }, l.cleaning_status === 'dirty' ? 'Mark clean' : 'Mark dirty'),
        canManage && h('button', { class: 'btn btn--secondary btn--sm', onclick: () => channelsModal(l, load) }, 'Channels'),
        canManage && h('button', { class: 'btn btn--secondary btn--sm', onclick: () => photosModal(l) }, 'Photos'),
        canManage && h('button', { class: 'btn btn--secondary btn--sm', onclick: () => guestPagesModal(l) }, 'Guest pages'),
        canManage && h('button', { class: 'btn btn--ghost btn--sm', onclick: async () => {
          const { units } = await get(`/properties/${l.property_id}`).then((r) => ({ units: r.units }));
          const unit = units.find((u) => u.unit_id === l.unit_id);
          const roomTypes = await roomTypeNames();
          // Not formModal: a cancelled question must leave the form open with what was typed.
          const modal = openModal({ title: `Edit ${l.unit_name}`, body: makeForm({ submitText: 'Save changes', fields: listingFields({ ...unit, tags: unit.tags }, roomTypes),
            cancel: () => modal.close(),
            onSubmit: async (d) => {
              if (!await lowPriceOk(d)) return;
              await patch(`/units/${l.unit_id}`, prepUnit(d)); toast('Listing updated.'); load(); modal.close();
            } }) });
        } }, 'Edit'),
        isOwner && h('button', { class: 'btn btn--ghost btn--sm', 'aria-label': `Archive ${l.unit_name}`, onclick: () => changeArchive(l, 'archive', load) }, 'Archive'),
        h('a', { class: 'btn btn--ghost btn--sm', href: `#/reservations?q=${encodeURIComponent(l.unit_name)}&view=all` }, 'Bookings')))))
      : h('div', { class: 'card' }, empty));
  }
  const bar = filterBar({
    key: 'listings', values: filters, defaults, onChange: load,
    search: { placeholder: 'Search listing, building or city' },
    quick: [
      properties.length > 1 && { name: 'property_id', label: 'Property', all: 'All properties', options: properties.map((p) => [p.property_id, p.property_name]) },
      tagList.length > 0 && { name: 'tag', label: 'Tag', all: 'All tags', options: tagList.map((t) => [t.tag, `${t.tag} (${t.count})`]) },
      { name: 'occupancy', label: 'Occupancy', all: 'Any occupancy', options: [['vacant', 'Vacant tonight'], ['occupied', 'Guest staying now'], ['arriving', 'Arrival in the next 7 days'], ['no_next', 'No upcoming booking']] },
      isOwner && { name: 'status', label: 'Show', all: 'Active listings', options: [['archived', 'Archived listings']] },
    ].filter(Boolean),
    more: [
      { name: 'unit_type', label: 'Type', all: 'Any type', options: UNIT_TYPES.map((t) => [t, t[0].toUpperCase() + t.slice(1)]) },
      { name: 'channels', label: 'Channels', all: 'Any', options: [['connected', 'Calendar connected'], ['none', 'No channel connected']] },
      canManage && { name: 'direct', label: 'Booking page', all: 'Any', options: [['on', 'Shown on my booking page'], ['off', 'Not on my booking page']] },
      { name: 'min_guests', label: 'Fits guests (at least)', type: 'number', min: 1 },
      { name: 'sort', label: 'Sort by', all: 'Property and name', options: [['rate', 'Highest nightly rate'], ['rate_asc', 'Lowest nightly rate'], ['next', 'Next arrival'], ['guests', 'Most guests']] },
    ].filter(Boolean),
  });
  await load();
  el.replaceChildren(
    h('div', { class: 'page-head' },
      h('div', { class: 'page-head__title' }, h('h1', null, 'Listings'), h('p', null, 'Your units, rates, cleaning status and channel connections')),
      canManage && h('div', { class: 'page-head__actions' },
        h('a', { class: 'btn btn--secondary', href: '#/gatepass-settings' }, 'Gate pass'),
        h('button', { class: 'btn btn--primary', onclick: () => addListingModal(load) }, icon('plus'), 'Add listing'))),
    bar,
    box);
  if (query.new && canManage) addListingModal(load);
}

// ---------------------------------------------------------------- guests
export async function guestsView(el, { query }) {
  const canManage = state.user.role !== 'staff';
  const defaults = { q: '', segment: '', stay: '', channel: '', property_id: '', last_from: '', last_to: '', min_stays: '', rating: '', sort: '' };
  const filters = initFilters('guests', query, defaults);
  const { properties } = await get('/properties');
  const box = h('div', { class: 'card' });
  async function load() {
    const active = changed(filters, defaults);
    history.replaceState(null, '', `#/guests${qs(active)}`);
    const { guests } = await get(`/guests${qs(active)}`);
    const filtered = Object.keys(active).some((k) => k !== 'sort');
    box.replaceChildren(...(guests.length ? [
      filtered ? h('p', { class: 'muted small' }, `Showing ${guests.length} guest${guests.length === 1 ? '' : 's'}`) : '',
      h('ul', { class: 'list' }, guests.map((g) => h('li', null, h('a', { class: 'row', href: `#/guests/${g.guest_id}` },
        h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, g.full_name), !g.limited && h('span', { class: 'row__sub' }, [g.phone, g.email].filter(Boolean).join(' · ') || 'No contact details')),
        h('div', { class: 'row__end' },
          h('div', { class: 'chips' }, g.vip && badge('paid', 'VIP'), Number(g.stays) > 1 && badge('active', 'Repeat'), g.do_not_rebook && badge('overdue', 'Do not rebook'),
            g.in_house && badge('active', 'In house'), g.avg_rating && h('span', { class: 'rating small' }, `★ ${g.avg_rating}`)),
          h('span', { class: 'small' }, `${g.stays} stay${Number(g.stays) === 1 ? '' : 's'}${canManage && Number(g.total_spent) > 0 ? ` · ${peso(g.total_spent)}` : ''}`),
          g.next_stay ? h('span', { class: 'muted small' }, `Next: ${fmtDate(g.next_stay)}`) : g.last_stay && h('span', { class: 'muted small' }, `Last: ${fmtDate(g.last_stay)}`))))))]
      : [emptyState({ iconName: 'users', title: filtered ? 'No results found' : 'No guests yet', text: filtered ? 'Try removing a filter.' : 'Guests are added when you create a reservation.' })]));
  }
  const bar = filterBar({
    key: 'guests', values: filters, defaults, onChange: load,
    search: { placeholder: canManage ? 'Search name, mobile or email' : 'Search guests' },
    quick: [
      { name: 'segment', label: 'Guest type', all: 'All guests', options: [['vip', 'VIP'], ['repeat', 'Repeat (2+ stays)'], ['first', 'One stay so far'], ['no_stays', 'No stays yet'], ['do_not_rebook', 'Do not rebook']] },
      { name: 'stay', label: 'Stay', all: 'Any stay', options: [['upcoming', 'Has an upcoming stay'], ['in_house', 'Staying now'], ['none_upcoming', 'Nothing booked ahead']] },
    ],
    more: [
      { name: 'channel', label: 'Booked through', all: 'Any channel', options: Object.entries(CHANNEL_LABEL) },
      properties.length > 1 && { name: 'property_id', label: 'Stayed at', all: 'Any property', options: properties.map((p) => [p.property_id, p.property_name]) },
      { name: 'last', keys: ['last_from', 'last_to'], label: 'Latest stay between', type: 'daterange' },
      { name: 'min_stays', label: 'Stays (at least)', type: 'number', min: 1 },
      { name: 'rating', label: 'Their review', all: 'Any', options: [['4', 'Rated 4★ and up'], ['low', 'Rated under 3★'], ['none', 'No review yet']] },
      { name: 'sort', label: 'Sort by', all: 'Name (A–Z)', options: [['stays', 'Most stays'], ['recent', 'Most recent stay'], ['next', 'Next arrival'], canManage && ['spent', 'Total spent'], ['added', 'Newest guests']].filter(Boolean) },
    ].filter(Boolean),
  });
  await load();
  el.replaceChildren(
    h('div', { class: 'page-head' }, h('div', { class: 'page-head__title' }, h('h1', null, 'Guests'), h('p', null, 'Everyone who has stayed or booked')),
      canManage && h('div', { class: 'page-head__actions' },
        h('a', { class: 'btn btn--secondary', href: '#/reviews' }, '★ Reviews'),
        h('a', { class: 'btn btn--secondary', href: '#/discount-codes' }, '% Discount codes'))),
    bar,
    box);
}

export async function guestDetailView(el, { params, rerender }) {
  const { guest: g, stays, reviews } = await get(`/guests/${params.id}`);
  const canManage = state.user.role !== 'staff';
  el.replaceChildren(
    h('a', { class: 'back', href: '#/guests' }, '‹ Guests'),
    h('div', { class: 'page-head' },
      h('div', { class: 'page-head__title' }, h('h1', null, g.full_name), h('p', null, ((n) => `${n} stay${n === 1 ? '' : 's'}`)(stays.filter((s) => s.status === 'confirmed').length)),
        h('div', { class: 'chips' }, g.vip && badge('paid', 'VIP'), g.do_not_rebook && badge('overdue', 'Do not rebook'))),
      canManage && h('div', { class: 'page-head__actions' }, h('button', { class: 'btn btn--secondary', onclick: () => formModal({
        title: 'Edit guest', submitText: 'Save',
        fields: [field({ name: 'full_name', label: 'Name', required: true, value: g.full_name }), field({ name: 'phone', label: 'Mobile', type: 'tel', value: g.phone }),
          field({ name: 'email', label: 'Email', type: 'email', value: g.email }), field({ name: 'notes', label: 'Notes', type: 'textarea', value: g.notes, hint: 'Only what you need to host them well.' }),
          field({ name: 'vip', label: 'VIP guest (shown on their reservations)', type: 'checkbox', value: Boolean(g.vip) }),
          field({ name: 'do_not_rebook', label: 'Do not rebook (you\'re warned if they book again)', type: 'checkbox', value: Boolean(g.do_not_rebook) })],
        onSubmit: async (d) => { await patch(`/guests/${g.guest_id}`, d); toast('Guest updated.'); rerender(); },
      }) }, 'Edit'))),
    h('div', { class: 'grid grid--2' },
      h('div', { class: 'card' }, h('h2', null, 'Contact'),
        g.limited ? h('p', { class: 'muted small' }, 'Contact details are limited to owners and managers.')
          : h('dl', { class: 'dl', style: { marginTop: '10px' } },
            h('dt', null, 'Mobile'), h('dd', null, g.phone || '—'), h('dt', null, 'Email'), h('dd', null, g.email || '—'),
            g.notes && [h('dt', null, 'Notes'), h('dd', null, g.notes)])),
      h('div', { class: 'card' }, h('h2', null, 'Stays'),
        stays.length ? h('ul', { class: 'list' }, stays.map((s) => h('li', null, h('a', { class: 'row', href: `#/reservations/${s.booking_id}` },
          h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, `${fmtDate(s.check_in)} – ${fmtDate(s.check_out)}`), h('span', { class: 'row__sub' }, `${s.unit_name} · ${CHANNEL_LABEL[s.channel]}`)),
          h('div', { class: 'row__end' }, h('span', { class: 'amount' }, peso(s.total_amount)), s.status === 'cancelled' && badge('voided', 'Cancelled'))))))
          : h('p', { class: 'muted' }, 'No stays.'))),
    reviews.length > 0 && h('div', { class: 'card', style: { marginTop: '16px' } }, h('h2', null, 'Their reviews (private)'),
      h('ul', { class: 'list' }, reviews.map((r) => h('li', null, h('a', { class: 'row', href: `#/reservations/${r.booking_id}` },
        h('div', { class: 'row__main' }, h('span', { class: 'row__title rating' }, '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating)), r.comment && h('span', { class: 'row__sub' }, `“${r.comment}”`)),
        h('div', { class: 'row__end' }, h('span', { class: 'muted small' }, fmtDate(manilaDay(r.created_at))))))))));
}
