// Guest-facing language: English or Taglish. The host sets the default for their
// guest pages; a guest's own choice (toggle) is remembered on their device.
// Text is looked up by its English wording; anything missing stays in English.

import { h, manilaDay } from './ui.js';

const TL = {
  // shared
  'Privacy notice': 'Privacy notice',
  'Payments are processed securely by PayMongo. ': 'Ligtas na pinoproseso ng PayMongo ang bayad. ',
  'Link not found': 'Hindi makita ang link',
  'Something went wrong. Please try again.': 'May nagkaproblema. Pakisubukan ulit.',
  'Stay': 'Stay',
  'Check-in': 'Check-in',
  'Check-out': 'Check-out',
  'Booking': 'Booking',
  'Total': 'Kabuuan',
  'Balance': 'Balanse',
  'Full name': 'Buong pangalan',
  'Email': 'Email',
  'Mobile number': 'Mobile number',
  'TEST MODE: this page uses a PayMongo test key, so payments are not real.': 'TEST MODE: test key ng PayMongo ang gamit dito, kaya hindi totoong bayad ito.',
  // booking pages
  'Book your stay': 'Mag-book ng stay',
  'Secure booking by ': 'Secure booking gamit ang ',
  'Page not found': 'Hindi makita ang page',
  'This is a demo booking page. Bookings and payments are turned off.': 'Demo booking page lang ito. Naka-off ang booking at bayad.',
  'Online booking is paused right now. Please contact the host directly.': 'Naka-pause muna ang online booking. Paki-contact po ang host.',
  'Up to {n} guests': 'Hanggang {n} guests',
  '{n}-night minimum': 'Minimum {n} gabi',
  ' / night': ' / gabi',
  'No places are open for online booking yet.': 'Wala pang bukas na lugar para sa online booking.',
  'Not available': 'Hindi available',
  'See all places': 'Tingnan lahat ng lugar',
  'Payment cancelled. Nothing was charged and your dates were not booked.': 'Kinansela ang bayad. Walang nasingil at hindi na-book ang dates mo.',
  'Show photo': 'Ipakita ang litrato',
  ', not available': ', hindi available',
  '‹ Earlier': '‹ Nakaraan',
  'Later ›': 'Susunod ›',
  'Now choose your check-out date': 'Piliin na ang check-out date mo',
  'Choose your check-in date': 'Piliin ang check-in date mo',
  'S M T W T F S': 'Lin Lun Mar Miy Huw Biy Sab',
  'Payment': 'Bayad',
  'Pay in full now': 'Bayaran nang buo ngayon',
  'Pay a {pct}% deposit now, the rest before check-in': '{pct}% deposit ngayon, ang natitira bago mag-check-in',
  'Discount code': 'Discount code',
  'Have a discount code?': 'May discount code ka?',
  'Apply': 'Gamitin',
  'Code {code} applied: {label}.': 'Nagamit ang code {code}: {label}.',
  'Continue to payment': 'Tumuloy sa pagbabayad',
  'Check-in {date}. Now choose check-out.': 'Check-in {date}. Piliin na ang check-out.',
  'Choose your dates on the calendar to see the price.': 'Pumili ng petsa sa calendar para makita ang presyo.',
  'Your stay is too soon for a deposit; it will be charged in full.': 'Malapit na ang stay mo kaya buong bayad ang kailangan.',
  'Dates': 'Petsa',
  '{n} nights': '{n} gabi',
  '1 night': '1 gabi',
  'Cleaning fee': 'Cleaning fee',
  '{pct}% deposit': '{pct}% deposit',
  '{now} now, {rest} due by {date}': '{now} ngayon, {rest} bayaran hanggang {date}',
  'Sorry, these dates are no longer available.': 'Pasensya na, hindi na available ang mga petsang ito.',
  'Guests': 'Guests',
  'We send your confirmation here.': 'Dito namin ipapadala ang confirmation mo.',
  'Message to the host (optional)': 'Mensahe sa host (optional)',
  'Arrival time, special requests…': 'Oras ng dating, special requests…',
  'I agree to the house rules, and that my details are shared with {host} to manage my booking (see the ': 'Sumasang-ayon ako sa house rules, at na ibabahagi ang details ko kay {host} para sa booking ko (tingnan ang ',
  'privacy notice': 'privacy notice',
  'This is a demo, so booking is turned off.': 'Demo ito kaya naka-off ang booking.',
  'Online booking is paused. Please contact the host.': 'Naka-pause ang online booking. Paki-contact ang host.',
  'Opening secure payment…': 'Binubuksan ang secure payment…',
  '‹ All places': '‹ Lahat ng lugar',
  'Check-in {in} · Check-out {out}': 'Check-in {in} · Check-out {out}',
  'House rules': 'House rules',
  'Availability': 'Mga available na petsa',
  'Booking not found': 'Hindi makita ang booking',
  "You're booked, {name}!": 'Booked ka na, {name}!',
  'A confirmation and receipt were sent to your email.': 'Naipadala na sa email mo ang confirmation at resibo.',
  'Booking code': 'Booking code',
  'Place': 'Lugar',
  'Paid': 'Nabayaran',
  '{amount}, due {n} days before check-in': '{amount}, bayaran {n} araw bago mag-check-in',
  'Register your guests now': 'I-register na ang guests',
  "The building needs everyone's names and a valid ID before arrival. You can also do this later from the link in your email.": 'Kailangan ng building ang pangalan at valid ID ng lahat bago dumating. Puwede mo rin itong gawin mamaya gamit ang link sa email mo.',
  'Confirming your payment…': 'Kinukumpirma ang bayad mo…',
  'This usually takes a few seconds. Please keep this page open.': 'Ilang segundo lang ito. Huwag munang isara ang page.',
  'Your payment went through, but those dates were just booked by someone else. The host has been notified and will contact you to offer other dates or a full refund.': 'Pumasok ang bayad mo, pero na-book na ng iba ang mga petsang iyon. Naabisuhan na ang host at kokontakin ka para sa ibang petsa o buong refund.',
  'This booking was not completed and nothing was charged. Please start again.': 'Hindi natapos ang booking at walang nasingil. Pakiulit po.',
  'The payment could not be started. Nothing was charged. Please try again.': 'Hindi nasimulan ang bayad. Walang nasingil. Pakisubukan ulit.',
  'We have not received the payment confirmation yet. If you paid, you will get a confirmation email shortly; otherwise please try again.': 'Wala pa kaming kumpirmasyon ng bayad. Kung nagbayad ka na, may darating na confirmation email; kung hindi pa, pakisubukan ulit.',
  'Dates no longer available': 'Hindi na available ang petsa',
  'Booking not completed': 'Hindi natuloy ang booking',
  'Back to all places': 'Bumalik sa lahat ng lugar',
  'Book direct': 'Mag-book nang direkta',
  "This place isn't taking online bookings right now.": 'Hindi muna tumatanggap ng online booking ang lugar na ito ngayon.',
  'Enter the number of guests to see the total.': 'Ilagay ang bilang ng guests para makita ang kabuuan.',
  // balance payment
  'TEST MODE: payments on this page are not real.': 'TEST MODE: hindi totoong bayad ang nasa page na ito.',
  'Confirming your payment… ': 'Kinukumpirma ang bayad mo… ',
  'Please keep this page open.': 'Huwag munang isara ang page.',
  'Payment received. Thank you!': 'Natanggap ang bayad. Salamat po!',
  'Pay {amount} now': 'Magbayad ng {amount} ngayon',
  'Your booking is fully paid': 'Bayad na nang buo ang booking mo',
  'Hi {name}! ': 'Hi {name}! ',
  'Pay your balance': 'Bayaran ang balanse',
  'Paid so far': 'Nabayaran na',
  'This booking was cancelled.': 'Na-cancel ang booking na ito.',
  'Thank you! Nothing more to pay. See you soon.': 'Salamat po! Wala nang babayaran. Kita-kits!',
  'GCash, Maya, cards and GrabPay. You get an email receipt.': 'GCash, Maya, card at GrabPay. May email receipt ka.',
  'Online payment is not available for this booking. Please contact your host.': 'Hindi puwedeng magbayad online para sa booking na ito. Paki-contact ang host mo.',
  // check-in form
  'Hi {name}! Please register before you arrive': 'Hi {name}! Paki-register bago ka dumating',
  'Guest registration': 'Guest registration',
  'The building requires the names and a valid ID of everyone staying. It takes about 2 minutes.': 'Kailangan ng building ang pangalan at valid ID ng lahat ng mag-stay. Mga 2 minuto lang ito.',
  '{date}, from {time}': '{date}, mula {time}',
  '{date}, by {time}': '{date}, hanggang {time}',
  'This stay has ended or was cancelled, so the form is closed.': 'Tapos na o na-cancel ang stay na ito, kaya sarado na ang form.',
  'This unit allows up to {n} guests.': 'Hanggang {n} guests lang ang puwede sa unit na ito.',
  'Remove': 'Alisin',
  'Guest {n} full name': 'Buong pangalan ng guest {n}',
  'ID photos': 'Litrato ng ID',
  'Save changes': 'I-save ang changes',
  'Submit registration': 'Ipadala ang registration',
  'Received {when}': 'Natanggap {when}',
  ' with {n} ID photos': ' kasama ang {n} litrato ng ID',
  ' with 1 ID photo': ' kasama ang 1 litrato ng ID',
  '. You can update it below.': '. Puwede mo itong i-update sa ibaba.',
  'Main guest': 'Main guest',
  'Full name (as on your ID)': 'Buong pangalan (gaya ng nasa ID)',
  'Other guests': 'Iba pang guests',
  'Everyone else staying, including children.': 'Lahat ng iba pang mag-stay, pati mga bata.',
  '+ Add guest': '+ Magdagdag ng guest',
  'Arrival': 'Pagdating',
  'Estimated arrival time': 'Tantyang oras ng dating',
  'Car plate number (if parking)': 'Plate number ng sasakyan (kung magpa-park)',
  'Anything we should know?': 'May gusto ka bang sabihin sa amin?',
  'Special requests, late arrival, celebrating something…': 'Special requests, late arrival, may celebration…',
  'Valid ID': 'Valid ID',
  "A photo of a valid government ID for each adult (driver's license, passport, UMID, PhilID…). ": "Litrato ng valid government ID ng bawat adult (driver's license, passport, UMID, PhilID…). ",
  'Photos you already sent are kept; add more only if needed.': 'Naka-save na ang mga naipadala mong litrato; magdagdag lang kung kailangan.',
  "I agree that {host} may use these details and ID photos to register our stay with the building, as required under the Data Privacy Act. BalayHub deletes the ID photos {days} days after check-out; copies given to the building follow the building's own rules.":
    'Pumapayag ako na gamitin ni {host} ang mga detalye at litrato ng ID para i-register ang stay namin sa building, ayon sa Data Privacy Act. Buburahin ng BalayHub ang mga litrato ng ID {days} araw pagkatapos ng check-out; ang kopyang ibinigay sa building ay sumusunod sa sariling patakaran ng building.',
  'Saving…': 'Sine-save…',
  'Uploading ID photo {i} of {n}…': 'Ina-upload ang litrato ng ID {i} sa {n}…',
  "Thank you! You're registered.": 'Salamat! Registered ka na.',
  "{host} has received your details. You'll get your check-in instructions before arrival.": 'Natanggap na ni {host} ang mga detalye mo. Matatanggap mo ang check-in instructions bago ka dumating.',
  'Review or change my answers': 'Tingnan o baguhin ang sagot ko',
  "You're offline. Your answers are still here; try again when you're connected.": 'Offline ka. Nandito pa rin ang mga sagot mo; subukan ulit kapag may internet na.',
  'Powered by BalayHub · ': 'Powered by BalayHub · ',
  'Please choose a photo.': 'Pumili ng litrato.',
  'This photo is too large. Please take a smaller one.': 'Masyadong malaki ang litrato. Kumuha ng mas maliit.',
  // review page
  'Full name (as on your ID)': 'Buong pangalan (gaya ng nasa ID)',
  'Mobile': 'Mobile',
  'Code {code}': 'Code {code}',
  'Code {code} applied: −{amount}.': 'Nagamit ang code {code}: −{amount}.',
  'from ': 'mula ',
  'Holiday price': 'Holiday price',
  'Show photo {n}': 'Ipakita ang litrato {n}',
  '{amount}, due by {date}': '{amount}, bayaran hanggang {date}',
  'This booking was cancelled': 'Na-cancel ang booking na ito',
  'Due by {date}': 'Bayaran hanggang {date}',
  'Your stay has ended or was cancelled': 'Tapos na o na-cancel ang stay mo',
  'You can leave feedback once your stay starts.': 'Puwede kang mag-feedback kapag nagsimula na ang stay mo.',
  'Feedback opens soon': 'Malapit nang magbukas ang feedback',
  '1 star – {label}': '1 star – {label}',
  'Poor': 'Hindi maganda', 'Fair': 'Okay lang', 'Good': 'Maganda', 'Very good': 'Napakaganda', 'Excellent': 'Sobrang ganda',
  'Tap a star': 'Pindutin ang star', 'Optional': 'Optional',
  'Your feedback goes only to your host. ': 'Sa host mo lang mapupunta ang feedback mo. ',
  'Salamat po!': 'Salamat po!',
  'Thank you for your feedback. {host} will read it personally. We hope to host you again!': 'Salamat sa feedback mo. Personal itong babasahin ni {host}. Sana makabalik ka ulit!',
  'Feedback is closed': 'Sarado na ang feedback',
  'This stay can no longer be reviewed here. You can always message your host directly.': 'Hindi na puwedeng i-review dito ang stay na ito. Puwede mo pa ring i-message ang host mo.',
  'Overall, how was your stay?': 'Kumusta ang stay mo overall?',
  'How clean was the place?': 'Gaano kalinis ang lugar?',
  'What did you like? What could be better?': 'Ano ang nagustuhan mo? Ano pa ang puwedeng gawing mas maganda?',
  'Send feedback': 'Ipadala ang feedback',
  'Please choose a star rating first.': 'Pumili muna ng star rating.',
  "Anything you'd like to tell your host? (optional)": 'May gusto ka bang sabihin sa host mo? (optional)',
  'How was your stay?': 'Kumusta ang stay mo?',
  '{listing} · {dates}. This is private: only your host sees it.': '{listing} · {dates}. Private ito: ang host mo lang ang makakakita.',
  '{n} stars – {label}': '{n} star – {label}',
};

