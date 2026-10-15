// Condo gate pass: settings per building, status on each reservation, and the
// printable page the building admin opens from the email.

import { get, post, patch } from '../api.js';
import { h, brand, fmtDate, fmtDateTime, field, formModal, emptyState, pageHead, toast, badge } from '../ui.js';

// ---------------------------------------------------------------- settings
export async function gatepassSettingsView(el, { rerender }) {
  const { properties } = await get('/gatepass/settings');
  const edit = (p) => formModal({
    title: `Gate pass · ${p.property_name}`, submitText: 'Save',
    fields: [
      field({ name: 'admin_email', label: 'Building admin email(s)', value: p.admin_email, maxlength: 800, placeholder: 'admin@building.com, security@building.com', hint: 'Up to 3, separated by commas.' }),
      field({ name: 'gatepass_enabled', label: 'Send automatically before each check-in', type: 'checkbox', value: p.gatepass_enabled }),
      field({ name: 'gatepass_days_before', label: 'Send how many days before check-in?', type: 'select', value: String(p.gatepass_days_before), placeholderOption: false,
        options: [['0', 'On the check-in day'], ['1', '1 day before'], ['2', '2 days before'], ['3', '3 days before'], ['5', '5 days before'], ['7', '7 days before']],
        hint: 'BalayHub waits for the guest\'s check-in form (names, IDs) until the day before arrival, then sends what it has and tells you.' }),
      field({ name: 'gatepass_attach_ids', label: 'Include guest ID photos (in the email and on the gate pass link)', type: 'checkbox', value: p.gatepass_attach_ids,
        hint: 'On: the IDs are attached to the email and shown on the private gate pass link. Copies stay in the admin\'s mailbox and are not deleted after the stay. Off: the admin gets the guests\' names and details only, with no ID photos. Turning it off also hides IDs on passes already sent.' }),
      field({ name: 'gatepass_authorized_by', label: 'Authorized by (unit owner name on file with admin)', value: p.gatepass_authorized_by, maxlength: 120 }),
      field({ name: 'gatepass_notes', label: 'Notes for the admin (optional)', type: 'textarea', value: p.gatepass_notes, maxlength: 1000, placeholder: 'e.g. Parking slot B2-15 is assigned to the guest. Pets not allowed.' }),
    ],
    onSubmit: async (d) => {
      await patch(`/properties/${p.property_id}/gatepass`, { ...d, gatepass_days_before: Number(d.gatepass_days_before) });
      toast('Gate pass settings saved.');
      rerender();
    },
  });
  el.replaceChildren(
    pageHead({ title: 'Gate pass', sub: 'Send guest details to the building admin before arrival', back: { href: '#/listings', label: 'Listings' } }),
    h('div', { class: 'card' },
      h('p', null, 'Many condos need the guests\' names and IDs before they arrive. Set the admin\'s email per building and BalayHub sends a gate pass automatically, with a private link where the admin views the pass and confirms receipt.'),
      h('p', { class: 'muted small' }, 'Guest names and IDs come from the guest check-in form. Include {{checkin_link}} in your booking confirmation so guests fill it in early.')),
    properties.length ? h('div', { class: 'card' }, h('ul', { class: 'list' }, properties.map((p) => h('li', null, h('div', { class: 'row' },
      h('div', { class: 'row__main' }, h('span', { class: 'row__title' }, p.property_name),
        h('span', { class: 'row__sub' }, p.admin_email ? `${p.admin_email} · ${p.gatepass_enabled ? `automatic, ${p.gatepass_days_before === 0 ? 'on check-in day' : `${p.gatepass_days_before} day${p.gatepass_days_before > 1 ? 's' : ''} before`}` : 'send by hand from each reservation'}${p.gatepass_attach_ids ? ' · IDs included' : ''}` : 'No admin email yet')),
      h('div', { class: 'row__end' }, p.gatepass_enabled ? badge('paid', 'On') : badge('voided', 'Off'),
        h('button', { class: 'btn btn--secondary btn--sm', type: 'button', 'aria-label': `Set up, ${p.property_name}`, onclick: () => edit(p) }, 'Set up')))))))
      : h('div', { class: 'card' }, emptyState({ iconName: 'building', title: 'No listings yet', text: 'Add a listing first.' })));
}

