// Guest check-in (registration) form, opened from the private link the host sends.
// Also: the host's "Guest check-in form" card on the reservation page.

import { get, post, api, ApiError, fileContentError, PHOTO_KINDS } from '../api.js';
import { h, brand, field, fmtDateTime, toast, clearErrors, showErrors, readForm, confirmDialog, fileRefused, EMAIL_RE, PHONE_RE, guardPress } from '../ui.js';
import { t, tServer, tFields, extendTranslations, initGuestLang, langToggle, keepFormValues, restoreFormValues, fmtDateL, fmtDateTimeL } from '../i18n.js';
import { copyText } from './quotes.js';

const fmtTime = (t) => {
  if (!t) return '';
  const [hh, mm] = t.split(':').map(Number);
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
};

// Same wording as the gate pass: the booked number only when more people registered than booked.
export const registeredText = (reg, booked) => (booked && reg > booked ? `${reg} (booked for ${booked})` : String(reg));

extendTranslations({
  'Too many attempts': 'Napakaraming subok',
  'Something went wrong': 'May nagkaproblema',
  'Your check-in details': 'Ang check-in details mo',
  'House rules': 'Mga patakaran sa bahay',
  'I have read and agree to the house rules.': 'Nabasa ko at sumasang-ayon ako sa mga patakaran sa bahay.',
  'Please read and agree to the house rules.': 'Basahin at sang-ayunan ang house rules.',
  'You accepted the house rules on {when}.': 'Sinang-ayunan mo ang mga patakaran sa bahay noong {when}.',
  'Please check the highlighted fields.': 'Pakitingnan ang mga naka-highlight.',
  'Please enter your full name, as on your ID.': 'Pakilagay ang buong pangalan mo, gaya ng nasa ID.',
  'Please enter your mobile number.': 'Pakilagay ang mobile number mo.',
  'Enter the name of each guest, or remove the empty row.': 'Pakilagay ang pangalan ng bawat guest, o alisin ang walang laman na row.',
  'Your ID must be a JPG, PNG or WEBP photo.': 'Dapat JPG, PNG o WEBP na litrato ang ID mo.',
  'Please agree so your host can register you with the building.': 'Paki-agree para ma-register ka ng host sa building.',
  'This place allows up to {n} guests.': 'Hanggang {n} guests lang ang puwede sa lugar na ito.',
  'Enter a valid email address.': 'Maglagay ng tamang email address.',
  'Enter a valid phone number.': 'Maglagay ng tamang mobile number.',
  'Remove guest {n}': 'Alisin ang guest {n}',
  'Choose the photos again after changing the language.': 'Piliin ulit ang mga litrato pagkatapos magpalit ng wika.',
  'Add a photo of a valid ID for at least one guest.': 'Mag-upload ng litrato ng valid ID ng kahit isang guest.',
  "This file isn't a real JPG, PNG or WEBP. Choose the file again.": 'Hindi totoong JPG, PNG o WEBP ang file na ito. Piliin ulit ang file.',
  'Upload a photo (JPG, PNG or WEBP) up to 10 MB.': 'Mag-upload ng litrato (JPG, PNG o WEBP) na hanggang 10 MB.',
  'Your answers are saved. Add a photo of your ID to finish registering.': 'Naka-save na ang mga sagot mo. Mag-upload ng litrato ng ID mo para matapos ang registration.',
});

// The heading follows the cause: only a 404 is a bad link.
const failTitle = (err) => (err.status === 404 ? t('Link not found') : err.status === 429 ? t('Too many attempts') : t('Something went wrong'));

// The ID photo types the server accepts (src/routes/checkin.js). Checked before anything is sent.
const ID_PHOTO_TYPE = /^image\/(jpeg|png|webp)$/;

// Shrink phone photos (often 4–8 MB) to about 1600 px JPEG before upload.
async function shrinkImage(file) {
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
  if (file.size > 10 * 1024 * 1024) throw new Error(t('This photo is too large. Please take a smaller one.'));
  return file;
}

