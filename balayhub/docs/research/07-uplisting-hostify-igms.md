# 07. Uplisting, Hostify and iGMS: research

**Research limits (read first).** The vendors' own sites (uplisting.io, hostify.com, igms.com), Reddit, Capterra, G2 and the price-tracking sites could not be opened from this session. The network policy blocks them, and the search budget ran out after about 12 searches. Everything below comes from search-result snippets and comparison pages. Where sources disagree, both figures are given. Anything marked **unverified** needs a check on the vendor's pricing page before it is relied on. No Reddit host threads were found for any of the three tools.

## Summary

- **What these are:** three vacation-rental management tools. Each runs calendar sync with Airbnb, Booking.com and Vrbo, guest messaging, cleaning tasks and direct booking pages.
- **Who they are for:** Uplisting and iGMS target independent hosts and small management companies. Hostify is described as aimed at professional hosts running many properties.
- **Market position:** all three are mid-market tools for short-term rentals in the US. None is built around Philippine payments (GCash, Maya) or local holidays.
- **Pricing model:** Uplisting charges per listing with a minimum. Hostify charges per rental with volume tiers. iGMS charges per property per month, or a small fee per booked night on its usage plan.
- **Reputation:** all three sit around 4.6 to 4.7 out of 5 on review sites, with small review counts (roughly 18 to 300 each).
- **Common complaints:** slow or confusing channel setup, messaging that is slow to send, cost that rises with scale, and limited reporting.
- **Gap for BalayHub:** none of the three offers PHP pricing, local payment methods, or Philippine holiday and peak-season rules. Their pricing is in USD and assumes US-style billing.

## Pricing

Prices are USD per month unless stated. Sources conflict on most of these figures.

| Product | Plan / unit | Price (as reported) | What it includes | Source conflict or note |
|---|---|---|---|---|
| Uplisting | Per listing | From $20 per listing per month. Minimum $100 per month for customers with fewer than 5 properties. Annual billing saves 10%. | Official support article: plan names and features not captured in the snippet. | Official article (per snippet). Confirm on the pricing page. |
| Uplisting | "Portfolio Manager" | $20 per month | Listed by PricingSaaS. Contents not captured. | PricingSaaS snippet. |
| Uplisting | "Independent Host" | $100 per month | Listed by PricingSaaS. Contents not captured. | PricingSaaS snippet. |
| Uplisting | "Premier" | Not disclosed | Listed by PricingSaaS. | PricingSaaS snippet. |
| Uplisting | Add-on: Security Deposits | $6 per month | Deposit handling. | PricingSaaS snippet. |
| Uplisting | Add-on: Client Statements + Portal | $12 per month | Owner statements and an owner portal. | PricingSaaS snippet. |
| Uplisting | Flat fee (UK source) | About £72 per month for 1 to 5 listings, about £16 per listing for 6 to 40 | Roommaster says Uplisting takes no revenue share on bookings. | Secondary source; figures are conversions. Unverified. |
| Hostify | Per rental, volume tiers | $20 (5 to 19 rentals), $16 (20 to 49), $13 (50 to 99), $10 (100 to 199), contact sales (200+) | Full PMS and channel manager. | PricingSaaS snippet. |
| Hostify | Annual, under 5 properties | $83.33 per month (annual) | Same features as the tiers above. | PricingSaaS snippet. |
| Hostify | Plan count | Five plans (Capterra) or six plans (PricingSaaS) | Free trial, credit card required (Capterra). No free plan. | Sources disagree on count. Another directory says about $10 to $20 per month. Unverified. |
| iGMS | Flex | $20 per property per month (Toolradar and Capterra); usage-based at $1 (PricingSaaS); $1 per booked night with a $20 per property monthly minimum (G2) | Basic channel sync and messaging (see feature table). | Sources disagree. |
| iGMS | Pro | $13 per month (Capterra); $21 per property (Toolradar); $48 per month (PricingSaaS); custom quote (CostBench) | Adds automated reviews, cleaning and task management, direct booking tools, financial reports, and owner portal (Toolradar). | Sources disagree. |
| iGMS | Pro+ | $16 per month (Capterra); $21 per property (Toolradar); $69 per month (PricingSaaS) | Adds auto-translation, white-label, open API, cash-flow report, revenue management (Capterra). | Open API is excluded for BalayHub. |
| iGMS | Free trial | Free 14-day trial (G2) | Trial access. | G2 snippet. |
| iGMS | Price change claim | Single source (CostBench changelog) says the top tier went from $21 to $56 per property per month on 28 September 2026. | Not confirmed. | **Unverified.** Only one source. |

