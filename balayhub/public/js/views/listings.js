// Listings (units rented per night), cleaning status and channel connections.

import { get, post, patch, qs, api } from '../api.js';
import {
  h, icon, peso, fmtDate, fmtDateTime, badge, field, formModal, openModal, confirmDialog, emptyState, toast, options, searchBox,
} from '../ui.js';
import { state } from '../app.js';
import { CHANNEL_LABEL } from './reservations.js';

const UNIT_TYPES = ['studio', 'apartment', 'room', 'house', 'other'];
const PROPERTY_TYPES = ['condominium', 'apartment', 'house', 'boarding_house', 'other'];

function listingFields(u = {}) {
  return [
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'unit_name', label: 'Listing name', required: true, value: u.unit_name, placeholder: 'e.g. Tower 1 - 1201 or Studio A', maxlength: 60 }),
      field({ name: 'unit_type', label: 'Type', type: 'select', required: true, value: u.unit_type || 'studio', placeholderOption: false, options: options(UNIT_TYPES) })),
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
        ['either', 'Guest chooses: full or 50% deposit'], ['full', 'Full payment only'], ['deposit', '50% deposit, rest before check-in'],
      ] }),
      field({ name: 'min_nights', label: 'Minimum nights', type: 'number', min: 1, max: 60, value: u.min_nights || 1, inputmode: 'numeric' })),
    field({ name: 'balance_due_days', label: 'Balance due (days before check-in)', type: 'number', min: 0, max: 60, value: u.balance_due_days ?? 3, inputmode: 'numeric',
      hint: 'For 50% deposits. Use your payment reminder message to ask for the rest.' }),
  ];
}

async function addListingModal(onSaved) {
  const { properties } = await get('/properties');
  const isOwner = state.user.role === 'owner';
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
  formModal({
    title: 'Add listing', submitText: 'Save listing', draftKey: 'listing-new',
    fields: [propSelect, newProp, h('hr', { class: 'divider' }), ...listingFields()],
    onSubmit: async (d) => {
      let propertyId = d.property_id;
      if (!propertyId || propertyId === '__new') {
        const res = await post('/properties', { property_name: d.property_name, property_type: d.property_type, address: d.address, city: d.city, province: d.province });
        propertyId = res.property.property_id;
      }
      await post(`/properties/${propertyId}/units`, d);
      toast('Listing added. Next: connect your Airbnb or Booking.com calendar.');
      onSaved();
    },
  });
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
    const input = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'input' });
    const status = h('span', { class: 'muted small', 'aria-live': 'polite' });
    box.replaceChildren(
      h('p', { class: 'muted small' }, 'Shown on your booking page. The first photo is the cover. Up to 12 photos; large photos are resized automatically.'),
      photos.length ? h('div', { class: 'ph-grid' }, photos.map((p, i) => h('figure', { class: 'ph-item' },
        h('img', { src: `/api/files/${p.file_id}`, alt: '', loading: 'lazy' }),
        h('figcaption', null,
          i === 0 ? h('span', { class: 'badge badge--paid' }, 'Cover') : h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: async () => { await post(`/listing-photos/${p.file_id}/cover`); draw(); } }, 'Make cover'),
          h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: async () => { await post(`/listing-photos/${p.file_id}/remove`); draw(); } }, 'Delete')))))
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

