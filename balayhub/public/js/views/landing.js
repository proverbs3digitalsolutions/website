// Public landing page: what BalayHub does, why it fits Philippine hosts,
// pricing, FAQ, a 3-step "Get started" sign-up and an English/Tagalog switch.

import { get, post, ApiError } from '../api.js';
import { h, brand, icon, toast, openModal } from '../ui.js';
import { refreshUser, navigate, homeRoute, state, afterLogin } from '../app.js';
import { t, initGuestLang, setGuestLang, guestLang, extendTranslations } from '../i18n.js';
import { themeSwitch } from '../themeswitch.js';

extendTranslations({
  // nav
  'Features': 'Features', 'Why BalayHub': 'Bakit BalayHub', 'Pricing': 'Presyo', 'FAQ': 'FAQ', 'Log in': 'Mag-log in', 'Get started': 'Magsimula',
  'Language': 'Wika',
  // hero
  'For Airbnb and staycation hosts in the Philippines': 'Para sa mga Airbnb at staycation host sa Pilipinas',
  'Run all your units from ': 'Patakbuhin ang lahat ng unit mo sa ',
  'one calendar.': 'iisang calendar.',
  'BalayHub brings your Airbnb, Booking.com, Agoda and direct bookings together, with your own booking page, GCash and Maya payments, a guest inbox, cleaning schedule and condo gate passes. Made for hosts with 1 to 10 units.':
    'Pinagsasama ng BalayHub ang bookings mo sa Airbnb, Booking.com, Agoda at direkta, kasama ang sarili mong booking page, bayad sa GCash at Maya, guest inbox, cleaning schedule at gate pass para sa condo. Para sa mga host na may 1 hanggang 10 unit.',
  'Start your {n}-day free trial': 'Simulan ang {n}-day free trial',
  'Try the live demo': 'Subukan ang live demo',
  'Opening demo…': 'Binubuksan ang demo…',
  'No credit card needed. Works on your phone. English or Tagalog.': 'Walang credit card na kailangan. Gumagana sa phone. English o Tagalog.',
  'Syncs with': 'Naka-sync sa',
  // highlights
  'One calendar': 'Iisang calendar', 'for every channel': 'para sa lahat ng channel',
  'GCash & Maya': 'GCash at Maya', 'payments to your own account': 'diretso sa sarili mong account',
  'English or Tagalog': 'English o Tagalog', 'for you and your guests': 'para sa iyo at sa guests mo',
  'Peso pricing': 'Presyong piso', 'from ₱{p} a month': 'mula ₱{p} kada buwan',
  // all-in-one
  'All-in-one for hosts': 'All-in-one para sa mga host',
  'Everything a host juggles, in one place': 'Lahat ng inaasikaso ng host, nasa iisang lugar',
  'Stop switching between three host apps, a spreadsheet, a notebook and a dozen chat threads.': 'Tama na ang palipat-lipat sa tatlong host app, spreadsheet, notebook at sandamakmak na chat.',
  'Channels & pricing': 'Channels at presyo', 'Direct bookings & payments': 'Direct booking at bayad', 'Guest experience': 'Para sa guests',
  'Operations': 'Operations', 'Owners & reports': 'Owners at reports',
  // groups
  'Multi-calendar for all your units and channels': 'Multi-calendar ng lahat ng unit at channel',
  'Calendar sync with Airbnb, Booking.com, Agoda, Vrbo, Expedia and Trip.com': 'Calendar sync sa Airbnb, Booking.com, Agoda, Vrbo, Expedia at Trip.com',
  'Weekend and PH holiday rates (Holy Week, Christmas, long weekends) applied automatically': 'Weekend at PH holiday rates (Holy Week, Pasko, long weekend) awtomatiko',
  'Seasons, minimum nights, weekly and monthly discounts': 'Seasons, minimum nights, weekly at monthly discount',
  'Your own booking page with photos and a live availability calendar': 'Sariling booking page na may litrato at live na availability calendar',
  'Guests pay with GCash, Maya or card through your own PayMongo account': 'Nagbabayad ang guests gamit GCash, Maya o card sa sarili mong PayMongo account',
  'Full payment or a deposit (set per listing, default 50%), with a payment link for the balance': 'Buong bayad o deposit (itakda kada listing, default 50%), may payment link para sa balanse',
  'Discount codes for returning guests and quiet weeks': 'Discount codes para sa bumabalik na guests at matumal na linggo',
  'Guest inbox with templates and automatic messages': 'Guest inbox na may templates at automatic messages',
  'AI reply drafts in English, Tagalog or Taglish': 'AI reply drafts sa English, Tagalog o Taglish',
  'Online check-in form: guest names and IDs before arrival': 'Online check-in form: pangalan at ID ng guests bago dumating',
  'Private reviews after each stay, and repeat-guest and VIP flags': 'Private reviews pagkatapos ng stay, at repeat-guest at VIP flags',
  'Cleaning tasks with checklists and photos for every check-out': 'Cleaning tasks na may checklist at litrato sa bawat check-out',
  'Gate pass emailed to your condo admin before each arrival': 'Gate pass na ini-email sa condo admin bago dumating ang guest',
  'Security deposits: record, return or deduct with photos': 'Security deposit: i-record, ibalik o bawasan na may litrato',
  'Team logins for co-hosts and cleaners, phone app and notifications': 'Login para sa co-host at cleaners, phone app at notifications',
  'Revenue, occupancy, average nightly rate and channel reports': 'Reports ng kita, occupancy, average nightly rate at channel',
  'Income summary per month and quarter for your bookkeeper': 'Income summary kada buwan at quarter para sa bookkeeper mo',
  'Monthly owner statements with your management fee': 'Monthly owner statements kasama ang management fee mo',
  'Numbered receipts and booking confirmations by email': 'Numbered receipts at booking confirmations sa email',
  'Your Airbnb, Booking.com and Agoda calendars stay in sync, and prices follow weekends and Philippine holidays.': 'Naka-sync ang calendar mo sa Airbnb, Booking.com at Agoda, at sumusunod ang presyo sa weekend at mga holiday sa Pilipinas.',
  'Take bookings without channel fees, and get paid straight to your own account.': 'Tumanggap ng booking nang walang channel fee, at diretso ang bayad sa sarili mong account.',
  'Every guest gets the right message at the right time, in the language they prefer.': 'Tamang mensahe sa tamang oras para sa bawat guest, sa wikang gusto nila.',
  'Cleanings, condo paperwork and deposits handled without the group chat chaos.': 'Cleaning, papeles sa condo at deposit, ayos na nang walang gulo sa group chat.',
  'Know which unit is really earning, and keep owners and your bookkeeper happy.': 'Alamin kung aling unit ang talagang kumikita, at panatilihing masaya ang owners at bookkeeper mo.',
  // new in BalayHub + refreshed feature lists
  'Team & daily work': 'Team at daily work',
  'Warnings when a channel calendar stops syncing': 'Babala kapag tumigil ang sync ng calendar ng channel',
  'Last-minute, far-out, gap-night, event and 14+ night prices, with a preview and a lowest-price floor': 'Presyo para sa last-minute, malayo pa, gap nights, events at 14+ gabi, may preview at pinakamababang presyo',
  'Bulk price and block changes across units': 'Sabay-sabay na pagbabago ng presyo at block sa maraming unit',
  'Itemised bills with extra charges, and numbered receipts': 'Itemised na bill na may extra charges, at numbered receipts',
  'Guests send GCash, Maya or bank proof; you confirm or reject it': 'Nagpapadala ang guests ng patunay ng GCash, Maya o bank transfer; ikaw ang magko-confirm o magre-reject',
  'Cancellation policies with suggested refunds and a refund log': 'Cancellation policy na may suggested refund at refund log',
  'Quotes with a pay link for Facebook and Messenger inquiries': 'Quote na may pay link para sa inquiries sa Facebook at Messenger',
  'Share links by source, so you see where bookings come from': 'Share links kada source, para makita kung saan galing ang bookings',
  'Guidebook with Wi-Fi and door code shown only around the stay': 'Guidebook na may Wi-Fi at door code na lalabas lang sa paligid ng stay',
  'House rules accepted by the guest before they book': 'House rules na tinatanggap ng guest bago mag-book',
  'Paid add-ons like late check-out or extra bed': 'Bayad na add-ons tulad ng late check-out o extra bed',
  'Review links for happy guests, and codes for returning guests': 'Review links para sa masasayang guests, at codes para sa bumabalik',
  'Cleaners see only their own jobs and pay, in Taglish': 'Nakikita lang ng cleaners ang sarili nilang trabaho at sahod, sa Taglish',
  'Status board (dirty, clean, inspected) and inspections with scores': 'Status board (madumi, malinis, na-inspect) at inspections na may score',
  'Damage reports that become a charge, a deposit deduction or a waiver': 'Damage reports na nagiging charge, bawas sa deposit o waived',
  'Cleaner pay, supplies with low-stock alerts, and lost and found': 'Sahod ng cleaner, supplies na may low-stock alert, at lost and found',
  'Work orders and recurring maintenance': 'Work orders at paulit-ulit na maintenance',
  'Owner portal: owners sign in with an emailed link, no password': 'Owner portal: nagla-log in ang owners gamit ang link sa email, walang password',
  'Fee types, statements you review then publish, and payout records': 'Fee types, statements na ire-review mo bago i-publish, at payout records',
  'Repairs reserve and profit and loss for each unit': 'Repairs reserve at kita at gastos kada unit',
  'Daily close: see the day\'s check-ins, payments and tasks, then wrap up': 'Daily close: tingnan ang check-ins, bayad at gawain ng araw, saka isara',
  'Group bookings and moving a booking by drag and drop': 'Group bookings at paglipat ng booking sa pamamagitan ng drag and drop',
  'Activity history on every booking': 'Activity history sa bawat booking',
  'Assign conversations and @mention teammates': 'Mag-assign ng conversations at mag-@mention ng kakampi',
  'Notification settings for each person': 'Notification settings kada tao',
  'Know who did what, who is on duty and what is left for today.': 'Alamin kung sino ang gumawa ng ano, sino ang naka-duty at ano ang natitira ngayong araw.',
  'New in BalayHub': 'Bago sa BalayHub',
  'Built from what hosts told us they needed.': 'Binuo ayon sa sinabi ng mga host na kailangan nila.',
  'Money done right': 'Maayos na pera', 'Itemised bills, GCash, Maya and bank proofs, deposits per listing, refunds that follow your cancellation policy.': 'Itemised na bill, patunay ng GCash, Maya at bank, deposit kada listing, refund ayon sa cancellation policy mo.',
  'Owner portal': 'Owner portal', 'Owners sign in with an emailed link to see their statements, payouts and unit profit.': 'Nagla-log in ang owners gamit ang link sa email para makita ang statements, payouts at kita ng unit nila.',
  'Cleaner app': 'App para sa cleaners', 'Cleaners see only their jobs and pay, with photos and checklists, in Taglish.': 'Nakikita lang ng cleaners ang trabaho at sahod nila, may litrato at checklist, sa Taglish.',
  'Smarter prices': 'Mas matalinong presyo', 'Last-minute, far-out and gap-night rules with a preview before you save.': 'Rules para sa last-minute, malayo pa at gap nights, may preview bago i-save.',
  'Guidebook and add-ons': 'Guidebook at add-ons', 'Wi-Fi and door code appear only around the stay. Sell late check-out and extras.': 'Lalabas lang ang Wi-Fi at door code sa paligid ng stay. Magbenta ng late check-out at extras.',
  'Quotes for Messenger': 'Quote para sa Messenger', 'Send a price with a pay link to guests who ask on Facebook or Messenger.': 'Magpadala ng presyo na may pay link sa guests na nagtatanong sa Facebook o Messenger.',
  'Do owners get their own login?': 'May sariling login ba ang owners?',
  'Yes. You invite an owner and they sign in with a one-time link sent to their email. They see only their own units: published statements, payouts, repairs reserve and profit and loss. They never see your other units.': 'Oo. Mag-iimbita ka ng owner at magla-log in sila gamit ang one-time link sa email. Ang units lang nila ang nakikita: published statements, payouts, repairs reserve at kita at gastos. Hindi nila nakikita ang ibang unit mo.',
  'Yes. Invite a manager, staff member or cleaner and choose which properties they can see. Cleaners see only their own cleaning jobs and pay, in English or Taglish. Staff never see guests\' phone numbers or email addresses.': 'Oo. Mag-invite ng manager, staff o cleaner at piliin kung aling properties ang makikita nila. Nakikita lang ng cleaners ang sarili nilang cleaning jobs at sahod, sa English o Taglish. Hindi kailanman nakikita ng staff ang phone number o email ng guests.',
  // why
  'Made for hosts in the Philippines': 'Gawa para sa mga host sa Pilipinas',
  'Foreign tools are built for other markets. BalayHub is built around how hosting works here.': 'Gawa ang foreign tools para sa ibang market. Ang BalayHub ay ginawa ayon sa takbo ng hosting dito.',
  'Philippine holidays built in': 'Kasama na ang PH holidays', 'Holy Week, Christmas to New Year and long weekends get your holiday rate automatically.': 'Awtomatikong holiday rate sa Holy Week, Pasko hanggang Bagong Taon at long weekends.',
  'Condo gate passes': 'Gate pass sa condo', 'Guest names and IDs go to the building admin before arrival, and the admin confirms with one click.': 'Naipapadala ang pangalan at ID ng guests sa building admin bago dumating, at nagko-confirm ang admin sa isang click.',
  'GCash and Maya': 'GCash at Maya', 'Guests pay the way they already do, straight to your PayMongo account.': 'Nagbabayad ang guests sa paraang sanay sila, diretso sa PayMongo account mo.',
  'Taglish for guests': 'Taglish para sa guests', 'Booking page, check-in form and messages in English or Taglish.': 'Booking page, check-in form at messages sa English o Taglish.',
  'Data Privacy Act ready': 'Handa sa Data Privacy Act', 'Consent on every form, guest IDs deleted after the stay, export or delete your data anytime.': 'May consent sa bawat form, binubura ang guest IDs pagkatapos ng stay, puwedeng i-export o burahin ang data anumang oras.',
  'Priced in pesos': 'Presyong piso', 'Simple monthly plans in pesos, paid by GCash, Maya or card. No dollar bills.': 'Simpleng monthly plans sa piso, bayad sa GCash, Maya o card. Walang dolyar.',
  // steps
  'Set up in an afternoon': 'Setup sa isang hapon',
  'Add your listings': 'Idagdag ang listings mo', 'Name, nightly rate, cleaning fee, Wi-Fi and house rules.': 'Pangalan, nightly rate, cleaning fee, Wi-Fi at house rules.',
  'Connect your calendars': 'I-connect ang calendars mo', 'Paste each listing\'s Airbnb, Booking.com or Agoda calendar link. Bookings appear automatically.': 'I-paste ang calendar link ng bawat listing sa Airbnb, Booking.com o Agoda. Kusang lalabas ang bookings.',
  'Invite your team': 'I-invite ang team mo', 'Your co-host and cleaners get their own logins with just the access they need.': 'May sariling login ang co-host at cleaners mo, sa access lang na kailangan nila.',
  // who
  'Who BalayHub is for': 'Para kanino ang BalayHub',
  'Starting out': 'Nagsisimula pa lang', '1–2 units': '1–2 unit', 'One calendar, automatic messages and receipts, so hosting fits around your day job.': 'Iisang calendar, automatic messages at resibo, para kasya ang hosting sa trabaho mo.',
  'Growing host': 'Lumalaking host', '4–10 units': '4–10 unit', 'A team, cleaning schedule, direct bookings and reports for every unit.': 'Team, cleaning schedule, direct bookings at reports para sa bawat unit.',
  'Managing for owners': 'Nagma-manage para sa owners', 'More than 10 units': 'Higit 10 unit', 'Owner statements with your management fee, and access per building.': 'Owner statements na may management fee mo, at access kada building.',
  // pricing
  'Simple monthly pricing': 'Simpleng monthly na presyo',
  'Every plan starts with a {n}-day free trial with all features. Pay by GCash, Maya or card.': 'Bawat plan ay may {n}-day free trial na kumpleto ang features. Bayad sa GCash, Maya o card.',
  'Most popular': 'Pinakasikat', ' / month': ' / buwan', 'Up to {n} listings': 'Hanggang {n} listings', 'Up to 1 listing': 'Hanggang 1 listing',
  'Multi-calendar, channel sync and pricing helpers': 'Multi-calendar, channel sync at pricing helpers',
  'Direct booking page and online payments': 'Direct booking page at online payments',
  'Guest inbox, automatic messages and check-in form': 'Guest inbox, automatic messages at check-in form',
  'Housekeeping, gate pass and deposits': 'Housekeeping, gate pass at deposits',
  'Reports and owner statements': 'Reports at owner statements',
  'AI reply drafts': 'AI reply drafts', 'No AI reply drafts': 'Walang AI reply drafts', 'Unlimited team members': 'Walang limit na team members',
  'Start free trial': 'Simulan ang free trial',
  'More than 10 units or managing for owners? ': 'Higit 10 unit o nagma-manage para sa owners? ', 'Talk to us': 'Kausapin kami', ' about a custom plan.': ' para sa custom plan.',
  // faq
  'Questions hosts ask': 'Mga tanong ng mga host',
  'Does it connect to my Airbnb account?': 'Konektado ba ito sa Airbnb account ko?',
  'BalayHub syncs calendars with Airbnb, Booking.com, Agoda and more using their calendar (iCal) links, which every host can set up in a few minutes. Guest messages on Airbnb stay on Airbnb; BalayHub\'s inbox is for guests you reach by email, including direct bookings.':
    'Nagsi-sync ang BalayHub ng calendar sa Airbnb, Booking.com, Agoda at iba pa gamit ang calendar (iCal) links nila, na kayang i-setup ng kahit sinong host sa ilang minuto. Nananatili sa Airbnb ang messages doon; ang inbox ng BalayHub ay para sa guests na naaabot mo sa email, kasama ang direct bookings.',
  'Can guests pay me online?': 'Puwede bang magbayad online ang guests?',
  'Yes. Connect your own PayMongo account and guests pay by GCash, Maya or card on your booking page or through a payment link for the balance. The money goes to your PayMongo account, not to BalayHub.':
    'Oo. I-connect ang sarili mong PayMongo account at magbabayad ang guests gamit GCash, Maya o card sa booking page mo o sa payment link para sa balanse. Sa PayMongo account mo pumupunta ang pera, hindi sa BalayHub.',
  'Is my guests\' data safe?': 'Ligtas ba ang data ng guests ko?',
  'Your data is stored on a private server, every page requires a login, and each team member only sees the properties you assign. BalayHub follows the Philippine Data Privacy Act (RA 10173): guest ID photos are deleted after the stay, and you can export or delete your data at any time.':
    'Nasa private server ang data mo, kailangan ng login sa bawat page, at ang properties lang na in-assign mo ang nakikita ng bawat team member. Sumusunod ang BalayHub sa Data Privacy Act (RA 10173): binubura ang ID photos ng guests pagkatapos ng stay, at puwede mong i-export o burahin ang data mo anumang oras.',
  'What happens when the free trial ends?': 'Ano ang mangyayari pagkatapos ng free trial?',
  'Nothing is deleted. Your workspace becomes view-only until you choose a plan, so you can still see and export everything.': 'Walang mabubura. Magiging view-only ang workspace mo hanggang pumili ka ng plan, kaya makikita at maie-export mo pa rin ang lahat.',
  'How do I pay for BalayHub?': 'Paano magbayad para sa BalayHub?',
  'Online with GCash, Maya, card or GrabPay, for 1, 3 or 12 months (12 months gets 2 months free). Your plan activates right away.': 'Online gamit GCash, Maya, card o GrabPay, para sa 1, 3 o 12 buwan (libre ang 2 buwan sa 12 buwan). Agad na mag-a-activate ang plan mo.',
  'Monthly, by GCash, Maya or bank transfer. Message us when you\'re ready and we\'ll activate your plan.': 'Buwanan, sa GCash, Maya o bank transfer. Mag-message lang kapag handa ka na at ia-activate namin ang plan mo.',
  'Can my co-host or cleaner use it?': 'Puwede bang gamitin ng co-host o cleaner ko?',
  'Do I need to install anything?': 'May kailangan bang i-install?',
  'No. BalayHub runs in your phone or computer browser. On a phone you can add it to your home screen like an app and get notifications.': 'Wala. Gumagana ang BalayHub sa browser ng phone o computer mo. Sa phone, puwede mo itong idagdag sa home screen na parang app at makatanggap ng notifications.',
  // final + footer
  'Spend less time managing and more time hosting.': 'Mas kaunting oras sa pag-manage, mas maraming oras sa pag-host.',
  'Terms of service': 'Mga tuntunin ng serbisyo', 'Privacy notice': 'Paunawa sa privacy',
  // get started popup
  'Step': 'Hakbang',
  'How many units do you manage?': 'Ilang unit ang hawak mo?',
  'Tell us about your hosting business': 'Ikuwento ang hosting business mo',
  'We\'ll set up BalayHub for the way you host.': 'Ise-setup namin ang BalayHub ayon sa paraan ng pag-host mo.',
  'First name': 'Pangalan', 'Last name': 'Apelyido', 'Business name': 'Pangalan ng business', 'e.g. Santos Staycations': 'hal. Santos Staycations',
  'Mobile number': 'Mobile number', 'What do you rent out?': 'Ano ang pinauupahan mo?',
  'Short-term stays (Airbnb, staycations)': 'Short-term stays (Airbnb, staycations)', 'Long-term rentals (monthly tenants)': 'Long-term rentals (buwanang tenants)', 'Both': 'Pareho',
  'Continue': 'Tuloy', 'Back': 'Bumalik',
  'Create your account': 'Gawin ang account mo', 'Email': 'Email', 'Password': 'Password', 'At least 8 characters.': 'Hindi bababa sa 8 characters.',
  'I agree to the ': 'Sumasang-ayon ako sa ', 'Terms of Service': 'Terms of Service', ' and have read the ': ' at nabasa ko ang ', 'Privacy Notice': 'Privacy Notice',
  'Start my free trial': 'Simulan ang free trial ko', 'Creating your account…': 'Ginagawa ang account mo…',
  'Already have an account? ': 'May account ka na? ',
  'Sign up with Google': 'Mag-sign up gamit ang Google',
  'Please fill in the highlighted fields.': 'Pakisagutan ang mga naka-highlight.',
  'Enter your first name.': 'Ilagay ang first name mo.', 'Enter your last name.': 'Ilagay ang last name mo.', 'Enter your business name.': 'Ilagay ang business name mo.',
  'More than 10': 'Higit 10',
  'BalayHub is made for 1 to 10 units. For more, we\'ll set up a custom plan with you after your trial.': 'Para sa 1 hanggang 10 unit ang BalayHub. Kung higit pa, gagawa tayo ng custom plan pagkatapos ng trial mo.',
  // contact fallback, used when no contact email is set: visitors sign up, then ask in Help & support
  ' and ask us in Help & support about a custom plan.': ' at magtanong sa Help & support tungkol sa custom plan.',
  'Monthly, by GCash, Maya or bank transfer. Create your account, then ask us in Help & support when you\'re ready and we\'ll activate your plan.':
    'Buwanan, sa GCash, Maya o bank transfer. Gumawa ng account, saka magtanong sa Help & support kapag handa ka na at ia-activate namin ang plan mo.',
});

