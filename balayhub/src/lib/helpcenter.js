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
// CREW: everyone who works a cleaning job (cleaners included). CLEANER: the cleaner role only.
const CREW = ['owner', 'manager', 'staff', 'cleaner'];
const CLEANER = ['cleaner'];

const ARTICLES = [
  {
    slug: 'whats-new', category: 'start', roles: CREW, title: 'What’s new in BalayHub',
    keywords: 'new update changes whats new what is new news release latest',
    body: [
      "Read the lines that match your role. Owners see everything. Managers see most of it, except owner-only settings. Staff see stays and check-ins without money details. Cleaners see only their own cleaning jobs, their own pay and the help pages.",
      "Money (owners and managers):",
      "Extra charges: add a late check-out, extra guest or damage charge to a stay, and void it with a reason. See “Extra charges and pay links”.",
      "Payment proofs: guests send a GCash or bank transfer screenshot from their pay page, and you confirm or reject it. See “Payment proofs: GCash and bank transfer screenshots”.",
      "Refunds and cancellation policies: pick a policy, see a suggested refund, and record refunds. See “Cancellation policies and refunds”.",
      "Deposit percentage per listing: choose 10% to 90% for online bookings. See “Deposit percentage per listing”.",
      "You keep: the reservation shows what you keep after channel fees. See “Create and manage reservations”.",
      "Message variables for the cancellation policy and payment links. See “Guest inbox, templates and automatic messages”.",
      "Reports and owner statements now include extra charges and refunds. See “Reports and income summary for taxes”.",
      "Owners:",
      "Owner portal: unit owners sign in with an emailed link to see their statements, payouts and bookings. See “Give unit owners their own portal”.",
      "Fee types: percent of net (the default), percent of gross, or a flat monthly fee. See “Fee types: percent of net, percent of gross, or flat monthly”.",
      "Owner statements: review the numbers, publish (which freezes them), then send. See “Owner statements (managing units for owners)”.",
      "Payouts and the repairs reserve: record payouts and reserve top-ups and withdrawals. See “Record payouts and the repairs reserve”.",
      "Profit and loss per unit, with a CSV download. See “Profit and loss per unit”.",
      "Cleaning and operations (owners and managers, and cleaners where it says so):",
      "Cleaner role: cleaners sign in to a short menu and see only their own jobs and pay. Owners invite them. See “Invite a cleaner and what they can see”.",
      "Status board: each unit shows Dirty, Clean or Inspected, with inspections and cleaner scores. See “Status board, calendar and inspections”.",
      "Damage reports: charge the guest, deduct from the deposit, or waive. Cleaners report damage from a job. See “Damage reports: charge the guest, deduct from deposit, or waive” and “Report damage from a cleaning job”.",
      "Cleaner pay: rates per clean or per hour, mark paid, and an optional cleaning expense. Cleaners see their own pay. See “Cleaner pay: rates, marking paid and expenses” and “See your pay”.",
      "Supplies with par levels and low-stock alerts; cleaners record what they used. See “Supplies, par levels and low stock”.",
      "Lost and found, and work orders raised from a cleaning job. See “Lost and found: log an item and return it” and “Raise a work order from a cleaning job”.",
      "Recurring maintenance, such as aircon cleaning every three months. See “Recurring maintenance, such as aircon cleaning every 3 months”.",
      "Guests and direct booking (owners and managers):",
      "Guidebook per listing, in English or Taglish, with a private link. Wi-Fi and the door code show from the day before check-in. See “Guidebook and door code: what guests see, and when”.",
      "House rules: guests tick an agreement before paying and at check-in. See “House rules: guests agree before paying and at check-in”.",
      "Paid add-ons, such as airport pickup, sold on the booking page or before arrival. See “Paid add-ons: airport pickup, early check-in and more”.",
      "Quotes for Facebook and Messenger inquiries, with a pay link. See “Send a quote to a Facebook or Messenger inquiry”.",
      "Share links with a source, and a by-source report. See “Share links and where guests came from”.",
      "Public review links for guests who rate 4 or 5 stars, returning-guest discount codes, and one follow-up email for unfinished bookings. See “Public review links: ask happy guests to post a review”, “Returning-guest discount codes” and “Follow up guests who didn't finish paying”.",
      "Listing pages that Google can find, with a sitemap. See “Listing pages for Google and search”.",
      "Pricing, team and bigger properties:",
      "Last-minute, far-out, gap-night and fortnight prices, with a price preview. See “Last-minute, far-out and gap-night prices”.",
      "Bulk price and block changes for many listings, with a preview first. See “Change prices or block dates for many listings at once”.",
      "Tags, room types, and group bookings for several rooms. See “Tags and room types” and “Group bookings: several rooms for one guest”.",
      "Move a booking to another listing by dragging it on the Calendar. See “Move a reservation to another listing”.",
      "Reservation activity: who did what, and when. See “Reservation activity: who did what, and when”.",
      "Assign conversations to a teammate and @mention them in notes. Choose which alerts you get. See “Assign conversations and mention a teammate” and “Choose which alerts you get”.",
      "Daily close: check the day before you log off. See “Daily close: check the day before you log off”.",
      "Calendar sync warnings for stale calendars and overlapping channel bookings. See “Calendar sync warnings: stale calendars and overlapping bookings”.",
      "Earlier this week (everyone):",
      "My account page: your name, password, notifications and language in one place, with Log out always visible. See “Choose which alerts you get”.",
      "Help center and support tickets: search these articles, and follow a ticket from Received to Resolved. See “Contact support”.",
      "Filters on every list page. See “Getting started with BalayHub”.",
      "Light and dark mode. See “Dark mode and language”.",
      "Taglish guest pages and messages. See “Guest inbox, templates and automatic messages”.",
      "Launchpad setup checklist and the guest check-in form. See “Getting started with BalayHub” and “Guest check-in form (names and IDs)”.",
      "Plan payments by PayMongo, and online payments for guests. See “Plans, free trial and paying for BalayHub” and “Take payments online (PayMongo, GCash, Maya)”.",
      "Installable app and push notifications on your phone. See “Use BalayHub on your phone and get notifications”.",
      "Security deposits and condo gate passes. See “Security deposits” and “Send the gate pass to the condo admin”.",
      "Reviews, repeat guests and discount codes. See “Guest reviews, repeat guests, VIP and Do not rebook” and “Discount codes for your booking page”.",
    ],
  },
  {
    slug: 'getting-started', category: 'start', roles: ALL, title: 'Getting started with BalayHub',
    keywords: 'setup start begin launchpad first steps onboarding',
    body: [
      'Owners of a short-term or combined workspace: open Launchpad (first item in the menu). It lists the setup steps in order and ticks them off as you go. Long-term rental workspaces start on Dashboard instead. Cleaners see a shorter menu: Cleaning, My pay and Help & support.',
      'The usual order: add your listings → connect your Airbnb/Booking.com/Agoda calendars → add guest info (Wi-Fi, check-in instructions, house rules) → turn on automatic messages → invite your team → choose a plan.',
      'Each step takes a few minutes. You can skip optional steps and come back later.',
    ],
  },
  {
    slug: 'add-listing', category: 'start', roles: MANAGERS, title: 'Add a listing (unit)',
    keywords: 'listing unit condo add new property building nightly rate cleaning fee',
    body: [
      'Go to Listings → Add listing.',
      'Choose the building. If it is not listed, an owner adds it first, then enter the listing name (e.g. Tower 1 - 1201), type, base nightly rate and cleaning fee.',
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
      'On the reservation: Check in / Check out, Record payment, Copy payment link, Edit (incl. channel fee), Message guest, Cancel. Owners and managers also see Extra charges, Payment proofs and Refunds under the Payment card, plus a "You keep" line (total minus channel fee).',
      'Checking out marks the listing dirty and creates a cleaning task.',
      'Saved views on the left (Check-ins today, Upcoming unpaid…) and the search and filters help you find stays quickly.',
    ],
  },
  {
    slug: 'block-dates-prices', category: 'bookings', roles: MANAGERS, title: 'Block dates or change a night\'s price',
    keywords: 'block dates owner stay repairs price override calendar nightly price',
    body: [
      'Open Calendar and tap an open night on a listing.',
      'Choose Block dates (owner stay, repairs) or Set nightly price. A price set here wins over weekend, holiday and season rates.',
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
      'If a guest has paid more than the total (for example after an extra charge was voided), the reservation shows "Guest overpaid" to owners and managers. Record a refund to settle it.',
    ],
  },
  {
    slug: 'online-payments', category: 'money', roles: MANAGERS, title: 'Take payments online (PayMongo, GCash, Maya)',
    keywords: 'paymongo online payment gcash maya card direct booking page payment link balance deposit percentage',
    body: [
      'Settings → Direct booking page (owners only) → connect your own PayMongo secret key (start with a test key sk_test_…). Money goes to your PayMongo account.',
      'Your booking page shows your listings with photos and live availability; guests pay in full or a deposit (set per listing, default 50%).',
      'For any reservation with a balance, use Copy payment link, or turn on the balance reminder message, so guests pay the rest online.',
      'BalayHub confirms every payment with PayMongo before recording it, and emails the guest a receipt.',
    ],
  },
  {
    slug: 'extra-charges', category: 'money', roles: MANAGERS, title: 'Extra charges and pay links',
    keywords: 'extra charge late check-out early check-in extra guest extra bed damage cleaning airport transfer add void pay link balance',
    body: [
      'Open the reservation → Extra charges → Add charge. Pick a category (late check-out, extra guest, damage…), adjust the description, quantity and price.',
      'Each charge raises the booking total, so the balance goes up. Extras count as income in your reports.',
      'After adding a charge, BalayHub offers to copy the guest\'s private pay link so you can send the new balance.',
      'A wrong charge can be voided with a reason. The line stays in the history and the total and balance come back down. Charges cannot be changed on a cancelled reservation.',
      'Staff can see charges but cannot add or void them.',
    ],
  },
  {
    slug: 'payment-proofs', category: 'money', roles: MANAGERS, title: 'Payment proofs: GCash and bank transfer screenshots',
    keywords: 'payment proof screenshot gcash maya bank transfer manual payments confirm reject instructions pay page',
    body: [
      'Settings → Manual payments (owner): turn it on and type the GCash number, bank name and account name guests should pay.',
      'Guests open their private payment link, pay you, then send a screenshot, amount and reference number from the same page.',
      'Home shows "Payments to check" when proofs are waiting. Open the reservation → Payment proofs, compare the screenshot with your GCash or bank account, then Confirm payment (records the payment and can email a receipt) or Reject with a reason the guest receives.',
      'BalayHub does not check the money for you. Always check your own account before confirming.',
      'The payment link also works for guests who pay by manual transfer only, so Copy payment link and the {{payment_link}} message variable work without PayMongo.',
    ],
  },
  {
    slug: 'cancellation-refunds', category: 'money', roles: MANAGERS, title: 'Cancellation policies and refunds',
    keywords: 'cancellation policy refund flexible moderate strict non-refundable custom suggested refund guest cancel',
    body: [
      'Listings → Edit → Cancellation policy: Flexible, Moderate, Strict, Non-refundable or your own wording. Guests see it on your booking page before they pay, and in the {{cancellation_policy}} message variable.',
      'On a reservation, the Refunds card shows the policy and a suggested refund based on the days before check-in. It is only a suggestion; you decide the amount.',
      'Record refund: amount, date, method (cash, bank transfer, GCash, Maya, card), reference number and reason. You can never refund more than the guest has paid.',
      'BalayHub does not send the money. Return it yourself, then record it here. A wrong entry can be voided with a reason.',
      'Staff can read the refund log but only owners and managers can record or void refunds.',
    ],
  },
  {
    slug: 'deposit-percentage', category: 'money', roles: MANAGERS, title: 'Deposit percentage per listing',
    keywords: 'deposit percentage percent down payment booking page partial pay later balance 50% per listing',
    body: [
      'Listings → Edit → Deposit (% of the total): the share a guest pays now on your booking page, from 10% to 90%. The default is 50%.',
      'The rest is due before check-in; guests pay it with their private payment link. Stays that are too soon for a deposit are charged in full.',
      'This is separate from a security deposit, which you record on the reservation and return after check-out.',
    ],
  },
  {
    slug: 'discount-codes', category: 'money', roles: OWNER, title: 'Discount codes for your booking page',
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
      'Templates & automatic messages (owners only): booking confirmation, check-in instructions (day before), thank-you after check-out (with a private review link), balance reminder. Turn each on and adjust the timing.',
      'Message variables include {{payment_link}} (works with PayMongo or manual payments turned on) and {{cancellation_policy}} (the listing\'s policy, in the guest language).',
      'Settings → Language for guests (owners) switches the built-in messages and guest pages to Taglish.',
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
      'Listings → Gate pass → press Set up next to the building: admin email(s), send automatically N days before check-in, notes (e.g. parking slot), and "Authorized by".',
      'BalayHub emails the guests\' names and a private link to a printable pass with IDs; the admin presses Confirm received.',
      'It waits for the guest\'s check-in form until the day before arrival, then sends what it has and tells you. Use Send again from the reservation after the guest fills it in.',
    ],
  },
  {
    slug: 'housekeeping', category: 'operations', roles: CREW, title: 'Cleaning tasks and housekeeping',
    keywords: 'cleaning housekeeping cleaner checklist task dirty clean turnover photos',
    body: [
      'A cleaning task is created for every check-out, with your checklist. Housekeeping lists today\'s cleanings and the next arrival.',
      'Cleaners open the task on their phone, press Start, tick the checklist, add photos and press Mark done. Or use "Copy for cleaner" to send it by Messenger/Viber.',
      'Settings → Housekeeping lets the owner change the checklist.',
    ],
  },
  {
    slug: 'cleaner-role', category: 'business', roles: OWNER, title: 'Invite a cleaner and what they can see',
    keywords: 'cleaner invite role team cleaning jobs only no money access outside cleaner name without login',
    body: [
      'Settings → Team & permissions → Invite. Choose Cleaner and the buildings they clean. They get an email with a sign-in link, like any team member.',
      'A cleaner signs in to a short menu: Cleaning, My pay, Help and Account. They see only their own cleaning jobs and jobs nobody has been given yet, in their buildings.',
      'A cleaner never sees booking money, payments, reports, settings, the inbox, guests\' phone numbers or emails, or other cleaners\' pay. Guests show by first name only.',
      'A cleaner can start and finish a job and tick its checklist, but can\'t cancel it. They can report damage, log lost items, record supplies used and raise a work order from the job.',
      'Cleaners who don\'t need a login: don\'t invite them. Type their name on the job ("Or a cleaner without a BalayHub login") and send it with Copy for cleaner. Their pay is set by name.',
    ],
  },
  {
    slug: 'cleaning-board', category: 'operations', roles: MANAGERS, title: 'Status board, calendar and inspections',
    keywords: 'board status dirty clean inspected calendar week reassign cleaner inspection pass fail score quality scores',
    body: [
      'Housekeeping → Board shows every unit as Dirty, Clean or Inspected, with who is in it now, the next arrival, the open job and the last inspection score.',
      'Dirty: a guest checked out and nobody has cleaned yet. Clean: the job is marked done. Inspected: an owner or manager checked it and it passed.',
      'Calendar shows a week by day. Owners and managers can change who a job goes to with the select on each job.',
      'Inspect: open a finished job, press Inspect, mark each checklist item pass or fail, add notes if needed, and save. Score = passed items ÷ items × 100, rounded.',
      'All items pass: the unit becomes Inspected. Any item fails: the job reopens with the failed items unticked, and the unit is Dirty again.',
      'You can\'t inspect a job that has no checklist items, and a failed inspection can\'t reopen a paid clean.',
      'Housekeeping → Scores shows each cleaner\'s finished and inspected jobs, average score and fails for the month.',
    ],
  },
  {
    slug: 'damage-reports-resolve', category: 'operations', roles: MANAGERS, title: 'Damage reports: charge the guest, deduct from deposit, or waive',
    keywords: 'damage report charge guest deduct deposit waive broken repair cost estimate photos found',
    body: [
      'Damage reported from a cleaning job or a stay is listed on the reservation and in the damage list. Only owners and managers see the amounts.',
      'Charge the guest: enter the amount and a description. It becomes an extra charge on the stay (category damage), and the balance goes up.',
      'Deduct from deposit: marks the report to deduct. When you settle the deposit, the form is filled in with the total of open and deducted reports, so you can change it before you confirm.',
      'Waive: you decide not to bill it. Add a note saying why.',
      'Each report can be resolved once. A report on a unit with no stay can only be waived, because there is no bill or deposit to use.',
      'Charging a report also updates that stay\'s total. Charges can\'t be changed on a cancelled reservation.',
    ],
  },
  {
    slug: 'damage-report-field', category: 'operations', roles: CREW, title: 'Report damage from a cleaning job',
    keywords: 'damage broken report photo cleaner found stain crack missing item cleaning job',
    body: [
      'Open the cleaning job and press Report damage. Say what you saw, add a cost estimate if you know it, and add photos.',
      'Owners and managers decide what happens next: charge the guest, take it from the deposit, or waive it. Cleaners don\'t see those amounts.',
      'Cleaners see only the damage reports they filed.',
    ],
  },
  {
    slug: 'lost-and-found', category: 'operations', roles: CREW, title: 'Lost and found: log an item and return it',
    keywords: 'lost found item left behind returned disposed photo held guest left found where cleaner',
    body: [
      'From a cleaning job, press Found an item. Describe it, say where you found it, pick the date and add a photo.',
      'Owners and managers see every item under Lost and found. Each item is Held, Returned or Disposed, and you can add a note when you change it.',
      'Cleaners see only the items they logged.',
      'To return an item, use the guest\'s contact details on the reservation. Cleaners never see guest contact details.',
    ],
  },
  {
    slug: 'cleaner-pay', category: 'business', roles: MANAGERS, title: 'Cleaner pay: rates, marking paid and expenses',
    keywords: 'cleaner pay rate per clean per hour paid gcash maya cash bank reference mark paid expense cleaning monthly unpaid undo',
    body: [
      'Owners set each cleaner\'s rate, per clean or per hour, on the Cleaner pay page, in the rates section (owners only). A cleaner is either a team member or an outside cleaner typed by name.',
      'When a job is marked done, its pay is worked out from the rate. Per hour counts the time from start to finish, rounded up to the next 15 minutes, and stops at 12 hours. You can change the amount until it is paid.',
      'A new rate applies only to cleans finished after you save it. Earlier cleans keep their amount.',
      'Owners and managers: Cleaner pay → pick a month, tick the finished cleans, then Mark paid. Enter the date, how you paid (cash, GCash, Maya or bank transfer) and a reference.',
      'Tick Also record as cleaning expenses to add one cleaning expense per unit. It then shows on Profit and loss and owner statements. Cleans paid together share one expense, so undo them together.',
      'Zero pay adds no expense. The payment date can\'t be in the future. A paid clean is locked: its status and pay can\'t change, and a failed inspection can\'t reopen it.',
      'Only owners can undo a payment.',
    ],
  },
  {
    slug: 'my-pay', category: 'account', roles: CLEANER, title: 'See your pay',
    keywords: 'my pay cleaner pay paid unpaid how much earned month cleaning payment',
    body: [
      'My pay lists the cleans you finished this month, the amount for each, and whether it has been paid, with the date and how it was paid.',
      'You see only your own pay. Booking money and other cleaners\' pay are never shown.',
      'If an amount looks wrong, tell the owner, or use Help → Contact support.',
    ],
  },
  {
    slug: 'supplies', category: 'operations', roles: CREW, title: 'Supplies, par levels and low stock',
    keywords: 'supplies stock par level low stock restock used count inventory cleaner record toilet paper soap',
    body: [
      'Owners and managers: Supplies → add an item for a property with its name, unit (pcs, rolls, bottles), par level (how many you want on hand) and an opening count.',
      'Record a count, a restock or a use. On hand changes with each record, and the history is kept.',
      'Low stock means on hand is below par. Supplies shows it, and Home shows how many items are low.',
      'Cleaners: on a cleaning job, press Supplies used and enter what you used or restocked. Items must belong to that property.',
      'If more is recorded as used than is on hand, the count stops at zero and the note keeps the amount that was asked for.',
      'BalayHub doesn\'t track costs or buying.',
    ],
  },
  {
    slug: 'work-orders', category: 'operations', roles: CREW, title: 'Raise a work order from a cleaning job',
    keywords: 'work order repair broken aircon leak fix maintenance request cleaner from job priority',
    body: [
      'From a cleaning job, press Something broken? Give the issue, details and priority.',
      'It becomes a repair request for that unit, linked to the job. Owners and managers get a notification.',
      'Cleaners can\'t add photos to a work order. Add photos to the cleaning job instead.',
      'Cleaners can\'t open the Maintenance page or see repair costs.',
    ],
  },
  {
    slug: 'recurring-maintenance', category: 'operations', roles: MANAGERS, title: 'Recurring maintenance, such as aircon cleaning every 3 months',
    keywords: 'recurring schedule preventive maintenance aircon every months days repeat due next pause request automatic',
    body: [
      'Maintenance → New recurring job: title, details, repeat every N days or months, the next due date, priority, and the property or unit.',
      'Once an hour BalayHub checks for due schedules. When one is due, it opens a maintenance request and moves the next due date forward.',
      'If the last request from a schedule is still open, no new one is opened. Missed dates aren\'t filled in: after a pause or a late check, you get one request, not a backlog.',
      'Pause stops a schedule. Press Resume on a paused schedule to turn it back on. Missed dates are not filled in.',
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
    keywords: 'owner statement management fee payout unit owner managed review publish unpublish send email print pdf',
    body: [
      'Unit owners → Add owner: email, fee type, cleaning fees kept or not, repairs reserve, and their units.',
      'A statement covers one month: stays that checked out, channel and cleaning fees, your fee, expenses and the payout. Open it from Unit owners → Statements, or wait for the reminder email on the 3rd of the month.',
      'Review the numbers, then press Publish. Publishing freezes them: later expenses or edits change the live figures, but not the published statement the owner sees.',
      'Send to owner emails the published statement. Print (or save as PDF) opens your browser\'s print window.',
      'To correct a published statement, press Unpublish to correct, fix the cause, then publish again. Publishing the same month twice is refused.',
      'Anything you write on a payout is visible to the owner, so keep it clear and polite.',
    ],
  },
  {
    slug: 'owner-portal', category: 'business', roles: OWNER, title: 'Give unit owners their own portal',
    keywords: 'owner portal login sign in link invite turn off access unit owner bookings block dates statements payouts',
    body: [
      'Unit owners → open the owner → Invite to owner portal. The owner needs an email address first. They get an email with a sign-in link.',
      'The link works once and expires after 30 minutes. If it has expired, the owner opens the owner sign-in page, enters their email, and gets a new one. No password is needed.',
      'In the portal an owner sees their own units only: published statements, payouts, bookings (guests by first name), an activity list, and their repairs reserve. They can also block dates on their units, and cancel their own blocks before they start.',
      'Owners never see guest phone numbers or emails, other owners, or your other data. Your team does not get a login through this link.',
      'Turn off portal access to sign the owner out everywhere. Invite them again to turn it back on.',
    ],
  },
  {
    slug: 'owner-fee-types', category: 'business', roles: OWNER, title: 'Fee types: percent of net, percent of gross, or flat monthly',
    keywords: 'fee type management fee net gross flat monthly percent owner statement loss owes',
    body: [
      'Each owner has one fee type, set on the owner form. The default is % of net, which is how BalayHub worked before.',
      '% of net: the fee is a percentage of the net rental income, which is after channel fees, cleaning fees you keep, and refunds.',
      '% of gross: the fee is a percentage of gross bookings, after refunds only.',
      'Flat monthly: a fixed amount for every month the owner has at least one unit, even if no stays checked out. If the fee and expenses are more than the month\'s income, the owner owes you that amount. The statement says so, and there is nothing to pay out.',
      'The fee is never negative.',
    ],
  },
  {
    slug: 'owner-payouts-reserve', category: 'business', roles: OWNER, title: 'Record payouts and the repairs reserve',
    keywords: 'payout paid gcash maya bank cash reference record void repairs reserve withdrawal top-up owner money',
    body: [
      'Open the owner\'s statement and press Record payout: the amount, the date paid, the method (GCash, Maya, bank transfer, cash or other), and a reference number if you have one. The statement shows "Paid ₱X of ₱Y" for that month.',
      'Payout notes are visible to the owner, so write them for them. Say what the money covers.',
      'A payout that was recorded by mistake is voided with a reason, not deleted. The record stays.',
      'Repairs reserve: set a target and a monthly top-up on the owner form. When you publish a statement, the top-up is taken from the payout, up to the target. A top-up never makes the payout negative.',
      'When the reserve pays for a repair, record a withdrawal with a date and a note. The balance can\'t go below zero.',
      'To undo a withdrawal, void it. Deposits from a statement are reversed by unpublishing that statement, and unpublishing is refused if the reserve has already paid out money that statement added. Void that withdrawal first.',
    ],
  },
  {
    slug: 'profit-loss', category: 'business', roles: MANAGERS, title: 'Profit and loss per unit',
    keywords: 'profit loss pnl per unit income expenses net gross report month property csv download',
    body: [
      'Open Profit and loss from the menu (owners and managers). Pick a month and, if you want, one property.',
      'Each unit shows its stays, nights, gross bookings, channel fees, refunds, expenses and net. Expenses with no unit are shown in one "Not linked to a unit" row.',
      'Guest cleaning fees count as the unit\'s income here, because this is the whole unit\'s result. An owner statement is different: it leaves out cleaning fees you keep, because that is the owner\'s share.',
      'Managers see only their assigned properties. Staff don\'t see this page. Download CSV gives the same table for a spreadsheet.',
    ],
  },
  {
    slug: 'team-roles', category: 'business', roles: OWNER, title: 'Invite your team and set roles',
    keywords: 'team invite co-host manager staff cleaner role access permissions',
    body: [
      'Settings → Team & permissions → Invite. Choose Property manager (co-host), Staff (cleaner, front desk or accountant), or Cleaner (cleaning jobs only; not offered in long-term rental workspaces). Then choose which buildings they can access.',
      'Share the invite link if the email doesn\'t arrive; pending invites have a New link button.',
      'Staff don\'t see guest phone numbers/emails, the inbox or reports. Cleaners see even less; see the cleaner article.',
    ],
  },
  {
    slug: 'long-term-setup', category: 'longterm', roles: MANAGERS, title: 'Set up monthly rentals: properties, tenants and leases',
    keywords: 'long-term monthly tenant lease boarding house apartment dorm room bedspace contract rent due day advance deposit renew end lease',
    body: [
      'For monthly rentals (apartments, boarding houses, dorms, bedspaces), an owner adds the property under Properties → Add property. Then open the property under Properties and press Add unit, with the monthly rent.',
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
    slug: 'phone-app', category: 'account', roles: CREW, title: 'Use BalayHub on your phone and get notifications',
    keywords: 'phone app install home screen notifications push iphone android',
    body: [
      'Android: open BalayHub in Chrome → Settings → App & notifications → Install, then Turn on notifications.',
      'iPhone: Safari → Share → Add to Home Screen, open it from the icon, then Settings → App & notifications → Turn on notifications.',
      'Choose which notifications you want (new bookings, guest messages, payments, cleaning…).',
    ],
  },
  {
    slug: 'appearance-language', category: 'account', roles: CREW, title: 'Dark mode and language',
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
      'Settings → Your data → Download all data.',
      'Delete workspace: confirm by name; it\'s deleted after a 14-day grace period (you can cancel).',
      'Guest ID photos are deleted automatically after the stay.',
    ],
  },
  {
    slug: 'support', category: 'account', roles: CREW, title: 'Contact support',
    keywords: 'help support ticket contact problem bug question',
    body: [
      'Help → Contact support. Describe the problem, add a screenshot if you can, and submit. You get a ticket number and email updates.',
      'Follow the progress on the Help page, under Support tickets (owners) or Your tickets (everyone else): Received → In progress → Waiting for you → Resolved. Reply there to add details.',
    ],
  },
  {
    slug: 'guidebook', category: 'guests', roles: MANAGERS, title: 'Guidebook and door code: what guests see, and when',
    keywords: 'guidebook guide wifi password door code gate arrival parking local tips emergency link private message',
    body: [
      'Listings → pick a listing → Guidebook. Fill in arrival, parking, building and gate notes, local tips and emergency contacts. Add a Taglish version of any section if you want; guests see the language set for your workspace, with a switch.',
      'The door code is stored encrypted and is masked here; use Show to read it. Owners and managers only.',
      'To send the guidebook, open the reservation and press Copy guidebook link, then send it to the guest, or use {{guidebook_link}} in a message template. The link opens from 14 days before check-in until 2 days after check-out, and only for confirmed stays. Cancelled stays get no link.',
      'The Wi-Fi password and door code show only from the day before check-in through check-out day (Manila time). Before that, the page says the day they will appear.',
      'In messages, {{wifi_password}} and {{door_code}} follow the same rule. Before that day they read "(shared the day before check-in)".',
      'Heads-up: once a message containing the Wi-Fi password or door code is sent, that text stays in the inbox history as plain text.',
    ],
  },
  {
    slug: 'house-rules-acceptance', category: 'guests', roles: MANAGERS, title: 'House rules: guests agree before paying and at check-in',
    keywords: 'house rules agree accept checkbox consent terms check-in booking page guest',
    body: [
      'If a listing has house rules (Listings → Edit), guests must tick "I agree to the house rules" on the booking page before they can pay, and again on the check-in form before they submit it.',
      'BalayHub saves the time they agreed and the exact text they saw. On the reservation, owners and managers see "House rules accepted on …" with that text under the details.',
      'A listing with no house rules has no checkbox.',
    ],
  },
  {
    slug: 'addons', category: 'money', roles: MANAGERS, title: 'Paid add-ons: airport pickup, early check-in and more',
    keywords: 'add-on addon extra optional airport pickup early check-in extra bed breakfast upsell price per night per guest',
    body: [
      'Owners add, change and archive them under Add-ons (managers can see the list): name, optional Taglish name, description, price, and how the price works. Choices are per stay, per night, per guest, or per guest per night. Set a maximum quantity (1 to 20) and choose which listings offer it (none picked means all).',
      'Each add-on can appear on the booking page, before arrival (on the guest\'s payment page, until check-in day), or both.',
      'Guests pay for add-ons in full, up front, together with the deposit. The deposit is still a percentage of the stay only.',
      'Each add-on a guest buys becomes an extra charge on the reservation, so it shows on the bill, receipt, balance and the owner statement. Archive an add-on to hide it; past stays keep it.',
    ],
  },
  {
    slug: 'quotes', category: 'bookings', roles: MANAGERS, title: 'Send a quote to a Facebook or Messenger inquiry',
    keywords: 'quote offer inquiry facebook messenger viber price custom booking send link pay expire cancel',
    body: [
      'Quotes → New quote. Pick the listing, dates, number of guests, guest name, and an email or mobile number. The price fills in from your rates; you can change the accommodation, cleaning fee, add-ons and discount.',
      'Choose full payment or deposit (the listing\'s setting applies), add a note if you like, and set how long the offer lasts. The default is 48 hours; the maximum is 14 days.',
      'Copy the link and send it yourself, or press Send by email if the guest has an email address. The link opens the offer, the house rules, and a payment page.',
      'The dates are checked as free when you make the quote, but they are not held until the guest pays. Once they start paying, the usual 30-minute hold applies.',
      'When the guest pays, the booking is created with the source "quote". Cancel an open quote to stop its link. A quote past its time shows as expired; a cancelled one shows as cancelled.',
      'If a guest starts a new payment on the same quote, the older unpaid payment page is ended.',
    ],
  },
  {
    slug: 'share-links-sources', category: 'bookings', roles: MANAGERS, title: 'Share links and where guests came from',
    keywords: 'share link source facebook instagram messenger viber tiktok google whatsapp referral report campaign tag',
    body: [
      'Open a listing\'s booking page and add ?src= with a source to the end of the link, for example ?src=facebook. Copy that link into your post or message. Sources: Facebook, Instagram, Messenger, Viber, TikTok, Google, WhatsApp, email, referral, or other.',
      'The source is kept during the guest\'s visit and saved on the booking. Quotes are tagged "quote" automatically.',
      'Stay reports show a "By source" table for direct bookings: stays, nights and revenue per source.',
      'BalayHub sets no tracking cookies. A booking with no source simply has none.',
    ],
  },
  {
    slug: 'public-reviews', category: 'guests', roles: OWNER, title: 'Public review links: ask happy guests to post a review',
    keywords: 'review google facebook public share links rating 4 5 stars private feedback thank you',
    body: [
      'Settings → Guest experience → Public review links. Add up to 4 links to your own pages (Google, Facebook or another page). Each must start with https:// and be 300 characters or fewer.',
      'The guest always gives a private rating first. Only guests who rate 4 or 5 stars then see "Would you share your experience?" and your links.',
      'Ratings of 3 or fewer never see the links. They stay private and you are alerted, as before.',
    ],
  },
  {
    slug: 'returning-guest-codes', category: 'money', roles: OWNER, title: 'Returning-guest discount codes',
    keywords: 'returning guest welcome back personal code discount repeat guest loyalty thank you message',
    body: [
      'Settings → Guest experience → Returning-guest discount. Enter a percentage from 1 to 50, or leave it blank to turn it off.',
      'When it is on, each guest who has checked out gets one personal code, used once and valid for 12 months. The code is made the first time a message uses {{returning_guest_code}}, for example in your thank-you template.',
      'With the setting off, that message variable is empty. Personal codes do not count toward your 50-code limit.',
    ],
  },
  {
    slug: 'abandoned-booking-followup', category: 'bookings', roles: OWNER, title: 'Follow up guests who didn\'t finish paying',
    keywords: 'abandoned unfinished unpaid booking follow up email reminder checkout expired failed still want',
    body: [
      'Settings → Guest experience → tick “Send one follow-up email when someone starts a direct booking but does not pay”. It is off by default.',
      'When it is on, a guest whose online booking ended unpaid gets one plain email about 2 hours later. It links back to the listing with the same dates. It only goes to checkouts that ended 2 to 24 hours ago.',
      'No email is sent if the same email address has booked overlapping nights or started a newer payment. Quotes never get this email. Each unfinished booking gets at most one email.',
    ],
  },
  {
    slug: 'listing-pages-google', category: 'bookings', roles: MANAGERS, title: 'Listing pages for Google and search',
    keywords: 'seo google search listing page address sitemap public web page stay find search engine indexing',
    body: [
      'Each listing with direct booking turned on has its own public page, for example /stay/your-workspace/your-listing. Set its address under Listings → Page address.',
      'The page shows the name, a "from" price (the lowest of the nightly, weekend and holiday rates), max guests, city and province, photos, house rules, the cancellation policy, and a "Check dates and book" button. It never shows the street address.',
      'The page follows your workspace language. Your pages are listed in /sitemap.xml.',
      'Listings made by the demo or seed have no page address until you set one. Google decides when to show new pages; BalayHub can\'t force it.',
    ],
  },
  {
    slug: 'booking-window-prices', category: 'money', roles: MANAGERS, title: 'Last-minute, far-out and gap-night prices',
    keywords: 'last minute far out gap night early booking discount fortnight 14 nights lowest price floor preview price rule percent season',
    body: [
      'Open Pricing rules. A rule changes the price of stays by a percentage. Use a minus sign for a discount, for example -10.',
      'Last-minute: check-ins within 0 to 30 days of today (Philippine time). Usually a discount to fill the gap.',
      'Far-out: check-ins more than 31 to 540 days away. Usually a discount for early bookers, or an increase.',
      'Gap night: a stay that exactly fills a free gap of 1 to 7 nights between two bookings or blocks. The minimum stay is waived for it.',
      'Owners set a rule for every listing. Owners and managers can set one for a single listing. A listing rule replaces the workspace rule of the same kind, and switching a rule off for a listing turns that kind off there.',
      'Stays of 14 nights or more can get a fortnight discount, set per listing. Stays of 28 nights or more get the monthly discount instead, and 7 nights or more the weekly one.',
      'The lowest price is a floor per listing. No night goes below it. A price you set on the calendar is always used exactly as you set it, even if it is below the floor.',
      'Price preview: pick a listing to see the next 60 days, night by night, with the rule that changed each price. Each night is shown as a one-night stay, so a last-minute price can differ from the price of a longer stay.',
      'Bookings you already made keep their price.',
    ],
  },
  {
    slug: 'bulk-prices-blocks', category: 'bookings', roles: MANAGERS, title: 'Change prices or block dates for many listings at once',
    keywords: 'bulk change many listings tag price percent clear block unblock preview apply several units dates multiple',
    body: [
      'Open Pricing rules and choose Bulk changes (owners and managers). Pick listings with the checkboxes or by tag, then the first and last night. You can change up to 50 listings and up to a year at a time.',
      'Price: set one nightly price, change prices by a percentage, or clear the custom prices set on the calendar. A percentage works from today\'s price for each night.',
      'Block: closes the dates for an owner stay or repairs. A listing is skipped whole if any of those nights already has a booking or block, and BalayHub says why.',
      'Unblock: removes only your manual blocks that lie fully inside the dates. Channel blocks, owner stays and reservations are never removed.',
      'Always preview first. The preview lists every change and writes nothing. Apply makes exactly the changes you saw.',
    ],
  },
  {
    slug: 'tags-room-types', category: 'bookings', roles: MANAGERS, title: 'Tags and room types',
    keywords: 'tag tags room type studio 1-bedroom any free room group filter listing type label bulk',
    body: [
      'Tags are short labels for listings, such as "azure" or "beachfront". Open Listings, choose the listing, then Edit. Add up to 10 tags. Each tag can be up to 30 characters, and tags are saved in lowercase.',
      'Use tags to filter the listing list and the calendar, and to pick listings for bulk changes.',
      'Room type is what kind of place a listing is, such as Studio or 1-bedroom (up to 40 characters).',
      'When you create a reservation, choose "Any free room of a type" and the property. BalayHub takes the first free listing of that type for your dates. Group bookings can use room types too.',
      'Room types are not shown on your public booking page yet.',
    ],
  },
  {
    slug: 'reservation-activity', category: 'bookings', roles: MANAGERS, title: 'Reservation activity: who did what, and when',
    keywords: 'activity history log audit who changed what payment charge refund check in check out timeline proof deposit damage',
    body: [
      'Open a reservation. The Activity card lists what happened, newest first, in plain English: check-ins, changes, payments, charges, refunds, payment proofs, deposits, damage, cleaning, quotes and messages sent to the guest.',
      'Each line shows who did it and when. The newest 200 lines are shown.',
      'Only owners and managers can see the Activity card. Staff never see money lines.',
      'Phone numbers and email addresses typed into a reason are removed from the lines.',
      'Not in the history yet: check-in form submissions, and the reason given for a refund.',
    ],
  },
  {
    slug: 'assign-mentions', category: 'business', roles: MANAGERS, title: 'Assign conversations and mention a teammate',
    keywords: 'assign assigned inbox conversation mention @ note team notify push email owner manager',
    body: [
      'In the Inbox, open a conversation and choose who it is assigned to. That person gets a push alert, or an email if they have no device. Home shows "Assigned to you" with a count.',
      'You can only assign a conversation to an owner or manager who can see that reservation\'s property. Otherwise BalayHub refuses it.',
      'In an internal note, type @ and a teammate\'s name, then pick them from the list. They get the note by push or email, with a link to the conversation.',
      'Only owners and managers who can see that reservation\'s property can be mentioned. Staff and cleaners can\'t be mentioned, because they can\'t open the inbox.',
      'Each person can switch these alerts off under My account, Notifications.',
    ],
  },
  {
    slug: 'notification-settings', category: 'account', roles: CREW, title: 'Choose which alerts you get',
    keywords: 'notifications settings turn off alerts push email property mentions assignment sync problems my account bell',
    body: [
      'Open My account, then Notifications. Each type of alert has its own on or off switch. Everything is on at first.',
      'Owners can choose all properties or only some. Other team members get alerts only for properties they can see.',
      'If an alert can\'t reach any of your devices, BalayHub sends it by email instead, when your email address is set.',
      'Cleaners see only the cleaning alerts.',
    ],
  },
  {
    slug: 'group-bookings', category: 'bookings', roles: ALL, title: 'Group bookings: several rooms for one guest',
    keywords: 'group booking family reunion several rooms listings lead guest one booking all or nothing add room remove cancel party',
    body: [
      'Open Group bookings and choose New group booking (owners and managers). Enter a name, the lead guest, then 2 to 20 rooms.',
      'Each room becomes a normal reservation in its own listing. Pick a listing, or a room type to take the first free listing of that type.',
      'It is all or nothing. If any room is taken, nothing is saved and BalayHub names the rooms that are taken.',
      'Each room has its own dates, guests and price. The group page shows the total and what is paid and still due for each room.',
      'Payments are taken per room. Group bookings do not send an automatic confirmation email, so send one from a room\'s reservation if the guest needs it.',
      'Add a room later. To remove a room, give a reason; that reservation is cancelled. Cancelling the group cancels every room. Channel bookings can\'t join a group.',
      'Staff can see groups, without money.',
    ],
  },
  {
    slug: 'move-booking-calendar', category: 'bookings', roles: MANAGERS, title: 'Move a reservation to another listing',
    keywords: 'move drag calendar another listing room change unit swap same dates price stays cleaning',
    body: [
      'On the Calendar, drag a reservation bar onto another listing\'s row, then confirm. The dates and the price stay the same.',
      'Or open the reservation and choose Move to another listing. Use this on a phone or with the keyboard.',
      'The move is refused if the other listing is taken for those nights. Stays that come from a channel calendar (Airbnb, Booking.com, Agoda) can\'t be moved.',
      'The cleaning task moves with the stay.',
    ],
  },
  {
    slug: 'daily-close', category: 'operations', roles: MANAGERS, title: 'Daily close: check the day before you log off',
    keywords: 'daily close checklist end of day arrivals departures cleaning payments balances proofs damage sync close the day note history',
    body: [
      'Open Daily close from the menu (owners and managers). It opens today, Philippine time. You can pick another day, up to tomorrow.',
      'The checklist shows what is still open: arrivals not checked in, departures not checked out, cleanings not done, payment proofs to review, balances due within 2 days, open damage reports and calendar sync problems. Tap a line to fix it.',
      'Payments recorded that day are totalled by method.',
      'Close the day to save a snapshot and an optional note. Closing again updates it. Past closes are listed below.',
      'A manager\'s close covers their own properties. A manager can\'t change a close that covers properties they don\'t look after; only an owner can.',
      'After 9 PM, Home reminds you if today isn\'t closed yet.',
    ],
  },
  {
    slug: 'sync-warnings', category: 'bookings', roles: MANAGERS, title: 'Calendar sync warnings: stale calendars and overlapping bookings',
    keywords: 'sync warning stale failing calendar not updated overlap double booking alert airbnb booking.com agoda ical problem',
    body: [
      'BalayHub shows a warning on Home, and a "Sync problem" mark on the Calendar, when a channel calendar hasn\'t refreshed for 3 hours or its last refresh failed.',
      'When a channel booking overlaps dates you already have in BalayHub, BalayHub doesn\'t add it and shows the overlap with its dates. Check both bookings on the channel.',
      'Owners and managers of that property get one alert per new problem, by push or by email if they have no device. The warning clears when the calendar updates again.',
      'To fix a stale calendar, open Listings, choose the listing, then Channels, and press Sync now. If it still fails, check the calendar link on the channel.',
      'Only owners and managers see these warnings.',
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
