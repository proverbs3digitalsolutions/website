# Owners and finance in short-term rental software

Research note for BalayHub. Scope: owner portals, owner statements, fees, payouts, trust accounting, and money reports in Guesty, Hostaway, Escapia, Track, OwnerRez and Hostify.

**Research limits (read first):**
- The web search budget ran out after about 23 searches. Several topics were not searched at all. Those are marked "not researched" or "unverified."
- The fetch tool could not open any vendor site from this environment. Every claim below comes from search-result snippets, not from reading the full vendor page.
- Track and Hostify have very little public detail. Treat their rows as gaps, not as "no feature."
- Vendor marketing claims are marked as such.

## 1. Summary

- This topic is about how a property manager tracks what each owner earns, what they owe, and what gets paid out.
- The users are professional property managers who look after units for other owners. BalayHub's owner statements already serve this group in a basic way.
- Guesty and Hostaway are the big names. Guesty sells its accounting as a paid add-on that needs a sales call to switch on.
- Escapia and Track are older trust-accounting tools built for licensed managers. Their public details are mostly vendor claims.
- OwnerRez is popular with small managers. Its owner portal was made free in 2023, but current prices are unclear.
- The main pain points in reviews: accounting is hard to follow, channel fees make payouts confusing, and pricing is hard to pin down.
- For a Filipino host with 1 to 10 units, the useful core is simple: a clear statement per owner, a visible fee, expenses, channel fees shown as their own line, and a read-only owner login.

## 2. Pricing

Prices are unclear or conflicting. Verify before any pricing decision.

| Product | What is known | Confidence |
|---|---|---|
| Guesty Accounting | "Accounting by Guesty is a premium feature." Must contact Guesty to activate. No public price. | Official help center. |
| Guesty overall | A review site says pricing starts near $9 per listing per month, and the owners portal is a paid add-on. | Unverified third-party. |
| Hostaway | No public per-listing price. G2 says Hostaway has not given pricing. Owner features are said to be included in the subscription, with no extra fees. | Vendor pages and G2. Unverified. |
| Escapia | Software Advice lists about $10 per month on a usage basis. Another listing shows $12. Currency is unclear. | Third-party, conflicting. |
| OwnerRez | A 2023 OwnerRez post says the owner portal is free for all users and was split off from property management. Third-party sites show a base plan from $40 to $88 per month, and they disagree on what is included. | Official 2023 post. Current terms unverified. |
| Track | Not researched. | Gap. |
| Hostify | Not researched. | Gap. |

## 3. Feature catalogue

Columns: Area | Feature | What it does | BalayHub has it? (Yes / Partly / No)

BalayHub status is based on the brief. Where the code was not checked, the row says so.

