# BalayHub vs Guesty and competitors: summary and roadmap

Last updated: 2026-10-13

This page sums up 15 research reports (`01`–`15` in this folder) plus two follow-ups. It answers four questions: what Guesty is, what Guesty and its competitors offer, where users complain, and what BalayHub should build next to become "a Guesty for Filipino hosts".

As the founder asked, the research **leaves out** integrations (channel APIs, open API, app marketplaces, smart locks, accounting sync) and **all AI features** (chatbots, AI replies, AI pricing). Everything recommended here is something BalayHub can build itself.

> **How reliable is this?** The research agents could not open vendor websites, review sites or Reddit from this environment. Most facts come from search-result summaries, comparison blogs and help-centre snippets, so prices in particular conflict between sources. Each report marks unverified points and links its sources. Treat competitor prices as rough, and check the tax and legal points (BIR, Data Privacy Act) with a practitioner before building rules on them.

---

## 1. What Guesty is

- **Guesty** is a property management system (PMS) for short-term rentals, founded in 2013 in Tel Aviv. It raised about US$170M in 2018 and about US$130M in 2024.
- **Who it's for:** it is built for operators with **10 or more listings** across Airbnb, Vrbo, Booking.com and their own sites. It is weakest for 1–3 unit hosts who want something simple, cheap and supported.
- **Plans:**
  - **Lite** (1–3 listings): about US$9 per listing a month plus 1% per booking, or US$16–39 per listing on fixed plans. Email support only.
  - **Pro** (4–199 listings): quote only. Reviewers report about US$40–72 per listing a month plus 2–3.5% on direct bookings, plus an onboarding fee.
  - **Enterprise** (200+ listings): custom quote.
- **Core features:**
  - unified inbox and automated messages
  - multi-calendar
  - task management for cleaners, with a cleaner app
  - owner statements and owner portal
  - direct booking website builder
  - guest app and guidebook
  - reports
- **Paid add-ons:** payments (GuestyPay), pricing (PriceOptimizer), ID checks (Verify), smart locks, accounting, financing.
- **What users love:** the unified inbox, automated messages, owner reports, and the ability to scale from 30 to 150+ listings.
- **What users hate:**
  1. **Price:** high, unclear, hidden add-ons; "value for money" is its lowest review score.
  2. **Contracts:** auto-renewal, non-refundable fees, price rises at Guesty's discretion.
  3. **Learning curve:** reviewers call it "too complicated".
  4. **Support:** uneven; Lite users waited months, with no live agent.
  5. **Sync bugs:** double bookings.
  6. **Small-host fit:** a weak fit for small hosts.

## 2. The competitors in one table

| Product | Best for | Price (rough, USD) | Stands out for | Main complaints |
|---|---|---|---|---|
| Guesty | 10–200+ listings | Lite ~$9–39/listing; Pro by quote | Inbox, automation, owner portal, add-on ecosystem | Price, contracts, complexity, support |
| Hostaway | 5–500 listings | ~$25–50/listing, setup fees | Onboarding help, support, shared calendar | Hidden fees, learning curve, 1.8% direct-booking fee |
| Hospitable | 1–20 listings | Free tier to ~$99/mo | Simple, messaging, direct site | Support, price creep per unit, thin owner statements |
| OwnerRez | Owner-operators | ~$40/mo + add-ons | Quote → signed agreement → payment in one flow, support | Learning curve, price rises |
| Hostfully | Guidebooks, small PMs | ~$15–25/property | Digital guidebook, owner portal | Bugs, complexity |
| Lodgify | Website-first hosts | ~$13+/mo, may take a % per booking | Website builder, guest app | Sync failures, support, invoicing |
| Smoobu | Very small hosts | Cheap; 0.9% per booking on low plan | Simple, cheap | Sync, fee surprises |
| Uplisting / Hostify / iGMS | 5–50 listings | ~$20/unit, ~$100/mo minimums | Owner portal (paid add-on), automation | Slow messages, slow setup, thin reports |
| Beds24 / Tokeet / Avantio / Zeevou | Very configurable / serviced apartments | €8 to €295+/mo | Zeevou: check-in, branded invoices, owner login | Setup difficulty, slow support, sync bugs |
| Cloudbeds / Little Hotelier / Sirvoy / eZee | Small hotels and inns | $9 to $600/mo | Itemised bills, extras, room status board, night audit | Double bookings, group bookings, all-or-nothing roles |

**What nobody does well:**
- prices in pesos
- GCash and Maya payments
- condo gate passes
- BIR-style receipts and tax summaries
- Taglish for guests
- support in Philippine hours

These are BalayHub's natural advantages.

## 3. BalayHub vs the market: feature map

✅ BalayHub has it · 🟡 partly · ❌ missing

