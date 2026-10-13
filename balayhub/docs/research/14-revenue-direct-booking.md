# Research 14: Revenue management and direct booking

Date: 2026-10-13. Scope: features BalayHub could build itself, with no third-party data feeds and no AI.

## 1. Summary

- Revenue tools (Guesty PriceOptimizer, Hostaway Dynamic Pricing, PriceLabs, Beyond, Wheelhouse) mostly do two jobs: change nightly prices by date, and fill short gaps between bookings.
- Most of their useful rules are simple. Many can run on a host's own calendar and bookings, with no market data: lead-time discounts, far-out premiums, gap rules, length-of-stay discounts and event bumps.
- BalayHub already has the basics: seasons, weekend and holiday rates, weekly and monthly discounts, minimum nights, a direct booking page, deposits and discount codes.
- The biggest gaps are lead-time pricing, gap filling, rate plans (refund terms as a price choice), packages, gift cards, and follow-up for unpaid checkouts.
- Dynamic (occupancy-based) pricing is listed as out of scope in PRD.MD. Building a rule-based version would change that scope, so the founder must decide it.
- Research limit: the web search budget ran out partway through. Gift cards, abandoned-booking tools, current prices, and host complaints from Reddit were only partly checked or not checked. Those points are marked "unverified" below.

## 2. Pricing

Vendor prices were not confirmed in this run.

| Tool | Plans and prices | Note |
|---|---|---|
| Guesty PriceOptimizer | Not verified | Sold as an add-on to the Guesty PMS. Sources: https://help.guesty.com/hc/en-gb/articles/14518163143965 |
| Hostaway Dynamic Pricing | Not verified | Help centre describes the feature, not the price. Sources: https://support.hostaway.com/hc/en-us/articles/27337257958939-Dynamic-Pricing-FAQs |
| PriceLabs | Not verified | Listed as a per-listing tool in comparison pages only. |
| Beyond | Not verified | No price found. |
| Wheelhouse | Not verified | No price found. |
| Lodgify (direct booking PMS, for comparison) | Unverified: one comparison page quotes per-unit pricing from about £10 per unit for 1–10 units, falling to about £2 per unit at 300+ units. A competitor page says it adds a 1.9% booking fee. | Both come from vendor comparison pages (Hospitable, Lodgify). Check Lodgify's own pricing page. Source: https://hospitable.com/lodgify-vs-hostaway |

Price takeaway for BalayHub: the tools are priced per listing or per unit. A 1–10 unit host pays for every unit. Confirm real prices before any pricing claim goes to customers.

## 3. Feature catalogue

Legend for "BalayHub has it?": Yes, Partly, No. Rows marked "Excluded" are not recommended.