// ---------------------------------------------------------------- on a reservation
export async function gatepassCard(bookingId, rerender) {
  let d;
  try { d = await get(`/reservations/${bookingId}/gatepass`); } catch { return null; }
  const p = d.pass;
  const send = async () => {
    try { const r = await post(`/reservations/${bookingId}/gatepass/send`); toast(`Gate pass sent to ${r.sent_to}.`); rerender(); } catch (err) { toast(err.message, 'error'); }
  };
  const status = !p ? badge('unpaid', 'Not sent')
    : p.status === 'acknowledged' ? badge('paid', 'Received by admin')
      : p.status === 'failed' ? badge('overdue', 'Not sent') : badge('active', 'Sent');
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Gate pass'), status),
    !d.admin_email ? h('p', { class: 'muted small' }, 'Send the guests\' details to the building admin automatically. ', h('a', { class: 'link-tap', href: '#/gatepass-settings' }, 'Set up the admin email'), '.')
      : h('div', null,
        p?.sent_at && h('p', { class: 'small' }, `Sent to ${p.sent_to} on ${fmtDateTime(p.sent_at)}${p.send_count > 1 ? ` (${p.send_count} times)` : ''}.`),
        p?.acknowledged_at && h('p', { class: 'small' }, `Admin confirmed ${fmtDateTime(p.acknowledged_at)}.`),
        p?.last_error && h('p', { class: 'small amount--neg' }, p.last_error),
        !p && h('p', { class: 'muted small' }, d.auto ? `Sends automatically on ${fmtDate(d.send_on)} to ${d.admin_email}.` : `Admin: ${d.admin_email}. Automatic sending is off.`),
        h('div', { class: 'chips' },
          h('button', { class: `btn ${p ? 'btn--secondary' : 'btn--primary'} btn--sm`, type: 'button', onclick: send }, p?.sent_at ? 'Send again' : 'Send now'),
          p && h('a', { class: 'btn btn--ghost btn--sm', href: p.link, target: '_blank', rel: 'noopener' }, 'Preview'))));
}

// ---------------------------------------------------------------- building admin's page
// One guest reads as a plain name. Two or more keep the numbered list.
export function guestNamesBlock(names) {
  return names.length === 1 ? h('p', null, names[0]) : h('ol', { class: 'gp__names' }, names.map((n) => h('li', null, n)));
}

export async function gatepassPublicView(el, { params }) {
  const token = params.token;
  const page = (...children) => h('div', { class: 'gc' },
    h('header', { class: 'gc__top no-print' }, brand(null)),
    h('main', { class: 'gc__main gp', id: 'main' }, children),
    h('p', { class: 'gc__foot muted small no-print' }, 'Private gate pass. Please don\'t forward. The link stops working after check-out.'));
  let d;
  try { d = await get(`/public/gatepass/${encodeURIComponent(token)}`); } catch (err) {
    el.replaceChildren(page(h('div', { class: 'card' }, h('h1', null, 'Gate pass not available'), h('p', { class: 'muted' }, err.message))));
    return;
  }
  const ack = async () => {
    try { await post(`/public/gatepass/${encodeURIComponent(token)}/ack`); d.acknowledged_at = new Date().toISOString(); toast('Thank you! The host has been told you received it.'); draw(); } catch (err) { toast(err.message, 'error'); }
  };
  function draw() {
    el.replaceChildren(page(
      h('div', { class: 'card receipt' },
        h('div', { class: 'receipt__head' },
          h('div', null, h('h1', null, 'Guest gate pass'), h('div', { class: 'muted small' }, `${d.property}${d.address ? ` · ${d.address}` : ''}`)),
          h('div', { class: 'receipt__no' }, h('div', { class: 'subhead' }, 'Unit'), h('strong', null, d.unit))),
        h('dl', { class: 'dl' },
          h('dt', null, `Guest${d.guests.length > 1 ? 's' : ''}`), h('dd', null, guestNamesBlock(d.guests)),
          h('dt', null, 'Check-in'), h('dd', null, `${fmtDate(d.check_in)}${d.checkin_time ? `, ${d.checkin_time}` : ''}${d.arrival_time ? ` (arriving ${d.arrival_time})` : ''}`),
          h('dt', null, 'Check-out'), h('dd', null, `${fmtDate(d.check_out)}${d.checkout_time ? `, ${d.checkout_time}` : ''}`),
          h('dt', null, 'Number of guests'), h('dd', null, `${d.guests.length > 1 ? d.guests.length : (d.num_guests || 1)}${d.registered && d.num_guests && d.registered !== d.num_guests ? ` (booked for ${d.num_guests})` : ''}`),
          d.vehicle_plate && [h('dt', null, 'Vehicle plate'), h('dd', null, d.vehicle_plate)],
          d.guest_phone && [h('dt', null, 'Guest mobile'), h('dd', null, d.guest_phone)],
          h('dt', null, 'Reference'), h('dd', null, d.code),
          h('dt', null, 'Authorized by'), h('dd', null, d.authorized_by, d.contact ? h('div', { class: 'muted small' }, d.contact) : null)),
        d.notes && h('p', { style: { whiteSpace: 'pre-wrap' } }, d.notes),
        d.ids?.length > 0 && [h('h2', { class: 'subhead', style: { marginTop: '14px' } }, 'Guest IDs'),
          h('div', { class: 'gp__ids' }, d.ids.map((x) => h('img', { src: x.url, alt: `Guest ID ${x.n}` })))]),
      h('div', { class: 'chips no-print', style: { marginTop: '12px' } },
        d.acknowledged_at ? h('span', { class: 'badge badge--paid' }, `Received ✓ ${fmtDateTime(d.acknowledged_at)}`)
          : h('button', { class: 'btn btn--primary', type: 'button', onclick: ack }, 'Confirm received'),
        h('button', { class: 'btn btn--secondary', type: 'button', onclick: () => window.print() }, 'Print'))));
  }
  draw();
}