// Messages that come from the server (validation, codes, discounts), in Taglish.
const SERVER_TL = [
  [/^Please check the highlighted fields\.$/, () => 'Pakitingnan ang mga naka-highlight.'],
  [/^(.+) is required\.$/, (m) => `Kailangan ang ${t(m[1]).toLowerCase()}.`],
  [/^Enter a valid email address\.$/, () => 'Maglagay ng tamang email address.'],
  [/^Enter a valid phone number\.$/, () => 'Maglagay ng tamang mobile number.'],
  [/^(.+) must be at most (\d+) characters\.$/, (m) => `Hanggang ${m[2]} characters lang ang ${t(m[1]).toLowerCase()}.`],
  [/^(.+) must be at least (\d+)\.$/, (m) => `Dapat hindi bababa sa ${m[2]} ang ${t(m[1]).toLowerCase()}.`],
  [/^(.+) must be at most (\d+)\.$/, (m) => `Hanggang ${m[2]} lang ang ${t(m[1]).toLowerCase()}.`],
  [/^Please agree to continue\.$/, () => 'Paki-agree para makatuloy.'],
  [/^This code is not valid\.$/, () => 'Hindi valid ang code na ito.'],
  [/^This code has expired or is not active yet\.$/, () => 'Expired na o hindi pa active ang code na ito.'],
  [/^This code has been fully used\.$/, () => 'Naubos na ang gamit ng code na ito.'],
  [/^This code is for stays of (\d+) nights or more\.$/, (m) => `Para sa stay na ${m[1]} gabi pataas ang code na ito.`],
  [/^This code is for returning guests\. (.*)$/, () => 'Para sa bumabalik na guests ang code na ito. Gamitin ang pangalan at email ng nakaraan mong stay.'],
  [/^For returning guests: checked at payment against your previous stay\.$/, () => 'Para sa bumabalik na guests: titingnan sa pagbabayad gamit ang nakaraan mong stay.'],
  [/^(\d+)% (weekly|monthly) discount$/, (m) => `${m[1]}% ${m[2]} discount`],
  [/^(.+) off$/, (m) => `${m[1]} bawas`],
  [/^During (.+), this place has a minimum stay of (\d+) nights\.$/, (m) => `Sa ${m[1]}, minimum ${m[2]} gabi ang stay dito.`],
  [/^This place has a minimum stay of (\d+) nights\.$/, (m) => `Minimum ${m[1]} gabi ang stay dito.`],
  [/^This place allows up to (\d+) guests\.$/, (m) => `Hanggang ${m[1]} guests lang ang puwede sa lugar na ito.`],
  [/^Choose a date from today onwards\.$/, () => 'Pumili ng petsa mula ngayon.'],
  [/^Choose a check-out date after check-in\.$/, () => 'Pumili ng check-out pagkatapos ng check-in.'],
  [/^For stays longer than 60 nights, please contact the host\.$/, () => 'Para sa stay na higit 60 gabi, paki-contact ang host.'],
  [/^Sorry, those dates were just booked\. Please choose other dates\.$/, () => 'Pasensya na, kaka-book lang ng mga petsang iyon. Pumili ng ibang petsa.'],
  [/^Couldn't reach the payment service\. Please try again in a moment\.$/, () => 'Hindi maabot ang payment service. Pakisubukan ulit mamaya.'],
  [/^This booking is already fully paid\. Thank you!$/, () => 'Bayad na nang buo ang booking na ito. Salamat!'],
  [/^You already sent proofs for (₱[\d,]+\.\d{2}) that the host hasn't checked yet, so you can send up to (₱[\d,]+\.\d{2}) more\.$/, (m) => `Nakapadala ka na ng patunay na ${m[1]} na hindi pa na-check ng host, kaya hanggang ${m[2]} pa lang ang puwede mong ipadala.`],
  [/^Your proofs already cover what you owe\. The host will check them soon\.$/, () => 'Sapat na ang mga patunay mo para sa utang mo. I-check na ito ng host maya-maya.'],
  [/^This is more than the (₱[\d,]+\.\d{2}) still owed\.$/, (m) => `Mas malaki ito sa balanseng ${m[1]}.`],
  [/^This check-in link is not valid\. Please ask your host for a new one\.$/, () => 'Hindi valid ang check-in link na ito. Humingi ng bagong link sa host mo.'],
  [/^This review link is not valid\.$/, () => 'Hindi valid ang review link na ito.'],
  [/^This guidebook is not available for this stay\. Please ask your host for a new link\.$/, () => 'Hindi available ang guidebook para sa stay na ito. Humingi ng bagong link sa host mo.'],
  [/^This quote is not available\.$/, () => 'Hindi available ang quote na ito.'],
  [/^This booking page is not available\.$/, () => 'Hindi available ang booking page na ito.'],
  [/^This listing is not available\.$/, () => 'Hindi available ang listing na ito.'],
];
export function tServer(msg) {
  if (current !== 'tl' || !msg) return msg;
  for (const [re, fn] of SERVER_TL) { const m = re.exec(msg); if (m) return fn(m); }
  return TL[msg] || msg;
}
export const tFields = (fields) => (fields ? Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, tServer(v)])) : fields);