export async function tryDemo(e) {
  const btn = e?.currentTarget;
  if (btn) { btn.disabled = true; btn.textContent = t('Opening demo…'); }
  try {
    await post('/auth/demo');
    await refreshUser();
    navigate(homeRoute(), { replace: true });
  } catch (err) {
    toast(err.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = t('Try the live demo'); }
  }
}

const peso = (n) => `₱${Number(n).toLocaleString('en-PH')}`;
const CHANNELS = ['Airbnb', 'Booking.com', 'Agoda', 'Vrbo', 'Expedia', 'Trip.com'];

// A small illustrated multi-calendar (decorative).
function heroCalendar() {
  const rows = [
    ['Paris 1208', [[0, 3, 'airbnb', 'Rafael D.'], [3, 5, 'direct', 'Emily L.']]],
    ['Rio 2210', [[1, 4, 'booking', 'Katherine S.'], [5, 7, 'airbnb', 'Peter T.']]],
    ['Tower 3 · 1815', [[0, 2, 'agoda', 'Laura G.'], [2, 6, 'direct', 'Archer C.']]],
    ['Loft A · Tagaytay', [[2, 5, 'airbnb', 'Mika V.']]],
  ];
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return h('div', { class: 'lp-cal', 'aria-hidden': 'true' },
    h('div', { class: 'lp-cal__row lp-cal__row--head' }, h('span', null, ''), days.map((d) => h('span', null, d))),
    rows.map(([name, stays]) => h('div', { class: 'lp-cal__row' },
      h('span', { class: 'lp-cal__name' }, name),
      h('div', { class: 'lp-cal__track' }, stays.map(([s, e, ch, guest]) => h('span', {
        class: `lp-cal__bar lp-cal__bar--${ch}`, style: { '--s': s, '--e': e },
      }, guest))))),
    h('div', { class: 'lp-cal__legend' },
      [['airbnb', 'Airbnb'], ['booking', 'Booking.com'], ['agoda', 'Agoda'], ['direct', 'Direct']].map(([k, label]) => h('span', null, h('i', { class: `lp-dot lp-cal__bar--${k}` }), label))));
}