| Area | Feature | What it does | BalayHub has it? |
|---|---|---|---|
| Owners | Owner portal (login for owners) | Owners log in to see their bookings, statements and payouts. Hostaway says the owner gets scoped access to the same dashboard, and the manager picks per owner whether they see full money or only the calendar. Sources: hostaway.com/vacation-rental-guide/owner-portal/ | No |
| Owners | Owner sees only own units | Owner sees only the properties they own. Hostaway says this is the default. | Partly (unverified; check scope in code) |
| Owners | Owner payout method self-service | Guesty lets owners manage their own payout details in the portal. Source: help.guesty.com (Managing owner statements payouts). | No |
| Owners | Owner language setting | Owners can change their language on a "My profile" page in the Guesty portal. | No |
| Owners | Owner statement (monthly) | Summary of revenue, expenses and payments per owner. Guesty creates it automatically. OwnerRez generates monthly statements showing bookings, expenses and total owed. | Yes (for units managed for other owners) |
| Owners | Automatic statement creation | Statements are made on a schedule, not by hand. Guesty: automatic. | Unverified |
| Owners | Statement approval before sending | Guesty: preview, approve, or flag for review. Only approved statements go to owners. | No (unverified) |
| Owners | Regenerate statement after change | If a booking or expense changes after the statement is made, rebuild it. Guesty: must regenerate. | Unverified |
| Owners | Send statements by email or portal | Guesty: after approval, send by portal, email or both. Can send several at once. | Unverified |
| Owners | Bulk download of statements | Guesty beta: download many owner statements at once. | No |
| Owners | Statement layout template | Customisable columns and sections. Hostaway has six sections, including metrics and expenses. Hostaway reviewers say custom layouts sometimes need extra manual work. | Unverified |
| Fees | Management fee as % of gross | Manager takes a set percent of the full booking amount. Most common model in vendor sources (15 to 30 percent typical, 20 to 25 most common). | Partly (unverified; check code) |
| Fees | Management fee as % of net | Percent is taken after channel or processing fees are removed. Depends on the contract. | Partly (unverified) |
| Fees | Flat monthly fee | Fixed amount per month, regardless of bookings. Lodgify gives an example of $400 per month. | Unverified |
| Fees | Per-booking flat fee | Fixed fee for each booking. No source found that calls this a standard model. | Unverified |
| Fees | Per-property commission rate | Each property can have its own commission rate. OwnerRez sets commission per property in the PM configuration. | Unverified |
| Fees | Fee on cleaning fee or taxes | Some contracts charge commission on cleaning fees or taxes. Sources advise defining "gross" in writing. | Unverified |
| Fees | Extra charges (onboarding, maintenance markup, restocking) | Guesty warns to check for add-on charges outside the base commission. | Unverified |
| Channel fees | Channel fee deducted from booking | Airbnb takes a host fee from the payout. For PMS-connected hosts it is 15.5% of the booking subtotal (no tax). Applies from 27 Oct 2025. Source: hostfully.com/blog/airbnb-host-fees/ (vendor blog). | Partly (the guest balance formula in CLAUDE.md includes a channel fee; owner-side display not checked) |
| Channel fees | Channel fee as its own line on owner statement | Shows gross, channel fee and net separately, so owners see why the payout is lower. OwnerRez owner feedback: owners saw gross charges but received much less. | Unverified |
| Channel fees | Commission calculated on net after channel fee | Lodgix sets a channel commission so management fee uses the net payout, not the higher invoice total. Source: support.lodgix.com (balancing Airbnb invoices). | Unverified |
| Channel fees | Booking.com commission and tax line | Booking.com may add tax on its commission. Hospitable users asked for it as a separate line. | Unverified |
| Expenses | Owner expense added to statement | Expense is listed on the owner's statement and reduces the payout. Hostify: owners > expenses. Hostaway: expenses and extras section. | Partly (monthly rentals have expenses; owner-statement link not checked) |
| Expenses | Expense date decides which statement | Hostify: expense dated in a finalised month rolls to the next open statement. | Unverified |
| Expenses | Vendor and description per expense | Hostify requires a vendor and a description. The description prints on the statement. | Unverified |
| Expenses | Bulk expense upload | Hostify allows bulk upload. Amount must use a dot as decimal separator and at most two decimals. | Unverified |
| Expenses | Bills passed to owner | Manager pays a vendor and bills the owner. Hostaway lists maintenance and vendor payments as statement items. | Unverified |
| Reserves | Owner reserve or working-capital balance | Hold back part of an owner's money for future costs. Guesty lets you move funds between owner statements and a working-capital account for cash flow control. Details not read. | No |
| Trust | Trust (escrow) accounting | Owner money is kept separate from the manager's own money. Escapia, Track, VRTrust, Quixar and Guesty all market it. Guesty mentions North Carolina trust compliance. | No |
| Trust | Owner ledger per owner | Running balance for each owner: money in, money out, expenses, adjustments. VRTrust describes owner balances across reservations, deposits, expenses and payouts. | Partly (unverified) |
| Payouts | Record owner payout | Log when an owner was paid, how (bank, cash, check), and a reference. OwnerRez: Owner Payouts > Record Payout. | Unverified |
| Payouts | Automatic bank or ACH payout to owner | Money moved by the software. Guesty: per-payment fee (example $0.95). OwnerRez moves no money itself. | Excluded (payment integration) |
| Payouts | Payout export | Export list of payments made to owners. Guesty help article exists. | Unverified |
| Payouts | Payout timing rules per owner | Custom schedule per owner. OwnerRez: custom payout rules. | No (unverified) |
| Guest money | Guest invoice | Itemised bill for the guest. Hostify: invoices can be exported. | Partly (payment links exist; invoice format not checked) |
| Guest money | Guest receipt | Proof of payment sent to the guest. | Unverified |
| Guest money | Pay-the-balance link | Guest pays rest of the amount through a link. | Yes |
| Guest money | Deposit and full payment | Guest pays a deposit or full amount online. | Yes |
| Refunds | Refund and cancellation adjustment on statement | Refund or cancellation fee changes the owner's money. Guesty has a help article on cancellation fees (title only, content not read). | No |
| Refunds | Cancellation fee split (owner vs manager) | How a cancellation fee is shared. | Unverified (not researched) |
| Reconciliation | Reconcile payouts to bookings | Match money received from Airbnb or Booking.com to each booking. Airbnb pays in batches, so one deposit covers many bookings. VRTrust claims automatic matching with Airbnb, Stripe and bank data. | Partly (channel fee and payment balance exist) |
| Reconciliation | Dispute or hold a difference | Keep unresolved gaps open instead of forcing a match. Smart Order advice for hotels. | No |
| P&L | Profit and loss per property | Income minus expenses for each unit per month. | Partly (stay reports and monthly rental income and expenses; per-property P&L not checked) |
| P&L | Owner-level P&L | Same, for each owner across their units. | Partly (unverified) |
| Tax | Yearly income and tax summary | Annual totals for tax filing. | Yes |
| Tax | Tax reports (VAT, withholding, 1099-style) | Reports for tax authorities. Escapia and others claim tax reports; details not found. Philippines rules not researched. | Partly (yearly summary exists; format for BIR not checked) |
| Tax | Tax line on guest bill | Taxes shown on the guest invoice and kept out of commission base. | Unverified |
| Multi-currency | Multiple currencies on statements | Guesty statements use the account's default currency. Credit/debit template uses each listing's currency. | No (PHP assumed; unverified) |
| Multi-currency | Exchange rate handling | How foreign-currency amounts are converted. Not researched. | No |
| Budget | Budget per property | Plan income and expenses, compare to actual. No source found for any of the six products. | No |
| Budget | Variance report | Actual against budget. | No |

