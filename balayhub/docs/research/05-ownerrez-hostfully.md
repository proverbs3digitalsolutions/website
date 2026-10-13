# OwnerRez and Hostfully: research for BalayHub

**Read this first: research limits.** The vendor sites (ownerrez.com, hostfully.com) and review or comparison sites (Capterra, Roommaster, Smoobu, Toolradar, Reddit) could not be opened. The session network policy blocked them (403 from the egress proxy). Every fact below comes from search-result summaries, not from full pages. Facts marked **unverified** need checking on the vendor's own pricing page before anyone relies on them. The search tool also reported its search budget used up after 14 searches, so one planned pricing search did not run. Reddit threads were not found in any search.

## Summary

- **OwnerRez** is a property management system (PMS) for vacation rental owners and small managers. It handles bookings, channel sync, quotes, signed rental agreements, deposits, payments and owner statements. Users rate it highly, especially on support.
- **Hostfully** is a PMS built around guest messaging, automation, cleaning and maintenance tasks, and digital guidebooks. Its guidebook product is the best-known part and has its own free tier.
- Both are US-first. Neither has a Philippines-specific payment path (no GCash, Maya or PayMongo that we could confirm).
- Both sell to hosts who run many units. Pricing for a host with 1 to 10 units is unclear and varies by source.
- OwnerRez is cheaper on paper and rated higher by reviewers (4.9 on Capterra, 259 reviews). Hostfully is more automated and has the guidebook and a broader task system, but its Capterra rating is lower (4.2, 235 reviews) and its reviews mention bugs and complexity.
- Market position: both sit at the mid-to-upper end of the US market. Guesty, which the founder named as the benchmark, is the bigger competitor (see the other research files).
- For BalayHub, the most useful gaps are: quotes with a signed rental agreement, scheduled payment rules, a damage deposit flow, a digital guidebook, and an owner view. Most of these are buildable without an integration.

## Pricing

Sources disagree. Treat every number below as **unverified** until checked on the vendor site.

**OwnerRez (per property, per month)**

| Source | What it says |
|---|---|
| Capterra pricing page, and Roommaster | A $40 per month account minimum covers one property. Per-property price falls as units are added. |
| Toolradar (August 2026) | Single-property base plan is $88 per month. |
| One review | A $35 per month "Standard" plan. |
| Roommaster | Add-on modules (QuickBooks sync, hosted website, messaging) are billed separately, each per property. Small operators pay roughly $40 to $120 per month in total. |
| Roommaster | 14-day free trial. |
| Capterra | Free trial exists, no free plan, credit card needed. |
| Toolradar | No setup fee, no booking fee, no contract on the base plan. |
| CostBench | Pricing is custom and hidden costs (setup, support) are added. Ask for a quote. |