// Feature groups shown as tabs ("All-in-one").
const GROUPS = [
  ['calendar', 'Channels & pricing', 'Your Airbnb, Booking.com and Agoda calendars stay in sync, and prices follow weekends and Philippine holidays.', [
    'Multi-calendar for all your units and channels', 'Calendar sync with Airbnb, Booking.com, Agoda, Vrbo, Expedia and Trip.com',
    'Weekend and PH holiday rates (Holy Week, Christmas, long weekends) applied automatically', 'Seasons, minimum nights, weekly and monthly discounts',
    'Last-minute, far-out, gap-night, event and 14+ night prices, with a preview and a lowest-price floor', 'Bulk price and block changes across units']],
  ['cash', 'Direct bookings & payments', 'Take bookings without channel fees, and get paid straight to your own account.', [
    'Your own booking page with photos and a live availability calendar', 'Guests pay with GCash, Maya or card through your own PayMongo account',
    'Full payment or a deposit (set per listing, default 50%), with a payment link for the balance', 'Itemised bills with extra charges, and numbered receipts',
    'Guests send GCash, Maya or bank proof; you confirm or reject it', 'Cancellation policies with suggested refunds and a refund log']],
  ['inbox', 'Guest experience', 'Every guest gets the right message at the right time, in the language they prefer.', [
    'Guest inbox with templates and automatic messages', 'Online check-in form: guest names and IDs before arrival',
    'Guidebook with Wi-Fi and door code shown only around the stay', 'House rules accepted by the guest before they book',
    'Paid add-ons like late check-out or extra bed', 'Review links for happy guests, and codes for returning guests']],
  ['sparkle', 'Operations', 'Cleanings, condo paperwork and deposits handled without the group chat chaos.', [
    'Cleaning tasks with checklists and photos for every check-out', 'Cleaners see only their own jobs and pay, in Taglish',
    'Status board (dirty, clean, inspected) and inspections with scores', 'Damage reports that become a charge, a deposit deduction or a waiver',
    'Cleaner pay, supplies with low-stock alerts, and lost and found', 'Work orders and recurring maintenance']],
  ['chart', 'Owners & reports', 'Know which unit is really earning, and keep owners and your bookkeeper happy.', [
    'Revenue, occupancy, average nightly rate and channel reports', 'Income summary per month and quarter for your bookkeeper',
    'Owner portal: owners sign in with an emailed link, no password', 'Fee types, statements you review then publish, and payout records',
    'Repairs reserve and profit and loss for each unit', 'Gate pass emailed to your condo admin before each arrival']],
  ['users', 'Team & daily work', 'Know who did what, who is on duty and what is left for today.', [
    'Team logins for co-hosts and cleaners, phone app and notifications', 'Daily close: see the day\'s check-ins, payments and tasks, then wrap up',
    'Group bookings and moving a booking by drag and drop', 'Activity history on every booking',
    'Assign conversations and @mention teammates', 'Notification settings for each person']],
];