| Area | Market standard | BalayHub |
|---|---|---|
| Calendar and channels | Multi-calendar, sync with Airbnb/Booking/Agoda | ✅ iCal sync (no API, by design) |
| Sync health | Last sync time, failure warning, double-booking alert | 🟡 Records last sync and errors; no prominent warning or alert |
| Reservations | Saved views, filters, manual and direct bookings, overlap block | ✅ |
| Group / multi-unit booking | One booker, several units | ❌ |
| Room types | Book "a 2-bedroom", system picks a free unit | ❌ |
| Rates | Weekend, holiday, season, length-of-stay, minimum nights | ✅ |
| Rule-based pricing | Gap-night filling, last-minute and far-out rules, events | ❌ |
| Bulk rate and block changes | Many units at once | ❌ (one unit at a time) |
| Direct booking | Booking page, online payment, deposits, codes | ✅ PayMongo, GCash/Maya/card |
| Direct booking extras | Add-ons, packages, cancellation policy presets, abandoned-booking follow-up | ❌ |
| Quotes | Send a quote; guest accepts and pays | ❌ |
| Payments | Balance links, receipts | ✅ |
| Manual payments | Record GCash/bank with proof screenshot, guest uploads proof | 🟡 Records method and reference; no proof upload or guest-side bank transfer |
| Itemised bill (folio) | Nights, extras, payments, balance on one bill | 🟡 One "other fees" amount only |
| Inbox | Unified inbox, templates, scheduled and event messages, internal notes | ✅ Email; AI drafts optional |
| Team inbox | Assign conversations, @mentions | ❌ |
| Guest check-in | Online form, ID upload, consent | ✅ |
| House rules / rental agreement | Guest accepts or signs | ❌ (consent to building registration only) |
| Guidebook | Per-unit digital guidebook with local tips | ❌ |
| Wi-Fi and door-code timing | Code sent X hours before arrival | 🟡 Possible with scheduled messages; no ready template |
| Upsells | Early check-in, late check-out, airport pickup, extra bed | ❌ |
| Reviews | Request after check-out, private feedback first | 🟡 Review request exists; no private-first step |
| Repeat guests | Profile, VIP, do-not-rebook, returning-guest code | 🟡 Codes exist, not issued automatically |
| Cleaning | Auto task at check-out, checklist with photos, assign | ✅ |
| Cleaner-only access | Cleaner sees jobs, not money | 🟡 Staff role hides guest contacts, not booking amounts |
| Cleaner calendar and status board | Who cleans what and when; clean/dirty/inspected | 🟡 Clean/dirty on calendar; no inspected state or cleaner calendar |
| Inspections | Pass/fail, quality score | ❌ |
| Damage reports | Cleaner reports from phone, linked to deposit | ❌ |
| Inventory | Par levels, restock alerts | ❌ |
| Lost and found | Log per stay | ❌ |
| Maintenance for stays | Work orders from cleaners | 🟡 Monthly-rental maintenance only |
| Cleaner pay | Pay per clean, mark paid | ❌ |
| Owners | Statements with management fee | ✅ one fee type (% of revenue) |
| Owner portal | Owner logs in to see statements, bookings, payouts | ❌ |
| Owner finance | Fee models (gross/net/flat), expenses with receipts, approval, payout record, reserve | 🟡 Fee % and expenses; no approval step, payout record, reserve or other fee types |
| P&L per unit | Monthly income minus costs per unit | 🟡 In reports; not a clear per-unit monthly view |
| Reports | Occupancy, ADR, RevPAR, by channel | ✅ |
| Scheduled reports | Monthly PDF by email | ❌ |
| Pacing | Bookings on hand vs last year, booking window | ❌ |
| Team | Roles, property scoping | ✅ |
| Activity log | Who changed what on each booking | 🟡 Audit log exists; not shown per booking |
| Notification rules | By event, property and person | 🟡 Push and email; no per-event rules |
| Unit tags / groups | "Makati condos", "Owner A" | ❌ |
| Taxes (PH) | Percentage tax / VAT summary, invoice numbering | 🟡 Yearly income summary; no BIR invoice numbering or monthly tax summary |
| Condo admin | Gate pass, guest list lead time | ✅ Unique to BalayHub |
| Data privacy | ID retention, consent | ✅ Auto-delete IDs, consent at check-in |
| Support | Help centre, tickets, local hours | ✅ (publish hours and reply target) |
| Pricing of BalayHub itself | Transparent, no lock-in | ✅ Peso prices, monthly, trial |

## 4. Recommended roadmap (BalayHub-owned features only)

Ranked by how often the research flagged it, how much it matters to a Filipino host with 1–10 units, and how much of it BalayHub already has.

### Phase 1: Money done right, the Filipino way (Must)
1. **Itemised stay bill:** extra charges such as early check-in, late check-out, extra guest or bed, airport pickup and damages, each with a pay link. Replaces the single "other fees" amount.
2. **Manual payments with proof:** guest or host uploads a GCash or bank transfer screenshot and the host confirms. Add bank transfer as a booking-page option.
3. **Cancellation policy presets and a refund log** per listing (flexible, moderate, strict), shown at checkout, with every refund recorded.
4. **Payment schedule rules** per listing, for example 50% at booking and the rest X days before check-in, with automatic reminders.
5. **Host net per booking:** show what the host keeps after channel or payment fees, and what a direct booking saved.
6. **BIR-ready invoices and a monthly tax summary.** Numbered invoices (EOPT wording) and a monthly percentage tax or VAT summary. *Only after a tax practitioner confirms the rules (BLOCKERS).*