// ---------------------------------------------------------------- guest page
// `kept` comes from a language switch: the typed values and whether ID photos were already chosen.
export async function guestCheckinView(el, { params }, kept) {
  initGuestLang();
  const token = params.token;
  const page = (...children) => h('div', { class: 'gc' },
    h('header', { class: 'gc__top gc__top--lang' }, brand(null), langToggle(() => guestCheckinView(el, { params }, { snap: keepFormValues(el), photosChosen: Boolean(el.querySelector('input[type=file]')?.files?.length) }))),
    h('main', { class: 'gc__main', id: 'main' }, children));

  let data;
  try {
    data = await get(`/public/checkin/${encodeURIComponent(token)}`);
  } catch (err) {
    el.replaceChildren(page(h('div', { class: 'card' }, h('h1', null, failTitle(err)), h('p', { class: 'muted' }, tServer(err.message)))));
    return;
  }
  const { stay: s, registration: r } = data;
  initGuestLang(s.guest_language);
  const heading = h('h1', null, s.closed ? t('Guest registration') : (s.checked_in || r?.submitted_at) ? t('Your check-in details') : s.guest_first_name ? t('Hi {name}! Please register before you arrive', { name: s.guest_first_name }) : t('Guest registration'));
  const intro = !s.closed && h('p', { class: 'muted' }, t('The building requires the names and a valid ID of everyone staying. It takes about 2 minutes.'));
  const header = h('div', { class: 'gc__stay card' },
    h('p', { class: 'gc__eyebrow' }, s.workspace_name),
    heading,
    intro,
    h('dl', { class: 'dl', style: { marginTop: '12px' } },
      h('dt', null, t('Stay')), h('dd', null, `${s.listing}, ${s.property}${s.city ? `, ${s.city}` : ''}`),
      h('dt', null, t('Check-in')), h('dd', null, s.checkin_time ? t('{date}, from {time}', { date: fmtDateL(s.check_in), time: fmtTime(s.checkin_time) }) : fmtDateL(s.check_in)),
      h('dt', null, t('Check-out')), h('dd', null, s.checkout_time ? t('{date}, by {time}', { date: fmtDateL(s.check_out), time: fmtTime(s.checkout_time) }) : fmtDateL(s.check_out)),
      h('dt', null, t('Booking')), h('dd', null, s.code)));

  if (s.closed) {
    el.replaceChildren(page(header, h('div', { class: 'alert alert--info' }, t('This stay has ended or was cancelled, so the form is closed.'))));
    return;
  }

  // Other guests: one input each, add/remove.
  const others = h('div', { class: 'gc__guests' });
  // Told, not blocked: more people than booked is fine (the listing max is the hard limit); the host sees the new number.
  const headcount = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const showHeadcount = () => {
    const n = s.num_guests;
    headcount.textContent = n && others.children.length + 1 > n
      ? (n === 1 ? t('This booking is for 1 guest. If more people are coming, your host will see the new number.') : t('This booking is for {n} guests. If more people are coming, your host will see the new number.', { n }))
      : '';
  };
  const addGuest = (value = '') => {
    if (others.children.length + 1 >= s.guests_allowed) { toast(t('This place allows up to {n} guests.', { n: s.guests_allowed }), 'error'); return; }
    const row = h('div', { class: 'gc__guest' },
      h('input', { class: 'input', name: 'guest', value, maxlength: 120, placeholder: t('Full name'), 'aria-label': t('Guest {n} full name', { n: others.children.length + 2 }) }),
      h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-label': t('Remove guest {n}', { n: others.children.length + 2 }), onclick: () => { row.remove(); renumber(); } }, '✕'));
    others.append(row);
    showHeadcount();
  };
  // Keep "Guest 2, Guest 3…" labels in order after removing someone.
  function renumber() {
    [...others.querySelectorAll('.gc__guest')].forEach((row, i) => {
      row.querySelector('input').setAttribute('aria-label', t('Guest {n} full name', { n: i + 2 }));
      row.querySelector('button').setAttribute('aria-label', t('Remove guest {n}', { n: i + 2 }));
    });
    showHeadcount();
  }
  // House rules: shown when the listing has some; the box is required until they were accepted once.
  const rules = String(s.house_rules || '').trim();
  const rulesAt = s.rules_accepted_at;
  // No blank row to start with: a solo guest submits as is, and "+ Add guest" adds one.
  (r?.guests || []).forEach((g) => addGuest(g));
  // After a language switch the guest may have added rows: make as many as were there before the values go back.
  for (let n = kept?.snap?.guest?.length || 0; others.children.length < n && others.children.length + 1 < s.guests_allowed;) addGuest();

  // No `capture`: guests must be able to pick existing photos from their gallery.
  // Named by its visible label "ID photos" (Taglish "Litrato ng ID"), never an aria-label (D-116).
  const photos = h('input', { type: 'file', id: 'ci-id-photos', accept: 'image/*', multiple: true, class: 'input' });
  const uploaded = new Set(); // files already sent, so a retry doesn't upload them twice
  const progress = h('div', { class: 'muted small', 'aria-live': 'polite' });
  const formError = h('div');
  const submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, r?.submitted_at ? t('Save changes') : t('Submit registration'));
  submit.addEventListener('click', (e) => guardPress(e)); // a refusal moves the button: a second press at its old spot does nothing for 600 ms, so it cannot untick the consent box (D-126, D-129)
  // The answers are saved but no ID photo is stored yet: the registration is not finished.
  const draftNote = t('Your answers are saved. Add a photo of your ID to finish registering.');

  const form = h('form', { class: 'form card', novalidate: true },
    r && !r.submitted_at && h('div', { class: 'alert alert--warn' }, draftNote),
    r?.submitted_at && h('div', { class: 'alert alert--ok' }, `${t('Received {when}', { when: fmtDateTimeL(r.submitted_at) })}${r.id_count ? (r.id_count > 1 ? t(' with {n} ID photos', { n: r.id_count }) : t(' with 1 ID photo')) : ''}${t('. You can update it below.')}`),
    formError,
    h('h2', null, t('Main guest')),
    field({ name: 'lead_name', label: t('Full name (as on your ID)'), required: true, value: r?.lead_name || '', maxlength: 120, autocomplete: 'name' }),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'phone', label: t('Mobile number'), type: 'tel', required: true, value: r?.phone || '', inputmode: 'tel', placeholder: '0917 123 4567', autocomplete: 'tel' }),
      field({ name: 'email', label: t('Email'), type: 'email', value: r?.email || '', autocomplete: 'email' })),
    h('h2', null, t('Other guests')),
    h('div', { class: 'field', dataset: { field: 'guests' } },
      h('p', { class: 'hint' }, t('Everyone else staying, including children.')),
      others,
      h('div', null, h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: () => addGuest() }, t('+ Add guest'))),
      headcount,
      h('div', { class: 'error', role: 'alert' })),
    h('h2', null, t('Arrival')),
    h('div', { class: 'form-row form-row--2' },
      field({ name: 'arrival_time', label: t('Estimated arrival time'), type: 'time', value: r?.arrival_time || '' }),
      field({ name: 'vehicle_plate', label: t('Car plate number (if parking)'), value: r?.vehicle_plate || '', maxlength: 20, placeholder: 'e.g. ABC 1234' })),
    field({ name: 'notes', label: t('Anything we should know?'), type: 'textarea', value: r?.notes || '', maxlength: 1000, placeholder: t('Special requests, late arrival, celebrating something…') }),
    h('h2', null, t('Valid ID')),
    h('div', { class: 'field', dataset: { field: 'id_photos' } },
      h('label', { for: 'ci-id-photos' }, t('ID photos')),
      h('p', { class: 'hint' }, h('span', { class: 'req', 'aria-hidden': 'true' }, '* '), `${t("A photo of a valid government ID for each adult (driver's license, passport, UMID, PhilID…). ")}${r?.id_count ? t('Photos you already sent are kept; add more only if needed.') : ''}${kept?.photosChosen ? ` ${t('Choose the photos again after changing the language.')}` : ''}`),
      photos, progress, h('div', { class: 'error', role: 'alert' })),
    rules && h('h2', null, t('House rules')),
    rules && h('div', { class: 'gp-rules', tabindex: 0, role: 'region', 'aria-label': t('House rules') }, rules),
    rules && (rulesAt
      ? h('p', { class: 'muted small' }, t('You accepted the house rules on {when}.', { when: fmtDateTimeL(rulesAt) }))
      : h('div', { class: 'field', dataset: { field: 'accept_rules' } },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'accept_rules' }), h('span', null, t('I have read and agree to the house rules.'))),
        h('div', { class: 'error', role: 'alert' }))),
    // Never pre-ticked, even when the form is reopened: the guest agrees again on every save.
    h('div', { class: 'field', dataset: { field: 'consent' } },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'consent' }),
        h('span', null, t("I agree that {host} may use these details and ID photos to register our stay with the building, as required under the Data Privacy Act. BalayHub deletes the ID photos {days} days after check-out; copies given to the building follow the building's own rules.", { host: s.workspace_name, days: s.id_retention_days }))),
      h('div', { class: 'error', role: 'alert' })),
    submit);

  // A field's message clears as soon as the guest changes that field (a checkbox, when ticked); the banner goes with the last marked field.
  // Guest rows added later are covered because the listener sits on the form. The Other guests message waits until no blank row is left.
  const clearFieldError = (e) => {
    const row = e.target.closest?.('.gc__guest');
    if (row) row.classList.remove('field--invalid');
    const wrap = e.target.closest?.('[data-field]');
    if (!wrap?.classList.contains('field--invalid')) return;
    if (row && others.querySelector('.field--invalid')) return;
    wrap.classList.remove('field--invalid');
    wrap.querySelectorAll('[aria-invalid]').forEach((f) => f.removeAttribute('aria-invalid'));
    const err = wrap.querySelector('.error');
    if (err) err.textContent = '';
    if (!form.querySelector('.field--invalid')) formError.replaceChildren();
  };
  form.addEventListener('input', clearFieldError);
  form.addEventListener('change', clearFieldError);

  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    clearErrors(form);
    formError.replaceChildren();
    const picked = [...photos.files]; // the photos checked here are the ones uploaded below
    const d = readForm(form);
    // Every required field, box and photo type is checked in one pass, before anything is sent.
    // Keys go in form order, so the first one focused is the first problem on screen.
    const problems = {};
    if (!d.lead_name.trim()) problems.lead_name = t('Please enter your full name, as on your ID.');
    if (!d.phone.trim()) problems.phone = t('Please enter your mobile number.');
    else if (!PHONE_RE.test(d.phone.trim())) problems.phone = t('Enter a valid phone number.'); // the server's `phone` type
    if (d.email.trim() && !EMAIL_RE.test(d.email.trim())) problems.email = t('Enter a valid email address.');
    // A blank guest row is marked here, and the server refuses it too: fill it in or remove it.
    const blankGuests = [...others.querySelectorAll('.gc__guest')].filter((row) => !row.querySelector('input').value.trim());
    blankGuests.forEach((row) => row.classList.add('field--invalid'));
    if (blankGuests.length) problems.guests = t('Enter the name of each guest, or remove the empty row.');
    if (picked.some((f) => f.size === 0)) problems.id_photos = t('This file is empty. Choose the file again.'); // D-111: a 0-byte photo is refused here, before anything is sent
    else if (picked.some((f) => !ID_PHOTO_TYPE.test(f.type))) problems.id_photos = t('Your ID must be a JPG, PNG or WEBP photo.');
    else for (const f of picked) { const bad = await fileContentError(f, PHOTO_KINDS); if (bad) { problems.id_photos = t(bad); break; } } // D-113: a renamed file is refused before the answers are saved
    if (!picked.length && !(r?.id_count > 0)) problems.id_photos = t('Add a photo of a valid ID for at least one guest.');
    if (rules && !rulesAt && !form.elements.accept_rules.checked) problems.accept_rules = t('Please read and agree to the house rules.');
    if (!form.elements.consent.checked) problems.consent = t('Please agree so your host can register you with the building.');
    if (Object.keys(problems).length) {
      formError.replaceChildren(h('div', { class: 'alert alert--error', role: 'alert' }, t('Please check the highlighted fields.')));
      showErrors(form, problems);
      busy = false;
      return;
    }
    // aria-disabled, not disabled: a disabled control drops focus to the page while it waits (D-97, D-105, D-120).
    submit.setAttribute('aria-disabled', 'true');
    const payload = {
      lead_name: d.lead_name, phone: d.phone, email: d.email, arrival_time: d.arrival_time, vehicle_plate: d.vehicle_plate,
      notes: d.notes, consent: Boolean(form.elements.consent.checked), id_photos: picked.length,
      ...(rules && !rulesAt ? { accept_rules: true } : {}),
      guests: [...others.querySelectorAll('input')].map((i) => i.value.trim()),
    };
    let savedDraft = false;
    try {
      submit.textContent = t('Saving…');
      await post(`/public/checkin/${encodeURIComponent(token)}`, payload);
      savedDraft = true;
      const files = picked.filter((f) => !uploaded.has(f));
      for (const [i, f] of files.entries()) {
        progress.textContent = t('Uploading ID photo {i} of {n}…', { i: i + 1, n: files.length });
        const blob = await shrinkImage(f);
        await api('POST', `/public/checkin/${encodeURIComponent(token)}/id`, undefined, { rawBody: blob, headers: { 'Content-Type': blob.type || 'image/jpeg' } });
        uploaded.add(f);
      }
      progress.textContent = '';
      // The page heading becomes the thank-you, so the screen no longer says "Please register".
      heading.textContent = t("Thank you! You're registered.");
      document.title = `${heading.textContent} — BalayHub`; // the tab follows the heading, like app.js titles the other guest pages
      if (intro) intro.hidden = true;
      el.replaceChildren(page(header, h('div', { class: 'card gc__done' },
        h('div', { class: 'gc__tick', 'aria-hidden': 'true' }, '✓'),
        h('p', { class: 'muted' }, t("{host} has received your details. You'll get your check-in instructions before arrival.", { host: s.workspace_name })),
        h('p', null, h('button', { class: 'linkbtn', onclick: () => guestCheckinView(el, { params }) }, t('Review or change my answers'))))));
    } catch (err) {
      progress.textContent = '';
      // A photo the server refuses after the answers were saved is said on the ID box; the banner keeps only the saved-answers note.
      const photoRefused = savedDraft && fileRefused(err);
      if (photoRefused) {
        if (!r) formError.replaceChildren(h('div', { class: 'alert alert--warn' }, draftNote)); // a page that loaded a saved record already shows the note at the top
        showErrors(form, { id_photos: tServer(err.message) });
        return;
      }
      // Each message shows once: one whose field is on the form sits at that field; the banner names only the rest.
      if (savedDraft && !r) formError.replaceChildren(h('div', { class: 'alert alert--warn' }, draftNote)); // same rule: a saved record already shows the note at the top
      const unplaced = err.fields ? showErrors(form, tFields(err.fields)) : [];
      const msg = !(err instanceof ApiError) ? (err.message || t('Something went wrong. Please try again.'))
        : unplaced.length ? unplaced.join(' ')
        : Object.keys(err.fields || {}).length ? t('Please check the highlighted fields.')
        : tServer(err.message);
      formError.append(h('div', { class: 'alert alert--error', role: 'alert' }, err.offline ? (navigator.onLine === false ? t("You're offline. Your answers are still here; try again when you're connected.") : t("That didn't go through. Your answers are still here; please try again.")) : msg));
      formError.scrollIntoView?.({ block: 'nearest' });
    } finally {
      busy = false;
      submit.removeAttribute('aria-disabled');
      submit.textContent = r?.submitted_at ? t('Save changes') : t('Submit registration');
    }
  });

  el.replaceChildren(page(header, form, h('p', { class: 'gc__foot muted small' }, t('Powered by BalayHub · '), h('a', { href: '#/privacy' }, t('Privacy notice')))));
  restoreFormValues(el, kept?.snap);
}