const WHY = [
  ['calendar', 'Philippine holidays built in', 'Holy Week, Christmas to New Year and long weekends get your holiday rate automatically.'],
  ['building', 'Condo gate passes', 'Guest names and IDs go to the building admin before arrival, and the admin confirms with one click.'],
  ['wallet', 'GCash and Maya', 'Guests pay the way they already do, straight to your PayMongo account.'],
  ['users', 'Taglish for guests', 'Booking page, check-in form and messages in English or Taglish.'],
  ['shield', 'Data Privacy Act ready', 'Consent on every form, guest IDs deleted after the stay, export or delete your data anytime.'],
  ['cash', 'Priced in pesos', 'Simple monthly plans in pesos, paid by GCash, Maya or card. No dollar bills.'],
];

const NEWS = [
  ['wallet', 'Money done right', 'Itemised bills, GCash, Maya and bank proofs, deposits per listing, refunds that follow your cancellation policy.'],
  ['building', 'Owner portal', 'Owners sign in with an emailed link to see their statements, payouts and unit profit.'],
  ['sparkle', 'Cleaner app', 'Cleaners see only their jobs and pay, with photos and checklists, in Taglish.'],
  ['chart', 'Smarter prices', 'Last-minute, far-out and gap-night rules with a preview before you save.'],
  ['file', 'Guidebook and add-ons', 'Wi-Fi and door code appear only around the stay. Sell late check-out and extras.'],
  ['chat', 'Quotes for Messenger', 'Send a price with a pay link to guests who ask on Facebook or Messenger.'],
];