## 4. Standout features

Sources are search-result snippets, not full reads.

1. **One owner statement, auto-made every month.** Guesty makes statements automatically and lets you approve them before sending. Source: help.guesty.com (Managing owner statements payouts).
2. **Owner portal that shows statements and payouts.** Owners log in and see their money without asking the manager. Hostaway and OwnerRez both offer this. Sources: hostaway.com/features/owner-portal/ and ownerrez.com/support/articles/property-management-overview-legacy.
3. **Fee set per property.** OwnerRez lets each property have its own commission rate. Source: ownerrez.com/support/articles/property-management-owner-statements-setup-configuration.
4. **Clear split on the statement.** Hostaway shows the owner payout and the manager's cut side by side. Source: hostaway.com/features/owner-statement/.
5. **Expenses flow into the next statement.** Hostify puts an expense into the next open statement by date. Source: help.hostify.com/en/articles/10325900-manage-expenses.
6. **Owner can change payout details themselves.** Guesty lets owners edit their own payout method. Source: help.guesty.com (Managing owner statements payouts).
7. **Owner statement with metrics.** Hostaway's six-section statement starts with headline totals and the formula behind them. Source: hostaway.com/features/owner-statement/.
8. **Reconciliation claims.** VRTrust says it matches Airbnb, Stripe, bank and owner data. Vendor claim, unverified. Source: vrplatform.app/trust-accounting-software-property-managers.
9. **Owner reporting praised.** Capterra reviewers praise owner reporting once set up. Source: capterra.com/p/159377/Guesty/reviews/?page=2.
10. **Payouts visibility.** Capterra reviewers mostly praise Hostaway's owner statements and payout visibility. Source: capterra.com/p/152433/Hostaway/reviews/.

## 5. Complaints and gaps from reviews

