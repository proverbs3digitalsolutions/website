# 09. Small-hotel and inn PMS products (Cloudbeds, Little Hotelier, Sirvoy, eZee Absolute)

Research date: 2026-10-13. Scope: the front desk, bill, extra-charge, room-type, group, invoice, night-close and housekeeping features that matter to a Filipino host running several rooms or a small resort or transient house.

**Research limits (read first):** Vendor websites could not be opened from this session (DNS failed), so every claim comes from search snippets, help-center page excerpts and review sites. The search budget ran out after about 22 searches. Items marked "unverified" are not confirmed. Not covered: Reddit, G2 and Trustpilot review mining, and any Philippine reseller or peso price for these four products.

---

## 1. Summary

- A small-hotel PMS (property management system) runs the front desk: bookings, check-in and check-out, the guest bill (the "folio"), extra charges, room cleaning and the end-of-day close (the "night audit").
- Cloudbeds is the largest of the four. It has the widest feature set and publishes no list prices.
- Little Hotelier (owned by SiteMinder) is aimed at B&Bs, inns and small properties. Its reviews are mixed: booking errors, slow pages and uneven support come up often.
- Sirvoy is aimed mainly at small properties. It has the best review scores for ease of use and support, and the lowest published prices.
- eZee Absolute is sold through resellers and priced per room. Its housekeeping and night-audit features are mentioned in reviews. No Philippine price or reseller was found.
- None of the four is built for Philippine tax rules. Two Philippine vendors (Hotelogix and Codingclave) claim BIR-ready receipts; both claims are unverified.
- The main gap for BalayHub: one itemised bill per stay (room charges, extras, payments, balance), a daily close, and a way to bill several units under one booking.

---

## 2. Pricing

All figures are third-party listings unless marked as vendor. Currency and date are as shown.

- **Cloudbeds:** No public list price. Plans are named Flex, One, Experience and Enterprise, and need a quote. One aggregator says entry Flex plans "often start near $180–$200 per month" (unverified). Another lists a "From $600/mo" start. The two figures conflict. Add-ons such as Revenue Intelligence are "contact sales". Housekeeping is listed on every plan.
- **Little Hotelier:** Sources disagree. GetApp lists $29 a month. Capterra lists a starting price of US$109 with a free trial, plus optional paid add-ons for guest engagement and a website builder. Check directly with SiteMinder.
- **Sirvoy:** Capterra shows "$15, usage based, per month" with a free trial. Starter is "from $9/month" and Pro is "from $35/month" (GetApp and Software Advice). Pricing depends on the number of rooms. 14-day free trial, no card needed.
- **eZee Absolute:** Capterra's example for a 5-room property (USD per month): Classic (PMS only) $23.86; Elite (PMS plus booking engine) $47.73; Star (PMS plus channel manager) $55.68 and Champion (all of those) $79.55, with Star and Champion as custom quotes. An "Ultimate" option charges a fee per confirmed online booking, amount undisclosed. One Indian reseller lists cloud tiers "from about 2,250 per room per month" with housekeeping and night audit included. Currency not stated. Excludes taxes. No setup fee and a free trial per TrustRadius.
- **Philippine vendors (vendor claims, unverified):** Codingclave advertises a subscription at ₱1,699 a month and a one-time self-hosted licence at ₱67,999. Hotelogix markets BIR-certified cloud invoicing. Neither confirms its accreditation status in the sources found.

---

## 3. Feature catalogue

Columns: Area | Feature | What it does | BalayHub has it? (Yes / Partly / No)

BalayHub status is based on the brief's list of built features. "Partly" means something close exists but does not do the whole job. "Unverified" items are marked in the text.

