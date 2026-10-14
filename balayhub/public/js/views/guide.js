// Guest's private guidebook for one stay, opened from the link the host sends (#/guide/:token).
// Phone-first sections in English or Taglish, plus Wi-Fi and door code cards that only show around the stay.

import { get } from '../api.js';
import { h, brand, icon, toast } from '../ui.js';
import { t, tServer, guestLang, initGuestLang, langToggle, fmtDateL as fmtDate, extendTranslations } from '../i18n.js';

extendTranslations({
  'Your guidebook': 'Ang guidebook mo',
  'Hi {name}! Welcome to your stay': 'Hi {name}! Maligayang pagdating sa stay mo',
  'Welcome to your stay': 'Maligayang pagdating sa stay mo',
  'Guidebook not available': 'Hindi available ang guidebook',
  'Loading your guidebook…': 'Kinukuha ang guidebook mo…',
  'Check-in': 'Check-in',
  'Check-out': 'Check-out',
  '{date}, from {time}': '{date}, mula {time}',
  '{date}, by {time}': '{date}, hanggang {time}',
  'Getting in': 'Pagpasok',
  'Wi-Fi': 'Wi-Fi',
  'Network name': 'Pangalan ng network',
  'Password': 'Password',
  'Door code': 'Code ng pinto',
  'Code': 'Code',
  'Copy': 'Kopyahin',
  'Copied.': 'Nakopya na.',
  'Could not copy. Please select the text and copy it.': 'Hindi makopya. Piliin ang text at kopyahin ito.',
  'Shown from {date}': 'Makikita mula {date}',
  'For your safety, the Wi-Fi password and door code appear the day before check-in.': 'Para sa seguridad, lalabas ang Wi-Fi password at door code isang araw bago ang check-in.',
  'Arrival and directions': 'Pagdating at direksyon',
  'Parking': 'Paradahan',
  'Building and gate notes': 'Tala sa building at gate',
  'Check-in instructions': 'Paano mag-check-in',
  'House rules': 'Mga patakaran sa bahay',
  'Local tips': 'Mga tip sa paligid',
  'Emergency contacts': 'Mga numero sa emergency',
  'This guidebook has no details yet. Please message your host if you need anything.': 'Wala pang laman ang guidebook na ito. Mag-message sa host kung may kailangan ka.',
  'Try again': 'Subukan ulit',
  'Your stay has ended, so the Wi-Fi password and door code are no longer shown.': 'Tapos na ang stay mo, kaya hindi na ipinapakita ang Wi-Fi password at door code.',
  'Your guidebook opens on {date}. Come back then; this same link will work.': 'Magbubukas ang guidebook mo sa {date}. Bumalik ka sa araw na iyon; gagana pa rin ang parehong link.',
});

// Section order, the field names (English; Taglish is `${key}_tl`) and the icon for each.
const SECTIONS = [
  ['arrival', 'Arrival and directions', 'home'],
  ['parking', 'Parking', 'building'],
  ['building_notes', 'Building and gate notes', 'shield'],
  ['checkin_instructions', 'Check-in instructions', 'file'],
  ['house_rules', 'House rules', 'bed'],
  ['local_tips', 'Local tips', 'sparkle'],
  ['emergency_contacts', 'Emergency contacts', 'help'],
];

const fmtTime = (v) => {
  if (!v) return '';
  const [hh, mm] = String(v).split(':').map(Number);
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
};

// The text of one section in the guest's language, falling back to English when the Taglish one is empty.
// The server sends `sections.key` (English) and `sections.key_tl` (Taglish).
function sectionText(d, key) {
  const tl = guestLang() === 'tl' ? d.sections?.[`${key}_tl`] : null;
  return String(tl || d.sections?.[key] || '').trim();
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast(t('Copied.')); } catch { toast(t('Could not copy. Please select the text and copy it.'), 'error'); }
}