- **Accounting is the weakest part of Guesty.** Some reviewers say accounting and payments are confusing, costly and need a lot of manual help. One owner moved to third-party trust software because Guesty's module was hard to follow. Source: capterra.com/p/159377/Guesty/reviews/?page=2 (Capterra summary, AI-generated, small sample of about 58 reviews).
- **Bank link is weak.** A reviewer wanted accounting that links to their bank. Guesty said it was looking at bank integration. Source: same Capterra page.
- **Price is hard to read.** Some Guesty reviewers say pricing is expensive, not transparent, and rises with extra modules. Source: same Capterra page.
- **Hidden fees (Hostaway).** One owner says Hostaway has lots of hidden fees. Source: g2.com/products/hostaway/pricing (review snippet).
- **Hostaway steep learning curve.** G2 reviewers say the platform has many features and takes time to learn. Source: g2.com/products/hostaway/pricing.
- **Hostaway mobile gaps.** One reviewer wants financial reports and owner statements on the phone app. Source: g2.com/products/hostaway/pricing.
- **Hostaway custom statements need work.** Reviewers say custom owner statements sometimes need manual work or third-party tools. Source: capterra.com/p/152433/Hostaway/reviews/.
- **Channel fees confuse owners.** An OwnerRez feature request says owners saw gross charges, but a much lower amount was deposited after Airbnb's deductions. Source: ownerrez.com/forums/requests/feature-request-better-reconciliation-for-channelcollected-payments.
- **Payouts do not match owner statements.** Hospitable users report owner payouts that do not match OTA payouts. Source: community.hospitable.com (OTA payouts not correlating with owner payments).
- **Tax on OTA commission missing from statements.** Hospitable users ask for a GST/VAT line on Booking.com commission on owner statements. Source: feedback.hospitable.com (automatic GST/VAT line item on owner statements).
- **Timing mismatch.** Owner statements count revenue on check-in or check-out date, but the OTA pays on its own schedule. The same booking can fall in different months. Source: community.hospitable.com (same thread).
- **Airbnb batches payouts.** One deposit can cover many bookings, so the bank alone cannot show which booking paid. Source: vrplatform.app/blog/how-to-reconcile-airbnb-payouts-quickbooks (vendor blog).
- **Disputes can be netted to the wrong booking.** One guide says a dispute on one reservation can be taken from another booking's payout. Source: same guide area (vendor blog, unverified).
- **Escapia claims inconsistent.** Escapia says it has 25 years in one page and 30 years in another. Its "most reliable" claim has no independent proof. Source: escapia.com/vacation-rental-trust-accounting-software/ (vendor claims).
- **Small managers may not need trust software.** Hostfully's comparison says managers with under five units can often run finances in a spreadsheet. Source: hostfully.com/blog/vacation-rental-accounting-software (vendor blog).
- **OwnerRez pricing unclear.** Third-party sites disagree on base price and on what the portal includes. Sources: pricingsaas.com/companies/ownerrez, toolradar.com/tools/ownerrez/pricing.
- **Escapia pricing unclear.** Two listings show $10 and $12 per month. Source: softwareadvice.com.au/software/133492/escapia.

No reviews found on refunds, budgeting, P&L per property or multi-currency. These are gaps in the research, not proof of gaps in the products.

## 6. Ideas for BalayHub

- **Must: Owner login (read only).** Owners see their statements, bookings and payouts without messaging the manager. Owners ask for this most. Owner portal is listed as No.
- **Must: Fee setting per owner or per unit.** Support percent of gross, percent of net after channel fee, and flat monthly. Show the chosen rule on every statement. Most managers charge this way, and disputes start when the rule is unclear.
- **Must: Channel fee as its own line.** Show gross booking, channel fee, expenses, fee and owner payout separately. Airbnb's 15.5% host fee now applies to PMS-connected hosts, so owners will see smaller payouts.
- **Must: Expenses and bills on the owner statement.** Let the manager add a repair or cleaning bill to one owner's statement, with date and description. Matching the expense date to a statement month avoids double counting.
- **Must: Statement approval before it goes to the owner.** Manager reviews, then sends. Stops errors reaching owners.
- **Should: Owner payout record.** Log when, how (GCash, Maya, bank, cash) and the reference for each owner payment. No bank link needed. Keeps the owner ledger true.
- **Should: Reserve or holdback per owner.** Hold back a set amount for future repairs. Lets managers avoid asking owners for top-ups.
- **Should: Refund and cancellation adjustments on statements.** When a booking is refunded or cancelled with a fee, the owner statement shows it. Otherwise payouts look wrong.
- **Should: Profit and loss per unit each month.** Income minus expenses per property. Filipino hosts with several units need this to decide what to keep renting.
- **Should: Owner statement sent by email and as a PDF.** Many owners do not log in. Email is their default channel.
- **Could: Budget per unit.** Plan monthly income and costs, then compare to actual. No product researched had a clear version.
- **Could: Bulk statement download.** Useful for managers with many owners. Low priority at 1 to 10 units.
- **Could: Guest invoice and receipt PDF.** Itemised bill and proof of payment for the guest. Useful for corporate or monthly guests.
- **Could: Owner payout timing rules.** Monthly, or on a set day. Low priority.
- **Could: Trust-style separate ledger.** Keep owner money separate from the manager's money. Check Philippine rules with an accountant before building; not researched. Put this question in BLOCKERS.MD if the founder wants it.
- **Could: Multi-currency.** Only if owners live abroad. Not researched. Likely not needed for PHP-only hosts.

Open questions for the founder (plain English):
- Which fee rule do most of your owners use: percent of gross, percent of net after the channel fee, or a flat monthly fee?
- Do owners need to log in, or is an emailed PDF enough?

## 7. Excluded (integrations/API/AI)

- Accounting software sync (QuickBooks, Xero and similar), including OwnerRez's QuickBooks ACH payouts.
- Automatic bank or ACH payouts to owners, which need a payment provider integration.
- Channel-manager API connections, including Airbnb and Booking.com data feeds used for reconciliation.
- Any AI feature, including AI statement summaries or AI reconciliation.

## 8. Sources