Sources: [Capterra OwnerRez pricing](https://capterra.com/p/100831/OwnerRez/pricing/), [Roommaster OwnerRez pricing](https://www.roommaster.com/blog/ownerrez-pricing), [Toolradar OwnerRez pricing](https://toolradar.com/tools/ownerrez/pricing), [CostBench hidden costs](https://costbench.com/software/vacation-rental-software/ownerrez/hidden-costs/).

**Hostfully PMS**

| Source | What it says |
|---|---|
| Hostfully pricing page (search summary only) | Per-property model: about $15 per property per month on the Growth plan and $25 on Pro, each with a platform fee. **Unverified**: the page could not be opened, so this comes from a search summary. |
| Roommaster | Flat tiers: about $119 per month for a small portfolio, about $215 for up to 11 listings, about $269 for up to 19. Custom quotes above 20. |
| Smoobu | Entry tier about $109 to $129 per month, up to 4 properties. The entry tier may add a 1% payment fee or a 0.85% fee on direct bookings. |
| Capterra | "Contact vendor." No public starting price. |

The per-property and flat-tier figures do not match. Ask Hostfully for a quote.

**Hostfully Digital Guidebooks (separate product)**

| Source | What it says |
|---|---|
| Hostfully guidebook pricing page (search summary) | Free plan: one guidebook. Pro: up to 199 guidebooks, adds custom branding, bulk edit, and translation into 16+ languages. Enterprise: 200+ guidebooks, priority support. |
| Capterra | Starts at US$9.99, flat rate, with a free version. |
| Zeevou (older) | "Power Host" single guidebook at $7.99 per month billed yearly or $9.99 billed monthly. |
| Smoobu | Guest guides are often a paid add-on, from $9.99 per month for one guide. |

Sources: [Hostfully pricing](https://www.hostfully.com/pricing/), [Hostfully guidebook pricing](https://www.hostfully.com/pricing/digital-guidebooks/), [Roommaster Hostfully pricing](https://www.roommaster.com/blog/hostfully-pricing), [Smoobu Hostfully vs Guesty](https://www.smoobu.com/en/comparisons/hostfully-vs-guesty/), [Capterra Hostfully guidebooks](https://www.capterra.ca/software/189151/hostfully-guidebooks), [Zeevou Hostfully vs Touch Stay](https://zeevou.com/?p=106033).

## Feature catalogue

The "Product" in the Feature cell says which tool has the feature: **OR** = OwnerRez, **HF** = Hostfully, **Both** = both. Where the search results did not confirm a feature for a product, it is marked "unverified" in the What it does column. "Excluded" features (integrations, APIs, AI, marketplaces) are listed at the end, not in this table.

| Area | Feature | What it does | BalayHub has it? (Yes / Partly / No) |
|---|---|---|---|
| Reservations | Booking records by hand (OR) | Staff enter a booking directly. OwnerRez warns that manual bookings skip the automatic agreement, deposit and payment steps. | Yes |
| Reservations | Quote before booking (OR) | Send a guest a quote with price, terms and a link to accept. Accepting it creates the booking, signs the agreement, takes payment and sets deposits. | No |
| Reservations | Book Now widget and direct booking site (OR, HF) | Guest books on the host's own site or widget. OwnerRez says its booking engine is built in, with no third-party widget. | Yes (direct booking page) |
| Reservations | Booking pipeline (HF) | Board that shows each reservation by stage and payment status, colour-coded. | Partly (reservations list with filters; no pipeline colours) |
| Reservations | Saved views and filters (both) | Saved list views for reservations. | Yes |
| Calendar | Multi-calendar and iCal sync (both) | One calendar across units and channels. | Yes |
| Calendar | Blocks and minimum stay (both) | Block dates for owner use or maintenance; set minimum nights. | Yes |
| Calendar | Owner self-blocking (HF) | Owners block their own dates from the owner portal; the manager is notified. | No |
| Pricing | Seasonal and long-stay rates (both) | Rates by season, weekend, holiday and length of stay. | Yes |
| Pricing | Rate multiplier by channel (HF, unverified detail) | Adjust prices or fees per channel to cover processor costs. | No |
| Pricing | Dynamic pricing tools (both) | Auto-price changes. Usually through a third-party integration. | Excluded (integration) |
| Payments | Card payment at checkout (OR, HF) | Guest pays at booking. BalayHub uses PayMongo (GCash, Maya, card). | Yes |
| Payments | Payment schedule rules (HF) | Set rules per property or booking, for example 50% at booking and the rest before check-in or after checkout. | Partly (full payment or deposit, plus pay-balance links; no rule-based schedule) |
| Payments | Automatic payment reminders (HF, unverified) | Reminders for unpaid balances. | Partly (pay-balance links; reminder status unverified in BalayHub) |
| Payments | Manual payment marking (HF) | Mark a booking paid when the guest paid by bank transfer, Venmo, cheque or cash. | No (unverified in BalayHub; check payment recording screens) |
| Payments | Manual card entry and scheduled charge (HF) | Enter a guest's card and charge now or on a set date. The card is not stored. | No |
| Payments | Refunds from the platform (HF, OR) | Refund a payment in the platform. | Unverified (check refund flow) |
| Payments | Payment processor choice (OR: Stripe, PayPal; HF: Stripe, PayPal, VacationRentPayment, plus wallets) | Choice of processors and wallets such as Apple Pay and Google Pay. | Partly (PayMongo only; GCash, Maya and card) |
| Payments | Discount codes (both, unverified detail) | Promo codes at checkout. | Yes |
| Damage deposits | Refundable damage deposit (OR) | Guest is charged a deposit up front and refunded after checkout if there is no damage. OwnerRez notes processors charge fees on these. | Partly (security deposit feature exists; check that it charges and refunds the same way) |
| Damage deposits | Security deposit hold (OR, HF) | Temporary hold on the card, nothing charged. HF also says it can pre-authorise a card. | No (unverified whether PayMongo supports a hold) |
| Damage deposits | Charge for damage with written agreement (OR, guidance) | OwnerRez advises a written agreement from the guest before any charge above the deposit, to avoid chargebacks. | No |
| Rental agreements | Digital rental agreement and e-sign (OR, HF) | Per-property agreement template filled from the booking. Guest signs on phone or desktop. Signed copy stored, with IP and timestamp. | No |
| Rental agreements | Customised agreement (OR) | Agreement text is editable and converted to PDF. | No |
| Rental agreements | Third-party e-sign (HF, DropboxSign) | Extra signing service. | Excluded (integration) |
| Guest communication | Email inbox with templates (both) | Shared inbox and reusable templates. | Yes |
| Guest communication | Scheduled and automatic messages (both) | Messages sent at set times or on booking events. | Yes |
| Guest communication | Automation triggers (HF) | Custom triggers for guest messages, task assignments and cleaning schedules. | Partly (scheduled and automatic messages; not task triggers) |
| Guest communication | Guest messaging in Taglish (BalayHub) | Guest-facing text in English and Taglish. | Yes (BalayHub only; neither competitor confirmed) |
| Guest experience | Digital guidebook (HF, strong; OR none native) | Online guide per property: check-in and checkout, house rules, amenities, photos, videos, local tips. Sent as a private link or PDF. Free tier covers one guide. | No |
| Guest experience | Guidebook upsells (HF) | Sell extras such as late checkout or mid-stay cleaning from the guide. | No |
| Guest experience | Guest review of the stay (both) | Host reviews guest, and the reverse. | Yes (guest reviews of the stay) |
| Check-in | Online check-in form (both, unverified detail) | Guest fills in details before arrival. | Yes |
| Check-in | ID upload (BalayHub) | Guest uploads ID. | Yes |
| Check-in | Gate or access codes (both, unverified detail) | Send door or gate codes. | Partly (condo gate pass to building admin; no access-code sending) |
| Operations | Cleaning tasks with checklists (HF) | Task created from a checkout event. Checklists per job. | Yes |
| Operations | Task photos (BalayHub) | Cleaners add photos to tasks. | Yes |
| Operations | Mobile app for vendors and staff (HF) | Service Provider Hub: calendar and job views, push alerts, confirm completion. | Partly (installable app with push; no separate cleaner view confirmed) |
| Operations | Vendor and cleaner access (HF) | Vendors see only their tasks. | Partly (team roles with property scoping) |
| Maintenance | Maintenance tracking (both, unverified detail) | Repair requests and history. | Partly (monthly rentals have maintenance; short-stay units do not) |
| Inventory | Inventory and supplies (both, unverified) | Stock levels for linen and amenities. | No |
| Owners | Owner statements (OR, HF) | Income, fees, expenses and payout per owner. OR allows custom formulas. HF lets managers deduct fees and repairs from owner credits and adjust totals. | Yes (owner statements for managed units) |
| Owners | Owner portal (HF) | Owners log in to see reservations, statements and messages. | No |
| Owners | Owner commission formulas (OR) | Commission calculated by formula. | Partly (confirm in BalayHub) |
| Owners | Owner self-blocking (HF) | See Calendar row above. | No |
| Accounting | Expense tracking (OR) | Record costs against a property or owner. | Yes (monthly rental expenses; check short-stay coverage) |
| Accounting | Accounting software sync (OR, QuickBooks) | Sync to QuickBooks. | Excluded (integration) |
| Accounting | Yearly income and tax summary (BalayHub) | Yearly income summary for tax. | Yes |
| Reports | Stay reports (BalayHub) | Stay reports. | Yes |
| Reports | Owner financial reports (HF) | Booking, owner adjustment and payout data generated automatically. | Partly (owner statements; check report depth) |
| Reports | Reporting depth (reviewer complaint, both) | Users say reporting lags and needs more for multi-unit properties. | Unverified |
| Team | Team roles and property scoping (both) | Roles and access by property. | Yes |
| Team | Staff task view (HF) | Staff see only their assigned tasks. | Partly |
| Mobile | Installable app with push (BalayHub) | Phone app with push. | Yes |
| Mobile | Native app for hosts (HF, unverified) | Hosts use a mobile app. | Partly (installable app, not native) |
| Mobile | Web-only (OR, per one 2025 review, unverified) | OwnerRez may have no mobile app. | n/a |
| Website | Host website builder with templates (OR) | Site builder with templates, SEO and mobile layouts. | No |
| Website | Direct booking site (both) | See Reservations row above. | Yes |
| Multi-unit | Multi-property management (both) | Manage many properties and owners from one account. | Yes (1 to 10 units target) |
| Monthly rentals | Long-term tenants and leases (BalayHub) | Tenants, leases, rent, expenses. | Yes (competitors not reviewed here; monthly rentals are not a focus for either) |
| Plans | Free trial (both) | OR: 14-day trial, card needed. | Yes |
| Plans | Base plan with add-on modules (OR) | Modules priced per property. | No (BalayHub plans, not add-ons) |
| Support | Customer support rating (both) | OR strongly praised; HF rated fine but with slow fixes in older reviews. | Unverified for BalayHub |
| Help | Help center and support tickets (BalayHub) | Help articles and tickets. | Yes |
| Account | My account page (BalayHub) | Account settings. | Yes |
| Theme | Light and dark mode (BalayHub) | Theme toggle. | Yes |
| Language | English and Taglish (BalayHub) | Interface and guest text. | Yes |

**Excluded features seen in the research (not recommended):** channel manager API connections (OR, HF, Hostfully's 100+ partner integrations, Stripe and PriceLabs links), dynamic pricing integrations (PriceLabs, Wheelhouse), QuickBooks and accounting sync, DropboxSign e-sign, smart-lock and gate integrations, Hostfully AI assistant, and any AI-written messages or replies.

## Standout features

1. **OwnerRez's quote-to-signed-agreement flow.** Accepting a quote creates the booking, a signed agreement, the payment and the deposit in one step. Source: [OwnerRez quotes guide](https://www.ownerrez.com/support/articles/why-you-should-create-quotes-instead-of-bookings) (search summary; page not opened).
2. **Hostfully's digital guidebook.** Widely praised; the free tier covers one guide and it sells upsells. Source: [Hostfully guidebook pricing](https://www.hostfully.com/pricing/digital-guidebooks/), [Smoobu comparison](https://www.smoobu.com/en/comparisons/hostfully-vs-guesty/) (calls it an industry standard).
3. **OwnerRez support.** Praised as personal and fast. Capterra support score 4.9. Source: [Capterra OwnerRez reviews](https://www.capterra.com/p/100831/OwnerRez/reviews/).
4. **OwnerRez's customised owner statements with formulas.** Source: [OwnerRez deposit and statement search summary](https://www.ownerrez.com/guides/how-to-handle-rental-agreements-and-extra-fees-outside-of-airbnb) (summary only).
5. **Hostfully's rule-based payment schedules.** Collect part at booking and the rest before check-in or after checkout, per property. Source: [Hostfully payment processing](https://www.hostfully.com/property-management-platform/features/payment-processing/).
6. **Hostfully's owner portal and automatic owner reports.** Owners see statements and reservations; managers deduct repairs from owner credits. Source: [Hostfully owner management](https://www.hostfully.com/property-management-software/features/owner-management/).
7. **Hostfully's cleaner app (Service Provider Hub).** Calendar and job views, push alerts, confirm jobs done. Source: [Hostfully task management](https://www.hostfully.com/property-management-platform/features/task-management/).
8. **Hostfully's task triggers.** Cleaning is created from a checkout event, not by hand. Source: [Hostfully task management](https://www.hostfully.com/property-management-platform/features/task-management/).
9. **OwnerRez's clear damage-deposit choice.** A refundable deposit or a card hold, with guidance on chargebacks. Source: [OwnerRez damage deposit forum](https://ownerrez.com/forums/general-help/damage-deposit) (forum summary).
10. **Hostfully's free guidebook tier.** A host can try the guidebook at no cost. Source: [Hostfully guidebook pricing](https://www.hostfully.com/pricing/digital-guidebooks/).

## Complaints and gaps from reviews

Review sources are summaries. Reddit was not reached. Most reviews on these sites are positive, and vendor-run pages skew positive.

**OwnerRez**
- **Learning curve.** The platform is deep and hard to learn for non-technical users. Source: [GetApp OwnerRez reviews](https://www.getapp.com/hospitality-travel-software/a/ownerrez/reviews/), [Capterra OwnerRez reviews](https://www.capterra.com/p/100831/OwnerRez/reviews/) (ease of use 4.7).
- **Price rises.** A long-time user says the price went up over four years. Source: [Capterra OwnerRez reviews](https://www.capterra.com/p/100831/OwnerRez/reviews/).
- **Reporting lags.** One user says property reports lag. Source: same.
- **Email template design is limited.** One review. Source: [GetApp OwnerRez reviews](https://www.getapp.com/hospitality-travel-software/a/ownerrez/reviews/).
- **Add-on costs.** Modules are billed per property, so the total can climb. Source: [Roommaster OwnerRez pricing](https://www.roommaster.com/blog/ownerrez-pricing).
- **Deposits show in the total.** A forum user asked how to keep a deposit out of the displayed total; no clear answer found. Source: [OwnerRez damage deposit forum](https://ownerrez.com/forums/general-help/damage-deposit).
- **No native guidebook.** Guidebooks come from third-party tools. Source: [RedCarpet Host](https://www.ownerreservations.com/support/articles/redcarpet-host).
- **Mobile app** may not exist (one 2025 review, **unverified**).

**Hostfully**
- **Bugs and stability.** The biggest recurring complaint on Capterra. Source: [Capterra Hostfully reviews](https://www.capterra.com/p/187827/Cache/reviews).
- **Slow fixes and support (older reviews, 2017 to 2023).** Some reviewers say fixes took days or weeks. Live chat not always available. Source: [Capterra Hostfully reviews](https://www.capterra.com/p/187827/Cache/reviews), [G2 Hostfully review](https://www.g2.com/survey_responses/hostfully-review-12102728).
- **Complexity.** Reviewers call the software complex. Source: [Smoobu comparison](https://www.smoobu.com/en/comparisons/hostfully-vs-guesty/).
- **Premium features cost more.** SMS messaging needs the Pro plan. Source: [Smoobu comparison](https://www.smoobu.com/en/comparisons/hostfully-vs-guesty/).
- **Weak for mid-term rentals.** One GetApp reviewer. Source: [GetApp Hostfully reviews](https://www.getapp.com/real-estate-property-software/a/property-management-platform/reviews/).
- **Reports and multi-unit handling.** Reports need work for multi-unit properties. Source: [Capterra Hostfully reviews](https://www.capterra.com/p/187827/Cache/reviews).
- **Listing control.** Owners want to archive properties, not just delete them. Source: same.
- **Pricing is not public** (Capterra: "Contact vendor"). Source: [Capterra OwnerRez vs Hostfully](https://capterra.com/compare/100831-187827/OwnerRez-vs-Property-Management-Platform).
- **Fit for small hosts.** No evidence found of a 1-to-10-unit plan. Both products look built for larger portfolios. (Judgement from pricing and complexity, not a review quote.)

## Ideas for BalayHub

Each idea is one line on why it matters for a Filipino host with 1 to 10 units. None use integrations or AI.

- **Must: quote, then accept and pay.** Host sends a quote with price and rules; guest accepts online and pays. Saves hosts from chasing deals by chat, the biggest manual step in short-stay booking.
- **Must: rental agreement with e-sign.** A house-rules agreement the guest signs at booking. Protects hosts when a guest damages a unit; the check-in form alone does not do this.
- **Must: deposit refund and hold flow.** Clear refund after checkout and a record of any deduction. Deposits are already in BalayHub, but refunds and charges need a tracked path.
- **Must: manual payment recording with proof.** Record GCash or bank transfer payments with a reference and screenshot. Many Filipino guests still pay this way, and it is how hosts actually get paid.
- **Should: payment schedule rules per property.** For example 50% at booking and the rest before check-in. Lowers no-shows on long stays and fits the current deposit model.
- **Should: digital guidebook per property in English and Taglish.** Replaces the house-rules message guests keep asking for; Taglish matches the guest audience.
- **Should: cleaner view on phone.** Cleaners see only their jobs, with photos and confirm-done. The cleaning feature exists, but a cleaner-only view reduces mistakes.
- **Should: owner login to view statements.** Owners see their own statements and bookings without asking the manager. BalayHub already produces owner statements.
- **Should: owner self-blocking dates.** Owners block their own nights and the manager is told. Cuts double bookings from owner stays.
- **Should: deduct repairs from owner payouts.** Manager adds a repair cost to the owner's statement with a photo. Makes owner statements complete for managed units.
- **Could: booking-page builder with templates.** A simple site per host. Helpful, but a direct booking page already exists.
- **Could: guidebook upsells.** Sell late checkout or mid-stay cleaning from the guidebook. Adds income with little work.
- **Could: card hold for deposits.** Only if PayMongo supports it (unverified). Otherwise skip.
- **Could: owner expense entry with receipts.** Owners see costs against their units.
- **Could: reporting by owner and unit.** Users say multi-unit reports lag; BalayHub can be better for 1 to 10 units.

## Excluded (integrations/API/AI)

- Channel manager API connections, and Hostfully's 100+ partner integrations.
- Dynamic pricing integrations (PriceLabs, Wheelhouse).
- QuickBooks and other accounting sync.
- DropboxSign or other third-party e-sign.
- Smart-lock and gate integrations; third-party guidebook tools (RedCarpet Host) that connect through an API.
- Hostfully's AI assistant, and any AI-written guest messages or replies.
- Open or public API and integration marketplaces.

## Sources

- https://capterra.com/p/100831/OwnerRez/pricing/
- https://www.capterra.com/p/100831/OwnerRez/reviews/
- https://www.roommaster.com/blog/ownerrez-pricing
- https://toolradar.com/tools/ownerrez/pricing
- https://costbench.com/software/vacation-rental-software/ownerrez/hidden-costs/
- https://www.ownerrez.com/support/articles/why-you-should-create-quotes-instead-of-bookings
- https://www.ownerrez.com/guides/how-to-handle-rental-agreements-and-extra-fees-outside-of-airbnb
- https://ownerrez.com/forums/general-help/damage-deposit
- https://www.ownerreservations.com/support/articles/creating-a-new-quote
- https://www.ownerreservations.com/support/articles/redcarpet-host
- https://www.getapp.com/hospitality-travel-software/a/ownerrez/reviews/
- https://www.hostfully.com/pricing/
- https://www.hostfully.com/pricing/digital-guidebooks/
- https://www.hostfully.com/guides
- https://www.roommaster.com/blog/hostfully-pricing
- https://www.smoobu.com/en/comparisons/hostfully-vs-guesty/
- https://www.hostfully.com/property-management-software/features/digital-rental-agreements-digital-signatures/
- https://www.hostfully.com/property-management-platform/features/payment-processing/
- https://www.hostfully.com/property-management-software/features/owner-management/
- https://www.hostfully.com/property-management-platform/features/task-management/
- https://www.hostfully.com/blog/ownerrez-vs-uplisting/
- https://www.capterra.com/p/187827/Cache/reviews
- https://www.capterra.com/p/187827/Property-Management-Platform/reviews/?page=2
- https://www.g2.com/survey_responses/hostfully-review-12102728
- https://www.getapp.com/real-estate-property-software/a/property-management-platform/reviews/
- https://capterra.com/compare/100831-187827/OwnerRez-vs-Property-Management-Platform
- https://capterra.com/compare/100831-223111/OwnerRez-vs-Hostfully-Guidebooks
- https://www.capterra.ca/software/189151/hostfully-guidebooks
- https://zeevou.com/?p=106033
- https://truvi.com/?p=19151 (vendor-adjacent; OwnerRez integration promoter)
- https://strspecialist.com/reviews/ownerrez-pms-review-airbnb
- https://www.stork.ai/en/ownerrez