| Area | Feature | What it does | BalayHub has it? (Yes / Partly / No) |
|---|---|---|---|
| Pricing | Occupancy-based (demand) pricing | Changes the rate by how full the calendar is at each lead time. Guesty's example: if occupancy is 20% or lower in the 0–15 days before check-in, the rate drops 15%. Prices stay inside the host's min and max. Source: https://help.guesty.com/hc/en-gb/articles/14518163143965 | No (PRD.MD lists dynamic pricing as out of scope) |
| Pricing | Last-minute discount | Lower price for bookings made within a set number of days. Hostaway's built-in rules: -10% within 21 days, -15% within 14 days. Source: https://support.hostaway.com/hc/en-us/articles/26198234370331-Dynamic-Pricing-Interactive-Demo-Setup-guide | No |
| Pricing | Far-out premium | Higher price for dates 6 to 11 months ahead. Hostaway's built-in rules: +10% at 180 days, +15% at 240, +25% at 330. PriceLabs advises turning this off for monthly planners. Sources: the Hostaway demo guide above; https://hello.pricelabs.co/blog/extended-stay-pricing/ | No |
| Pricing | Lead-time rules (general) | One rule set by days before check-in, applied to a date range. Covers both last-minute and far-out. | No |
| Pricing | Orphan-night (gap) filling | Short gaps between bookings get a lower price or a shorter minimum stay. PriceLabs applies 20% off gaps of 2 nights or less by default. Source: https://help.pricelabs.co/portal/en/kb/articles/preventing-gaps | No |
| Pricing | Gap minimum-stay rule | A gap of 1–3 nights can take a minimum stay equal to its length. A 1-night gap is always 1 night. PriceLabs's "Length of Gap" setting. Source: https://help.pricelabs.co/portal/kb/articles/understanding-min-nights | No |
| Pricing | Adjacent-day minimum stay | Stops small gaps from forming after a booking. PriceLabs uses it, with gap rules winning when they conflict. Source: https://help.pricelabs.co/portal/en/kb/articles/preventing-gaps | No |
| Pricing | Length-of-stay discount (weekly, monthly) | Lower nightly rate for 7+ nights and 28+ nights. Common ranges: 10–20% weekly, 25–40% monthly (vendor guides). Source: https://encyclopedia.lodgify.com/length-of-stay-discount | Yes (weekly 7+, monthly 28+; PRD.MD F6) |
| Pricing | Length-of-stay tiers | Separate discounts for 7–13, 14–27 and 28+ nights, varied by season. PriceLabs recommends this. Source: https://hello.pricelabs.co/blog/how-to-get-longer-vacation-rental-stays/ | Partly (two fixed tiers, not three) |
| Pricing | Discount stacking control | Sets which discounts apply together. OwnerRez warns that all matching discounts stack. Source: https://ownerrez.com/support/articles/length-of-stay-discounts | Unverified (not checked in code) |
| Pricing | Event pricing (known events) | Raises rates near a known event. PriceLabs adds a price factor within a radius of the venue. Source: https://help.pricelabs.co/portal/en/kb/articles/how-pricelabs-handles-event-pricing | Partly (date-range seasons with their own rate; no event list or radius) |
| Pricing | Date-specific override | Set a rate or minimum stay for named dates only, leaving the season alone. PriceLabs has it. Source: https://help.pricelabs.co/portal/en/kb/articles/events-holidays-and-high-demand-dates | Partly (seasons are date ranges; no single-date override noted) |
| Pricing | Surge detection from booking activity | Raises price when bookings in the area spike. PriceLabs's "Hyper Local Pulse" uses market data. | Excluded (market data) |
| Pricing | Holiday rates | Higher rate for holiday long weekends. | Yes (PH holiday list, next 12 months; PRD.MD F6) |
| Pricing | Weekend rate | Higher rate for Friday and Saturday nights. | Yes |
| Pricing | Minimum-stay rules | Minimum nights by listing, season, blocks. | Yes for listing, season, blocks. Partly for weekday or gap rules (none). |
| Pricing | Minimum-stay by weekday or time window | Different minimum nights by day of week. Guesty and PriceLabs both have it. | No |
| Pricing | Price floor and ceiling | Demand rules cannot push a rate below or above set limits. Guesty has it. Source: https://help.guesty.com/hc/en-gb/articles/14518163143965 | No |
| Pricing | Base price suggestion | Suggests a base rate from market averages. | Excluded (market data) |
| Pricing | Rate plans | Same unit sold under different terms, e.g. a refundable rate and a non-refundable rate with a price multiplier (Guesty example: x1.05). Source: https://help.guesty.com/hc/en-gb/articles/34324636161693 | No |
| Pricing | Non-refundable discount | Lower price for a non-refundable booking, offered up to 60 days before check-in (Guesty). Source: https://help.guesty.com/hc/en-gb/articles/9361709068061 | No |
| Pricing | Calendar preview before going live | Preview suggested prices for 30 days before turning a tool on. Hostaway has it. Source: the Hostaway FAQ above | No |
| Pricing | Price revert on disconnect | When a tool is turned off, prices go back to what they were. Hostaway has it. | No (no tool to switch off) |
| Direct booking | Booking page (own site) | Hosted page listing units with photos, prices and a calendar. | Yes (PRD.MD, direct booking page) |
| Direct booking | Website builder (drag and drop) | Lets owners design their own site with templates. Hostaway, Guesty and Lodgify offer it. | Partly (owner sets slug, welcome text, photos; no layout builder) |
| Direct booking | Multi-property search | One search across all units and properties by dates and guests. | Partly (guest page lists every listing; no date-first search noted) |
| Direct booking | Booking flow (dates first, then price, then pay) | Guest picks dates, sees a price summary, then pays. | Yes (APP-FLOW.MD, 7.x direct booking) |
| Direct booking | Hold dates during payment | Dates are held while the guest pays. | Yes (30 minutes) |
| Direct booking | Discount codes | Percent or peso off, valid dates, minimum nights, max uses, returning guests only. | Yes (PRD.MD F17) |
| Direct booking | One code per stay | Only one coupon per reservation (CraftedStays on Hostaway). | Unverified |
| Direct booking | Returning-guest coupon after checkout | Sends a code after the stay to bring the guest back. Guesty suggests it. Source: https://help.guesty.com/hc/en-gb/articles/9365886890653 | Partly (returning-guest codes exist; not sent automatically after checkout) |
| Direct booking | Promotion pop-ups and banners | Pop-ups and banners that show a live offer on the site. Guesty and Hostaway have them. Source: https://www.hostaway.com/features/marketing.md | No |
| Direct booking | Packages and add-ons | Bundles or extras sold at booking (early check-in, late checkout, airport pickup, extra guest). Hostaway's upsell tool was in beta. Source: https://travolution.com/news/travel-sectors/accommodation/hostaways-new-tool-generates-250-additional-revenue-per-reservation-for-property-managers | No |
| Direct booking | Gift cards | Prepaid value codes a guest can buy and redeem. Only found as a third-party add-on for Lodgify. Source: https://integrately.com/integrations/gift-up/lodgify | No. Native gift cards not verified on any major tool. |
| Direct booking | Abandoned-booking follow-up | Message guests who started checkout but did not pay. Third-party tools (CartStack) exist for hotels. Source: https://www.cartstack.com/blog/?p=2165 | No (BalayHub's background check only catches paid checkouts that never returned to the page) |
| Direct booking | Payment options (full, deposit, guest's choice) | Guest pays in full or 50% upfront. | Yes (PRD.MD, direct booking page) |
| Direct booking | Balance due date | Date by which the balance must be paid. | Yes (balance due days per listing) |
| Direct booking | Pay-the-balance links | Link the guest uses to pay the rest. | Yes (PRD.MD, pay balance links) |
| Direct booking | Installment schedule | Several payments on set dates. Hospitable offers installments and grace periods for failed payments. Source: https://help.hospitable.com/en/articles/14851555-booking-policies-for-direct-bookings | No |
| Direct booking | Deposit at booking as a set amount or nights | Deposit set as percent, flat amount or number of nights. Source: https://www.hospitalitynet.org/news/4098487.html | Partly (50% only) |
| Direct booking | Cancellation policy with refund tiers | Refund percentage depends on days before check-in. Hospitable and SiteMinder have it. Sources: https://help.hospitable.com/en/articles/14851555-booking-policies-for-direct-bookings and https://help-platform.siteminder.com/en/articles/9355775-set-up-cancellation-and-payment-policies-for-direct-booking-rates-in-multi-property | No (cancel is a manual action with a reason) |
| Direct booking | Non-refundable payment capture | Full payout taken at booking for a non-refundable rate. Guesty recommends auto-charging it. | No |
| Direct booking | Guarantee options (card on file, full prepay) | Choose how the stay is secured. SiteMinder lists options from no card to full prepayment. | No (deposit and full payment only) |
| Direct booking | SEO for the booking page | Location keywords, property page length, schema markup. Sources: https://hostaway.com/blog/seo-tips-for-direct-bookings and https://www.wander.com/article/vacation-rental-seo | No (listing pages are hash routes, `#/book/<slug>`; search engines may not index each listing separately. Unverified, check with a search console test.) |
| Direct booking | Social-media booking link | A link in bio or a post that opens the booking page. | Partly (the booking page has a URL; no per-listing share link or source tracking) |
| Direct booking | Google Vacation Rentals listing | Google shows listings that link to the host's own booking page, via a connected channel. | Excluded (needs a channel or booking-site integration). Source: https://www.hostfully.com/blog/google-for-hosts-managers/ |
| Direct booking | Best-rate guarantee | Promises the lowest price for booking direct. A common conversion tactic in vendor guides. | No |
| Direct booking | Direct-booking commission saving | Keeps the OTA fee on direct bookings. Vendor blogs say OTA commissions run around 10–30% (unverified figure). | Yes (direct bookings have no OTA fee; the channel fee field tracks fees on channel bookings) |
| KPIs | ADR (average daily rate) | Revenue divided by booked nights. | Yes (Performance tab, average nightly rate; PRD.MD) |
| KPIs | RevPAR | Revenue per available night (occupancy times ADR). | Yes (Performance tab; PRD.MD) |
| KPIs | Occupancy | Booked nights divided by available nights. | Yes (Performance tab). Formula not verified in code. |
| KPIs | Adjusted occupancy (owner and hold nights) | Counts owner nights as sold and removes hold nights from the total. Big Sky pacing reports use this. Source: https://www.keydatadashboard.com/blog/vacation-rental-analytics | No |
| KPIs | Pacing | Compares bookings on hand for future dates against the same point last year. Warns of slow periods. Source: https://www.keydatadashboard.com/blog/vacation-rental-kpis | No |
| KPIs | Booking window | Average days from booking to check-in. Source: https://www.keydatadashboard.com/blog/the-kpi-dictionary-understanding-short-term-rental-data-and-how-to-use-it | No (data exists in reservation dates; not reported) |
| KPIs | Average length of stay | Average nights per booking. | No (not reported; data exists) |
| KPIs | Revenue by channel | Revenue split by Airbnb, Booking.com and others. | Yes (PRD.MD Performance tab) |
| KPIs | Competitor-rate view | Shows nearby listings' prices. | Excluded (needs market data) |
| KPIs | Market demand index | Shows market-wide occupancy and events. | Excluded (needs market data) |

## 4. Standout features

These are the features tools are known for. Source notes are in the table above.

1. **Gap filling with a minimum-stay rule.** PriceLabs and Guesty both do it. It stops a 2-night hole from going empty. Sources: https://help.pricelabs.co/portal/en/kb/articles/preventing-gaps ; https://help.guesty.com/hc/en-gb/articles/14518163143965
2. **Lead-time pricing with fixed rules.** Hostaway shows its rules in plain numbers (-15% at 14 days, +25% at 330 days). Hosts can see what the tool will do. Source: https://support.hostaway.com/hc/en-us/articles/26198234370331-Dynamic-Pricing-Interactive-Demo-Setup-guide
3. **A preview before turning on pricing.** Hostaway shows 30 days of suggested prices first. Source: the Hostaway FAQ above.
4. **Length-of-stay tiers.** Separate discounts for 7–13, 14–27 and 28+ nights, set per season. Source: https://help.pricelabs.co/portal/fr/kb/articles/weekly-monthly-discount
5. **Event dates handled by a team plus a recurring-event check.** PriceLabs keeps an events list and drops one-off events from next year's baseline. Source: https://help.pricelabs.co/portal/en/kb/articles/events-holidays-and-high-demand-dates
6. **One place for direct-booking payments, deposits and balance links.** Hospitable lets hosts take full payment, installments and set grace periods. Source: https://help.hospitable.com/en/articles/14851555-booking-policies-for-direct-bookings
7. **Non-refundable rates with a price premium.** Guesty and SiteMinder let hosts sell a cheaper non-refundable rate with clear terms. Source: https://help.guesty.com/hc/en-gb/articles/9361709068061
8. **Promo codes tied to guest history.** Guesty suggests a "Returning Guest" code after checkout. Source: https://www.guesty.com/coupon-codes-for-booking-website/
9. **Pop-ups and banners on the booking site.** Hostaway bundles them with promo codes and lead capture. Source: https://www.hostaway.com/features/marketing.md
10. **Google listing from the booking site.** Hosts with a direct site can switch on a Google listing without a separate feed. Source: https://help.hospitable.com/en/articles/8010699-google-vacation-rentals (Excluded for BalayHub; listed here because users value it.)

## 5. Complaints and gaps from reviews

Review-site and Reddit searches returned little host-written text in this run. The points below come from vendor help pages, comparison blogs and one review. Treat them as leads, not proof.

- **Limited customisation (small booking sites).** One reviewer says Hostfully's direct booking site has very few customisation options, and its site must be run through Hostfully. Source: https://www.hostfully.com/?p=51580 (comparison page, vendor-written)
- **Basic website builder.** Hostaway's builder is described as having fewer templates than Lodgify's. Source: https://www.lodgify.com/comparisons/lodgify-vs-hostaway/ (vendor-written)
- **Pricing tools lack control.** A review says Wheelhouse has less customisation than other tools. Another says Beyond gives less granular control than PriceLabs. Source: https://www.bnbcalc.com/pt/reviews/wheelhouse-pricing-review ; https://bnbcalc.com/reviews/the-best-dynamic-pricing-tools-for-airbnb
- **Gaps in far-out rules.** A third-party comparison says Beyond does not change minimum stays automatically for far-out bookings, nor set separate weekday and weekend minimums. Source: https://zeevou.com/compare/beyond-vs-wheelhouse/ (third-party, unverified against Beyond's current product)
- **Minimum stays can block gap filling.** A PriceLabs training video warns that a long far-out minimum stay can leave a 3-night gap unbookable if the gap rule only covers 1- and 2-night gaps. Source: https://pricelabs.portal.trainn.co/videos/y3Jh1baOhViJ7YuNKynt7A
- **Rate strategies overwritten.** Guesty warns that PriceOptimizer overwrites rate strategies when data updates every 24 hours. Source: https://help.guesty.com/hc/en-gb/articles/14518163143965
- **Calendar mismatch.** Hostaway's live dynamic calendar and its daily main calendar can show different prices. Source: https://support.hostaway.com/hc/en-us/articles/26714000417051-Dynamic-Pricing-Calendar
- **Refund confusion.** Guesty help articles disagree on whether direct bookings default to refundable or non-refundable when no policy is set. Source: https://help.guesty.com/hc/en-gb/articles/18564288423965 and https://help.guesty.com/hc/en-gb/articles/9365605981469
- **No refunds happen automatically.** Guesty never refunds on its own; the host must refund by hand. Source: https://help.guesty.com/hc/en-gb/articles/9361709068061
- **Extra booking fee.** A competitor page says Lodgify adds 1.9% per booking on its lower tier. Source: https://hospitable.com/lodgify-vs-hostaway (competitor, unverified)
- **Price complaints.** Not verified. The one search for host cost complaints found no host posts.
- **Support.** Not verified in this run.
- **Fit for small hosts.** The sources suggest pricing tools suit hosts with many units and rules. Lodgify and Hostaway advertise to larger operators. Source: https://www.lodgify.com/comparisons/lodgify-vs-hostaway/ (vendor-written)

## 6. Ideas for BalayHub

Each idea uses only BalayHub's own data and rules. None needs a market-data feed or AI. Idea 1 changes an out-of-scope item, so the founder must decide it first.

1. **Must: Gap-filling rule.** Short gaps (1–2 nights) get a lower price and a 1-night minimum. Why: small hosts lose most money on the empty nights between bookings.
2. **Must: Lead-time rules.** Simple percent rules by days before check-in (last-minute discount, far-out premium), on top of the current seasons. Why: a 1–10 unit host needs fewer empty nights and a clear rule, not a model.
3. **Should: Events in the calendar.** A dated event list per property with a price bump and minimum nights (concerts, graduations, Holy Week, Christmas). Why: Manila and Cebu events move demand, and the PH holiday list already exists.
4. **Should: Packages and add-ons at checkout.** Early check-in, late checkout, extra guest, pet fee, airport pickup. Why: adds income per booking without lowering the nightly rate.
5. **Should: Unpaid-checkout follow-up.** Send a message (email or Inbox) with the same PayMongo link to guests who started but did not pay. Why: uses the Inbox and templates BalayHub already has. Demand unverified.
6. **Should: Cancellation policy presets.** Pick one of three (flexible, moderate, strict) with refund tiers by days before check-in, shown on the booking page. Why: sets clear terms, and cuts disputes over refunds.
7. **Should: Pacing and booking-window numbers.** Add pacing (bookings on hand versus this time last year) and average booking window to the Performance tab. Why: owners see a slow month early. Built from BalayHub's own reservations.
8. **Should: Social-media booking links.** A share link per listing with a source tag (for example from Instagram or Facebook), counted on the Performance tab. Why: most Filipino hosts post on Facebook and Instagram.
9. **Should: SEO for listing pages.** Give each listing its own real URL, page title, description and schema. Check first whether hash routes (`#/book/<slug>`) stop search engines indexing each listing (unverified). Why: direct bookings save the OTA fee.
10. **Should: Length-of-stay tiers.** Add a 14–27 night tier to the current 7+ and 28+ rules. Why: small change, matches PriceLabs's practice.
11. **Could: Gift cards.** Prepaid value codes paid through GCash, Maya or card, redeemed on the booking page. Why: gifting season (Christmas, Valentine's). Needs a tax and liability check first.
12. **Could: Non-refundable rate.** A cheaper rate with a clear no-refund term and full payment at booking. Why: lets guests choose price over flexibility. Depends on idea 6.
13. **Could: Returning-guest code sent after checkout.** Reuses discount codes and the thank-you message. Why: repeat guests cost less to win back.
14. **Could: Installments on the balance.** Two or three set payment dates. Why: some guests cannot pay a full balance in one go. Needs PayMongo checks.
15. **Could: Date-first search across all properties.** One search for dates and guests across every listing the host owns. Why: helps hosts with several condos.
16. **Could: Occupancy-based (dynamic) pricing from BalayHub's own bookings.** Price rules based on the host's own occupancy at each lead time, no market data. Why: the closest match to Guesty PriceOptimizer. Out of scope today in PRD.MD. Needs a founder decision (log in BLOCKERS.MD, not built).
17. **Could: Promo pop-up on the booking page.** A banner for a live discount code. Why: low effort, helps a sale on a quiet week.

## 7. Excluded (integrations/API/AI)

- Market-data feeds: PriceLabs, Beyond and Wheelhouse market data and base-price suggestions; competitor-rate views; market demand indexes; event databases fed from outside.
- Surge detection that uses wider market activity (PriceLabs Hyper Local Pulse).
- Google Vacation Rentals listing and any Google hotel feed (needs a channel or booking-site integration).
- Third-party gift-card and cart-recovery add-ons (Gift Up, CartStack) that connect to other software.
- Channel-manager connections for pricing push (Airbnb, Booking.com) and rate sync.
- AI pricing or AI-written promotions.

## 8. Sources

Pricing tools
- https://help.guesty.com/hc/en-gb/articles/14518163143965
- https://help.guesty.com/hc/en-gb/articles/9359361787805
- https://help.guestyforhosts.com/hc/en-gb/articles/17611036454813
- https://help.guesty.com/hc/en-gb/articles/34324636161693
- https://help.guesty.com/hc/en-gb/articles/9361709068061
- https://help.guesty.com/hc/en-gb/articles/18564288423965
- https://help.guesty.com/hc/en-gb/articles/9365605981469
- https://support.hostaway.com/hc/en-us/articles/26198234370331-Dynamic-Pricing-Interactive-Demo-Setup-guide
- https://support.hostaway.com/hc/en-us/articles/27337257958939-Dynamic-Pricing-FAQs
- https://support.hostaway.com/hc/en-us/articles/26714000417051-Dynamic-Pricing-Calendar
- https://help.pricelabs.co/portal/en/kb/articles/preventing-gaps
- https://help.pricelabs.co/portal/kb/articles/understanding-min-nights
- https://hello.pricelabs.co/how-to-use-orphan-gaps-for-increasing-revenue/
- https://help.pricelabs.co/portal/en/kb/articles/how-pricelabs-handles-event-pricing
- https://help.pricelabs.co/portal/en/kb/articles/events-holidays-and-high-demand-dates
- https://help.pricelabs.co/portal/fr/kb/articles/weekly-monthly-discount
- https://hello.pricelabs.co/blog/how-to-get-longer-vacation-rental-stays/
- https://hello.pricelabs.co/blog/extended-stay-pricing/
- https://pricelabs.portal.trainn.co/videos/y3Jh1baOhViJ7YuNKynt7A
- https://zeevou.com/compare/beyond-vs-wheelhouse/
- https://www.bnbcalc.com/pt/reviews/wheelhouse-pricing-review
- https://bnbcalc.com/reviews/the-best-dynamic-pricing-tools-for-airbnb
- https://usewheelhouse.com/blog/?p=1860 (vendor-written)

Length of stay
- https://encyclopedia.lodgify.com/length-of-stay-discount
- https://ownerrez.com/support/articles/length-of-stay-discounts
- https://www.hostaway.com/glossary/length-of-stay/

Direct booking
- https://www.guesty.com/features/website
- https://www.guesty.com/coupon-codes-for-booking-website/
- https://help.guesty.com/hc/en-gb/articles/9365886890653
- https://www.hostaway.com/features/marketing.md
- https://help.craftedstays.co/en/articles/14037606-how-to-create-and-use-discount-codes-hostaway-users
- https://travolution.com/news/travel-sectors/accommodation/hostaways-new-tool-generates-250-additional-revenue-per-reservation-for-property-managers
- https://help.hospitable.com/en/articles/14851555-booking-policies-for-direct-bookings
- https://help.hospitable.com/en/articles/14631739
- https://help-platform.siteminder.com/en/articles/9355775-set-up-cancellation-and-payment-policies-for-direct-booking-rates-in-multi-property
- https://www.hospitalitynet.org/news/4098487.html
- https://www.weneedavacation.com/str/rental-payment-schedules-how-much-and-when/
- https://thenantuckethotel.com/?p=767
- https://integrately.com/integrations/gift-up/lodgify
- https://www.cartstack.com/blog/?p=2165
- https://hostaway.com/blog/seo-tips-for-direct-bookings
- https://www.wander.com/article/vacation-rental-seo
- https://www.hostfully.com/blog/google-for-hosts-managers/
- https://help.hospitable.com/en/articles/8010699-google-vacation-rentals
- https://www.hostfully.com/?p=51580
- https://www.lodgify.com/comparisons/lodgify-vs-hostaway/
- https://hospitable.com/lodgify-vs-hostaway

KPIs
- https://www.keydatadashboard.com/blog/vacation-rental-kpis
- https://www.keydatadashboard.com/blog/vacation-rental-analytics
- https://www.keydatadashboard.com/blog/the-kpi-dictionary-understanding-short-term-rental-data-and-how-to-use-it
- https://www.hostfully.com/blog/vacation-rental-kpis
- https://pricelabs.portal.trainn.co/videos/S0fFSDUwGT8P8NCg9AI5fg

BalayHub canon docs used: /home/user/website/balayhub/PRD.MD (F6, F17, direct booking page, Performance tab); /home/user/website/balayhub/APP-FLOW.MD (direct booking flow).
