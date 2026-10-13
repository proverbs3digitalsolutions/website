'use strict';

// Help center articles: shown in Help, suggested while writing a ticket, and
// used by the BalayHub assistant as its knowledge of the platform.
// Each article: slug, title, category, roles who can do it, keywords, steps/text.

const CATEGORIES = [
  ['start', 'Getting started'],
  ['bookings', 'Calendar & reservations'],
  ['money', 'Payments & pricing'],
  ['guests', 'Guests & messages'],
  ['operations', 'Cleaning, condo & deposits'],
  ['business', 'Reports, owners & team'],
  ['longterm', 'Long-term rentals (monthly tenants)'],
  ['account', 'Account, plan & privacy'],
];

const ALL = ['owner', 'manager', 'staff'];
const MANAGERS = ['owner', 'manager'];
const OWNER = ['owner'];

const ARTICLES = [
  {
    slug: 'getting-started', category: 'start', roles: ALL, title: 'Getting started with BalayHub',
    keywords: 'setup start begin launchpad first steps onboarding',
    body: [
      'Open Launchpad (first item in the menu). It lists the setup steps in order and ticks them off as you go.',
      'The usual order: add your listings → connect your Airbnb/Booking.com/Agoda calendars → add guest info (Wi-Fi, check-in instructions, house rules) → turn on automatic messages → invite your team → choose a plan.',
      'Each step takes a few minutes. You can skip optional steps and come back later.',
    ],
  },
  {
    slug: 'add-listing', category: 'start', roles: MANAGERS, title: 'Add a listing (unit)',
    keywords: 'listing unit condo add new property building nightly rate cleaning fee',
    body: [
      'Go to Listings → Add listing.',
      'Choose the building (or add a new one), then enter the listing name (e.g. Tower 1 - 1201), type, base nightly rate and cleaning fee.',
      'Optional: weekend and holiday rates, weekly/monthly discounts, Wi-Fi, check-in instructions and house rules (used in guest messages), and the direct booking settings.',
      'Your plan sets how many listings you can have (Starter 2, Growth 5, Pro 10).',
    ],
  },
  {
    slug: 'calendar-sync', category: 'bookings', roles: MANAGERS, title: 'Connect Airbnb, Booking.com and Agoda calendars',
    keywords: 'ical calendar sync airbnb booking.com agoda vrbo expedia trip.com channel import export double booking',
    body: [
      'Open Listings, choose a listing, then Channels.',
      'Paste the listing\'s calendar (iCal) link from each channel. Bookings appear in BalayHub automatically and refresh every 30 minutes.',
      'Copy BalayHub\'s own calendar link for that listing and paste it into each channel\'s "import calendar" setting, so your direct bookings and blocks close those dates on the channels too.',
      'Calendar links carry dates only: guest names and amounts from channels are not included. Open the reservation and enter the amount and channel fee yourself.',
      'If a channel booking is missing, press Sync now on the channel; channels can take up to a few hours to update their own links.',
    ],
  },
  {
    slug: 'reservations', category: 'bookings', roles: ALL, title: 'Create and manage reservations',
    keywords: 'reservation booking new create edit cancel check in check out guest stay',
    body: [
      'Reservations → New reservation (owners and managers). Pick the listing and dates; the price fills in from your rates, discounts and holiday prices. You can change it.',
      'Enter the guest name; a guest with the same email as a past guest joins their profile (shown as "Returning").',
      'On the reservation: Check in / Check out, Record payment, Copy payment link, Edit (incl. channel fee), Message guest, Cancel.',
      'Checking out marks the listing dirty and creates a cleaning task.',
      'Saved views on the left (Check-ins today, Upcoming unpaid…) and the search and filters help you find stays quickly.',
    ],
  },
  {
    slug: 'block-dates-prices', category: 'bookings', roles: MANAGERS, title: 'Block dates or change a night\'s price',
    keywords: 'block dates owner stay repairs price override calendar nightly price',
    body: [
      'Open Calendar and tap an open night on a listing.',
      'Choose Block (owner stay, repairs) or Set nightly price. A price set here wins over weekend, holiday and season rates.',
      'Blocked nights also close on Airbnb/Booking.com once they read your BalayHub calendar link.',
    ],
  },
  {
    slug: 'pricing-rules', category: 'money', roles: MANAGERS, title: 'Weekend, holiday and season prices, discounts',
    keywords: 'pricing weekend holiday holy week christmas season minimum nights weekly monthly discount rate',
    body: [
      'Per listing (Listings → Edit → Pricing helpers): weekend rate (Fri & Sat nights), holiday rate, weekly (7+ nights) and monthly (28+ nights) discounts.',
      'Holiday rates apply automatically on the nights before and during Philippine holiday long weekends (Holy Week, Christmas to New Year, Independence Day, National Heroes Day…).',
      'Seasons (Calendar → Pricing rules → Add season): a date range with its own rate and/or minimum stay, for one listing or all.',
      'Priority: price set on the calendar → holiday → season → weekend → base; then the long-stay discount.',
    ],
  },
  {
    slug: 'record-payment', category: 'money', roles: ALL, title: 'Record a payment and send a receipt',
    keywords: 'payment record gcash maya cash bank transfer receipt void balance channel payout',
    body: [
      'Open the reservation → Record payment. Choose GCash, Maya, cash, bank transfer, card or channel payout, and tick "Email a receipt" for guest payments.',
      'The balance updates right away. Receipts are numbered acknowledgement receipts (not BIR official receipts).',
      'For Airbnb/Booking.com stays, enter the channel fee on the reservation; the balance is then the payout you expect.',
      'A wrong entry can be voided with a reason (owners and managers); it stays in the history.',
    ],
  },
  {
    slug: 'online-payments', category: 'money', roles: MANAGERS, title: 'Take payments online (PayMongo, GCash, Maya)',
    keywords: 'paymongo online payment gcash maya card direct booking page payment link balance deposit 50%',
    body: [
      'Settings → Direct booking page → connect your own PayMongo secret key (start with a test key sk_test_…). Money goes to your PayMongo account.',
      'Your booking page shows your listings with photos and live availability; guests pay in full or a 50% deposit (set per listing).',
      'For any reservation with a balance, use Copy payment link, or turn on the balance reminder message, so guests pay the rest online.',
      'BalayHub confirms every payment with PayMongo before recording it, and emails the guest a receipt.',
    ],
  },
  {
    slug: 'discount-codes', category: 'money', roles: MANAGERS, title: 'Discount codes for your booking page',
    keywords: 'discount code promo returning guests coupon',
    body: [
      'Guests → Discount codes → New code. Choose percent or peso off (accommodation only), optional dates, minimum nights, usage limit, or returning guests only.',
      'Guests enter the code on your booking page. Turn a code off anytime.',
    ],
  },
  {
    slug: 'inbox-messages', category: 'guests', roles: MANAGERS, title: 'Guest inbox, templates and automatic messages',
    keywords: 'inbox message email template automation confirmation check-in instructions thank you reminder ai draft taglish',
    body: [
      'Inbox shows every guest conversation. Write a reply, insert a template, or use AI draft (if available) and edit before sending.',
      'Templates & automatic messages: booking confirmation, check-in instructions (day before), thank-you after check-out (with a private review link), balance reminder. Turn each on and adjust the timing.',
      'Settings → Language for guests switches the built-in messages and guest pages to Taglish.',
      'Guest messages on Airbnb stay on Airbnb; the inbox is for guests you reach by email, including direct bookings.',
    ],
  },
  {
    slug: 'checkin-form', category: 'guests', roles: MANAGERS, title: 'Guest check-in form (names and IDs)',
    keywords: 'check-in form registration guest ids names plate building requirement',
    body: [
      'Every reservation has a private check-in form link (on the reservation, and in the {{checkin_link}} message variable).',
      'Guests enter everyone\'s names, arrival time, plate number and upload ID photos. You see it on the reservation.',
      'ID photos are deleted automatically some days after check-out (Data Privacy Act).',
    ],
  },
  {
    slug: 'gate-pass', category: 'operations', roles: MANAGERS, title: 'Send the gate pass to the condo admin',
    keywords: 'gate pass condo admin building security guest registration ids authorization',
    body: [
      'Listings → Gate pass → Set up a building: admin email(s), send automatically N days before check-in, notes (e.g. parking slot), and "Authorized by".',
      'BalayHub emails the guests\' names and a private link to a printable pass with IDs; the admin presses Confirm received.',
      'It waits for the guest\'s check-in form until the day before arrival, then sends what it has and tells you. Use Send again from the reservation after the guest fills it in.',
    ],
  },
  {
    slug: 'housekeeping', category: 'operations', roles: ALL, title: 'Cleaning tasks and housekeeping',
    keywords: 'cleaning housekeeping cleaner checklist task dirty clean turnover photos',
    body: [
      'A cleaning task is created for every check-out, with your checklist. Housekeeping lists today\'s cleanings and the next arrival.',
      'Cleaners (staff) open the task on their phone, tick the checklist, add photos and press Mark done. Or use "Copy for cleaner" to send it by Messenger/Viber.',
      'Settings → Housekeeping lets the owner change the checklist.',
    ],
  },
  {
    slug: 'security-deposit', category: 'operations', roles: ALL, title: 'Security deposits',
    keywords: 'security deposit refundable return deduct damage',
    body: [
      'On the reservation → Record deposit when the guest pays it (kept apart from income).',
      'After check-out it appears under Home → Deposits to return. Return deposit: return all, deduct with a reason the guest sees, or keep it; add damage photos.',
      'Staff can record deposits; owners and managers return them.',
    ],
  },
  {
    slug: 'reviews-guests', category: 'guests', roles: MANAGERS, title: 'Guest reviews, repeat guests, VIP and Do not rebook',
    keywords: 'review rating repeat guest vip do not rebook blacklist returning',
    body: [
      'The thank-you message includes a private review link; ratings appear on the reservation, the guest profile and Guests → Reviews. Low ratings send a notification.',
      'Mark guests VIP or Do not rebook from their profile; you\'re warned when a flagged guest books again.',
    ],
  },
  {
    slug: 'reports', category: 'business', roles: MANAGERS, title: 'Reports and income summary for taxes',
    keywords: 'report revenue occupancy adr revpar income summary bir tax quarter csv export',
    body: [
      'Reports → Performance: revenue, occupancy, average nightly rate, RevPAR, by channel and by listing, expenses and net, for a month or year.',
      'Reports → Income summary: per month and quarter, revenue earned vs payments received, fees, expenses, net. Download CSV for your bookkeeper.',
      'BalayHub doesn\'t issue BIR official receipts or give tax advice.',
    ],
  },
  {
    slug: 'owner-statements', category: 'business', roles: OWNER, title: 'Owner statements (managing units for owners)',
    keywords: 'owner statement management fee payout unit owner managed',
    body: [
      'Unit owners → Add owner: email, management fee %, cleaning fees kept or not, and their units.',
      'Statement for a month: stays that checked out, channel and cleaning fees, your fee, expenses and the payout. Print/save as PDF or email it.',
    ],
  },
  {
    slug: 'team-roles', category: 'business', roles: OWNER, title: 'Invite your team and set roles',
    keywords: 'team invite co-host manager staff cleaner role access permissions',
    body: [
      'Settings → Team & permissions → Invite. Choose Property manager (co-host) or Staff (cleaner, front desk, accountant) and which buildings they can access.',
      'Share the invite link if the email doesn\'t arrive; pending invites have a New link button.',
      'Staff don\'t see guest phone numbers/emails, the inbox or reports.',
    ],
  },
  {
    slug: 'long-term-setup', category: 'longterm', roles: MANAGERS, title: 'Set up monthly rentals: properties, tenants and leases',
    keywords: 'long-term monthly tenant lease boarding house apartment dorm room bedspace contract rent due day advance deposit renew end lease',
    body: [
      'For monthly rentals (apartments, boarding houses, dorms, bedspaces), go to Properties → Add property, then Add unit with the monthly rent.',
      'Go to Tenants → Add tenant for each person renting, then create their lease from the tenant page: unit, start and end date, monthly rent, due day, advance and deposit.',
      'Rent charges are created from the lease every month, so Rent & Expenses always shows who has paid and who is overdue.',
      'When a tenant moves out, open the lease and choose End lease. Leases that are about to expire are listed on the Dashboard so you can renew in time.',
    ],
  },
  {
    slug: 'rent-payments', category: 'longterm', roles: ALL, title: 'Record rent payments and see who is overdue',
    keywords: 'rent payment collect overdue unpaid partial receipt gcash cash bank void tenant balance monthly',
    body: [
      'Go to Rent & Expenses → Record payment. Choose the tenant/lease, amount, date and method (cash, GCash, Maya, bank transfer, check) and add the reference number if any.',
      'Partial payments are allowed. The rent status shows Paid, Partial, Unpaid or Overdue.',
      'You can attach a photo of the receipt or deposit slip on the payment page.',
      'Made a mistake? Owners and managers can void a payment with a reason (it stays in the history and audit log instead of being deleted).',
    ],
  },
  {
    slug: 'expenses-maintenance', category: 'longterm', roles: ALL, title: 'Expenses, repairs and maintenance requests',
    keywords: 'expense repair maintenance plumber electricity water association dues taxes cost receipt request fix broken',
    body: [
      'Expenses: Rent & Expenses → Expenses tab → Add expense (category, amount, date, vendor). Attach the receipt photo. Expenses appear in Reports.',
      'Repairs: Maintenance → New request. Set the property/unit, priority and who is assigned. Move it to In progress and Mark resolved when done.',
      'Use Add cost on a maintenance request to record what you paid; it is saved as a Repairs expense automatically.',
      'Reports show income, expenses and net per property and month, and can be exported to Excel/CSV.',
    ],
  },
  {
    slug: 'phone-app', category: 'account', roles: ALL, title: 'Use BalayHub on your phone and get notifications',
    keywords: 'phone app install home screen notifications push iphone android',
    body: [
      'Android: open BalayHub in Chrome → Settings → App & notifications → Install, then Turn on notifications.',
      'iPhone: Safari → Share → Add to Home Screen, open it from the icon, then Settings → App & notifications → Turn on notifications.',
      'Choose which notifications you want (new bookings, guest messages, payments, cleaning…).',
    ],
  },
  {
    slug: 'appearance-language', category: 'account', roles: ALL, title: 'Dark mode and language',
    keywords: 'dark mode light theme language tagalog taglish english',
    body: [
      'Settings → Appearance: Light, Dark or Match device (also in the menu).',
      'Guest pages and messages can be in English or Taglish: Settings → Language for guests (owner).',
    ],
  },
  {
    slug: 'plans-billing', category: 'account', roles: OWNER, title: 'Plans, free trial and paying for BalayHub',
    keywords: 'plan billing trial pay subscription starter growth pro price read-only expired',
    body: [
      'Every workspace starts with a free trial with all features. Settings → Plan & billing shows your plan and lets you pay online (GCash, Maya, card) for 1, 3 or 12 months.',
      'When a trial ends or payment is overdue, the workspace becomes view-only: nothing is deleted.',
    ],
  },
  {
    slug: 'privacy-data', category: 'account', roles: OWNER, title: 'Export or delete your data, privacy',
    keywords: 'privacy export delete data download data privacy act account close',
    body: [
      'Settings → Your data → Download a copy of everything (JSON).',
      'Delete workspace: confirm by name; it\'s deleted after a 14-day grace period (you can cancel).',
      'Guest ID photos are deleted automatically after the stay.',
    ],
  },
  {
    slug: 'support', category: 'account', roles: ALL, title: 'Contact support',
    keywords: 'help support ticket contact problem bug question',
    body: [
      'Help → Contact support. Describe the problem, add a screenshot if you can, and submit. You get a ticket number and email updates.',
      'Follow the progress under Help → My tickets: Received → In progress → Waiting for you → Resolved. Reply there to add details.',
    ],
  },
];

const norm = (s) => String(s || '').toLowerCase();

// Simple keyword search: title and keywords count more than the text.
function searchArticles(q, role, limit = 6) {
  const words = norm(q).split(/[^a-z0-9.@-]+/).filter((w) => w.length > 2);
  const visible = ARTICLES.filter((a) => !role || a.roles.includes(role));
  if (!words.length) return [];
  return visible.map((a) => {
    const title = norm(a.title); const kw = norm(a.keywords); const body = norm(a.body.join(' '));
    const score = words.reduce((s, w) => s + (title.includes(w) ? 5 : 0) + (kw.includes(w) ? 3 : 0) + (body.includes(w) ? 1 : 0), 0);
    return { a, score };
  }).filter((x) => x.score > 0).sort((x, y) => y.score - x.score).slice(0, limit).map((x) => x.a);
}

module.exports = { CATEGORIES, ARTICLES, searchArticles };