// ---------------------------------------------------------------- host: card on the reservation page
export async function checkinCard(bookingId, rerender) {
  let d;
  try { d = await get(`/reservations/${bookingId}/checkin`); } catch { return null; }
  const r = d.registration;
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
  const reg = r ? 1 + (r.guests?.length || 0) : 0;
  const registered = registeredText(reg, d.num_guests);
  return h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h2', null, 'Guest check-in form'),
      r?.submitted_at ? h('span', { class: 'badge badge--paid' }, 'Submitted') : h('span', { class: 'badge badge--unpaid' }, r ? 'Waiting' : 'Not yet')),
    !r && h('p', { class: 'muted small' }, 'Send this private link to the guest so they can register everyone and upload IDs before arrival. It is also included in the {{checkin_link}} message variable.'),
    h('div', { class: 'chips' },
      h('button', { class: 'btn btn--secondary btn--sm', onclick: () => copyText(d.link, 'Check-in link copied.', 'Copy the check-in link') }, 'Copy link'),
      r && h('button', { class: 'btn btn--secondary btn--sm', onclick: () => copyText(adminText, 'Copied. Paste it to your building admin.', 'Copy the registration details') }, 'Copy for building admin'),
      h('button', { class: 'btn btn--ghost btn--sm', onclick: newLink }, 'New link')),
    r && h('dl', { class: 'dl', style: { marginTop: '12px' } },
      h('dt', null, 'Main guest'), h('dd', null, r.lead_name),
      h('dt', null, 'Guests'), h('dd', null, registered),
      h('dt', null, 'Mobile'), h('dd', null, r.phone),
      r.email && [h('dt', null, 'Email'), h('dd', null, r.email)],
      h('dt', null, 'Other guests'), h('dd', null, r.guests?.length ? r.guests.join(', ') : '—'),
      h('dt', null, 'Arrival'), h('dd', null, r.arrival_time ? fmtTime(r.arrival_time) : '—'),
      h('dt', null, 'Plate number'), h('dd', null, r.vehicle_plate || '—'),
      r.notes && [h('dt', null, 'Notes'), h('dd', { style: { whiteSpace: 'pre-wrap' } }, r.notes)],
      r.submitted_at ? [h('dt', null, 'Submitted'), h('dd', null, fmtDateTime(r.updated_at || r.submitted_at))]
        : [h('dt', null, 'Status'), h('dd', null, "Waiting for the guest's ID photo")]),
    r && (r.ids_purged_at && !d.files.length
      ? h('p', { class: 'muted small' }, `ID photos were deleted ${fmtDateTime(r.ids_purged_at)} (after the stay).`)
      : d.files.length
        ? h('div', { class: 'gc__ids' }, d.files.map((f) => h('a', { href: `/api/files/${f.file_id}`, target: '_blank', rel: 'noopener' },
          h('img', { src: `/api/files/${f.file_id}`, alt: f.file_name, loading: 'lazy' }))))
        : h('p', { class: 'muted small' }, 'No ID photos uploaded yet.')));
}