| Area | Feature | What it does | BalayHub has it? (Yes / Partly / No) |
|---|---|---|---|
| Reservations | Booking calendar, all units | One timeline of every unit showing bookings and availability. Cloudbeds, Sirvoy and eZee all have one. | Yes (multi-calendar) |
| Reservations | Drag a booking to another unit | Move a guest to a different room on the calendar and save. Sirvoy does this with drag and drop, and the move works even when every room is occupied. Channel bookings can only move to the same room type. (Sirvoy help) | No (unverified) |
| Reservations | Overlap and double-booking guard | Stops a manual booking from landing on dates already taken. Reviews say Little Hotelier lets double bookings through. (Software Advice, Software Finder) | Unverified |
| Reservations | Saved views and filters | Save a filtered list of bookings. | Yes |
| Reservations | Room types with unit grouping | Sell "a 2-bedroom unit" as one type; the system picks any free unit of that type. Sirvoy filters the calendar by room type and sorts units by type or bed count. | Partly (each unit is its own listing) |
| Reservations | Group or split booking | One booker holds several units or rooms under one reservation. Sirvoy supports "group and split bookings". Little Hotelier reviews say group and split bookings are hard. Cloudbeds has a Groups module (see below). | No |
| Reservations | Block dates and minimum stay | Close dates for owner use or maintenance and set a minimum number of nights. | Yes |
| Reservations | Printable booking document | Print or PDF one booking's details. Sirvoy offers printable booking PDFs. | Unverified |
| Reservations | Booking history log | Record who changed what on a booking and when. Sirvoy lists a history log. | Unverified |
| Pricing | Nightly, weekend, holiday and season rates | Different prices by day type and season. | Yes |
| Pricing | Long-stay discounts | Lower price for longer stays. | Yes |
| Pricing | Per-person and fixed fees (taxes and fees) | A fixed fee per night, per person, or once per stay, added to the bill. Sirvoy adds these under Extras settings. | No |
| Pricing | Default tax rate per room and extra | Tax rate set once and applied to new rooms and extras. Sirvoy does this. | No |
| Direct booking | Direct booking page with payment | Guests book and pay on your own page. | Yes (PayMongo: GCash, Maya, card) |
| Direct booking | Deposit or full payment | Take part or all of the price upfront. | Yes |
| Direct booking | Discount codes | Promo codes at checkout. | Yes |
| Direct booking | Booking engine on your website | Embeddable booking widget for a host's own site. Cloudbeds, Sirvoy and eZee sell one. | No (direct booking page exists) |
| Payments | Pay-the-balance link | Send a link for the unpaid balance. | Yes |
| Payments | Itemised guest folio | The guest's bill, listing each room night, extra and payment, with a running balance. Cloudbeds shows a "Reservation Folio" with filters for grouping transactions, showing pending or posted items and an audit trail that includes voided entries. | Partly (balance is total minus payments; no line items) |
| Payments | Folio transfer between guests or to a group | Move a charge from one guest's bill to another, or to a company or group bill. Cloudbeds can move charges to a group folio. | No |
| Payments | Refund and void with audit trail | Refund a payment or void a charge, with a record. Cloudbeds keeps voided entries visible in folios. | Unverified |
| Payments | Security deposit hold | Take and track a deposit. | Yes |
| Payments | Payment reminders for balance | Automatic reminders for unpaid balances. Little Hotelier lists deposits and reminders as a feature in a competitor comparison. | Partly (scheduled messages exist; balance reminder unverified) |
| Extra charges | Add extras to a stay | Add items such as breakfast, rentals, spa or late check-out to a booking. Sirvoy calls these Extras and can track them on the calendar. It also offers a limited-number option. | No |
| Extra charges | Light point of sale (POS) | Add a sale to a guest's booking, for example drinks from the house fridge. Sirvoy describes its POS as light and says full shop or restaurant POS needs another system. | No |
| Extra charges | Restaurant POS | Full restaurant and bar billing with tables and kitchen tickets. eZee's restaurant POS is a separate product (eZee Optimus or BurrP). | No (out of scope for a condo host) |
| Invoices | Printed invoice | A bill for the guest or company. Sirvoy offers several invoice templates, changed under Settings, then Financials, then Invoicing module. | No |
| Invoices | Official receipt or BIR-compliant invoice | Philippine tax receipt with the seller's registered name, TIN, branch code, serial number and VAT shown separately. Hotelogix and Codingclave say they meet BIR rules (vendor claims, unverified). BIR accreditation applies to the sales software and each machine. | No (legal check needed) |
| Invoices | Customisable invoice layout | Logo, footer and fields on the invoice. Sirvoy lists customisable invoices. | Unverified |
| Front desk | Check-in and check-out workflow | Staff record arrival and departure from one screen. | Partly (guest check-in form with ID upload; no front desk board) |
| Front desk | Walk-in or same-day booking | Quick entry for a guest who arrives without booking. | Unverified |
| Front desk | In-house guest list | A list of guests in-house tonight. | Unverified |
| Front desk | Arrivals and departures for today | A daily list of who arrives and who leaves. | Unverified |
| Guests | Guest profile with history | Past stays and notes. | Yes (VIP, do-not-rebook, repeat tracking) |
| Guests | Guest reviews | Review after stay. | Yes |
| Guests | Guest messaging with templates | Pre-written messages sent by hand or on a schedule. | Yes |
| Guests | Guest app or online check-in | Guests check in online or through an app. Cloudbeds lists online check-in and a guest app. | Partly (check-in form only) |
| Housekeeping | Room condition board (clean, dirty, inspected) | One screen showing each room as clean, dirty or inspected. Cloudbeds uses these three states, with "inspected" turned on in settings. A room is marked dirty when a guest checks in. Condition does not affect availability. | No (cleaning tasks exist; no room status board) |
| Housekeeping | Assign a housekeeper | Pick who cleans a room. Cloudbeds shows an "Assigned To" menu. Sirvoy shows housekeeping status on the calendar. | Partly (tasks can be assigned; status board missing) |
| Housekeeping | Cleaning checklists with photos | Step-by-step checks with photo proof. | Yes |
| Housekeeping | Auto-set dirty at check-out | Room turns dirty as soon as the guest leaves. Odoo and Cloudbeds both do this. | No (unverified) |
| Housekeeping | Housekeeper sees tasks but not money | A cleaner logs in and sees only tasks. Hot Tech Report says Little Hotelier roles are all-or-nothing, so a cleaner cannot be limited this way. | Partly (team roles with property scope; check money visibility) |
| Night audit | Daily close (night audit) | End-of-day run that moves the business date forward, posts room charges, flags unpaid balances and locks the day. Cloudbeds lets you set an automatic run between midnight and 6 AM, or run it by hand, and limits who can run it. | No |
| Night audit | Night audit reports | Reports for the close, such as revenue for the day and cancelled bookings with balance due. Cloudbeds' help center has a "Night Audit" report tag. | No |
| Night audit | Cashier or daily cash report | Cash and card totals for the day. | No |
| Group | Groups module | One group, one master bill. Charges can route to the group bill automatically when a booking joins the group. Cloudbeds' newer Groups and Events module is in limited release. | No |
| Group | Company or corporate bill | Bill a company rather than the guest. | No |
| Team | Roles (owner, manager, staff) | Different access per role. | Yes |
| Team | Property scoping for staff | Staff see only their units. | Yes |
| Team | Shift or staff schedule | Plan who works when. | Partly (tasks, no shift roster; unverified) |
| Operations | Maintenance requests | Log and track repairs. | Partly (monthly rentals only) |
| Operations | Inventory and linen stock | Track supplies such as towels and toiletries. Cloudbeds and eZee list housekeeping inventory. | No |
| Owners | Owner statements | Income and costs per owner for units managed. | Yes |
| Owners | Owner portal | Owners log in to see their own statements. | Unverified |
| Accounting | Expenses log | Record costs by unit. | Partly (monthly rentals) |
| Accounting | Yearly income and tax summary | Income totals for tax time. | Yes |
| Reports | Revenue and occupancy reports | Occupancy rate and revenue by unit or period. | Partly (stay reports; occupancy unverified) |
| Reports | Custom report builder | Build reports from chosen fields. Cloudbeds' users say its reports are less flexible than expected (one review). | No |
| Mobile | Installable phone app | App on the phone home screen. | Yes |
| Mobile | Push notifications | Alerts on the phone. | Yes |
| Language | English and Taglish for guests | Guest-facing text in both languages. | Yes |
| Look | Light and dark mode | Screen theme. | Yes |
| Support | Help center and support tickets | Self-help articles and a support request form. | Yes |
| Support | Phone or chat support | Live help. Sirvoy reviews praise 24/7 support. Little Hotelier reviews split on it. | Unverified |
| Channel (excluded) | Channel manager and sync | Connects to booking sites. See Section 7. | Partly (iCal sync exists; excluded from ideas) |