Pricing takeaway: at 5 units, a host pays roughly $100 per month on Uplisting, roughly $100 on Hostify (5 x $20), and roughly $100 on iGMS Flex (5 x $20). The price per unit falls as the count rises on Hostify, but not on iGMS.

## Feature catalogue

The product name in brackets shows which tool has the feature. "Unverified" means the feature was named by one source only, or only in a vendor comparison.

| Area | Feature | What it does | BalayHub has it? (Yes / Partly / No) |
|---|---|---|---|
| Reservations | Central reservation list (Uplisting, Hostify, iGMS) | One list of all bookings from every channel. | Yes |
| Reservations | Unified messaging (Uplisting) | Guest messages from all channels in one inbox. | Yes |
| Calendar | Multi-calendar iCal sync (Uplisting, Hostify, iGMS) | Two-way sync with Airbnb, Booking.com, Vrbo and Expedia. | Yes (iCal one-way per calendar; check two-way) |
| Calendar | Real-time channel manager (Hostify, Uplisting, iGMS) | Live sync of availability and rates to channels. | Partly (iCal, not live API) |
| Calendar | Unlimited listings (Uplisting) | No cap on the number of listings. | Yes |
| Pricing | Nightly, weekend, holiday and season rates (BalayHub) | Rate rules per listing. | Yes |
| Pricing | Long-stay discounts (BalayHub) | Discount for longer stays. | Yes |
| Pricing | Rate management across channels (Hostify) | Push rates to all channels from one place. | Partly (rates are set in BalayHub; channel push is not in scope) |
| Pricing | Dynamic / revenue management (Uplisting: no native dynamic pricing per one review; iGMS Pro+, Hostify rates management) | Rates change automatically with demand. | No |
| Pricing | Minimum stay and blocks (BalayHub) | Set minimum nights and block dates. | Yes |
| Direct booking | Direct booking website (Uplisting, iGMS) | A public booking site for the host. | Partly (direct booking page, not a full site builder) |
| Direct booking | Website builder (iGMS, Pro) | Build a branded site for direct bookings. | No |
| Direct booking | Payments through PayMongo (BalayHub) | GCash, Maya and card payments; full or deposit. | Yes (Hostify, Uplisting, iGMS: US payment methods only in the sources read; unverified) |
| Payments | Payment automation (Hostify) | Automatic payment requests. | Partly (pay-balance links) |
| Payments | Discount codes (BalayHub) | Codes for direct bookings. | Yes |
| Payments | Security deposit (Uplisting add-on, $6/month; BalayHub) | Hold and release a deposit. | Yes |
| Guest communication | Templates (all three; iGMS and Uplisting) | Canned replies. | Yes |
| Guest communication | Scheduled and automatic messages (Uplisting, iGMS) | Messages sent at set times or on set events. | Yes |
| Guest communication | AI reply drafts or AI-driven replies (iGMS, Toolradar) | AI writes replies. | Excluded (AI) |
| Guest communication | Auto-translation (iGMS Pro+) | Machine translation of messages. | Excluded (likely AI; unverified) |
| Guest experience | Guest profiles with VIP and do-not-rebook (BalayHub) | Guest history tags. | Yes |
| Guest experience | Guest reviews of the stay (BalayHub) | Host reviews guest and guest reviews stay. | Yes |
| Guest experience | Automated review requests (iGMS Pro, unverified) | Asks guests for reviews after checkout. | No (unverified) |
| Check-in | Guest check-in form with ID upload (BalayHub; check-in instructions on Hostify) | Form and ID upload before arrival. | Yes |
| Check-in | Check-in instructions sent automatically (Hostify) | Sends door and arrival instructions. | Partly (inbox templates; not confirmed as automatic) |
| Operations | Cleaning tasks and checklists with photos (BalayHub; Hostify, iGMS Pro) | Staff tasks per stay, photo proof. | Yes |
| Operations | Cleaning schedule automation (iGMS, per Smoobu's Reddit-theme summary; unverified) | Creates cleaning jobs from bookings. | Partly (tasks exist; auto-creation unverified) |
| Operations | Task management (iGMS Pro) | General to-dos for the team. | Partly (cleaning tasks only) |
| Maintenance | Maintenance requests (Monthly rentals in BalayHub) | Repair tracking. | Partly (monthly rentals only, not short-stay) |
| Inventory | Inventory and supplies tracking (not confirmed in any source read) | Stock levels for linen and consumables. | No (unverified for all three) |
| Owners | Owner statements (BalayHub) | Statement per owner for units they own. | Yes |
| Owners | Owner portal (Uplisting add-on, $12/month; iGMS Pro) | Owners log in to see their own bookings and money. | No |
| Accounting | Financial reports (iGMS Pro) | Income and expense reports. | Partly (yearly income and tax summary) |
| Accounting | Cash-flow report (iGMS Pro+) | Money in and out over time. | No |
| Accounting | Accounting-software sync (none named in sources) | Sends data to an accounting tool. | Excluded (integration) |
| Reports | Stay reports (BalayHub) | Per-stay report. | Yes |
| Reports | Basic reporting (Uplisting, per one review site) | Simple booking reports. | Yes |
| Team | Team roles with property scoping (BalayHub) | Owner, manager and staff access. | Yes |
| Team | Staff scheduling (not confirmed in any source read) | Shift or job scheduling. | No (unverified) |
| Mobile | Mobile app (Uplisting: none per one review site; Hostify and iGMS: unverified) | Phone app for hosts. | Yes (installable app, push notifications) |
| Mobile | Push notifications (BalayHub) | Alerts on the phone. | Yes |
| Reviews | Automated review collection (iGMS Pro, unverified) | See above. | No (unverified) |
| Multi-unit | Multi-property management (all three) | One login for many units. | Yes |
| Multi-unit | Lock-in and plan minimums (iGMS vendor claim; Uplisting minimum $100) | Pricing minimums for small accounts. | Not a feature; note only |
| Setup | Demo required before sign-up (Hostify, per iGMS's own comparison page; vendor-biased) | Sales call before buying. | Not a feature; note only |
| Setup | Free trial (iGMS 14 days; Hostify with card) | Trial before paying. | Partly (plans with a free trial, per BalayHub plans) |
| Integrations | Smart-lock integration (none named) | Remote door codes. | Excluded (integration) |

## Standout features

Each item is what users praise, from snippets. Confidence is noted.

1. **Automation of daily tasks (iGMS).** iGMS says it automates up to 90% of daily hosting tasks. This is a vendor claim. Source: [Capterra iGMS pricing snippet](https://www.capterra.com/p/157033/iGMS/pricing/) and [Toolradar iGMS pricing](https://toolradar.com/tools/igms/pricing).
2. **Real-time channel sync (Hostify).** One SaaSHub reviewer called the channel manager "really good" and said it connects to Airbnb, Booking and others in real time. Source: [SaaSHub Hostify vs iGMS](https://www.saashub.com/compare-hostify-vs-igms).
3. **Feature direction (Hostify).** G2 reviewers rated Hostify higher for meeting business needs and for where the product is going. Source: [G2 Hostify vs iGMS](https://www.g2.com/compare/hostify-vs-igms-formerly-airgms).
4. **Product support (iGMS).** G2 reviewers rated iGMS higher for ongoing product support. Source: [G2 Hostify vs iGMS](https://www.g2.com/compare/hostify-vs-igms-formerly-airgms).
5. **All-in-one with cleaning and check-in (Hostify).** Software Advice describes payment automation, rate management, guest communication, cleaning tasks and check-in instructions in one tool. Source: [Software Advice Hostify](https://www.softwareadvice.com/hotel-management/hostify-profile).
6. **Unlimited listings and unified messaging (Uplisting).** One review site describes unlimited listings, unified messaging, multi-calendar sync, automated guest messaging and direct booking sites. Source: [strspecialist Uplisting review](https://strspecialist.com/reviews/uplisting-pms-review-airbnb) (snippet).
7. **Automation of Airbnb and Vrbo tasks (Uplisting).** A Capterra owner said they can automate almost every part of the Airbnb and Vrbo process. Source: [Capterra Uplisting reviews](https://www.capterra.com/p/154137/Uplisting/reviews/).
8. **Calendar view and templates (iGMS).** A Capterra host praised the calendar view and message templates (2017 review, dated). Source: [G2 Hostify vs iGMS](https://www.g2.com/compare/hostify-vs-igms-formerly-airgms) (summary of Capterra reviews).

## Complaints and gaps from reviews

- **Price rises with scale (iGMS, Hostify).** Smoobu, a competitor, says users find iGMS's pay-as-you-go model can get expensive as a business grows. Source: [Smoobu iGMS vs Lodgify](https://www.smoobu.com/en/comparisons/igms-vs-lodgify/) (competitor; treat with care).
- **Channel setup problems (iGMS).** Smoobu says users often point to problems with the first channel connections. Source: [Smoobu iGMS vs Hostaway](https://www.smoobu.com/es/comparisons/igms-vs-hostaway/) (competitor; treat with care).
- **Slow messages and unclear rate updates (iGMS).** A Capterra host said messages were slow to send and that nightly rate updates after date changes were unclear. These are 2017 reviews and may be out of date. Source: [G2 Hostify vs iGMS](https://www.g2.com/compare/hostify-vs-igms-formerly-airgms) (summary).
- **Messaging not full-featured (Uplisting).** A Capterra reviewer said the messaging app was not very full-featured until recent releases, and says it has improved. Source: [Capterra Uplisting reviews](https://www.capterra.com/p/154137/Uplisting/reviews/).
- **No dynamic pricing and basic reports (Uplisting).** One review site says Uplisting has no native dynamic pricing and only basic reporting. Source: [strspecialist Uplisting review](https://strspecialist.com/reviews/uplisting-pms-review-airbnb) (single source; unverified).
- **No mobile app (Uplisting).** The same review says there is no native app and hosts use the mobile browser. Single source; unverified.
- **Demo required and annual lock-in for small accounts (Hostify, per iGMS).** iGMS's comparison page says every Hostify plan requires a demo and that under 5 properties means an annual plan with no monthly option. This comes from a rival's page. Source: [iGMS vs Hostify](https://www.igms.com/igms-vs-hostify/).
- **Support (Hostify).** G2 reviewers preferred iGMS for ongoing support. Source: [G2 Hostify vs iGMS](https://www.g2.com/compare/hostify-vs-igms-formerly-airgms).
- **Small review base.** Hostify has 18 G2 reviews and about 68 Capterra reviews. Ratings may not be stable. Sources: G2 and Capterra snippets.
- **Pricing confusion.** Sources disagree on plan names, counts and prices for all three. Hosts cannot easily tell the real monthly cost. This is the main complaint a Filipino host would face.
- **Fit for small hosts.** Uplisting's $100 minimum and iGMS's $20 per property minimum both cost more than a 1-to-3-unit host can easily pay in a slow month. Hostify's list price for 5 units ($20 each) is the same $100. These are computed figures from the list prices above.
- **Reddit.** No Reddit host threads were found in this research. Smoobu's summary of Reddit themes is a second-hand source (unverified).

## Ideas for BalayHub

- **Must: Fast-sending guest messages.** Competitors get complaints about slow sends. A Filipino host with 1 to 10 units messages guests many times a day. Keep sends instant.
- **Must: Peso pricing with a clear, low monthly cost for 1 to 3 units.** Competitors start at $100 per month or $20 per unit. A small host needs a cheap entry tier in pesos.
- **Must: Clear, simple channel setup with a checklist.** iGMS and others get complaints about first connections. A step-by-step iCal setup guide reduces support calls.
- **Should: Owner portal for owners of managed units.** Uplisting charges $12 per month for an owner portal. BalayHub already has owner statements, so a free portal adds value for condo owners.
- **Should: Automatic cleaning jobs from bookings.** Competitors offer this. BalayHub has cleaning tasks, so link them to each checkout for less manual work.
- **Should: Automated review request after checkout.** Competitors mention it. A nudge to guests after checkout helps a host grow listing reviews.
- **Should: Basic cash-flow view.** iGMS Pro+ offers it. BalayHub's yearly summary can show month-by-month income and expenses for the host's tax and cash needs.
- **Could: Philippine holiday and peak-season rate rules.** Rate rules for Holy Week, Christmas, New Year and long weekends are not in any competitor here. Rule-based, not AI.
- **Could: Simple branded direct-booking site.** iGMS offers a site builder. BalayHub's direct booking page could get a host-branded header and link for a small host.
- **Could: Staff scheduling.** Not found in any competitor read. Check with the founder before building.

## Excluded (integrations/API/AI)

- Open API and white-label API access (iGMS Pro+).
- AI-driven guest replies and AI reply drafts (iGMS).
- Auto-translation, which is likely AI (iGMS Pro+; unverified).
- Channel-manager API connections and live channel push (Hostify, Uplisting, iGMS).
- Smart-lock integration (not named in sources).
- Accounting-software sync (not named in sources).
- Integration marketplaces (not named in sources).

## Sources

- [Uplisting Pricing 2026: Plans, Real Costs, and Is It Worth It?](https://www.roommaster.com/blog/uplisting-pricing)
- [Uplisting Pricing Plans & History (2026), PricingSaaS](https://pricingsaas.com/companies/uplisting)
- [Uplisting support: Uplisting pricing](https://support.uplisting.io/en/article/uplisting-pricing-1oqujdi/)
- [Uplisting Pricing and Plans, SoftwareSuggest](https://www.softwaresuggest.com/uplisting/pricing)
- [Uplisting Review: Property Management Software for Airbnb Hosts (2025), strspecialist](https://strspecialist.com/reviews/uplisting-pms-review-airbnb)
- [Uplisting Reviews 2026, Capterra](https://www.capterra.com/p/154137/Uplisting/reviews/)
- [Uplisting Review, bnbcalc (affiliate-style; less neutral)](https://bnbcalc.com/reviews/uplisting-review)
- [Hostify Pricing Plans & History (2026), PricingSaaS](https://pricingsaas.com/companies/hostify)
- [Hostify Pricing 2026, Capterra](https://www.capterra.com/p/183332/Hostify/pricing/)
- [Hostify Software Pricing, Alternatives & More 2026, Capterra](https://capterra.com/p/183332/Hostify/)
- [Hostify Software Reviews, Demo & Pricing 2026, Software Advice](https://www.softwareadvice.com/hotel-management/hostify-profile)
- [Hostify on GetApp](https://www.getapp.com/hospitality-travel-software/a/hostify)
- [iGMS Pricing 2026, Capterra](https://www.capterra.com/p/157033/iGMS/pricing/)
- [iGMS Pricing Plans & History (2026), PricingSaaS](https://pricingsaas.com/companies/igms)
- [iGMS pricing, Toolradar](https://toolradar.com/tools/igms/pricing)
- [iGMS pricing, ITQlick](https://www.itqlick.com/igms/pricing)
- [All iGMS Plans & Pricing, CostBench](https://costbench.com/software/vacation-rental-software/igms/)
- [iGMS Pricing Change, September 2026, CostBench (single source; unverified)](https://costbench.com/changelog/igms-price-increase-2026-09/)
- [iGMS on GetApp](https://www.getapp.com/hospitality-travel-software/a/igms/)
- [iGMS profile, Software Advice](https://www.softwareadvice.com/vacation-rental/airgms-profile/)
- [iGMS vs Hostify (vendor comparison; biased)](https://www.igms.com/igms-vs-hostify/)
- [Compare Hostify and iGMS, G2](https://www.g2.com/compare/hostify-vs-igms-formerly-airgms)
- [iGMS Reviews 2026, Capterra](https://capterra.com/p/157033/iGMS/reviews/?page=9)
- [Hostify vs iGMS, SaaSHub](https://www.saashub.com/compare-hostify-vs-igms)
- [iGMS vs Hostify, Software Advice AU](https://www.softwareadvice.com.au/compare/33682/213178/airgms/vs/hostify)
- [iGMS vs Lodgify, Smoobu (competitor)](https://www.smoobu.com/en/comparisons/igms-vs-lodgify/)
- [iGMS vs Hostaway, Smoobu (competitor)](https://www.smoobu.com/es/comparisons/igms-vs-hostaway/)
- [Hostaway, iGMS and OwnerRez comparison, G2](https://www.g2.com/compare/hostaway-vs-igms-formerly-airgms-vs-ownerrez)