// A card with one secret value and a Copy button, or the "shown from" note when it isn't time yet.
function secretCard(title, iconName, rows, from) {
  return h('section', { class: 'card gg-secret' },
    h('h2', { class: 'gg-h' }, icon(iconName), h('span', null, title)),
    from
      ? [h('p', { class: 'gg-from' }, t('Shown from {date}', { date: fmtDate(from) })),
        h('p', { class: 'muted small' }, t('For your safety, the Wi-Fi password and door code appear the day before check-in.'))]
      : rows.filter((r) => r.value).map((r) => h('div', { class: 'gg-row' },
        h('div', { class: 'gg-row__text' }, h('span', { class: 'muted small' }, r.label), h('code', { class: 'gg-val' }, r.value)),
        r.copy && h('button', { class: 'btn btn--secondary btn--sm', type: 'button', 'aria-label': `${t('Copy')}: ${r.label}`, onclick: () => copyText(r.value) }, t('Copy')))));
}

export async function guideView(el, { params }) {
  initGuestLang();
  const token = params.token;
  const page = (...children) => h('div', { class: 'gc' },
    h('header', { class: 'gc__top gc__top--lang' }, brand(null), langToggle(() => guideView(el, { params }))),
    h('main', { class: 'gc__main', id: 'main' }, children),
    h('p', { class: 'gc__foot muted small' }, t('Powered by BalayHub · '), h('a', { href: '#/privacy' }, t('Privacy notice'))));
  el.replaceChildren(page(h('div', { class: 'card', role: 'status', 'aria-live': 'polite' }, h('p', { class: 'muted' }, t('Loading your guidebook…')), h('div', { class: 'skeleton' }))));
  let d;
  try { d = await get(`/public/guide/${encodeURIComponent(token)}`); } catch (err) {
    // Before the window the same link works later, so the page says the date it opens.
    const early = err.code === 'GUIDE_NOT_YET';
    el.replaceChildren(page(h('div', { class: 'card' },
      h('h1', null, early ? t('Your guidebook') : t('Guidebook not available')),
      h('p', { class: 'muted' }, early ? t('Your guidebook opens on {date}. Come back then; this same link will work.', { date: fmtDate(err.data?.opens_on) }) : tServer(err.message)),
      err.offline && h('button', { class: 'btn btn--secondary', type: 'button', onclick: () => guideView(el, { params }) }, t('Try again')))));
    return;
  }
  initGuestLang(d.guest_language);
  const first = d.guest_first_name;
  const wifiFrom = d.secrets_from;
  const hasWifi = d.wifi_name || d.wifi_password;
  const secrets = d.stay_over ? [h('p', { class: 'alert alert--info', role: 'status' }, t('Your stay has ended, so the Wi-Fi password and door code are no longer shown.'))] : [
    (hasWifi || wifiFrom) && secretCard(t('Wi-Fi'), 'cash', [
      { label: t('Network name'), value: d.wifi_name },
      { label: t('Password'), value: d.wifi_password, copy: true }], wifiFrom && !d.wifi_password ? wifiFrom : null),
    (d.door_code || wifiFrom) && secretCard(t('Door code'), 'shield', [{ label: t('Code'), value: d.door_code, copy: true }], wifiFrom && !d.door_code ? wifiFrom : null),
  ].filter(Boolean);
  const blocks = SECTIONS.map(([key, title, ic]) => {
    const text = sectionText(d, key);
    return text && h('section', { class: 'card gg-sec' },
      h('h2', { class: 'gg-h' }, icon(ic), h('span', null, t(title))),
      h('div', { class: 'gg-text' }, text));
  }).filter(Boolean);
  el.replaceChildren(page(
    h('div', { class: 'card' },
      h('p', { class: 'gc__eyebrow' }, d.property_name || ''),
      h('h1', null, first ? t('Hi {name}! Welcome to your stay', { name: first }) : t('Welcome to your stay')),
      h('p', { class: 'muted' }, [d.listing, d.city].filter(Boolean).join(', ')),
      h('dl', { class: 'dl' },
        h('dt', null, t('Check-in')), h('dd', null, d.checkin_time ? t('{date}, from {time}', { date: fmtDate(d.check_in), time: fmtTime(d.checkin_time) }) : fmtDate(d.check_in)),
        h('dt', null, t('Check-out')), h('dd', null, d.checkout_time ? t('{date}, by {time}', { date: fmtDate(d.check_out), time: fmtTime(d.checkout_time) }) : fmtDate(d.check_out)))),
    secrets,
    blocks.length ? blocks : !secrets.length && h('div', { class: 'alert alert--info' }, t('This guidebook has no details yet. Please message your host if you need anything.'))));
}