const UNIT_BANDS = [['1-3', '1–2 units'], ['4-10', '4–10 units'], ['10+', 'More than 10']];

// Where a guest sends a question: the team's email when one is set. Until then, visitors sign up first and ask in Help & support.
const askNodes = (pricing) => (pricing.contact_email
  ? [h('a', { href: `mailto:${pricing.contact_email}` }, t('Talk to us')), t(' about a custom plan.')]
  : [h('a', { href: '#/signup' }, t('Create your account')), t(' and ask us in Help & support about a custom plan.')]);

// ---------------------------------------------------------------- language menu
function langMenu(onChange) {
  const label = guestLang() === 'tl' ? 'TL' : 'EN';
  const menu = h('details', { class: 'lp-lang' },
    h('summary', { 'aria-label': t('Language') }, label, h('span', { 'aria-hidden': 'true' }, ' ▾')),
    h('div', { class: 'lp-lang__menu', role: 'menu' },
      [['en', 'English'], ['tl', 'Tagalog']].map(([k, name]) => h('button', {
        type: 'button', role: 'menuitemradio', 'aria-checked': String(guestLang() === k), class: guestLang() === k ? 'is-on' : '',
        onclick: () => { setGuestLang(k); menu.open = false; onChange(); },
      }, name))));
  return menu;
}

