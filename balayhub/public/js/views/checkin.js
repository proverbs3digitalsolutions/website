// Guest check-in (registration) form, opened from the private link the host sends.
// Also: the host's "Guest check-in form" card on the reservation page.

import { get, post, api, ApiError } from '../api.js';
import { h, brand, field, fmtDate, fmtDateTime, toast, clearErrors, showErrors, readForm, confirmDialog } from '../ui.js';

const fmtTime = (t) => {
  if (!t) return '';
  const [hh, mm] = t.split(':').map(Number);
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
};

// Shrink phone photos (often 4–8 MB) to about 1600 px JPEG before upload.
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) && !/^image\//.test(file.type)) throw new Error('Please choose a photo.');
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (blob) return blob;
  } catch { /* fall back to the original */ }
  if (file.size > 10 * 1024 * 1024) throw new Error('This photo is too large. Please take a smaller one.');
  return file;
}

// ---------------------------------------------------------------- guest page
export async function guestCheckinView(el, { params }) {
  const token = params.token;
  const page = (...children) => h('div', { class: 'gc' },
    h('header', { class: 'gc__top' }, brand(null)),
    h('main', { class: 'gc__main', id: 'main' }, children));

  let data;
  try {
    data = await get(`/public/checkin/${encodeURIComponent(token)}`);
  } catch (err) {
    el.replaceChildren(page(h('div', { class: 'card' }, h('h1', null, 'Link not found'), h('p', { class: 'muted' }, err.message))));
    return;
  }
  const { stay: s, registration: r } = data;
  const header = h('div', { class: 'gc__stay card' },
    h('p', { class: 'gc__eyebrow' }, s.workspace_name),
    h('h1', null, s.guest_first_name ? `Hi ${s.guest_first_name}! Please register before you arrive` : 'Guest registration'),
    h('p', { class: 'muted' }, 'The building requires the names and a valid ID of everyone staying. It takes about 2 minutes.'),
    h('dl', { class: 'dl', style: { marginTop: '12px' } },
      h('dt', null, 'Stay'), h('dd', null, `${s.listing}, ${s.property}${s.city ? `, ${s.city}` : ''}`),
      h('dt', null, 'Check-in'), h('dd', null, `${fmtDate(s.check_in)}${s.checkin_time ? `, from ${fmtTime(s.checkin_time)}` : ''}`),
      h('dt', null, 'Check-out'), h('dd', null, `${fmtDate(s.check_out)}${s.checkout_time ? `, by ${fmtTime(s.checkout_time)}` : ''}`),
      h('dt', null, 'Booking'), h('dd', null, s.code)));

  if (s.closed) {
    el.replaceChildren(page(header, h('div', { class: 'alert alert--info' }, 'This stay has ended or was cancelled, so the form is closed.')));
    return;
  }

  // Other guests: one input each, add/remove.
  const others = h('div', { class: 'gc__guests' });
  const addGuest = (value = '') => {
    if (others.children.length + 1 >= s.guests_allowed) { toast(`This unit allows up to ${s.guests_allowed} guests.`, 'error'); return; }
    const row = h('div', { class: 'gc__guest' },
      h('input', { class: 'input', name: 'guest', value, maxlength: 120, placeholder: 'Full name', 'aria-label': `Guest ${others.children.length + 2} full name` }),
      h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': 'Remove', onclick: () => row.remove() }, '✕'));
    others.append(row);
  };
  const initial = r?.guests?.length ? r.guests : Array.from({ length: Math.max(0, (s.num_guests || 1) - 1) }, () => '');
  initial.forEach((g) => addGuest(g));

  const photos = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'input', capture: 'environment', 'aria-label': 'ID photos' });
  const progress = h('div', { class: 'muted small', 'aria-live': 'polite' });
  const formError = h('div');
  const submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, r ? 'Save changes' : 'Submit registration');

  const form = h('form', { class: 'form card', novalidate: true },
    r && h('div', { class: 'alert alert--ok' }, `Received ${fmtDateTime(r.submitted_at)}${r.id_count ? ` with ${r.id_count} ID photo${r.id_count > 1 ? 's' : ''}` : ''}. You can update it below.`),
    formError,
    h('h2', null, 'Main guest'),
    field({ name: 'lead_name', label: 'Full name (as on your ID)', required: true, value: r?.lead_name || '', maxlength: 120, autocomplete: 'name' }),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'phone', label: 'Mobile number', type: 'tel', required: true, value: r?.phone || '', inputmode: 'tel', placeholder: '0917 123 4567', autocomplete: 'tel' }),
      field({ name: 'email', label: 'Email', type: 'email', value: r?.email || '', autocomplete: 'email' })),
    h('h2', null, 'Other guests'),
    h('div', { class: 'field', dataset: { field: 'guests' } },
      h('p', { class: 'hint' }, 'Everyone else staying, including children.'),
      others,
      h('div', null, h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => addGuest() }, '+ Add guest')),
      h('div', { class: 'error', role: 'alert' })),
    h('h2', null, 'Arrival'),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'arrival_time', label: 'Estimated arrival time', type: 'time', value: r?.arrival_time || '' }),
      field({ name: 'vehicle_plate', label: 'Car plate number (if parking)', value: r?.vehicle_plate || '', maxlength: 20, placeholder: 'e.g. ABC 1234' })),
    field({ name: 'notes', label: 'Anything we should know?', type: 'textarea', value: r?.notes || '', maxlength: 1000, placeholder: 'Special requests, late arrival, celebrating something…' }),
    h('h2', null, 'Valid ID'),
    h('div', { class: 'field' },
      h('p', { class: 'hint' }, `A photo of a valid government ID for each adult (driver's license, passport, UMID, PhilID…). ${r?.id_count ? 'Photos you already sent are kept; add more only if needed.' : ''}`),
      photos, progress),
    h('div', { class: 'field', dataset: { field: 'consent' } },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'consent', checked: Boolean(r) }),
        h('span', null, `I agree that ${s.workspace_name} may use these details and ID photos to register our stay with the building, as required under the Data Privacy Act. ID photos are deleted ${s.id_retention_days} days after check-out.`)),
      h('div', { class: 'error', role: 'alert' })),
    submit);

  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    clearErrors(form);
    formError.replaceChildren();
    submit.disabled = true;
    const d = readForm(form);
    const payload = {
      lead_name: d.lead_name, phone: d.phone, email: d.email, arrival_time: d.arrival_time, vehicle_plate: d.vehicle_plate,
      notes: d.notes, consent: Boolean(form.elements.consent.checked),
      guests: [...others.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean),
    };
    try {
      submit.textContent = 'Saving…';
      await post(`/public/checkin/${encodeURIComponent(token)}`, payload);
      const files = [...photos.files];
      for (const [i, f] of files.entries()) {
        progress.textContent = `Uploading ID photo ${i + 1} of ${files.length}…`;
        const blob = await shrinkImage(f);
        await api('POST', `/public/checkin/${encodeURIComponent(token)}/id`, undefined, { rawBody: blob, headers: { 'Content-Type': blob.type || 'image/jpeg' } });
      }
      progress.textContent = '';
      el.replaceChildren(page(header, h('div', { class: 'card gc__done' },
        h('div', { class: 'gc__tick', 'aria-hidden': 'true' }, '✓'),
        h('h2', null, 'Thank you! You\'re registered.'),
        h('p', { class: 'muted' }, `${s.workspace_name} has received your details. You'll get your check-in instructions before arrival.`),
        h('p', null, h('button', { class: 'linkbtn', onclick: () => guestCheckinView(el, { params }) }, 'Review or change my answers')))));
    } catch (err) {
      progress.textContent = '';
      const msg = err instanceof ApiError ? err.message : (err.message || 'Something went wrong. Please try again.');
      formError.replaceChildren(h('div', { class: 'alert alert--error', role: 'alert' }, err.offline ? "You're offline. Your answers are still here; try again when you're connected." : msg));
      if (err.fields) showErrors(form, err.fields);
      formError.scrollIntoView?.({ block: 'nearest' });
    } finally {
      busy = false;
      submit.disabled = false;
      submit.textContent = r ? 'Save changes' : 'Submit registration';
    }
  });

  el.replaceChildren(page(header, form, h('p', { class: 'gc__foot muted small' }, 'Powered by BalayHub · ', h('a', { href: '#/privacy' }, 'Privacy notice'))));
}

