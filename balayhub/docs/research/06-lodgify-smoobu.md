# 06. Lodgify and Smoobu: research for BalayHub

Research date: 2026-10-13. Vendor sites (lodgify.com, smoobu.com) could not be opened from this research environment (the network proxy blocked them), so almost every fact below comes from third-party review sites, comparison blogs, and vendor pages seen only as search snippets. Prices and feature lists conflict between sources. Anything marked **unverified** should be checked on the vendor site before we rely on it.

Key to the feature table: **[Both]** means both products have it. **[Lodgify]** and **[Smoobu]** mean only that product has it. **[Neither]** means no product has it, or the sources say nothing. "Not confirmed" means we found no source either way.

## 1. Summary

- **Lodgify** is a vacation rental platform. It sells a website builder, a booking engine, payments, a guest app, task management and owner statements in one product. It is aimed at hosts who want a polished direct-booking site.
- **Smoobu** is a lower-cost rental manager. Its core is channel sync (calendar and price sync with Airbnb, Booking.com and others), plus a booking engine, a simple website builder, and automated guest messages.
- **Who they serve:** both are popular with small hosts who run a few units. Lodgify is pitched as the more complete product. Smoobu is pitched as the cheaper, simpler one.
- **Market position:** Lodgify has the larger reputation and is often named as the step-up tier. Smoobu is often picked as the budget option. Reviewers say Smoobu suits small portfolios and is weaker for larger ones.
- **Ratings:** Lodgify about 4.5 on Capterra (one source). Smoobu about 4.5 on Capterra from 195 reviews.
- **Pricing:** Lodgify is priced in US dollars and Smoobu in euros. Both are monthly subscriptions, and Smoobu also takes a per-booking commission on its cheaper plan.
- **Relevance to BalayHub:** the two products sell the same things we have (calendar, direct booking, guest messages, tasks). Their biggest complaints are sync failures and price. Those are the areas where a Filipino host with 1 to 10 units could be better served.

## 2. Pricing

### Lodgify (USD, per property per month; vendor page not opened)

