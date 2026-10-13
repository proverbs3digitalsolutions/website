# 10. Philippines and Southeast Asia short-term rental market

Status: partial. Read this first.

- The search budget ran out after about 17 searches. Several topics have no real answer yet (see "What we could not verify").
- Every page fetch failed (the fetch tool could not resolve the hosts). All facts below come from search result summaries, not from the original pages. Each claim is marked "unverified" where it rests on one secondary source.
- No Reddit, Facebook-group, YouTube or review-site (G2, Capterra, Trustpilot) content was read in full. Nothing here is a verified user quote.
- Nothing here is legal or tax advice. Check BIR and NPC rules with a Philippine tax practitioner or lawyer before building product rules on them.

## 1. Summary

- Short-term rentals (Airbnb, Booking.com, Agoda) are legal in the Philippines in general. There is no citywide ban found for Manila (unverified, one 2026 guide).
- The real limits come from each condo's bylaws. Many condos ban or restrict rentals under 30 days. The condo corporation has the final say.
- Tax is the big open question for hosts. BIR says owners who list on Airbnb must register. Enforcement is growing. One regional office said only about 40% of its Airbnbs were registered (Philstar, Oct 2024).
- Airbnb had about 99,000 Philippine listings in 2023–2024, with about 49% average occupancy (Airbtics, unverified count).
- Most Filipino hosts run 1–10 units. Many use Airbnb plus a Facebook page and a group chat. Money moves by GCash, Maya or bank transfer.
- Global tools (Guesty, Hospitable, Hostaway, Lodgify, Hostfully) are priced in US dollars and built for US or EU hosts. We found no PH-built PMS that covers BIR, condo gate passes and GCash together.
- Co-hosts (local property managers) charge about 10–15% of income for half-service and 20–30% for full-service in Metro Manila (Airbtics, one site's boilerplate, treat as rough).
- Cleaners are paid by the host or co-host per stay. We found no sourced cleaner rates.

## 2. Pricing

### Global PMS tools (benchmarks only, all unverified against vendor pages)

| Tool | What we found | Source |
|---|---|---|
| Guesty Lite | $9 to $29 per listing per month (pay-as-you-grow, annual, monthly). CostBench also adds 1% per reservation on pay-as-you-grow. | https://costbench.com/software/vacation-rental-software/guesty/ ; https://www.roommaster.com/blog/guesty-pricing |
| Guesty Pro and Enterprise | Quote only. One blog says $40–72 per listing per month for 5–50 units, plus 2–3.5% on direct bookings (anecdotal). | https://www.roommaster.com/blog/guesty-pricing |
| Hospitable | Starts at $29 per month with no booking fees (its own page). Capterra shows Professional $59 and Mogul $99 per month, usage-based. A $500 setup fee is mentioned. | https://hospitable.com/compare/lodgify-vs-hostfully ; https://www.capterra.com/p/189280/smartbnb/pricing/ |
| Hostaway | Custom quote. One site says $16–40 per unit per month plus $300–800 setup. | https://www.costbench.com/software/vacation-rental-software/hostaway/alternatives/ ; https://zeevou.com/?p=181365 |
| Lodgify | Starter about $13, Pro about $35, Ultimate about $49 per month, with per-unit discounts. One comparison adds 1.9% on direct bookings (French comparison site, unverified). | https://hospitable.com/compare/lodgify-vs-hostaway ; https://comparatifchannelmanager.fr/?p=6026 |
| Hostfully | Sources disagree: $15–25 per property per month, $129 per month plus setup, or $249 per month for 5 listings. | https://www.costbench.com/software/vacation-rental-software/ ; https://comparatifchannelmanager.fr/?p=10002 |
| PriceLabs | Revenue pricing tool for short-term rentals that works alongside PMS tools. Price not found. | Search summary only (no URL captured) |

### Local (Philippines) benchmarks

- A Philippine hotel PMS vendor (name not captured) lists ₱1,699 per month cloud, ₱14,999 per year, or ₱67,999 one-time self-hosted. It targets hotels and inns, not Airbnb hosts. Source link not captured.
- BalayHub's own plan prices are not in this brief. Check the app's pricing page before comparing.

### Co-host and management fees (Metro Manila)

- Half-service management: about 10–15% of rental income (Airbtics).
- Full-service management: about 20–30% of rental income (Airbtics).
- Premium firms: up to 40–45% of the booking total (Airbtics, one site, treat as high-end outliers).
- Source: https://airbtics.com/airbnb-management-companies/manilabnb-property-management-485196961 (boilerplate across many manager pages on the same site).

### Airbnb's own fees (for the host's view)

- MoneyMax says Airbnb takes a flat 3% service fee from the host on the booking subtotal (unverified, one source). Source: https://www.moneymax.ph/personal-finance/articles/earn-money-airbnb

## 3. Feature catalogue

Columns: Area | Feature | What it does | BalayHub has it? (Yes / Partly / No)

Rows marked "PH need" are features a Philippine-focused PMS needs and that global tools do not handle well. Other rows come from the global tool set the founder asked about.

| Area | Feature | What it does | BalayHub has it? |
|---|---|---|---|
| Reservations | Reservation list with saved views and filters | Find and sort bookings | Yes |
| Reservations | Manual booking entry | Host adds a booking from a chat or Facebook message | Partly (manual add exists in reservations; off-channel source tag not confirmed) |
| Reservations | Booking source tag (Airbnb, Booking, Agoda, Facebook, direct, cash) | Shows where each booking came from and its fees | Partly |
| Reservations | Reservation fee and deposit tracking | Track a booking fee paid up front and the balance | Yes (deposit and balance links) |
| Reservations | Cancellation and refund policy per listing | Sets refund rules and records refunds | No |
| Calendar | Multi-calendar | One view of all units | Yes |
| Calendar | iCal sync with Airbnb, Booking.com, Agoda, Vrbo, Expedia, Trip.com | Blocks dates across channels | Yes |
| Calendar | Blocks and minimum stay | Owner or host blocks dates, sets minimum nights | Yes |
| Calendar | Condo gate-pass date and time window | Sends the stay dates to the building admin | Yes (PH need) |
| Pricing | Nightly, weekend, holiday and season rates | Date-based rates | Yes |
| Pricing | Long-stay discounts | Discount for 7+ or 30+ nights | Yes |
| Pricing | Peak-date or event rate rules (Christmas, Holy Week, New Year, Fiesta) | Automatic higher rates on local holidays | Partly (holiday rates exist; event presets not confirmed) |
| Pricing | Rate suggestion from market data | Suggests a price from demand | No (note: may need external data; not an integration if we use our own data) |
| Direct booking | Direct booking page | Guest books and pays on the host's own site | Yes |
| Direct booking | Payment by GCash, Maya, card (PayMongo) | Local payment methods | Yes (PH need) |
| Direct booking | Full payment or deposit at booking | Guest pays all or part | Yes |
| Direct booking | Pay-the-balance link | Sends a link for the rest | Yes |
| Direct booking | Discount codes | Promo codes for direct bookings | Yes |
| Direct booking | Facebook page booking link or quote link | Host sends a booking page or quote to a Facebook or Messenger chat | No (PH need) |
| Direct booking | Bank transfer payment instructions with proof upload | Guest sends bank transfer and uploads a screenshot; host confirms | No (PH need) |
| Direct booking | Pay-by-cash record | Host records cash received and gives a receipt | No (PH need) |
| Payments | Security deposit hold and refund | Holds a deposit and returns it after check-out | Yes |
| Payments | Owner payout or balance record | Records what is owed to each owner | Partly (owner statements) |
| Payments | Co-host commission setting | Sets a percent or fixed fee per booking for a co-host | No (PH need; global tools have this, see Standout features) |
| Payments | Cleaning fee paid by owner at check-out | Charges owner the cleaning fee automatically | No |
| Guests | Guest profile with VIP, do-not-rebook and repeat tracking | Keeps guest history | Yes |
| Guests | Guest reviews of the stay | Host reviews the guest | Yes |
| Guests | Guest-facing messages in English and Taglish | Message templates in both languages | Yes |
| Guests | Email inbox with templates and scheduled messages | Sends and schedules messages | Yes |
| Guests | Chat or Messenger inbox | One place for Facebook and Messenger messages | No |
| Check-in | Check-in form with ID upload | Guest uploads ID before arrival | Yes |
| Check-in | Consent notice and data retention limit for guest ID | Shows why the ID is collected, when it is deleted | Partly (ID upload exists; consent text and deletion timer not confirmed) (PH need, Data Privacy Act) |
| Check-in | Building rules sheet per unit | Shows house rules and building rules to the guest | No |
| Check-in | Gate pass sent to building admin | Sends the guest list and times to the condo admin | Yes (PH need) |
| Check-in | Guest registration log for the building | Exports the guest list in the format the building asks for | Partly |
| Operations | Cleaning tasks and checklists | Assign tasks and checklists | Yes |
| Operations | Cleaning photos | Staff upload before and after photos | Yes |
| Operations | Cleaner pay per turnover | Records what each cleaner earns per stay | No (PH need) |
| Operations | Cleaner payment record (GCash or cash) | Pays and logs the amount | No (PH need) |
| Maintenance | Maintenance requests | Log a repair and track it | Partly (monthly rentals only) |
| Maintenance | Maintenance for short-term units | Repairs for staycation units | No |
| Inventory | Linen and supply stock | Track towels, toiletries, stock levels | No |
| Owners | Owner statements for managed units | Income and expense statement per owner | Yes |
| Owners | Owner portal or login | Owner logs in to see their own statements | No |
| Owners | Owner-approved expenses | Owner approves costs before they are charged | No |
| Accounting | Yearly income and tax summary | Summary for the tax return | Yes |
| Accounting | Monthly percentage tax or VAT summary | Gross receipts per month for filing (PH need, BIR) | No |
| Accounting | Official receipt or invoice numbering | Sequential numbered receipts for guests (PH need, BIR) | No |
| Accounting | Books of accounts export | Ledger in a format the BIR asks for (PH need, BIR) | No |
| Accounting | Tax-rate setting (3% percentage tax, 8% option, VAT) | Sets the tax rule per owner or host (PH need, BIR) | No |
| Accounting | Expense recording with receipts | Logs costs with a photo of the receipt | Partly |
| Reports | Stay report | Shows occupancy and income by stay | Yes |
| Reports | Occupancy and revenue by unit and month | Compares units | Partly |
| Reports | Booking source report | Income by channel | Partly |
| Team | Roles (owner, manager, staff) | Role-based access | Yes |
| Team | Scope staff to properties | Staff see only their units | Yes |
| Team | Staff never see guest phone or email | Privacy for staff | Yes |
| Team | Shift or schedule view for cleaners | Calendar of who cleans what | Partly (tasks, not shifts) |
| Mobile | Installable phone app | Works like an app | Yes |
| Mobile | Push notifications | Alerts for new bookings and tasks | Yes |
| Multi-property | Multiple properties per owner | Groups units by owner or building | Yes |
| Multi-property | Multiple buildings or condo projects | Groups units by condo project and gate rules | No |
| Reviews | Review management across channels | Collects and answers reviews | No |
| Plans | Free trial and paid plans | Subscription plans | Yes |
| Plans | Pay in pesos with local payment methods | Billing in PHP | Partly (PayMongo for guests; host billing not confirmed) |
| Help | Help center and support tickets | Self-help and support | Yes |
| Settings | Light and dark mode | Display theme | Yes |
| Settings | English and Taglish | Language for guests | Yes |

## 4. Standout features

These come from vendor pages and community posts, not from user reviews. Treat as vendor-claimed unless noted.

1. **Owner statements and invoices for co-hosts.** Hospitable added owner statements and invoices for Airbnb co-hosts. Source: https://community.hospitable.com/hospitable-changelog-3/owner-statements-and-invoices-for-airbnb-co-hosts-are-here-370
2. **Automatic cleaner payout at check-out.** Hospitable users asked for cleaner money to be charged to the owner at a fixed rate when a stay ends. Shows this is a real pain point, not yet shipped. Source: https://feedback.hospitable.com/p/automated-owner-to-co-host-cleaner-payments-triggered-by-check
3. **Co-host payout options set by the host.** Airbnb lets hosts share payouts with a co-host as a cleaning fee, a cleaning fee plus percent, a percent, or a fixed amount per booking. Source: https://web-archive.nli.org.il/National_Library/mp_/https://www.airbnb.com.ph/help/article/3389 (archived Airbnb Philippines help page)
4. **Low entry price with no booking fees.** Hospitable markets a $29 start with no booking fees. Source: https://hospitable.com/compare/lodgify-vs-hostfully
5. **Lodgify low tiers with per-unit discounts.** Source: https://hospitable.com/compare/lodgify-vs-hostaway
6. **Hospitable: owner deposit to cover cleaning.** Co-hosts ask for a deposit from owners (one thread asks for $1,500) so they do not fund cleaning from their own pocket. Source: https://community.hospitable.com/industry-conversations-33/co-hosts-unite-1158 (single thread; unverified as common practice)
7. **Direct booking with local payments.** Vendors offer their own booking pages. BalayHub already has GCash and Maya, which is a point global tools lack. Source: BalayHub brief, not an external source.

Not verified: review-site ratings for any of these tools.

## 5. Complaints and gaps from reviews

### Pain points for Philippine hosts (secondary sources)

- **Building rules are unclear or change without notice.** Many condo bylaws ban rentals under 30 days or need written consent from both owner and condo corporation. Hosts often find out after listing. Source: https://www.lawyer-philippines.com/articles/condo-unit-rental-checklist-philippines ; https://www.lawyer-philippines.com/articles/homeowners-association-policy-enforcement-philippines-1
- **Developers differ.** One Taguig source says Megaworld brands allow Airbnb, while Ayala's Premier and Alveo do not (community-sourced, unverified). Source: https://airbtics.com/airbnb-rules-in-taguig-philippines/
- **Tax is confusing.** Sources disagree on whether hosts pay 3% percentage tax, VAT (12%), or the 8% flat option. Sources also disagree on the VAT threshold (PHP 3 million). Source: https://www.respicio.ph/commentaries/bir-form-for-airbnb-hosts ; https://trykintsugi.com/sales-tax-guides/apac/philippines.md
- **Enforcement is picking up.** BIR Region 7 said in October 2024 it was working with condo managers to find unregistered units, and warned of fines. Source: https://www.philstar.com/the-freeman/cebu-news/2024/10/10/2391521/bir-7-stepping-crackdown-unregistered-airbnb-units
- **Condo managers may share owner data with BIR.** A 2025 NPC advisory opinion (No. 2025-006, per a law-firm summary) said condo corporations may give owner names and tax IDs to BIR without owner consent for legal-obligation reasons. Source: https://conventuslaw.com/report/philippines-bir-can-ask-condocorps-for-information-about-condo-owners-with-airbnb-businesses/ (summary read from search snippet only; verify the opinion text)
- **DOT accreditation is unclear.** One legal-form site says DOT Memorandum Circular 2018-002 requires accreditation for commercial condo rentals, but enforcement on individual hosts is uneven. A Cebu consultancy says it is optional. Mabuhay Accommodation is the category Airbnb points condo hosts to. Source: https://forms-legal.com/philippines/real-estate/leases/short-term-rental-agreement-philippines ; https://news.airbnb.com/working-together-to-help-drive-safe-tourism-recovery-in-the-philippines/
- **Barangay clearance, Mayor's permit and BIR are often all needed.** Local rules vary. Mandaue requires a Mayor's Permit for transient accommodation. Source: https://airbtics.com/airbnb-rules-in-manila-philippines/ ; https://3d-universal.com/en/blogs/airbnb-in-cebu-laws-profitability-and-setup.html
- **Off-platform payment looks like a scam to Airbnb.** Airbnb's help page treats bank transfer requests and paper invoices as red flags. Hosts who move guests to GCash or a Facebook page lose platform protection. Source: https://www.airbnb.com.ph/help/article/199
- **Cash and GCash scams.** Local scam guides report fake Facebook sellers who take GCash payments and disappear. Source: https://walastech.com/featured/six-common-holiday-scams-to-avoid-in-the-philippines/ (general scam guide, not a study)
- **Co-hosts front cleaning costs.** Co-hosts pay cleaners first and wait for the owner to repay. Source: https://feedback.hospitable.com/p/automated-owner-to-co-host-cleaner-payments-triggered-by-check
- **Global tool pricing is hard to read.** Guesty Pro and Enterprise are quote only. Hostaway is custom pricing. Lodgify and Hostfully list prices that disagree between sites. Sources: https://costbench.com/software/vacation-rental-software/guesty/ ; https://www.costbench.com/software/vacation-rental-software/hostaway/alternatives/
- **Small-host fit.** Global tools have per-listing fees that add up for 1–10 units. The one-line point: a 3-unit host pays for features built for 50-unit firms. Source: CostBench and Roommaster pricing pages above (inference, not a user quote).
- **Booking fees on direct bookings.** Guesty Pro (2–3.5%) and Lodgify (1.9%) take a cut on direct bookings. This is the opposite of what a host wants from a direct channel. Sources: https://www.roommaster.com/blog/guesty-pricing ; https://comparatifchannelmanager.fr/?p=6026

### What we could not verify

- Reddit (r/Philippines, r/phinvest, r/airbnb_hosts): no threads were read. The search returned none.
- Facebook host groups: none read.
- Guest ID rules under the Data Privacy Act for hosts: no NPC opinion about hosts was found. Our guess is that a host needs a lawful basis (contract or legal obligation) and a privacy notice. This is inference, not a source. Unverified.
- Official BIR issuances on Airbnb: none read. The 2024 Philstar article and an older Inquirer piece are news, not rules.
- DOT accreditation text: not read.
- LGU business permits: only examples (Mandaue, Manila). No list for other cities.
- Cleaner rates in pesos: not found.
- Bank transfer and cash norms: not found beyond scam warnings.
- Reservation fee norms (typical percent): not found.
- Local PH PMS competitors other than the hotel PMS above: not found.

## 6. Ideas for BalayHub

Each idea has one line on why it matters for a Filipino host with 1–10 units.

- **Must: Official receipt or invoice numbering and export.** BIR expects receipts for guest payments. Without them, hosts are stuck. (Must)
- **Must: Monthly percentage tax or VAT summary.** Hosts must file monthly, usually by the 20th of the next month (per Airbnb help). A one-click summary saves hours. (Must)
- **Must: Tax setting per host (3% percentage tax, 8% option, VAT).** Sources disagree on the rules. Let the host pick and see the effect, with a note to check with BIR. (Must)
- **Must: Guest ID consent notice and auto-delete timer.** Hosts collect IDs for the gate pass and the Data Privacy Act applies. (Must, after legal check)
- **Must: Building rules and ban flag per unit.** Hosts need to know if the condo bans short stays before they list. Show the rule in the unit record. (Must)
- **Must: Cleaner pay per turnover and payout record.** Cleaners are paid in cash or GCash. Track it so hosts stop losing money. (Must)
- **Must: Co-host commission setting (percent, fixed or cleaning-fee share).** Co-hosts are the local management model. Let the host set the split per unit. (Must)
- **Should: Bank transfer and cash payment with proof upload and host confirm.** Many guests still pay this way. Keep it inside the platform record so Airbnb rules are not the only record. (Should)
- **Should: Facebook or Messenger booking link with a quote page.** Many hosts sell through Facebook. A link that opens the booking page keeps the booking in BalayHub. (Should)
- **Should: Cleaning fee charged to owner at check-out.** Removes the co-host's cash float problem. (Should)
- **Should: Owner portal login.** Owners check their own statements. Less chasing by message. (Should)
- **Should: Reservation fee and cancellation rule per listing.** Typical deposit and refund rules are not known from our research. Let the host set them. (Should)
- **Should: Building documents folder (gate pass format, bylaws, registration) per property.** Keeps the paperwork in one place. (Should)
- **Could: Multiple buildings or condo-project grouping with its own gate rules.** Useful for co-hosts with many condos. (Could)
- **Could: Inventory for linen and supplies.** Cleaners and hosts track stock. (Could)
- **Could: Review collection and reply templates for Filipino guests.** Taglish review requests. (Could)

## 7. Excluded (integrations/API/AI)

- Channel-manager API connections
- Open or public API
- Integration marketplace
- Smart-lock or third-party app integrations
- Accounting-software sync
- AI agents, AI chatbots, AI auto-replies, or any AI feature

## 8. Sources

Primary-type sources were not reachable. Every URL below was seen in search results only.

- https://airbnb.com/help/article/2996 (Airbnb responsible hosting, Philippines)
- https://www.airbnb.com.ph/help/article/199 (Airbnb, paying outside Airbnb)
- https://web-archive.nli.org.il/National_Library/mp_/https://www.airbnb.com.ph/help/article/3389 (Airbnb co-host payouts, archived)
- https://news.airbnb.com/working-together-to-help-drive-safe-tourism-recovery-in-the-philippines/
- https://business.inquirer.net/323752/bir-going-after-airbnb-hosts/ (older, date unverified)
- https://www.philstar.com/the-freeman/cebu-news/2024/10/10/2391521/bir-7-stepping-crackdown-unregistered-airbnb-units
- https://www.respicio.ph/commentaries/bir-form-for-airbnb-hosts
- https://www.lawyer-philippines.com/articles/condo-unit-rental-checklist-philippines
- https://www.lawyer-philippines.com/articles/homeowners-association-policy-enforcement-philippines-1
- https://www.lawyer-philippines.com/articles/tax-requirements-for-foreign-airbnb-business-in-the-philippines
- https://conventuslaw.com/report/philippines-bir-can-ask-condocorps-for-information-about-condo-owners-with-airbnb-businesses/
- https://forms-legal.com/philippines/real-estate/leases/short-term-rental-agreement-philippines
- https://airbtics.com/airbnb-rules-in-the-philippines
- https://airbtics.com/airbnb-rules-in-makati-philippines
- https://airbtics.com/airbnb-rules-in-taguig-philippines/
- https://airbtics.com/airbnb-rules-in-manila-philippines/
- https://airbtics.com/starting-an-airbnb-the-philippines
- https://airbtics.com/airbnb-management-companies/manilabnb-property-management-485196961
- https://3d-universal.com/en/blogs/airbnb-in-cebu-laws-profitability-and-setup.html
- https://www.moneymax.ph/personal-finance/articles/earn-money-airbnb
- https://trykintsugi.com/sales-tax-guides/apac/philippines.md
- https://walastech.com/featured/six-common-holiday-scams-to-avoid-in-the-philippines/
- https://costbench.com/software/vacation-rental-software/guesty/
- https://www.costbench.com/software/vacation-rental-software/hostaway/alternatives/
- https://www.roommaster.com/blog/guesty-pricing
- https://www.capterra.com/p/189280/smartbnb/pricing/
- https://hospitable.com/compare/lodgify-vs-hostfully
- https://hospitable.com/compare/lodgify-vs-hostaway
- https://zeevou.com/?p=181365
- https://comparatifchannelmanager.fr/?p=6026
- https://comparatifchannelmanager.fr/?p=10002
- https://community.hospitable.com/hospitable-changelog-3/owner-statements-and-invoices-for-airbnb-co-hosts-are-here-370
- https://community.hospitable.com/industry-conversations-33/co-hosts-unite-1158
- https://feedback.hospitable.com/p/automated-owner-to-co-host-cleaner-payments-triggered-by-check

## Next steps for this file

- Re-run the Reddit, Facebook, BIR and DOT searches in a fresh session. The budget is shared and was used up here.
- Read the BIR revenue memorandum circulars on percentage tax and the 8% option directly.
- Read the NPC advisory opinions on guest IDs and lodging.
- Collect 10 to 15 real host posts on cleaner pay, deposits and co-host splits.

## Follow-up findings

Second pass, fresh searches. Page fetches still failed (respicio.ph, paymongo.com, grantthornton.com.ph and airbtics.com did not resolve), so every fact below comes from search snippets. Nothing here is tax or legal advice. Check with a Philippine tax practitioner or lawyer before building rules on it.

### BIR and taxes

- **Registration (verified in part, snippet):** Individuals register with BIR Form 1901. Corporations use Form 1903. Most hosts are sole proprietors, so Form 1901 is the likely one. Source: https://www.respicio.ph/commentaries/bir-form-for-airbnb-hosts
- **BIR position on Airbnb (news, 2021 and 2024):** A BIR official said property owners listed on Airbnb must register as lessors of real property. BIR Region 7 (Central Visayas) said in Oct 2024 that it was working with condo managers to find unregistered units and warned of fines. Sources: https://business.inquirer.net/323752/bir-going-after-airbnb-hosts/ ; https://www.philstar.com/the-freeman/cebu-news/2024/10/10/2391521/bir-7-stepping-crackdown-unregistered-airbnb-units
- **Percentage tax (unverified):** A non-VAT seller with gross sales up to PHP 3,000,000 may pay 3% percentage tax instead of VAT. One undated source says the rate was cut to 1% until 30 June 2023, then may have gone back to 3%. The current rate must be checked. Source: https://www.respicio.ph/commentaries/bir-form-for-airbnb-hosts
- **8% option (unverified, from background knowledge, not found in any source):** An elective 8% flat rate for self-employed people under PHP 3 million in gross receipts. We could not confirm the eligibility rules or how it applies to rental income.
- **Invoices replace official receipts (verified in part, snippets):** Under EOPT (RA 11976) and Revenue Regulations 7-2024 (effective 27 April 2024), the invoice is the main supporting document for VAT. Loose-leaf or manual official receipts can no longer be the main document for service sales. RR 11-2024 later extended some transition rules. Whether a non-VAT host must issue an invoice or may still use an official receipt was not confirmed. Sources: https://www.grantthornton.com.ph/insights/articles-and-updates1/lets-talk-tax/invoicing-requirements-under-the-eopt-act/ ; https://batasnatin.com/laws/eopt-act-ra-11976-invoicing-rules-revenue-regulations-no-7-2024-summary
- **Returns and deadlines (Airbnb help page 2996, snippet via mirror domains):** Income tax returns are quarterly and annual. For individuals, quarterly returns are due 15 May, 15 August and 15 November, and the annual return on 15 April. Airbnb says VAT and percentage tax are due monthly, by the 20th of the following month. The quarterly form 2551Q does not appear in the snippet, and 1701Q is named only by a secondary law-firm page. Unverified which return a host files. Source: https://airbnb.com/help/article/2996
- **Platform withholding (unverified):** Revenue Regulations 16-2023 set a 1% withholding on half of gross remittances from online platforms to local sellers, from 12 January 2024. Sellers under PHP 500,000 a year were exempt. A payment-processor page says RR 5-2025 cut this to one-half of 1%. No source says Airbnb withholds tax on host payouts. Sources: https://www.abs-cbn.com/business/12/29/23/bir-imposes-1-pct-withholding-tax-on-online-platforms-digital-service-providers ; https://docs.paymongo.com/docs/account-settings-taxes
- **Revenue Memorandum Circulars on Airbnb:** Not found. Searches returned only US and Massachusetts results. No RMC on short-term rentals was verified.
- **Books of accounts:** Not verified in any source.

### Data Privacy Act

- **NPC Advisory Opinion No. 2025-006 (unverified text, law-firm summary):** A condo corporation got a BIR access letter asking for owner names and TINs linked to leasing and Airbnb or staycation use. NPC said the data may be shared without owner consent, under DPA Section 12(c) (legal obligation) and Section 13(f) (public authority). The opinion does not say whether a condo can share without a BIR request. Source: https://conventuslaw.com/report/philippines-bir-can-ask-condocorps-for-information-about-condo-owners-with-airbnb-businesses/
- **Guest ID copies for hotels or hosts:** No NPC opinion found. Foreign regulators (Cyprus, Spain, Italy, Turkey) say keeping ID copies breaks data minimisation. This is not Philippine authority. Unverified for PH. Sources: https://cyprus-mail.com/2025/02/10/hotels-told-to-stop-keeping-id-copies ; https://www.grcreport.com/post/italys-privacy-watchdog-tells-hotels-to-stop-holding-guest-id-copies
- **Retention periods for guest IDs:** Not found.

### DOT and LGU permits

- **Condo units (snippet, secondary):** DOT does not accredit single condo units used as Airbnb accommodation. It can accredit a whole building classed as an apartment hotel or condo-hotel. Source: https://news.airbnb.com/working-together-to-help-drive-safe-tourism-recovery-in-the-philippines/ (cited in search summary, unverified)
- **Circular numbers:** MC 2018-002 text was not found. MC 2018-03 (Progressive Accreditation System) and MC 2020-005 (interim guideline, which defines condotels and homestays) were seen in search results. Homestay rules need at least one furnished guestroom. Sources: https://dev.lawyerly.ph/laws/90444 ; https://seepangasinan.com/wp-content/uploads/2020/09/MEMORANDUM-CIRCULAR-NO.-2020-005.pdf
- **Permits to expect (secondary, Cebu and general guides):** Barangay clearance, Mayor's or business permit, BIR registration. DOT accreditation is called optional by a Cebu consultancy and uneven in enforcement. Source: https://3d-universal.com/en/blogs/airbnb-in-cebu-laws-profitability-and-setup.html
- **Makati, Taguig, Pasig, Quezon City, Tagaytay, Baguio:** No city ordinance found. Quezon City is described as lenient by a data site (unverified, commercial). Only a 2021 QC business-permit ordinance (SP-3013) was found, and it does not cover short-term rentals.

### Payments

- **PayMongo fees (unverified, search snippet from a PayMongo blog post, page not opened):** Cards 3.125% plus PHP 13.39 per transaction. GCash 2.23%. Maya 1.79%. Direct online banking 0.71% or PHP 13.39. QR Ph 1.3%. All VAT-exclusive. A competitor (HitPay) estimates cards at about 3.5% plus PHP 15 and GCash at about 2.5%, so check PayMongo's pricing page. Source: https://www.paymongo.com/blog/maya-vs-gcash-vs-paymongo-for-business
- **Reservation fee and deposit norms:** Not found. Airbnb's own platform lets guests pay in installments. Hosts receive payment 24 hours after check-in. Unverified for staycations.
- **Cash on arrival:** Not found as a norm. One host blog says cash is still common and that bank transfer is requested. Single anecdote, unverified.

### Local tools and communities

- **Local PMS (snippets):** Codingclave (PHP 1,699 a month cloud, PHP 14,999 a year, PHP 67,999 one-time self-hosted; BIR-ready invoices and official receipts; 12% VAT) and Hotelogix (BIR-certified POS, OTA sync, direct booking). Both target hotels and inns, not Airbnb hosts. No GCash or Maya link was confirmed for either. Sources: https://codingclave.com/blog/hotel-management-software-philippines-2026 ; https://www.hotelogix.com/blogs/tag/hotel-pms-philippines
- **Global tools with cheap entry:** Renty (free plan; Pro about EUR 10 a month) syncs Airbnb and Booking.com calendars and assigns cleaning tasks. Source: https://www.producthunt.com/p/renty (unverified price)
- **Cleaner rate (weak proxy):** Manila hourly domestic cleaning about PHP 316 (Expatistan, six data points, a rough estimate, updated Feb 2026). No per-turnover peso rate was found. Source: https://expatistan.com/price/cleaning-help/manila/EUR
- **Co-host fee norms:** Not found in this pass.
- **Common host complaints (news, 2025 to 2026):** Makati host hit by a 13-person group leaving damage, taking items and not returning an access card. Parañaque host found units left in poor condition, with a two-hour turnover window. A Pasay host was charged condo penalties for an extra guest, which the host had to pay. Sources: https://interaksyon.philstar.com/trends-spotlights/2025/04/28/295526/makati-airbnb-host-calls-out-guests-disregarding-rules/ ; https://interaksyon.philstar.com/trends-spotlights/2025/01/13/290046/airbnb-paranaque-guests-units-unacceptable-condition/
- **Reddit (r/Philippines, r/phinvest):** Not reached. Searches returned no Airbnb threads.

### Condo building rules

- **Guest list lead time:** Listings show 7 days (Pico de Loro, Cavite; unit owner submits endorsement and authorization forms; one-time registration fee per guest at the gate), 1 week (Azure Urban Resort, Pasay; guest list and valid IDs), and 2 days (Grass Residences; names plus passport or PH ID copies). These are individual listings, so treat them as examples, not rules. Sources: https://www.airbnb.com.sg/rooms/5900944 ; https://www.airbnb.com/rooms/1427334110359292253
- **Accreditation or admin fee per stay:** No published figure found. Fees are set by each building admin. Unverified.
- **Guest limits, parking passes:** Not found beyond the examples above.
- **Ban rules:** Many condo bylaws restrict stays under 30 days (earlier pass, lawyer-philippines.com, unverified this pass).

### Ideas for BalayHub: changes

- **Must (unchanged, now more support):** Guest list and ID lead-time settings per building. The three listings above show that a 2 to 7 day lead time is common. Add a per-building setting.
- **Must (wording change):** Official receipt or invoice numbering. Under EOPT the document is called an invoice. Build for "invoice" and keep "official receipt" only if the BIR still requires it for non-VAT hosts (unverified).
- **Must (cost note):** PayMongo card fee is about 3.1% plus PHP 13.39 per payment (unverified). A host with a PHP 5,000 booking pays about PHP 170 on a card. Show the fee to the host in the payment screen, or let the host pass it on.
- **Should (new):** Damage and penalty charges to guests, with photos, because hosts report guest damage and condo fines passed on to them.
- **No change:** Guest ID consent notice and retention timer remain Must after a legal check. No Philippine NPC opinion on hosts was found.