- https://help.guesty.com/hc/en-gb/sections/9112098852509-Managing-owner-statements-payouts
- https://help.guesty.com/hc/en-gb/sections/9112098852509-Owner-statements-expenses-charges
- https://help.guesty.com/hc/en-gb/sections/9112098852509-Owner-Statements
- https://help.guesty.com/hc/en-gb/articles/9370418394141-Sending-owner-statements
- https://help.guesty.com/hc/en-gb/articles/9383160667933-Getting-started-with-Guesty-Accounting-and-owner-financial-management
- https://help.guesty.com/hc/en-gb/articles/9369443472285-Getting-started-with-owner-statements
- https://help.guesty.com/hc/en-gb/articles/9370464544541-Exporting-payments-made-to-an-owner
- https://help.guesty.com/hc/en-gb/articles/9383359529373 (cancellation fees; title only)
- https://help.guesty.com/hc/en-gb/articles/24235745381533-New-releases-2025
- https://www.guesty.com/guestypedia/owners-portal
- https://www.guesty.com/ach-onboarding-terms-and-conditions-us/
- https://www.guesty.com/wp-content/uploads/2026/02/Accounting-Releases-Guide-2026.pdf (listed in search, not read)
- https://guesty.com/lp/guesty-vs-hostaway
- https://zeevou.com/pms/guesty/
- https://help.guestyforhosts.com/hc/en-gb/articles/9351176857373-Income-Reports-Overview
- https://www.capterra.com/p/159377/Guesty/reviews/?page=2
- https://www.capterra.com/p/152433/Hostaway/reviews/
- https://www.hostaway.com/vacation-rental-guide/owner-portal/
- https://www.hostaway.com/features/owner-portal/
- https://www.hostaway.com/features/owner-statement/
- https://www.hostaway.com/glossary/commission-rate/
- https://www.hostaway.com/glossary/revenue-split/
- https://www.hostaway.com/glossary/payout/
- https://www.hostaway.com/vacation-rental-accounting
- https://support.hostaway.com/hc/en-us/community/posts/10413177466523-Reconciling-reservation-payouts
- https://g2.com/products/hostaway/pricing
- https://www.ownerrez.com/support/articles/property-management-owner-payouts
- https://www.ownerrez.com/support/articles/property-management-overview-legacy
- https://ownerrez.com/support/articles/property-management-owner-statements-setup-configuration
- https://ownerrez.com/support/articles/direct-owner-payments
- https://www.ownerrez.com/blog/new-ownerrez-pricing-for-2023
- https://pricingsaas.com/companies/ownerrez
- https://toolradar.com/tools/ownerrez/pricing
- https://www.ownerrez.com/forums/requests/feature-request-better-reconciliation-for-channelcollected-payments
- https://help.hostify.com/en/articles/10325900-manage-expenses
- https://help.hostify.com/en/articles/10327261-invoices-and-hostify
- https://www.hostfully.com/blog/airbnb-host-fees/
- https://www.hostfully.com/blog/vacation-rental-accounting-software
- https://www.hostfully.com/pmp-features/owner-financial-reports/
- https://www.futurestay.com/read/airbnb-host-fee-calculator-2026-breakdown
- https://escapia.com/features/trust-accounting/
- https://www.escapia.com/vacation-rental-trust-accounting-software/
- https://www.escapia.com/escapia-comparisons/escapia-vs-lodgify/
- https://www.softwareadvice.com.au/software/133492/escapia
- https://www.vrplatform.app/trust-accounting-software-property-managers
- https://www.vrplatform.app/owner-statement-software-vacation-rentals
- https://www.vrplatform.app/blog/how-to-reconcile-airbnb-payouts-quickbooks
- https://encyclopedia.lodgify.com/property-management-cost
- https://www.redawning.com/pm/post/vacation-rental-management-fees
- https://rentalrealestate.com/blog/vacation-rental-property-management-fees-explained-costs-percentages-red-flags/
- https://web2025.guesty.com/blog/airbnb-property-manager-fees-2/
- https://support.lodgix.com/en/articles/5356930-balancing-airbnb-invoices
- https://feedback.hospitable.com/p/automatic-gstvat-line-item-on-owner-statements-for-bookingcom-commission
- https://community.hospitable.com/hospitable-hosts-australia-and-new-zealand-44/ota-payouts-not-correlating-with-owner-payments-1701
- https://www.smartorder.ai/resources/blog/booking-com-payout-reconciliation/

Not found: Track product pages, Hostify pricing, budgeting and P&L detail for any product, refund accounting detail, tax-report formats, multi-currency detail. Searches for these were not completed.