### Phase 2: Owners and co-hosts (Must)
7. **Owner portal:** read-only login for unit owners to see statements, bookings, payouts and an operations feed. Owners can also block their own dates.
8. **Owner finance:**
   - fee models: % of gross, % of net after channel fee, flat monthly
   - expenses with receipts on the statement
   - a review-then-send step for statements, plus a PDF by email
   - a payout record (GCash, Maya, bank or cash, with reference)
   - a repairs reserve per owner
9. **Profit and loss per unit per month,** plus a monthly report emailed to the host and owners.

### Phase 3: Operations and housekeeping (Must / Should)
10. **Cleaner-only access:**
    - cleaners see jobs, checklists and photos, never money
    - a cleaner calendar with easy reassignment
    - a status board showing clean, dirty or inspected
11. **Inspections** with pass/fail per item and a quality score per cleaner. **Damage reports** from the cleaner's phone, linked to the security deposit.
12. **Cleaner pay** per clean or per hour, marked paid (cash or GCash), with a monthly summary.
13. **Supplies:** par levels in the checklist and low-stock warnings for linens and toiletries. **Lost and found** log per stay.
14. **Maintenance for stays:** work orders raised by cleaners, plus recurring preventive tasks such as aircon cleaning.

### Phase 4: Guest experience and direct booking (Should)
15. **Digital guidebook** per unit in English and Taglish: Wi-Fi, rules, parking, gate notes, local tips. Plus a timed Wi-Fi and door-code message template.
16. **House rules / rental agreement:** the guest accepts or signs on the check-in form and booking page, with the time recorded.
17. **Paid add-ons** on the booking page and before arrival, paid through the existing PayMongo links.
18. **Quote → accept → pay link** for Facebook and Messenger inquiries, plus share links per listing with a source tag ("from Facebook").
19. **Reviews:**
    - a private feedback question before the public review request
    - an automatic returning-guest code
    - a follow-up when a guest starts a booking but doesn't pay
20. **Search-friendly listing pages** with real web addresses, so Google can index direct-booking pages.

### Phase 5: Pricing rules, team tools and bigger properties (Should / Could)
21. **Rule-based pricing:**
    - gap-night filling
    - last-minute and far-out rules
    - dated events with a price bump and minimum nights
    - one-click Philippine holiday list
    - a 14–27 night tier
    - a price preview
    - bulk rate and block changes across units
22. **Team:**
    - activity log on each booking
    - assign conversations
    - @mentions in notes
    - notification rules by event and property
    - unit tags and groups
23. **Bigger properties:**
    - group bookings across several units
    - room types that auto-pick a free unit
    - drag a booking to another unit
    - a daily close (night audit) checklist
24. **Sync health:** a clear warning when a channel calendar hasn't refreshed, and an alert on any double-booked night.

### Business moves (no code, or very little)
- Keep pricing **transparent and in pesos**:
  - publish every fee, including PayMongo's
  - monthly billing with cancel-in-app and no lock-in
  - (Founder decision) a **free 1-unit plan** to win the biggest group of hosts
- Publish **support hours (Philippine time) and a reply target** in English and Tagalog.

### Not recommended now
- Shift or on-call scheduling: no competitor does it well, and it's a large build.
- Cleaner marketplace.
- Gift cards (tax and liability check first).
- Trust-account ledger (needs a Philippine legal check).
- Multi-currency.
- Occupancy-based "dynamic" pricing beyond simple rules (founder decision, see BLOCKERS).

## 5. Excluded on purpose
- Channel-manager API connections and an open/public API
- Integration marketplaces
- Smart-lock and third-party app connections
- Accounting-software sync and market-data feeds
- All AI features: AI pricing (Guesty PriceOptimizer's machine learning), AI chatbots, AI replies, AI guest screening, selfie matching

BalayHub's existing optional AI reply drafts and assistant stay as they are; this research adds no new AI.

## 6. Reports in this folder
| File | Topic |
|---|---|
| 01 | Guesty: company, plans, full features, module details |
| 02 | Guesty: user reviews and gaps |
| 03 | Hostaway |
| 04 | Hospitable |
| 05 | OwnerRez and Hostfully |
| 06 | Lodgify and Smoobu |
| 07 | Uplisting, Hostify, iGMS |
| 08 | Beds24, Tokeet, Avantio, Zeevou |
| 09 | Small-hotel systems (Cloudbeds, Little Hotelier, Sirvoy, eZee) |
| 10 | Philippine market: condo rules, BIR, Data Privacy Act, payments, local tools |
| 11 | Operations and housekeeping tools |
| 12 | Guest experience |
| 13 | Owners and finance |
| 14 | Revenue rules and direct booking |
| 15 | Team, scheduling and reports |