export function fmtDateTimeL(d) {
  return d ? new Date(d).toLocaleString(locale(), { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }) : '';
}

// Pages can add their own Taglish wording (e.g. the landing page).
export function extendTranslations(dict) { Object.assign(TL, dict); }

const KEY = 'bh-guest-lang';
let current = 'en';
let hostDefault = 'en';

// Call when a guest page loads, with the host's default ('en' or 'tl').
export function initGuestLang(def) {
  hostDefault = def === 'tl' ? 'tl' : 'en';
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* private mode */ }
  current = saved === 'en' || saved === 'tl' ? saved : hostDefault;
  document.documentElement.lang = current === 'tl' ? 'fil' : 'en';
  return current;
}

export const guestLang = () => current;
export const locale = () => (current === 'tl' ? 'fil-PH' : 'en-PH');

export function t(en, vars) {
  let s = (current === 'tl' && TL[en]) || en;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

export function fmtDateL(d) {
  return d ? new Date(`${manilaDay(d)}T00:00:00Z`).toLocaleDateString(locale(), { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
}

export function setGuestLang(l) {
  current = l === 'tl' ? 'tl' : 'en';
  document.documentElement.lang = current === 'tl' ? 'fil' : 'en';
  try { localStorage.setItem(KEY, current); } catch { /* ignore */ }
}

// Tab title from a page's h1 (minus a leading brand name). app.js marks the guest pages it titled this way (data-h1title).
export function h1Title(root = document.getElementById('app')) {
  return root?.querySelector('h1')?.textContent.replace(/^BalayHub /, '').replace(/^Terms of Service/, 'Terms of service');
}
function retitle() {
  if (!document.documentElement.dataset.h1title) return;
  const title = h1Title();
  if (title) document.title = `${title} — BalayHub`;
}

// "English · Tagalog" switch for guest pages.
export function langToggle(onChange) {
  const pick = (l) => {
    current = l;
    document.documentElement.lang = l === 'tl' ? 'fil' : 'en';
    try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
    // The redraw may be async; the tab title follows the new heading once it is drawn.
    Promise.resolve(onChange()).then(retitle, () => {});
  };
  return h('div', { class: 'langtoggle', role: 'group', 'aria-label': 'Language' },
    h('button', { type: 'button', 'aria-pressed': String(current === 'en'), onclick: () => pick('en') }, 'English'),
    h('button', { type: 'button', 'aria-pressed': String(current === 'tl'), onclick: () => pick('tl') }, 'Tagalog'));
}