async function channelsModal(listing, onChange) {
  let data;
  try { data = await get(`/units/${listing.unit_id}/channels`); } catch (err) { toast(err.message, 'error'); return; }
  const exportInput = h('input', { class: 'input', readonly: true, value: data.export_url, 'aria-label': 'BalayHub calendar link' });
  const feedRow = (f) => h('li', null, h('div', { class: 'row' },
    h('div', { class: 'row__main' },
      h('span', { class: 'row__title' }, CHANNEL_LABEL[f.channel]),
      h('span', { class: 'row__sub', style: { wordBreak: 'break-all' } }, f.url),
      h('span', { class: `row__sub ${f.last_status === 'error' ? 'amount--neg' : ''}` }, f.last_synced_at ? `${fmtDateTime(f.last_synced_at)} — ${f.last_message || ''}` : 'Not synced yet')),
    h('div', { class: 'row__end' }, h('div', { class: 'chips' },
      h('button', { class: 'btn btn--secondary btn--sm', onclick: async (e) => {
        e.target.disabled = true;
        try { const r = await post(`/ical-feeds/${f.feed_id}/sync`); toast(r.sync.message, r.sync.ok ? 'info' : 'error'); m.close(); channelsModal(listing, onChange); onChange(); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
      } }, 'Sync now'),
      h('button', { class: 'btn btn--ghost btn--sm', onclick: async () => {
        if (!await confirmDialog({ title: `Disconnect ${CHANNEL_LABEL[f.channel]}?`, text: 'Future stays and blocks imported from this calendar are removed. Past stays and any stays with payments are kept.', confirmText: 'Disconnect', danger: true })) return;
        await post(`/ical-feeds/${f.feed_id}/remove`); toast('Calendar disconnected.'); m.close(); channelsModal(listing, onChange); onChange();
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
      toast(r.sync.ok ? `Connected. ${r.sync.message}` : `Connected, but the first sync failed: ${r.sync.message}`, r.sync.ok ? 'info' : 'error');
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

export async function listingsView(el, { query }) {
  const canManage = state.user.role !== 'staff';
  const filter = { cleaning: query.cleaning === 'dirty' ? 'dirty' : '' };
  const box = h('div');
  async function load() {
    const { listings } = await get('/listings');
    const shown = filter.cleaning ? listings.filter((l) => l.cleaning_status === 'dirty') : listings;
    const dirtyCount = listings.filter((l) => l.cleaning_status === 'dirty').length;
    const tabs = h('div', { class: 'tabs', role: 'tablist' },
      h('button', { role: 'tab', 'aria-selected': String(!filter.cleaning), onclick: () => { filter.cleaning = ''; load(); } }, `All (${listings.length})`),
      h('button', { role: 'tab', 'aria-selected': String(filter.cleaning === 'dirty'), onclick: () => { filter.cleaning = 'dirty'; load(); } }, `Needs cleaning (${dirtyCount})`));
    if (!listings.length) {
      box.replaceChildren(h('div', { class: 'card' }, emptyState({ iconName: 'building', title: 'No listings yet', text: 'Add each unit you rent out per night, with its base nightly rate and cleaning fee.', action: canManage && h('button', { class: 'btn btn--primary', onclick: () => addListingModal(load) }, icon('plus'), 'Add listing') })));
      return;
    }
    box.replaceChildren(tabs, shown.length ? h('div', { class: 'listing-grid' }, shown.map((l) => h('article', { class: `card listing${query.focus === l.unit_id ? ' is-focus' : ''}` },
      h('div', { class: 'card__head' },
        h('div', null, h('h2', null, l.unit_name), h('p', { class: 'muted small' }, `${l.property_name}${l.city ? ` · ${l.city}` : ''}`)),
        h('span', { class: `badge badge--${l.cleaning_status === 'dirty' ? 'overdue' : 'paid'}` }, l.cleaning_status === 'dirty' ? '🧹 Dirty' : '✓ Clean')),
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
        canManage && h('button', { class: 'btn btn--ghost btn--sm', onclick: async () => {
          const { units } = await get(`/properties/${l.property_id}`).then((r) => ({ units: r.units }));
          const unit = units.find((u) => u.unit_id === l.unit_id);
          formModal({ title: `Edit ${l.unit_name}`, submitText: 'Save changes', fields: listingFields(unit),
            onSubmit: async (d) => { await patch(`/units/${l.unit_id}`, d); toast('Listing updated.'); load(); } });
        } }, 'Edit'),
        h('a', { class: 'btn btn--ghost btn--sm', href: `#/reservations?q=${encodeURIComponent(l.unit_name)}&view=all` }, 'Bookings')))))
      : h('div', { class: 'card' }, emptyState({ title: 'All clean ✨', text: 'No listings need cleaning right now.' })));
  }
  await load();
  el.replaceChildren(
    h('div', { class: 'page-head' },
      h('div', { class: 'page-head__title' }, h('h1', null, 'Listings'), h('p', null, 'Your units, rates, cleaning status and channel connections')),
      canManage && h('div', { class: 'page-head__actions' }, h('button', { class: 'btn btn--primary', onclick: () => addListingModal(load) }, icon('plus'), 'Add listing'))),
    box);
  if (query.new && canManage) { history.replaceState(null, '', '#/listings'); addListingModal(load); }
}

// ---------------------------------------------------------------- guests
export async function guestsView(el, { query }) {
  const box = h('div', { class: 'card' });
  let q = query.q || '';
  async function load() {
    history.replaceState(null, '', `#/guests${qs({ q })}`);
    const { guests } = await get(`/guests${qs({ q })}`);
    box.replaceChildren(guests.length ? h('ul', { class: 'list' }, guests.map((g) => h('li', null, h('a', { class: 'row', href: `#/guests/${g.guest_id}` },
      h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, g.full_name), !g.limited && h('span', { class: 'row__sub' }, [g.phone, g.email].filter(Boolean).join(' · ') || 'No contact details')),
      h('div', { class: 'row__end' },
        h('div', { class: 'chips' }, g.vip && badge('paid', 'VIP'), Number(g.stays) > 1 && badge('active', 'Repeat'), g.do_not_rebook && badge('overdue', 'Do not rebook'),
          g.avg_rating && h('span', { class: 'rating small' }, `★ ${g.avg_rating}`)),
        h('span', { class: 'small' }, `${g.stays} stay${Number(g.stays) === 1 ? '' : 's'}`), g.last_stay && h('span', { class: 'muted small' }, `Last: ${fmtDate(g.last_stay)}`))))))
      : emptyState({ iconName: 'users', title: q ? 'No results found' : 'No guests yet', text: q ? 'Try another name.' : 'Guests are added when you create a reservation.' }));
  }
  await load();
  el.replaceChildren(
    h('div', { class: 'page-head' }, h('div', { class: 'page-head__title' }, h('h1', null, 'Guests'), h('p', null, 'Everyone who has stayed or booked')),
      state.user.role !== 'staff' && h('div', { class: 'page-head__actions' },
        h('a', { class: 'btn btn--secondary', href: '#/reviews' }, '★ Reviews'),
        h('a', { class: 'btn btn--secondary', href: '#/discount-codes' }, '% Discount codes'))),
    h('div', { class: 'toolbar' }, searchBox({ value: q, placeholder: 'Search guests', onSearch: (v) => { q = v; load(); } })),
    box);
}

export async function guestDetailView(el, { params, rerender }) {
  const { guest: g, stays, reviews } = await get(`/guests/${params.id}`);
  const canManage = state.user.role !== 'staff';
  el.replaceChildren(
    h('a', { class: 'back', href: '#/guests' }, '‹ Guests'),
    h('div', { class: 'page-head' },
      h('div', { class: 'page-head__title' }, h('h1', null, g.full_name), h('p', null, `${stays.filter((s) => s.status === 'confirmed').length} stay(s)`),
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
        h('div', { class: 'row__end' }, h('span', { class: 'muted small' }, fmtDate(r.created_at.slice(0, 10))))))))));
}