// ---------------------------------------------------------------- "Get started" (3 steps)
export function openGetStarted(preset = {}) {
  const data = { units_band: preset.units_band || null, business_type: 'short_term' };
  let step = data.units_band ? 2 : 1;
  const box = h('div', { class: 'gs' });
  const m = openModal({ title: 'BalayHub', body: box, wide: true });
  m.el.classList.add('gs-modal');

  const steps = () => h('ol', { class: 'gs-steps', 'aria-label': `${t('Step')} ${step} / 3` },
    [1, 2, 3].map((n) => h('li', { class: n < step ? 'is-done' : n === step ? 'is-on' : '' }, h('span', null, String(n)), h('small', null, t('Step')))));
  const input = (name, label, attrs = {}) => h('div', { class: 'field', dataset: { field: name } },
    h('label', { for: `gs-${name}` }, label, attrs.required ? h('span', { class: 'req' }, ' *') : null),
    h('input', { class: 'input', id: `gs-${name}`, name, value: data[name] || '', ...attrs }),
    h('div', { class: 'error', role: 'alert' }));
  const showErrors = (fields) => {
    for (const el of box.querySelectorAll('[data-field] .error')) el.textContent = '';
    for (const [k, msg] of Object.entries(fields || {})) {
      const f = box.querySelector(`[data-field="${k}"] .error`);
      if (f) f.textContent = msg;
    }
  };
  const read = () => { for (const el of box.querySelectorAll('input[name], select[name]')) data[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim(); };

  function draw() {
    if (step === 1) {
      box.replaceChildren(steps(), h('h2', { class: 'gs-title' }, t('How many units do you manage?')),
        h('div', { class: 'gs-cards' }, UNIT_BANDS.map(([k, text]) => h('button', {
          type: 'button', class: `gs-card${data.units_band === k ? ' is-on' : ''}`,
          onclick: () => { data.units_band = k; step = 2; draw(); },
        }, h('span', { class: 'gs-card__icon', 'aria-hidden': 'true' }, icon(k === '10+' ? 'building' : 'home')), h('strong', null, t(text))))));
    } else if (step === 2) {
      const type = h('select', { class: 'input', id: 'gs-business_type', name: 'business_type' },
        [['short_term', 'Short-term stays (Airbnb, staycations)'], ['long_term', 'Long-term rentals (monthly tenants)'], ['both', 'Both']]
          .map(([k, text]) => h('option', { value: k, selected: data.business_type === k }, t(text))));
      box.replaceChildren(steps(), h('h2', { class: 'gs-title' }, t('Tell us about your hosting business')),
        h('p', { class: 'gs-sub' }, t('We\'ll set up BalayHub for the way you host.')),
        data.units_band === '10+' && h('p', { class: 'alert alert--info' }, t('BalayHub is made for 1 to 10 units. For more, we\'ll set up a custom plan with you after your trial.')),
        h('form', { class: 'form', novalidate: true, onsubmit: (e) => {
          e.preventDefault(); read();
          const errs = {};
          if (!data.first_name) errs.first_name = t('Enter your first name.');
          if (!data.last_name) errs.last_name = t('Enter your last name.');
          if (!data.business_name) errs.business_name = t('Enter your business name.');
          if (Object.keys(errs).length) { showErrors(errs); return; }
          step = 3; draw();
        } },
        h('div', { class: 'form-row form-row--2' },
          input('first_name', t('First name'), { required: true, maxlength: 60, autocomplete: 'given-name' }),
          input('last_name', t('Last name'), { required: true, maxlength: 60, autocomplete: 'family-name' })),
        h('div', { class: 'form-row form-row--2' },
          input('business_name', t('Business name'), { required: true, maxlength: 120, placeholder: t('e.g. Santos Staycations'), autocomplete: 'organization' }),
          input('phone', t('Mobile number'), { type: 'tel', inputmode: 'tel', maxlength: 20, placeholder: '0917 123 4567', autocomplete: 'tel' })),
        h('div', { class: 'field' }, h('label', { for: 'gs-business_type' }, t('What do you rent out?')), type),
        h('div', { class: 'gs-actions' },
          h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => { read(); step = 1; draw(); } }, t('Back')),
          h('button', { class: 'btn btn--primary', type: 'submit' }, t('Continue')))));
    } else {
      const submit = h('button', { class: 'btn btn--primary btn--block', type: 'submit' }, t('Start my free trial'));
      const formError = h('div');
      const form = h('form', { class: 'form', novalidate: true, onsubmit: async (e) => {
        e.preventDefault(); read();
        showErrors({}); formError.replaceChildren();
        submit.disabled = true; submit.textContent = t('Creating your account…');
        try {
          const res = await post('/auth/signup', {
            full_name: `${data.first_name} ${data.last_name}`.trim(), email: data.email, password: data.password, confirm_password: data.password,
            accept_privacy: Boolean(data.accept_privacy),
          });
          // The workspace is created with these answers right after sign-up (see setupView).
          try {
            localStorage.setItem('bh-setup', JSON.stringify({ name: data.business_name, business_type: data.business_type, units_band: data.units_band, phone: data.phone || undefined }));
            if (res.devVerificationLink) sessionStorage.setItem('bh-dev-verify', res.devVerificationLink);
            if (res.emailFailed) sessionStorage.setItem('bh-email-failed', '1');
          } catch { /* private mode: the setup page simply asks again */ }
          state.user = res.user;
          await refreshUser();
          m.close();
          afterLogin();
        } catch (err) {
          formError.replaceChildren(h('div', { class: 'alert alert--error', role: 'alert' }, err instanceof ApiError ? err.message : t('Please fill in the highlighted fields.')));
          showErrors(err.fields);
          submit.disabled = false; submit.textContent = t('Start my free trial');
        }
      } },
      formError,
      input('email', t('Email'), { type: 'email', required: true, autocomplete: 'email', placeholder: 'name@example.com' }),
      h('div', { class: 'field', dataset: { field: 'password' } },
        h('label', { for: 'gs-password' }, t('Password'), h('span', { class: 'req' }, ' *')),
        h('input', { class: 'input', id: 'gs-password', name: 'password', type: 'password', autocomplete: 'new-password', minlength: 8 }),
        h('p', { class: 'hint' }, t('At least 8 characters.')),
        h('div', { class: 'error', role: 'alert' })),
      h('div', { class: 'field', dataset: { field: 'accept_privacy' } },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'accept_privacy' }),
          h('span', null, t('I agree to the '), h('a', { href: '#/terms', target: '_blank' }, t('Terms of Service')), t(' and have read the '),
            h('a', { href: '#/privacy', target: '_blank' }, t('Privacy Notice')), '.')),
        h('div', { class: 'error', role: 'alert' })),
      submit);
      box.replaceChildren(steps(), h('h2', { class: 'gs-title' }, t('Create your account')), form,
        h('div', { class: 'gs-google' }),
        h('div', { class: 'gs-actions gs-actions--split' },
          h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => { read(); step = 2; draw(); } }, t('Back')),
          h('span', { class: 'small' }, t('Already have an account? '), h('a', { href: '#/login', onclick: () => m.close() }, t('Log in')))));
      // Google sign-up, if the server has it set up (the workspace is created on the setup page).
      import('./auth.js').then(({ googleButton }) => googleButton(t('Sign up with Google'))).then((g) => {
        if (g) {
          box.querySelector('.gs-google')?.replaceChildren(g);
          g.querySelector('a')?.addEventListener('click', () => {
            read();
            try { localStorage.setItem('bh-setup', JSON.stringify({ name: data.business_name, business_type: data.business_type, units_band: data.units_band, phone: data.phone || undefined })); } catch { /* ignore */ }
          });
        }
      }).catch(() => {});
    }
    box.querySelector('input:not([type=checkbox]), .gs-card')?.focus();
  }
  draw();
}