---

## 4. Standout features

1. **Sirvoy: easy calendar moves.** Hosts move a booking by dragging it onto another room, then saving. Source: [Sirvoy help: moving a guest to a different room](https://help.sirvoy.com/moving-a-guest-to-a-different-room).
2. **Sirvoy: ease of use and support.** 301 Capterra reviews, 96% positive, and 98% of reviewers run small businesses. Reviewers praise 24/7 tech support. Source: [Capterra, Sirvoy](https://www.capterra.com/p/103570/Sirvoy-Booking-System/).
3. **Cloudbeds: housekeeping status shared between front desk and cleaners.** Housekeeping sets the condition (clean or dirty). The front office sees check-out status. Source: [Cloudbeds help: managing housekeeping from the new calendar](https://myfrontdesk.cloudbeds.com/hc//articles/48389981165083).
4. **Cloudbeds: group folio routing.** Charges can route automatically to a group bill when a booking joins a group. Source: [Cloudbeds help: Group Folios](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/27157673723931-Group-Folios).
5. **Cloudbeds: night audit that runs on a timer.** Set a run time between midnight and 6 AM, with a manual option and user permissions. Source: [Cloudbeds help: night audit enhancements](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/31030047512347).
6. **eZee Absolute: night audit as a daily record.** A user says the night audit is "very useful" for keeping a daily revenue record. Source: [Capterra, eZee Absolute reviews](https://www.capterra.com/p/135751/eZee-Absolute/reviews/?page=3).
7. **Little Hotelier: easy to use.** Capterra gives 4.0 out of 5 overall from 220 reviews, and 4.1 for ease of use. Reviewers say it centralises bookings and cuts double bookings for new hosts. Source: [Capterra, Little Hotelier (UK page)](https://www.capterra.co.uk/reviews/144307/little-hotelier).
8. **Sirvoy: extras on the calendar.** Extras such as breakfast or rentals can be tracked on the calendar, with an optional limited count. Source: [Sirvoy help: track and print extras from calendar](https://help.sirvoy.com/track-and-print-extras-from-calendar).
9. **Cloudbeds: folio audit trail.** Folios can show voided and deleted entries, so a host can see what was changed. Source: [Cloudbeds help: Reservation Folio](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/22503892593051-Reservation-Folio-Everything-you-need-to-know).

---

## 5. Complaints and gaps from reviews

**Booking accuracy (Little Hotelier)**
- Reviewers report overbookings and double bookings. Software Finder reviewer: the software "causes overbookings". Source: [Software Finder, Little Hotelier reviews](https://softwarefinder.com/property-management-software/little-hotelier/reviews?page=5).
- Group and split reservations are hard. Source: [Software Advice, Little Hotelier profile](https://www.softwareadvice.com/hotel-management/little-hotelier-profile/).

**Speed and clunkiness (Little Hotelier)**
- Reviews call the system "very cumbersome and slow" and mention lag and slow pages. Source: [Software Finder, Little Hotelier reviews](https://softwarefinder.com/property-management-software/little-hotelier/reviews?page=5).

**Support (Little Hotelier, mixed)**
- Some say support is quick and patient, with fixes "within minutes". Others say replies are slow and hard to reach. Sources: [GetApp, Little Hotelier](https://www.getapp.com/industries-software/a/little-hotelier/); [Software Advice, Little Hotelier profile](https://www.softwareadvice.com/hotel-management/little-hotelier-profile/).
- One reviewer complained about cancellation and says the free trial is hard to cancel. Source: [Software Finder, Little Hotelier reviews](https://softwarefinder.com/property-management-software/little-hotelier/reviews?page=5).

**Staff access (Little Hotelier)**
- Roles are all-or-nothing. A cleaner cannot see bookings without also seeing financial data. Source: [Hot Tech Report, Little Hotelier review](https://hoteltechreport.com/reviews/gn7m17ozkm93).

**Limited features for growing hosts (Little Hotelier)**
- Reviewers say rate rules and group bookings "can feel limited", and customisation is weak. Source: [RFP.wiki, Little Hotelier](https://www.rfp.wiki/vendors/little-hotelier).
- Currency and regional cost limits are mentioned. Source: [GetApp, Little Hotelier](https://www.getapp.com/industries-software/a/little-hotelier/).

**Price confusion (all)**
- Little Hotelier's starting price differs by source ($29 versus US$109). Sources: [GetApp](https://www.getapp.com/industries-software/a/little-hotelier/); [Capterra UK](https://www.capterra.co.uk/reviews/144307/little-hotelier).
- Cloudbeds has no public price. Third-party starts range from about $180 to $600 a month, and the sources disagree. Sources: [Pulse Signal, Cloudbeds pricing](https://getpulsesignal.com/pricing/cloudbeds); [Roommaster, Cloudbeds pricing](https://www.roommaster.com/blog/cloudbeds-pricing).

**Reporting (Cloudbeds)**
- One reviewer finds the reports, including guest folios, "not as comprehensive or flexible" as expected. Source: [GetApp, Cloudbeds](https://www.getapp.com/all-software/a/cloudbeds/).

**Slow product change and SMS fees (Sirvoy)**
- Reviewers say improvements are "rather slow". One wanted SMS templates that can be scheduled at different times, and said SMS fees should be included in the price. Source: [Capterra, Sirvoy](https://www.capterra.com/p/103570/Sirvoy-Booking-System/).

**Fit for larger hosts (Sirvoy)**
- Capterra notes that 98% of reviewers are small businesses, so larger properties should check more carefully. Source: [Capterra, Sirvoy](https://www.capterra.com/p/103570/Sirvoy-Booking-System/).

**Thin data on eZee Absolute**
- Reviews are few and mostly from resellers and comparison sites. No Philippine peso price or local support was found. Source: [Krowdbase, eZee Absolute](https://www.krowdbase.com/software/ezee-absolute).

**Philippine tax compliance (all four, gap)**
- None of the four is shown to issue BIR-compliant receipts. The BIR says hotels must use certified systems for official receipts. Its rules cover the sales software and each registered machine. Source: [Hotelogix, BIR-certified hotel PMS](https://blog.hotelogix.com/bir-certified-hotel-in-phillipines/); [Fiscal Requirements, Philippines software compliance](https://www.fiscal-requirements.com/news/5916-philippines-software-compliance).

---

## 6. Ideas for BalayHub

Each idea is something BalayHub can build itself. None uses an integration, a public API or AI.

- **Must: One itemised bill per stay.** Show room nights, extra charges, payments made and the balance on one screen and one page the guest can open. Why: hosts charge for early check-in, extra guests and towels, and today the balance only subtracts payments. (Based on the Cloudbeds folio and the Sirvoy extras pages.)
- **Must: Add extra charges to a stay.** A simple list where the host adds breakfast, late check-out or a pool fee to a booking. Why: this is the most common extra money line for a condo staycation, and it feeds the bill above.
- **Must: Stop overlapping bookings from manual entry.** Warn or block when a manual or direct booking overlaps another booking on the same unit. Why: double bookings are the top complaint about Little Hotelier, and one missed booking costs a guest and a host.
- **Should: Room condition board.** A single screen for clean, dirty and inspected per unit, with the assigned cleaner. Why: a host with 5 units on the same day needs to know which unit is ready without opening each task. (Cloudbeds states.)
- **Should: One booking for several units.** One booker, one payment, several units under one reservation. Why: families or groups book two or three condos together, and the reviews say split and group bookings are the weak spot of rivals.
- **Should: Room types that pick a free unit.** Set up a "2-bedroom" type; a booking takes any free unit of that type. Why: a host with three identical units does not need to choose the unit at booking time.
- **Should: Daily close (night audit) with a checklist.** One end-of-day screen: arrivals, departures, unpaid balances, cancellations, and a "day closed" lock. Why: small hosts currently have no daily record of money, and an eZee reviewer valued this exact record.
- **Should: BIR-compliant invoice or official receipt, after a tax check.** Print an invoice with the seller's name, TIN, branch code, serial number and VAT shown. Why: VAT-registered hosts need valid paper. This is a legal question first. Before building, the founder should ask a Philippine tax adviser what a host needs and whether BIR accreditation applies to BalayHub. Log it in BLOCKERS.MD until answered.
- **Should: Cleaner sees tasks, not money.** Confirm and, if needed, add a role that sees housekeeping and the calendar, but no rates or balances. Why: Little Hotelier's roles are all-or-nothing, and reviewers flag this.
- **Could: Drag a booking to another unit on the calendar.** Why: moving a guest after a fault in a unit is a common, slow task; Sirvoy's calendar makes it one drag.
- **Could: Fixed fees per night or per guest.** A fixed fee (for example a per-head local tax or a cleaning fee) added to a booking automatically. Why: Sirvoy does this with a tax-style setting, and it is simple to add to the rate settings.
- **Could: Walk-in quick entry.** One short form for a guest who arrives without booking. Why: common in transient houses; check first whether the existing booking form already covers it.
- **Could: Lightweight POS for the house fridge.** Log items such as drinks or snacks per unit with a price. Why: Sirvoy calls its own version "light". Keep it to a list on the folio, not a full sales screen.
- **Could: Printed booking sheet.** One printable page per booking. Why: some hosts keep paper for the front gate or guard.

---

## 7. Excluded (integrations/API/AI)

- Channel managers and booking-site sync (Cloudbeds channel manager, Little Hotelier and SiteMinder, Sirvoy channel manager, eZee channel manager).
- Public or developer API (Cloudbeds developer API used for housekeeping and room status).
- Accounting-software sync.
- Restaurant POS links to other POS hardware (eZee Optimus, BurrP).
- BIR electronic invoicing submission to the government (an integration with a government system). The receipt format itself is in Ideas, after a tax check.
- Any AI feature (Cloudbeds' revenue and automation features that rely on AI were not checked and are not recommended).

---

## 8. Sources

Cloudbeds
- https://myfrontdesk.cloudbeds.com/hc/en-us/articles/22503892593051-Reservation-Folio-Everything-you-need-to-know
- https://myfrontdesk.cloudbeds.com/hc/en-us/articles/219104088-Use-Cloudbeds-Reports-for-Night-Audit
- https://myfrontdesk.cloudbeds.com/hc/en-us/articles/31030047512347
- https://myfrontdesk.cloudbeds.com/hc//articles/216540808
- https://myfrontdesk.cloudbeds.com/hc//articles/25695101078427
- https://myfrontdesk.cloudbeds.com/hc//articles/48389981165083
- https://myfrontdesk.cloudbeds.com/hc/en-us/articles/27279213107739--New-Groups-Everything-you-need-to-know
- https://myfrontdesk.cloudbeds.com/hc/en-us/articles/27157673723931-Group-Folios
- https://developers.cloudbeds.com/docs/housekeeping-staff-management
- https://www.getapp.com/all-software/a/cloudbeds/
- https://www.softwareadvice.com/hospitality/cloudbeds-profile/
- https://www.roommaster.com/blog/cloudbeds-pricing
- https://getpulsesignal.com/pricing/cloudbeds
- https://truto.one/blog/connect-cloudbeds-to-ai-agents-sync-property-ops-and-analytics/ (third-party blog, group folio and housekeeping examples; not official)

Little Hotelier
- https://www.capterra.co.uk/reviews/144307/little-hotelier
- https://www.getapp.com/industries-software/a/little-hotelier/
- https://subscribed.fyi/little-hotelier/
- https://softwarefinder.com/property-management-software/little-hotelier/reviews?page=5
- https://www.softwareadvice.com/hotel-management/little-hotelier-profile/
- https://hoteltechreport.com/reviews/gn7m17ozkm93
- https://www.rfp.wiki/vendors/little-hotelier

Sirvoy
- https://www.capterra.com/p/103570/Sirvoy-Booking-System/
- https://www.capterra.com/p/103570/Sirvoy-Booking-System/pricing/
- https://www.softwareadvice.com.au/software/156859/sirvoy
- https://www.getapp.ca/software/110345/sirvoy-booking-system
- https://www.hoteltechreport.com/operations/property-management-systems/sirvoy
- https://help.sirvoy.com/moving-a-guest-to-a-different-room
- https://help.sirvoy.com/track-and-print-extras-from-calendar
- https://help.sirvoy.com/invoices-receipts
- https://sirvoy.com/blog/how-to-better-organize-your-hotel-with-sirvoys-ever-practical-calendar-page/

eZee Absolute
- https://www.capterra.com/p/135751/eZee-Absolute/
- https://www.capterra.com/p/135751/eZee-Absolute/reviews/?page=3
- https://www.getapp.com/all-software/a/ezee-absolute/
- https://www.krowdbase.com/software/ezee-absolute
- https://www.trustradius.com/products/ezee-pms/reviews
- https://us.fitgap.com/products/ezee-absolute
- https://hoteltechreport.com/compare/ezee-absolute-vs-touchmenu

Philippine tax and vendors
- https://blog.hotelogix.com/bir-certified-hotel-in-phillipines/
- https://www.hospitalitynet.org/opinion/4133770/hotelogix-sees-instant-adoption-of-bir-compliance-among-philippine-hotels
- https://www.fiscal-requirements.com/news/5916-philippines-software-compliance
- https://codingclave.com/blog/hotel-management-software-philippines-2026