| Plan | Price (monthly list) | What it includes (per sources) |
|---|---|---|
| Basic | $18/mo (CostBench, Sept 2026) | Channel sync and basic tools. Booking fee reported at 1.9% by some sources. |
| Starter | $33/mo (frontdeskreview.com, Sept 2026; also CostBench) | Website builder and booking engine. Booking fee reported at 1.9% by some sources and 0% by others (conflict). |
| Professional | $53/mo (frontdeskreview.com; CostBench) | Adds more reporting and multi-property tools, per one review. No booking fee reported by some sources. |
| Ultimate | $77/mo (frontdeskreview.com) | Task management with automatic tasks at checkout, checklists and photo proof, owner reporting, guest app, priority support (Lodgify's Ultimate page, vendor claim). |
| Enterprise | Custom | 25+ properties, dedicated onboarding (one source). |

- Annual billing: about 20% off (frontdeskreview.com). Other sites list lower annual-billed figures (Starter about $16, Professional about $42, Ultimate about $103). These do not match the monthly list, so treat them as unclear.
- Older sites list Starter $13, Professional $38, Ultimate $59. Treat as out of date.
- Free trial: one source says 7 days. CostBench says there is no trial. **Unverified.**
- Hidden costs: some advanced features cost extra (one reviewer). Reviewers cite "hidden fees" in rate setup and billing (Capterra summary).

### Smoobu (EUR, per unit or property per month; sources disagree on which)

| Plan | Price (monthly list) | What it includes (per sources) |
|---|---|---|
| Professional Flex | €29/mo (Smoobu pricing page as reported in search); about €26.10/mo on yearly billing | Smoobu says Flex is Prepaid's benefits plus a **0.9% commission on every booking**. |
| Professional Prepaid | €35/mo (one source says €28/mo) | No booking commission. |
| Teams Pro+ | €55/mo per unit; €49.50/mo yearly; about €44/mo on a two-year prepaid plan | Two write-access team seats, e-invoicing, priority support (one review). |

- Extra team members: a team member with write access costs €15/mo. A read-only team member is free (Smoobu support page).
- Dynamic pricing: a paid add-on at €12.99/mo per property (one source). Another source says it is included in Teams Pro+.
- Free trial: 14 days (one source). **Unverified.**
- Some older pages show USD prices and "Professional" and "Team" names. Those do not match the current plans.

### Pricing takeaways

- Both products charge a monthly fee per unit. Smoobu's cheaper plan also takes 0.9% of each booking. Lodgify's cheaper plans may take 1.9% (sources disagree).
- Reviewers say the fee makes a small host pay more than the sticker price suggests.

## 3. Feature catalogue

| Area | Feature | What it does | BalayHub has it? (Yes / Partly / No) |
|---|---|---|---|
| Reservations | Manual booking entry | Staff add or edit a booking by hand. [Both] (general PMS feature; detail not confirmed) | Yes |
| Reservations | Saved views and filters for bookings | Filter the booking list. [Neither confirmed] | Yes |
| Reservations | Booking list from channels | Bookings that come in from Airbnb, Booking.com and others appear in one list. [Both] | Partly (iCal only, no channel API; API excluded) |
| Calendar | Multi-calendar for all units | One calendar view for many properties. [Both] (Smoobu reviewers praise calendar management) | Yes |
| Calendar | Channel calendar sync (availability) | Keeps availability matched across booking sites. [Both] (Smoobu: syncs availability and rates only; Lodgify: full property data sync per one chart) | Partly (iCal sync for six channels) |
| Calendar | Double-booking prevention | Stops two bookings on the same night. [Both] (praised in Smoobu reviews; sync delays cause it to fail in practice) | Partly |
| Calendar | Sync status and last-synced time | Shows the host when a calendar last updated. [Not confirmed] | No |
| Calendar | Minimum stay rules | Sets a minimum number of nights. [Neither confirmed] | Yes |
| Calendar | Blocks | Closes dates for owner use or repairs. [Neither confirmed] | Yes |
| Pricing | Base nightly rate | One price per night. [Both] | Yes |
| Pricing | Weekend, holiday and season rates | Different prices on set days or seasons. [Both] (Smoobu reviewers praise the rate options; Lodgify rate setup called confusing) | Yes |
| Pricing | Long-stay discounts | Lower price for longer stays. [Neither confirmed] | Yes |
| Pricing | Dynamic (automatic) pricing | Changes prices based on demand. [Lodgify: dynamic pricing tool, fee reported as 0.8% per booking by Smoobu's comparison page (vendor claim, unverified); Smoobu: paid add-on] | No |
| Pricing | Rate changes pushed to channels | Sends new prices to each booking site. [Both] (integration, excluded) | No (excluded) |
| Direct booking | Built-in booking engine | Guests book and pay on the host's own page. [Both] | Yes |
| Direct booking | Website builder (no code) | Create a booking website with templates. [Both] (Lodgify: drag-and-drop, live in hours; Smoobu: included in all plans, but reviewers say customisation is limited) | Partly (booking page only, no site builder) |
| Direct booking | Embeddable booking widget | Put a booking form on any website. [Both] (Smoobu: works with any site) | No |
| Direct booking | Custom domain | Use the host's own web address. [Lodgify: yes (one reviewer); Smoobu: not confirmed] | No |
| Direct booking | Custom CSS on booking widget | Change the look of the widget. [Smoobu] (one reviewer) | No |
| Direct booking | Cancellation policy text | Host sets the policy shown at checkout. [Both] (Smoobu: customisable text; Lodgify: cancellation policies per one review) | No |
| Direct booking | Google Vacation Rentals listing | Shows listings in Google search. [Lodgify only] (one comparison chart; Smoobu lacks it per same chart) | No |
| Payments | Card and online payments | Guest pays at booking. [Both] (Lodgify: Lodgify Payments, Stripe, PayPal; Smoobu: detail not confirmed) | Yes (PayMongo: GCash, Maya, card) |
| Payments | Deposit or full payment at booking | Guest pays part now, rest later. [Both] (Lodgify: deposit requirements and payment schedules) | Yes |
| Payments | Pay-the-balance link | Guest pays the rest through a link. [Not confirmed] | Yes |
| Payments | Discount codes | Guest enters a code at checkout. [Not confirmed] | Yes |
| Payments | Security deposit collection | Holds or takes a damage deposit. [Lodgify: no native feature found; partners (Happy Guest, Charge Automation) do it. Smoobu: not confirmed] | Yes |
| Payments | Damage protection for guests | Guest buys cover for accidental damage at checkout. [Lodgify only] | No |
| Payments | Platform booking fee | Commission on each booking. [Smoobu: 0.9% on Flex. Lodgify: 1.9% on some plans, 0% per others (conflict)] | Not applicable (BalayHub's fee model is not in this research) |
| Guest communication | Message templates | Reusable message text. [Both] (Smoobu template editor with triggers, timing, conditions and attachments; rolling out) | Yes |
| Guest communication | Scheduled and automatic messages | Sends messages at set times or on triggers. [Both] (Smoobu support article on automated messages) | Yes |
| Guest communication | Attach house rules to messages | Sends files with a message. [Smoobu] | Partly (not confirmed) |
| Guest communication | Shared inbox for all channel messages | One place for messages from each booking site. [Both] (Smoobu reviewers say channel messages sometimes fail to arrive) | Yes (email inbox) |
| Guest communication | AI message translation | Machine translation of host and guest messages. [Smoobu] | Excluded (AI) |
| Guest communication | AI reply drafting | Auto replies. [Not confirmed] | Excluded (AI) |
| Guest experience | Digital guidebook (wifi, house rules, nearby places) | Guest reads info in one place. [Lodgify: guest app with guidebooks; Smoobu: guest guide as a plan feature (third-party)] | No |
| Guest experience | Guest-facing app | Mobile app for guests. [Lodgify: yes (check-in details, guidebooks, rental agreements); Smoobu: none found] | No (BalayHub has a host app only) |
| Guest experience | Pre-arrival upsells | Offers extras before check-in. [Smoobu (one reviewer); Lodgify via partner] | No |
| Guest experience | Guest reviews of the stay | Host reads reviews from guests. [Lodgify: 5-star review push via guest app (marketing)] | Yes (guest reviews of the stay) |
| Check-in | Online check-in form | Guest fills in details before arrival. [Both] (Smoobu: online check-in as a plan feature; Lodgify: self-serve check-in) | Yes |
| Check-in | ID upload | Guest uploads a photo ID. [Lodgify via partner (Happy Guest, Chekin)] | Yes |
| Check-in | Rental agreement signing | Guest signs a rental agreement. [Lodgify via partner] | No |
| Check-in | Arrival instructions sent automatically | Sends access details before arrival. [Both] (Lodgify: via message, email or guest app) | Partly (via scheduled messages) |
| Check-in | Smart lock and access codes | Digital door codes. [Lodgify: smart locks (2025 update)] | Excluded (smart locks) |
| Operations and tasks | Task creation at checkout | Cleaning or maintenance task created when a guest leaves. [Lodgify: yes, auto-scheduled (Ultimate). Smoobu: not confirmed] | Partly (cleaning tasks exist; auto-creation not confirmed) |
| Operations and tasks | Assign tasks to staff | Give a task to a named person. [Lodgify: Ultimate; Smoobu: not confirmed] | Yes |
| Operations and tasks | Checklists with photo proof | Checklist items that need a photo. [Lodgify: Ultimate] | Yes |
| Cleaning | Cleaner backup (auto-reassign) | Sends the job to another cleaner if the first is unavailable. [Lodgify via TIDY partner] | No |
| Cleaning | Per-property cleaning to-do lists | Separate list for each unit. [Lodgify via TIDY partner] | Partly |
| Cleaning | Cleaner payments and payroll | Pays cleaners per job. [Lodgify via ResortCleaning partner] | No |
| Maintenance | Maintenance tasks | Repairs tracked as tasks. [Lodgify: task management covers cleaning and maintenance] | Partly (monthly rentals only) |
| Maintenance | Maintenance request from guest | Guest reports a fault. [Not confirmed] | No |
| Inventory | Stock and supplies tracking | Track linens and consumables. [Neither confirmed] | No |
| Owners | Owner statements | Owner gets revenue, fees, expenses and payouts. [Lodgify: recurring, custom dates, multi-property (accounting page)] | Yes |
| Owners | Owner read-only portal | Owner logs in to see their unit. [Lodgify Ultimate (one review)] | No |
| Owners | Owner and team permissions in one place | One screen to manage owners and team. [Lodgify (2025 update)] | Partly (team roles yes; owner logins no) |
| Accounting and finance | Expense tracking | Records costs per property. [Lodgify via Clearing partner] | Yes (monthly rentals) |
| Accounting and finance | Guest invoices | Sends an invoice or receipt to a guest. [Lodgify: limited (old review); Smoobu: invoicing listed as a plan feature (one summary); e-invoicing on Teams Pro+ (one review)] | No |
| Accounting and finance | Accounting software sync | Pushes bookings to Xero or QuickBooks. [Lodgify via Zapier] | Excluded (integration) |
| Accounting and finance | Yearly income and tax summary | Income report for the year. [Not confirmed] | Yes |
| Reports and analytics | Financial overview and statistics | Revenue and occupancy overview. [Smoobu (one summary); Lodgify: more reporting on Professional (one review)] | Yes (stay reports) |
| Reports and analytics | Data export | Download bookings or revenue as a file. [Smoobu: exports listed in one summary] | Partly |
| Reports and analytics | Multi-property reports | Compare units side by side. [Lodgify: Professional (one review)] | Partly |
| Team and roles | Team roles and permissions | Limit what each person can see or change. [Lodgify: sub-accounts with role-based permissions (Ultimate, one review); Smoobu: write and read-only seats] | Yes (owner, manager, staff with property scoping) |
| Team and roles | Paid seats for extra users | Each extra user costs money. [Smoobu: €15/mo per write-access user] | Not applicable |
| Team and roles | Staff shift scheduling | Plans who works when. [Neither confirmed] | No |
| Mobile | Host phone app | App to run the business from a phone. [Smoobu: iOS and Android apps (store listings); Lodgify: not confirmed] | Yes (installable app) |
| Mobile | Push notifications | Alerts on the phone. [Smoobu: reviewers say channel alerts sometimes do not arrive] | Yes |
| Reviews | Review requests after checkout | Asks the guest to leave a review. [Lodgify: marketing claim via guest app] | Partly |
| Multi-unit | Multiple units or properties | Manage many units in one account. [Smoobu: supports multi-unit (hostradar chart); Lodgify: multi-property on Professional (one review); a second chart says Lodgify does not natively support multi-unit. Conflict] | Yes (1 to 10 units) |
| Multi-unit | Owner-managed units | Units managed for other owners. [Neither confirmed] | Yes |
| Other | Free trial | Try before paying. [Lodgify: 7 days per one source, CostBench says none; Smoobu: 14 days per one source. Both unverified] | Yes (BalayHub has a free trial) |
| Other | Support hours | When live help is available. [Lodgify: 24/7 on higher plans (Conduit, unverified); Smoobu: CET business hours (Conduit)] | Not applicable (BalayHub support tickets exist) |
| Other | Dark mode and language | Interface look and language. [Neither confirmed] | Yes (dark mode; English and Taglish for guests) |

## 4. Standout features

1. **Lodgify website builder.** Hosts build a direct-booking site without code. Reviewers praise it most. Sources: https://checkthat.ai/brands/lodgify/reviews and https://www.lodgify.com/
2. **Lodgify automatic tasks at checkout.** Cleaning and maintenance tasks are created when a guest leaves, with checklists and photo proof (Ultimate plan, vendor claim). Sources: https://www.lodgify.com/ultimate-plan/ and https://www.lodgify.com/all-features/
3. **Lodgify owner statements.** Revenue, fees, expenses and payouts pulled from the platform, with recurring statements and custom dates. Source: https://www.lodgify.com/accounting/
4. **Lodgify guest app with self check-in.** Check-in details, guidebooks and rental agreements in one app. Source: https://www.lodgify.com/all-features/ and https://encyclopedia.lodgify.com/self-check-in
5. **Smoobu calendar sync that prevents double bookings.** Reviewers praise it. Source: https://capterra.com/p/160106/Smoobu/reviews/
6. **Smoobu ease of use and quick setup.** Several Capterra reviewers call it easy and quick to set up. Source: https://capterra.com/p/160106/Smoobu/reviews/
7. **Smoobu automated messages.** Template editor with triggers, timing, conditions and attached files. Users praise the editing options. Sources: https://support.smoobu.com/hc/en-us/articles/360003170840-Set-up-automated-messages-to-your-guests and https://www.softwareadvice.com/property/smoobu-profile/reviews/
8. **Smoobu low entry price.** Smoobu is repeatedly named the cheaper option for small operators. Sources: https://www.smoobu.com/en/comparisons/smoobu-vs-lodgify/ (Smoobu-published, biased) and https://hostradar.eu/en/comparisons/lodgify-smoobu-comparison/
9. **Smoobu free-to-run Prepaid plan.** The Prepaid plan has no booking commission, so the host keeps all rental income. Source: https://support.smoobu.com/hc/en-us/articles/360003170680-How-much-does-Smoobu-cost-Plans-and-pricing-explained
10. **Support praise.** Some Smoobu reviewers say support is excellent. Lodgify support is rated 8.9 out of 10 on G2 (one blog), below Hostaway's 9.5. Sources: https://capterra.com/p/160106/Smoobu/reviews/ and https://checkthat.ai/brands/lodgify/reviews

## 5. Complaints and gaps from reviews

**Lodgify**

- **Calendar sync.** Sync problems with Airbnb calendars come up often. One reviewer had to switch to iCal after the channel manager kept failing. Sources: https://checkthat.ai/brands/lodgify/reviews and https://www.capterra.com/compare/131924-183332/Lodgify-vs-Hostify
- **Bugs and unreliable updates.** Capterra's theme analysis lists recurring technical problems. One reviewer says a refund was refused for a technical issue. Source: https://www.capterra.com/p/131924/Lodgify/reviews/
- **Booking fee versus marketing.** Starter's 1.9% booking fee conflicts with the "you keep 100% of your rental income" message (one reviewer). Source: https://checkthat.ai/brands/lodgify/reviews
- **Price for small hosts.** Reviewers say it is expensive for small portfolios, and the fees hurt the most on the lowest tier. Source: https://checkthat.ai/brands/lodgify/reviews
- **Hidden fees and confusing rate setup.** Source: https://www.capterra.com/p/131924/Lodgify/reviews/
- **Annual contract auto-renewal.** One reviewer says the annual plan renewed with no warning email. Source: https://www.capterra.com/p/131924/Lodgify/reviews/
- **Support after onboarding.** Onboarding praised, support slower afterwards. Also messaging failures and reporting gaps. Source: https://checkthat.ai/brands/lodgify/reviews
- **Invoices and accounting.** Users find invoicing weak. The source is old (over 1,000 days). Source: https://www.softwareadvice.com/hotel-management/lodgify-profile/
- **Airbnb bookings with missing charges.** One reviewer says guests were added to Airbnb bookings with no charge. Source: https://www.capterra.com/p/131924/Lodgify/reviews/
- **Who leaves Lodgify.** Among 87 reviewers who left, the most common new tools were Hostaway, Guesty, Guesty Lite and OwnerRez. Source: https://www.capterra.com/p/131924/Lodgify/reviews/
- **Security deposit.** One reviewer says built-in deposit handling is limited. Source: https://staystra.com/lodgify-review-2026/ (unverified)

**Smoobu**

- **Channel message failures.** Push alerts for Airbnb and Booking.com enquiries sometimes do not reach the app, and confirmation emails do not appear in the inbox. Source: https://capterra.com/p/160106/Smoobu/reviews/
- **Integration problems.** One review says recent Airbnb and Booking.com integration changes caused major issues. Source: https://www.softwareadvice.com/property/smoobu-profile/reviews/
- **Price increases.** One reviewer says the price increases were repeated and steep. Source: https://capterra.com/p/160106/Smoobu/reviews/ (German-language review, unverified in full)
- **Slow feature development.** Some reviewers say updates have slowed in recent years. Source: https://capterra.com/p/160106/Smoobu/reviews/
- **Weaker for large portfolios.** Fewer features than rival products, and fewer third-party integrations when a host has many properties. Source: https://www.bnbcalc.com/reviews/smoobu-review (third-party blog)
- **Invoicing.** A user says recording invoices is the main weak spot. Source: https://www.softwarefinder.com/property-management-software/smoobu (unverified)
- **Sync limits.** Only availability and rates sync centrally. Property content has to be edited in each booking site. Source: https://www.getapp.com/hospitality-travel-software/a/smoobu/ (unverified)
- **Support hours.** Support runs on CET business hours. Source: https://www.conduit.ai/blog/lodgify-vs-smoobu (comparison blog)

**Both**

- **Small-host fit.** Both are priced per unit per month. Reviewers say the fee structure hurts small hosts who book through many channels. Sources: https://checkthat.ai/brands/lodgify/reviews and https://www.capterra.com/p/160106/Smoobu/reviews/

**Ratings snapshot.** Lodgify: Capterra 4.5 (about 1,311 reviews, one source); G2 about 4.2 (blog source, 65 reviews, unclear). Smoobu: Capterra 4.5 from 195 reviews (listing pages, March 2026); Trustpilot about 4.4 from 380+ reviews (May 2026 comparison site, unverified). Sources: https://www.capterra.com/p/131924/Lodgify/reviews/ and https://capterra.com/p/160106/Smoobu/reviews/

**Reddit.** No 2025 or 2026 Reddit threads on either product turned up in search. Sentiment here is thin and secondhand.

## 6. Ideas for BalayHub

Each idea is something BalayHub can build itself. Integrations, channel APIs and AI are left out (see section 7).

- **Must: Auto-create a cleaning task at checkout.** Lodgify does this on its top plan. Filipino hosts with 1 to 10 units usually assign cleaners by hand. BalayHub already has cleaning tasks and checklists, so this is a small step.
- **Must: Show sync status for each calendar.** Show the last time each iCal feed updated, and flag any feed that has failed. Sync failure is the top complaint for both products, and hosts who double-book lose money and guest trust.
- **Must: Show every fee before the guest pays.** Lodgify and Smoobu both draw complaints about fees that hosts did not expect. BalayHub should state its own fees on its pricing page in plain terms.
- **Should: Guest digital guidebook.** One page per unit with wifi, house rules, parking, gate notes and nearby food, in English and Taglish. It goes out with the check-in form. Both competitors offer one. A Filipino host with a condo unit needs the gate and building rules in one place.
- **Should: Official receipts for guests.** Lodgify's invoicing and Smoobu's invoicing both draw complaints. Filipino guests and companies often ask for a receipt. Check with an accountant which receipt format is required before building this.
- **Should: Owner portal.** A read-only page for each owner showing bookings, income and their statement. BalayHub already makes owner statements, so this is mostly access and a login.
- **Should: Cleaner pay per job.** Track what each cleaner is owed per completed task, and print a monthly summary. Lodgify does this only through a partner tool.
- **Should: Support response promise.** Both competitors draw "slow support" complaints. Publish support hours and a response target, and show them on the help center.
- **Should: Signed house rules at check-in.** The guest taps to accept house rules and signs a short rental agreement on the check-in form. Lodgify does this through a partner. BalayHub's check-in form already has ID uploads.
- **Could: Auto-fill Philippine holiday rates.** Load the national holiday calendar into the holiday rate setting so the host does not type each date. BalayHub already has holiday rates, so this is a time-saver only.
- **Could: Cancellation policy text on the booking page.** Smoobu lets hosts edit the policy text. Let each unit show its own policy at checkout.
- **Could: Google-free public listing page.** A shareable page per unit, branded to the host. Lodgify's website builder gets the most praise. A simple version is a Could, not a Must.
- **Could: Extra staff seats priced clearly.** If BalayHub charges for extra team members, show the price up front. Smoobu's per-seat charge is one of the things reviewers mention.

## 7. Excluded (integrations/API/AI)

- Channel-manager API connections (Airbnb, Booking.com and others, which is the core of both products).
- Open or public API.
- Integration marketplaces and partner integrations: Happy Guest, Chekin, Charge Automation, TIDY, ResortCleaning, Clearing.
- Smart locks and digital door codes (Lodgify, 2025).
- Accounting-software sync (Xero, QuickBooks, Wave) and Zapier.
- Google Vacation Rentals listing feed (treated as a channel connection).
- AI message translation (Smoobu) and AI reply drafting.

## 8. Sources

Pricing
- https://www.roommaster.com/blog/lodgify-pricing
- https://frontdeskreview.com/software/vacation-rental-software/lodgify/
- https://costbench.com/software/vacation-rental-software/lodgify/
- https://www.softwr.com/pricing/lodgify
- https://comparatifchannelmanager.fr/en/lodgify-pricing/
- https://toolseam.com/lodgify-pricing/
- https://www.g2.com/products/smoobu/pricing
- https://comparatifchannelmanager.fr/en/smoobu-pricing/
- https://support.smoobu.com/hc/en-us/articles/360003170680-How-much-does-Smoobu-cost-Plans-and-pricing-explained
- https://www.smoobu.com/en/pricing/ (search result only; not opened, blocked)

Lodgify features (vendor pages seen only as search snippets)
- https://www.lodgify.com/
- https://www.lodgify.com/all-features/
- https://www.lodgify.com/ultimate-plan/
- https://www.lodgify.com/professional-plan/
- https://www.lodgify.com/accounting/
- https://www.lodgify.com/blog/lodgify-tidy-partnership/
- https://www.lodgify.com/blog/lodgify-resort-cleaning-partnership/
- https://www.lodgify.com/blog/lodgify-clearing-partnership/
- https://www.lodgify.com/blog/product-updates-february-2025/
- https://www.lodgify.com/blog/happy-guest-partnership/
- https://encyclopedia.lodgify.com/self-check-in

Smoobu features
- https://support.smoobu.com/hc/en-us/articles/360003170840-Set-up-automated-messages-to-your-guests
- https://www.smoobu.com/en/guides/guest-communications/
- https://www.smoobu.com/en/comparisons/smoobu-vs-lodgify/
- https://apps.apple.com/us/app/smoobu-vacation-rental-app/id6504219001
- https://play.google.com/store/apps/details?id=com.smoobu.app

Comparisons
- https://hostradar.eu/en/comparisons/lodgify-smoobu-comparison/
- https://www.conduit.ai/blog/lodgify-vs-smoobu
- https://rentalbeam.com/blog/smoobu-vs-lodgify
- https://www.roommaster.com/alternatives/lodgify-vs-smoobu
- https://www.softwaresuggest.com/compare/lodgify-vs-smoobu

Reviews
- https://www.capterra.com/p/131924/Lodgify/reviews/
- https://checkthat.ai/brands/lodgify/reviews
- https://www.softwareadvice.com/hotel-management/lodgify-profile/
- https://staystra.com/lodgify-review-2026/
- https://thehoststack.com/lodgify-review-2026/
- https://capterra.com/p/160106/Smoobu/reviews/
- https://www.softwareadvice.com/property/smoobu-profile/reviews/
- https://www.softwarefinder.com/property-management-software/smoobu
- https://www.bnbcalc.com/reviews/smoobu-review
- https://www.getapp.com/hospitality-travel-software/a/smoobu/
- https://thehoststack.com/smoobu-review/
- https://hostradar.eu/en/reviews/smoobu/