// ---------------------------------------------------------------- host: card on the reservation page
export async function checkinCard(bookingId, rerender) {
  let d;
  try { d = await get(`/reservations/${bookingId}/checkin`); } catch { return null; }
  const r = d.registration;
  const copy = async (text, msg) => {
    try { await navigator.clipboard.writeText(text); toast(msg); } catch { window.prompt('Copy this:', text); }
  };
  const adminText = r && [
    `Guest registration — ${r.lead_name}`,
    `Guests (${(r.guests?.length || 0) + 1}): ${[r.lead_name, ...(r.guests || [])].join(', ')}`,
    r.arrival_time ? `Arrival: ${fmtTime(r.arrival_time)}` : null,
    r.vehicle_plate ? `Vehicle plate: ${r.vehicle_plate}` : null,
    `Contact: ${r.phone}`,
  ].filter(Boolean).join('\n');
  const newLink = async () => {
    if (!await confirmDialog({ title: 'Replace the check-in link?', text: 'The old link stops working. Use this if the link was shared with the wrong person.', confirmText: 'Replace link' })) return;
    try { await post(`/reservations/${bookingId}/checkin/new-link`); toast('New link created.'); rerender(); } catch (err) { toast(err.message, 'error'); }
  };
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Guest check-in form'),
      r ? h('span', { class: 'badge badge--paid' }, 'Submitted') : h('span', { class: 'badge badge--unpaid' }, 'Not yet')),
    !r && h('p', { class: 'muted small' }, 'Send this private link to the guest so they can register everyone and upload IDs before arrival. It is also included in the {{checkin_link}} message variable.'),
    h('div', { class: 'chips' },
      h('button', { class: 'btn btn--secondary btn--sm', onclick: () => copy(d.link, 'Check-in link copied.') }, 'Copy link'),
      r && h('button', { class: 'btn btn--secondary btn--sm', onclick: () => copy(adminText, 'Copied. Paste it to your building admin.') }, 'Copy for building admin'),
      h('button', { class: 'btn btn--ghost btn--sm', onclick: newLink }, 'New link')),
    r && h('dl', { class: 'dl', style: { marginTop: '12px' } },
      h('dt', null, 'Main guest'), h('dd', null, r.lead_name),
      h('dt', null, 'Mobile'), h('dd', null, r.phone),
      r.email && [h('dt', null, 'Email'), h('dd', null, r.email)],
      h('dt', null, 'Other guests'), h('dd', null, r.guests?.length ? r.guests.join(', ') : '—'),
      h('dt', null, 'Arrival'), h('dd', null, r.arrival_time ? fmtTime(r.arrival_time) : '—'),
      h('dt', null, 'Plate number'), h('dd', null, r.vehicle_plate || '—'),
      r.notes && [h('dt', null, 'Notes'), h('dd', { style: { whiteSpace: 'pre-wrap' } }, r.notes)],
      h('dt', null, 'Submitted'), h('dd', null, fmtDateTime(r.updated_at || r.submitted_at))),
    r && (r.ids_purged_at
      ? h('p', { class: 'muted small' }, `ID photos were deleted ${fmtDateTime(r.ids_purged_at)} (after the stay).`)
      : d.files.length
        ? h('div', { class: 'gc__ids' }, d.files.map((f) => h('a', { href: `/api/files/${f.file_id}`, target: '_blank', rel: 'noopener' },
          h('img', { src: `/api/files/${f.file_id}`, alt: f.file_name, loading: 'lazy' }))))
        : h('p', { class: 'muted small' }, 'No ID photos uploaded yet.')));
}