// ---------------------------------------------------------------- page
export async function landingView(el) {
  initGuestLang('en');
  let pricing = { plans: [], trial_days: 14, contact_email: '' };
  try { pricing = await get('/public/plans'); } catch { /* show the page without prices */ }
  const trialDays = pricing.trial_days || 14;
  const lowest = pricing.plans.length ? Math.min(...pricing.plans.map((p) => Number(p.price))) : null;
  const scrollTo = (id) => (e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); };
  const getStarted = (preset) => () => openGetStarted(preset);
  let activeGroup = 0;
  const groupPanel = h('div', { class: 'lp-tabpanel', id: 'lp-panel', role: 'tabpanel' });
  const groupTabs = h('div', { class: 'lp-tabs', role: 'tablist', 'aria-label': t('Features') });
  // Roving tabindex: only the selected tab is in the Tab order; arrow keys, Home and End move between tabs.
  function drawGroup(moveFocus = false) {
    groupTabs.replaceChildren(...GROUPS.map(([ic, name], i) => h('button', {
      type: 'button', id: `lp-tab-${i}`, role: 'tab', 'aria-controls': 'lp-panel', 'aria-selected': String(i === activeGroup),
      tabindex: i === activeGroup ? '0' : '-1', class: i === activeGroup ? 'is-on' : '',
      onclick: () => { activeGroup = i; drawGroup(true); },
      onkeydown: (e) => {
        const last = GROUPS.length - 1;
        const next = { ArrowRight: activeGroup === last ? 0 : activeGroup + 1, ArrowLeft: activeGroup === 0 ? last : activeGroup - 1, Home: 0, End: last }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        activeGroup = next;
        drawGroup(true);
      },
    }, icon(ic), h('span', null, t(name)))));
    const [, name, text, items] = GROUPS[activeGroup];
    groupPanel.setAttribute('aria-labelledby', `lp-tab-${activeGroup}`);
    groupPanel.replaceChildren(
      h('div', null, h('h3', null, t(name)), h('p', { class: 'lp-tabpanel__lead' }, t(text))),
      h('ul', { class: 'lp-checks' }, items.map((x) => h('li', null, t(x)))));
    if (moveFocus) groupTabs.children[activeGroup].focus();
  }
  drawGroup();

  el.replaceChildren(h('div', { class: 'lp' },
    h('header', { class: 'lp-top' },
      h('div', { class: 'lp-wrap lp-top__inner' },
        brand('#/'),
        h('nav', { class: 'lp-top__nav', 'aria-label': 'Main' },
          h('a', { href: '#features', class: 'lp-hide-sm', onclick: scrollTo('features') }, t('Features')),
          h('a', { href: '#why', class: 'lp-hide-sm', onclick: scrollTo('why') }, t('Why BalayHub')),
          h('a', { href: '#pricing', class: 'lp-hide-sm', onclick: scrollTo('pricing') }, t('Pricing')),
          h('a', { href: '#faq', class: 'lp-hide-sm', onclick: scrollTo('faq') }, t('FAQ')),
          langMenu(() => landingView(el)),
          h('a', { href: '#/login' }, t('Log in')),
          h('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: getStarted() }, t('Get started'))))),
    h('main', { id: 'main' },
      h('section', { class: 'lp-hero' },
        h('div', { class: 'lp-wrap lp-hero__inner' },
          h('div', { class: 'lp-hero__copy' },
            h('p', { class: 'lp-eyebrow' }, t('For Airbnb and staycation hosts in the Philippines')),
            h('h1', null, t('Run all your units from '), h('span', null, t('one calendar.'))),
            h('p', { class: 'lp-lead' }, t('BalayHub brings your Airbnb, Booking.com, Agoda and direct bookings together, with your own booking page, GCash and Maya payments, a guest inbox, cleaning schedule and condo gate passes. Made for hosts with 1 to 10 units.')),
            h('div', { class: 'lp-cta' },
              h('button', { class: 'btn btn--primary', type: 'button', onclick: getStarted() }, t('Start your {n}-day free trial', { n: trialDays })),
              h('button', { class: 'btn btn--secondary', type: 'button', onclick: tryDemo }, t('Try the live demo'))),
            h('p', { class: 'lp-small' }, t('No credit card needed. Works on your phone. English or Tagalog.'))),
          heroCalendar()),
        h('div', { class: 'lp-wrap' }, h('p', { class: 'lp-channels' }, h('span', null, t('Syncs with')), CHANNELS.map((c) => h('strong', null, c))))),
      h('section', { class: 'lp-highlights' },
        h('div', { class: 'lp-wrap lp-highlights__grid' },
          [['One calendar', 'for every channel'], ['GCash & Maya', 'payments to your own account'], ['English or Tagalog', 'for you and your guests'],
            ['Peso pricing', lowest ? t('from ₱{p} a month', { p: lowest.toLocaleString('en-PH') }) : '']].map(([a, b]) => h('div', null, h('strong', null, t(a)), h('span', null, t(b)))))),
      h('section', { class: 'lp-section', id: 'features' },
        h('div', { class: 'lp-wrap' },
          h('p', { class: 'lp-eyebrow lp-center' }, t('All-in-one for hosts')),
          h('h2', { class: 'lp-h2' }, t('Everything a host juggles, in one place')),
          h('p', { class: 'lp-sub' }, t('Stop switching between three host apps, a spreadsheet, a notebook and a dozen chat threads.')),
          groupTabs, groupPanel)),
      h('section', { class: 'lp-section lp-section--alt', id: 'new' },
        h('div', { class: 'lp-wrap' },
          h('p', { class: 'lp-eyebrow lp-center' }, t('New in BalayHub')),
          h('h2', { class: 'lp-h2' }, t('Built from what hosts told us they needed.')),
          h('div', { class: 'lp-features' }, NEWS.map(([ic, title, text]) => h('div', { class: 'lp-feature lp-feature--card' },
            h('span', { class: 'lp-feature__icon' }, icon(ic)), h('h3', null, t(title)), h('p', null, t(text))))))),
      h('section', { class: 'lp-section lp-section', id: 'why' },
        h('div', { class: 'lp-wrap' },
          h('h2', { class: 'lp-h2' }, t('Made for hosts in the Philippines')),
          h('p', { class: 'lp-sub' }, t('Foreign tools are built for other markets. BalayHub is built around how hosting works here.')),
          h('div', { class: 'lp-features' }, WHY.map(([ic, title, text]) => h('div', { class: 'lp-feature lp-feature--card' },
            h('span', { class: 'lp-feature__icon' }, icon(ic)), h('h3', null, t(title)), h('p', null, t(text))))))),
      h('section', { class: 'lp-section' },
        h('div', { class: 'lp-wrap' },
          h('h2', { class: 'lp-h2' }, t('Set up in an afternoon')),
          h('ol', { class: 'lp-steps' },
            h('li', null, h('strong', null, t('Add your listings')), h('span', null, t('Name, nightly rate, cleaning fee, Wi-Fi and house rules.'))),
            h('li', null, h('strong', null, t('Connect your calendars')), h('span', null, t('Paste each listing\'s Airbnb, Booking.com or Agoda calendar link. Bookings appear automatically.'))),
            h('li', null, h('strong', null, t('Invite your team')), h('span', null, t('Your co-host and cleaners get their own logins with just the access they need.')))))),
      h('section', { class: 'lp-section lp-section--alt' },
        h('div', { class: 'lp-wrap' },
          h('h2', { class: 'lp-h2' }, t('Who BalayHub is for')),
          h('div', { class: 'lp-who' }, [['1-3', 'Starting out', '1–2 units', 'One calendar, automatic messages and receipts, so hosting fits around your day job.'],
            ['4-10', 'Growing host', '4–10 units', 'A team, cleaning schedule, direct bookings and reports for every unit.'],
            ['10+', 'Managing for owners', 'More than 10 units', 'Owner statements with your management fee, and access per building.']]
            .map(([band, title, units, text]) => h('div', { class: 'lp-who__card' },
              h('span', { class: 'lp-who__units' }, t(units)), h('h3', null, t(title)), h('p', null, t(text)),
              h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: getStarted({ units_band: band }) }, t('Get started'))))))),
      h('section', { class: 'lp-section', id: 'pricing' },
        h('div', { class: 'lp-wrap' },
          h('h2', { class: 'lp-h2' }, t('Simple monthly pricing')),
          h('p', { class: 'lp-sub' }, t('Every plan starts with a {n}-day free trial with all features. Pay by GCash, Maya or card.', { n: trialDays })),
          h('div', { class: 'lp-plans' }, pricing.plans.map((p) => h('div', { class: `lp-plan${p.key === 'growth' ? ' lp-plan--pop' : ''}` },
            p.key === 'growth' && h('span', { class: 'lp-plan__tag' }, t('Most popular')),
            h('h3', null, p.name),
            h('div', { class: 'lp-plan__price' }, peso(p.price), h('span', null, t(' / month'))),
            h('ul', null,
              h('li', null, p.listings === 1 ? t('Up to 1 listing') : t('Up to {n} listings', { n: p.listings })),
              h('li', null, t('Multi-calendar, channel sync and pricing helpers')),
              h('li', null, t('Direct booking page and online payments')),
              h('li', null, t('Guest inbox, automatic messages and check-in form')),
              h('li', null, t('Housekeeping, gate pass and deposits')),
              h('li', null, t('Reports and owner statements')),
              h('li', { class: p.ai ? '' : 'lp-no' }, p.ai ? t('AI reply drafts') : t('No AI reply drafts')),
              h('li', null, t('Unlimited team members'))),
            h('button', { class: `btn ${p.key === 'growth' ? 'btn--primary' : 'btn--secondary'} btn--block`, type: 'button', onclick: getStarted() }, t('Start free trial'))))),
          h('p', { class: 'lp-note' }, t('More than 10 units or managing for owners? '), askNodes(pricing)))),
      h('section', { class: 'lp-section lp-section--alt', id: 'faq' },
        h('div', { class: 'lp-wrap lp-faq' },
          h('h2', { class: 'lp-h2' }, t('Questions hosts ask')),
          [
            ['Does it connect to my Airbnb account?', 'BalayHub syncs calendars with Airbnb, Booking.com, Agoda and more using their calendar (iCal) links, which every host can set up in a few minutes. Guest messages on Airbnb stay on Airbnb; BalayHub\'s inbox is for guests you reach by email, including direct bookings.'],
            ['Can guests pay me online?', 'Yes. Connect your own PayMongo account and guests pay by GCash, Maya or card on your booking page or through a payment link for the balance. The money goes to your PayMongo account, not to BalayHub.'],
            ['Is my guests\' data safe?', 'Your data is stored on a private server, every page requires a login, and each team member only sees the properties you assign. BalayHub follows the Philippine Data Privacy Act (RA 10173): guest ID photos are deleted after the stay, and you can export or delete your data at any time.'],
            ['What happens when the free trial ends?', 'Nothing is deleted. Your workspace becomes view-only until you choose a plan, so you can still see and export everything.'],
            ['How do I pay for BalayHub?', pricing.online_payments
              ? 'Online with GCash, Maya, card or GrabPay, for 1, 3 or 12 months (12 months gets 2 months free). Your plan activates right away.'
              : pricing.contact_email
                ? 'Monthly, by GCash, Maya or bank transfer. Message us when you\'re ready and we\'ll activate your plan.'
                : 'Monthly, by GCash, Maya or bank transfer. Create your account, then ask us in Help & support when you\'re ready and we\'ll activate your plan.'],
            ['Can my co-host or cleaner use it?', 'Yes. Invite a manager, staff member or cleaner and choose which properties they can see. Cleaners see only their own cleaning jobs and pay, in English or Taglish. Staff never see guests\' phone numbers or email addresses.'],
            ['Do owners get their own login?', 'Yes. You invite an owner and they sign in with a one-time link sent to their email. They see only their own units: published statements, payouts, repairs reserve and profit and loss. They never see your other units.'],
            ['Do I need to install anything?', 'No. BalayHub runs in your phone or computer browser. On a phone you can add it to your home screen like an app and get notifications.'],
          ].map(([q, a]) => h('details', null, h('summary', null, t(q)), h('p', null, t(a)))))),
      h('section', { class: 'lp-section lp-final' },
        h('div', { class: 'lp-wrap' },
          h('h2', { class: 'lp-h2' }, t('Spend less time managing and more time hosting.')),
          h('div', { class: 'lp-cta lp-cta--center' },
            h('button', { class: 'btn btn--primary', type: 'button', onclick: getStarted() }, t('Start free trial')),
            h('button', { class: 'btn btn--secondary', type: 'button', onclick: tryDemo }, t('Try the live demo')))))),
    h('footer', { class: 'lp-foot' },
      h('div', { class: 'lp-wrap lp-foot__inner' },
        h('span', null, `© ${new Date().getFullYear()} BalayHub`),
        h('a', { href: '#/terms' }, t('Terms of service')),
        h('a', { href: '#/privacy' }, t('Privacy notice')),
        pricing.contact_email ? h('a', { href: `mailto:${pricing.contact_email}` }, pricing.contact_email) : h('a', { href: '#/signup' }, t('Create your account')),
        themeSwitch({ compact: true })))));
}
