# 11. Operations and housekeeping tools for short-term rentals

Research date: 2026-10-13. Covers Breezeway, Turno (TurnoverBnB), Properly, Operto Teams, and the task features in Guesty and Hostaway.

**Limits of this research.** The search budget for this run ran out after about 15 searches. Several vendor and review sites could not be opened directly (DNS errors for strspecialist.com, turno.com, support.hostaway.com and getproperly.com), so most claims below come from search result text, not the live pages. Marked "unverified" where that matters. No Reddit threads came up in the results. Lost and found, and cleaner pay tied to hourly time, had almost no usable sources.

## 1. Summary

- This area covers the work done between guests: cleaning, inspections, repairs, restocking, and cleaner pay.
- The main tools are Breezeway, Turno, Properly and Operto Teams. Guesty and Hostaway have task features, but most cleaning depth comes from partner apps.
- These tools are built for hosts with many units and for teams that hire outside cleaners. Filipino hosts with 1–10 units usually have one or two regular cleaners.
- Turno and Properly are the closest to a "cleaner marketplace" model. They let hosts find cleaners and pay them through the app.
- Breezeway is the heaviest tool. Reviewers say it has a steep learning curve and a patchy mobile experience. Its pricing is by quote only.
- The common core is simple: a task is created from a booking, a cleaner works through a checklist with photos, and the host sees the result. Most of the rest is extra.
- Strong reviews praise fast cleaner adoption and automatic task creation. Complaints focus on price, per-clean fees, mobile bugs and missing pay tools.

## 2. Pricing

| Tool | What the sources say | Source |
|---|---|---|
| Breezeway | Host Essentials listed at $19.99 per month. Operations Pro and Operations + Guest Experience show "pricing not disclosed." A free first property is advertised. Guest messaging is an add-on. | [PricingSaaS](https://pricingsaas.com/companies/breezeway), [Subscribed.fyi](https://subscribed.fyi/breezeway/deals/), [StrHub review](https://strhub.com/?p=2351) |
| Properly | Platform plan from $12.99 per property per month, with volume tiers. Includes the cleaner marketplace. 30-day free trial. Free app for cleaners. | [Properly marketplace page (via search)](https://www.getproperly.com/features/marketplace), [GetApp](https://www.getapp.com/all-software/a/properly/) |
| Turno | Free for one property. Free for cleaners who join through the marketplace. Paid plan $10 per property per month, or $96 per property per year, adds non-Turno teammates. 14-day trial. Some reviewers say per-clean payment fees are on top. Sources disagree on whether a free version exists, so check the pricing page. | [Capterra Turno reviews](https://www.capterra.com/p/166734/Turno/reviews/?page=5), [StrHub Turno](https://strhub.com/product/turnoverbnb/), [GetApp Turno](https://www.getapp.com/hospitality-travel-software/a/turno/) |
| Operto Teams (formerly VRScheduler) | One review lists $70 per month for up to 10 properties, plus $7 per extra property on the standard plan. Another source says there is no free trial. Unverified. | [StrHub Operto review](https://strspecialist.com/reviews/operto-teams-operations-review), [GetApp VRScheduler](https://www.getapp.ie/software/111883/vrscheduler) |
| Hostaway tasks | Custom quote for 3 or more listings. Whether task features are included in the base plan is unverified. Cleaning partner apps (TIDY, Turnify and others) are separate products with their own prices. | [StayFi review (Oct 2025)](https://stayfi.com/vrm-insider/2025/10/28/hostaway-app-review/), [Hostaway Marketplace](https://www.hostaway.com/marketplace/tidy) |
| Guesty tasks | Not found in this research. Unverified. | |

## 3. Feature catalogue

BalayHub status comes from the project's own docs (`TRD.MD` and `_BRIEF.md`). "Partly" means some related feature exists.

| Area | Feature | What it does | BalayHub has it? (Yes / Partly / No) |
|---|---|---|---|
| Task automation | Auto-create tasks from bookings | Makes a cleaning or check task when a reservation is booked or ends. Breezeway, Guesty ("Auto Tasks") and Hostaway ("Manage Auto-tasks") do this. [Hostaway](https://support.hostaway.com/hc/en-us/articles/360002564074-Tasks-Use-and-Calendar), [Guesty](https://help-lite.guesty.com/hc/en-gb/articles/24940592448925) | Partly. Cleaning tasks for departures are created every 15 minutes (`TRD.MD`). Stays longer than a few days may need manual tasks (unverified). |
| Task automation | Custom rules | Rules by property, reservation length or task type. Breezeway: "custom rules" for scheduling. [StrHub Breezeway](https://strhub.com/?p=2351) | No |
| Task automation | Recurring preventive tasks | Repeats tasks such as filter changes or monthly checks. Breezeway and Bookerville mention this. [Bookerville](https://www.bookerville.com/VacationRentalHousekeepingSoftware) | No (monthly rentals have maintenance, not recurring tasks, per the brief) |
| Scheduling | Cleaner calendar | Shows tasks by day or week for all cleaners. Hostaway has a Tasks calendar. Operto has drag-and-drop with workload balancing. [Hostaway](https://support.hostaway.com/hc/en-us/articles/360002564074-Tasks-Use-and-Calendar), [Operto (via search)](https://www.guesty.com/marketplace-items/opertoteams/) | Partly (tasks exist; a calendar view is not confirmed in the brief) |
| Scheduling | Assign a task to a cleaner | Pick who does each job. Hostaway and Breezeway both do this. | Partly (team roles and property scoping exist) |
| Scheduling | Workload balancing | Spreads jobs across cleaners. Operto says it does this. | No |
| Scheduling | Automatic dispatch to a preferred cleaner | Sends the job to a set cleaner, or first to whoever accepts. Properly offers both. | No |
| Checklists | Task checklist templates | Reusable step lists per task type. Hostaway calls them "Checklist Templates." Breezeway has a template library. [Hostaway](https://support.hostaway.com/hc/en-us/articles/360002564054-Checklist-Templates) | Yes (cleaning tasks and checklists exist) |
| Checklists | Photo proof per step | Cleaner photographs each room or item. Turno, Properly and Breezeway all do this. [Turno](https://turno.com/en-gb/features/problem-reporting/) | Yes (checklists with photos) |
| Checklists | Before and after photos with time stamps | Timestamped photos prove the work was done. CleanTrackPro and CleanClac do this. [CleanTrackPro](https://apps.apple.com/ca/app/cleantrackpro/id6743517437), [CleanClac](https://www.getapp.co.uk/software/2142605/cleanclac) | Partly (photos exist; time stamps not confirmed) |
| Inspections | Post-clean inspection | Manager checks the job against a checklist after the cleaner finishes. Breezeway has "quality inspection management." [StrHub Breezeway](https://strhub.com/?p=2351) | No |
| Inspections | Quality score per cleaner or unit | Gives a score from checklist results and photos. Breezeway and Properly mention quality control, not a specific score (unverified). | No |
| Inspections | Monthly property inspection | Scheduled deep check with photos per room. [RedAwning guide](https://redawning.com/pm/post/property-inspections-for-short-term-rentals-checklists-tools-automation-for-airbnb-hosts) | No |
| Inspections | Pre-arrival check | Manager checks the unit before the next guest. Recommended by guides (15–30 minutes). [RedAwning guide](https://redawning.com/pm/post/property-inspections-for-short-term-rentals-checklists-tools-automation-for-airbnb-hosts) | No |
| Maintenance | Work order from a cleaner | Cleaner reports a fault and it becomes a repair ticket. Bookerville turns housekeeping reports into work orders. [Bookerville](https://www.bookerville.com/VacationRentalHousekeepingSoftware) | No (monthly rentals have maintenance; short stays do not) |
| Maintenance | Repair tracking and status | Ticket moves from reported to fixed, with cost and photos. Breezeway and Turno (problem reporting) do this. | Partly (monthly rentals: maintenance records) |
| Maintenance | Recurring preventive maintenance | Automatic repeat tasks such as AC cleaning. Breezeway and Bookerville list it. | No |
| Maintenance | Repair contact passing | Photos and details go to a repair person. Turno does this. [Turno](https://turno.com/en-gb/features/problem-reporting/) | No |
| Inventory | Par levels per property | Target count for each item (for example, 3 bath towels per guest). Guides suggest 1.5–2x average use as a buffer. [StrSpecialist](https://strspecialist.com/airbnb-inventory-that-never-runs-out-par-levels-bins-and-reorder-rules) | No |
| Inventory | Restock checklist at turnover | Cleaner tops up each item and notes what is used. Turno and Breezeway list inventory tracking. [Hostaway glossary](https://www.hostaway.com/glossary/inventory-management/) | No |
| Inventory | Low-stock alerts | Warns when an item drops below par. Breezeway's listing mentions alerts (unverified). | No |
| Inventory | Linen and toiletry counts | Counts linen per room, in use, in wash and in storage. Guides suggest 3 bath towels per guest. | No |
| Inventory | Purchase list and cost | Shows what to buy and what it costs. | No |
| Lost and found | Lost item log | Records items left by guests, with photos, and holds them for pickup or return. Operto's mobile app mentions lost-and-found records (search snippet). [Operto (via search)](https://www.getapp.ie/software/111883/vrscheduler) | No |
| Lost and found | Guest belongings message | Tells the guest an item was found. Not found in sources. | No |
| Damage | Damage report with photos | Cleaner reports broken or missing items, with photos, during a task. Lodgix limits this to tasks in progress. [Lodgix](https://support.lodgix.com/en/articles/8230183-damage-notices-and-checklists-lodgix-admin-app), [Turno](https://turno.com/en-gb/features/problem-reporting/) | Partly (security deposits exist; no cleaner damage report) |
| Damage | Link damage to a stay and deposit | Ties the report to the guest and the deposit. | Partly (deposits are linked to stays) |
| Time and pay | Clock in and clock out | Records start and end time for each job. Clockify and CleanClac do this. [Clockify](https://clockify.me/cleaning-time-clock), [CleanClac](https://www.getapp.co.uk/software/2142605/cleanclac) | No |
| Time and pay | Pay per clean | Sets a fee per job type and pays it when done. Turno pays cleaners through Stripe after each job (per StrHub). [StrHub Turno](https://strhub.com/product/turnoverbnb/) | No |
| Time and pay | Hourly pay and payroll export | Totals hours per cleaner per week. Operto has time tracking and payroll support (via search). | No |
| Time and pay | Pay statements for cleaners | Lists the jobs and amounts a cleaner earned in a period. Turno reviewers want invoices they can mark as paid. [Capterra Turno reviews](https://www.capterra.com/p/166734/Turno/reviews/?page=5) | No (owner statements exist for owners, not cleaners) |
| Time and pay | Mark pay as paid outside the app | Records cash or bank pay that happened outside the system. Turno users ask for this. | No |
| Marketplace | Find cleaners | Host browses vetted cleaners in the area and hires them. Turno and Properly both offer this. [Properly](https://www.getproperly.com/features/marketplace) | No |
| Marketplace | Cleaner vetting and ratings | Verified cleaners with ratings from hosts. Properly says all providers are verified; the ratings are from its own platform. | No |
| Marketplace | Cleaner fees | Fee taken from the host or the cleaner per job. Reviewers complain about this on Turno. | No |
| Staff app | Phone app for cleaners | Cleaner sees tasks, checklists and photos on a phone. Turno, Properly, Hostaway and Breezeway all have one. | Yes (installable app with push notifications; cleaner-specific views not confirmed) |
| Staff app | Push notifications for tasks | Alerts a cleaner about a new or changed job. Hostaway mentions automated notifications. | Yes (push notifications exist, and a cleaning notification type is sent to all roles per `TRD.MD`; users can switch it off) |
| Staff app | Offline use | Cleaner works in a basement or rural unit with no signal. Not found in sources. Unverified. | No |
| Staff app | Notes and messages to host | Cleaner leaves comments per task. Guesty mentions comments from the app. | Partly (team messages and tickets exist; per-task comments not confirmed) |
| Owner log | Operations log for owners | Shows what was done, by whom and when, for each property. Properly's audit trail supports insurance claims. [Properly (via search)](https://subscribed.fyi/properly/reviews/) | Partly (`audit_logs` exists; owners see all entries, managers see their own latest 200 per `TRD.MD`; not a cleaning-focused view) |
| Owner log | Before and after photo record | Owner sees photo history per unit. Bookerville keeps inspection photos per inspection. | No |
| Team | Role-based access per property | Limits what each staff member sees. | Yes (owner, manager, staff with property scoping) |
| Team | Cleaner onboarding | Adds a new cleaner and shows them the checklists. Breezeway reviewers say cleaners adopt it quickly. | Partly (team invites exist; no cleaner training flow) |
| Reports | Cleaning and turnover report | Counts jobs done, late jobs and missed checks. Guesty reviewers praise its housekeeping reports. [Capterra Guesty](https://www.capterra.com/p/159377/Guesty/reviews/?page=18) | Partly (stay reports exist; no cleaning report) |
| Reports | Cost per clean | Shows what each clean cost, for owner statements. | No |
| Multi-unit | Cleaning tasks across many properties | One view of all jobs and cleaners across units. Hostaway and Breezeway do this. | Partly (multi-property with scoping) |
| Mobile | Phone-first task screen | Large buttons and simple steps for cleaners. Breezeway reviewers say the mobile app is hard to use. | Partly (not confirmed for cleaners) |
| Reviews | Cleaning quality from guest reviews | Links low guest ratings to a cleaning task. Not found in sources. Unverified. | No (guest reviews exist, not linked to cleaning) |

## 4. Standout features

1. **Automatic cleaning from bookings.** Tasks appear by themselves when a guest checks out. Hostaway and Breezeway users praise this most. Source: [Hostaway automate cleaning tasks](https://www.hostaway.com/blog/automate-cleaning-tasks/), [StrHub Breezeway](https://strhub.com/?p=2351). BalayHub has a version of this for departures.
2. **Photo checklists that create a record.** Cleaners upload photos at each step. Owners check the work without visiting. Sources: [Turno](https://turno.com/en-gb/features/problem-reporting/), [Properly (via search)](https://www.getproperly.com/features/marketplace).
3. **Easy cleaner adoption.** One Breezeway host with 12 listings said all cleaners adopted the app and checklists quickly. Source: [Capterra Breezeway reviews](https://www.capterra.com/p/186514/Breezeway/reviews/?page=3).
4. **Pay in one place.** Turno reviewers say cleaner payment and coordination happen in one app. Source: [Capterra Turno reviews](https://www.capterra.com/p/166734/Turno/reviews/?page=5). Turno's payments use Stripe (per StrHub, unverified on Turno's site).
5. **Responsive support.** Turno reviewers say chat support is quick. Source: [Capterra Turno reviews](https://www.capterra.com/p/166734/Turno/reviews/?page=5).
6. **Verified cleaner marketplace.** Properly says all providers are vetted and hosts can choose auto-dispatch or first come first served. Source: [Properly marketplace](https://www.getproperly.com/features/marketplace).
7. **Damage reports with photos.** Lodgix ties damage notices to tasks in progress, with photos sent to the manager. Source: [Lodgix](https://support.lodgix.com/en/articles/8230183-damage-notices-and-checklists-lodgix-admin-app).
8. **Audit trail for insurance.** Properly says its records help with insurance claims. Source: [Subscribed.fyi Properly](https://subscribed.fyi/properly/reviews/).
9. **Par-level restocking.** Guides explain how to set par levels and how to build restock prompts into the cleaner's checklist. Source: [StrSpecialist restock rules](https://strspecialist.com/never-run-out-again-airbnb-restock-rules-bins-and-cleaner-prompts).
10. **Free starter tiers.** Turno and Breezeway both offer a free first property. Sources: [StrHub Turno](https://strhub.com/product/turnoverbnb/), [Subscribed.fyi Breezeway](https://subscribed.fyi/breezeway/deals/).

## 5. Complaints and gaps from reviews

**Price and fees**
- Turno: "Fees: One manager called the online payment fees (on top of subscription fees) and the lack of downloadable reports the main drawbacks." Source: [StrHub Turno](https://strhub.com/product/turnoverbnb/).
- Turno: reviewers call payment processing and per-clean fees high, and dislike non-prorated refunds. Source: [Capterra Turno reviews](https://www.capterra.com/p/166734/Turno/reviews/?page=5).
- Turno: a long-time user says a per-property plan came in with little notice. Source: [StrHub Turno](https://strhub.com/product/turnoverbnb/).
- Breezeway: pricing is by quote only, which makes budgeting hard. Source: [Capterra Breezeway reviews](https://www.capterra.com/p/186514/Breezeway/reviews/?page=3).
- Breezeway: a PissedConsumer page reports high price and recurring billing complaints. Anecdotal. Source: [PissedConsumer (via search)](https://www.pissedconsumer.com/breezeway/RT-F.html).

**Complexity**
- Breezeway: "every day I learn something new that I wish I knew before." Source: [Capterra Breezeway reviews](https://www.capterra.com/p/186514/Breezeway/reviews/?page=3).
- Breezeway: one owner says there are "too many features that are not needed." Source: [Capterra Breezeway reviews](https://www.capterra.com/p/186514/Breezeway/reviews/?page=3).
- Guesty: a reviewer says it takes a couple of months to learn, and it suits operators with more than 10 listings. Source: [Capterra Guesty reviews](https://www.capterra.com/p/159377/Guesty/reviews/?page=18).

**Mobile and bugs**
- Breezeway: the app keeps logging users out, and the mobile version is hard to navigate. Source: [Capterra Breezeway reviews](https://www.capterra.com/p/186514/Breezeway/reviews/?page=3).
- Breezeway: a reviewer says a basic upload problem was fixed only after years. Source: [Capterra Breezeway reviews](https://www.capterra.com/p/186514/Breezeway/reviews/?page=3).
- Turno: photo uploads sometimes glitch in the field. Source: [StrHub Turno](https://strhub.com/product/turnoverbnb/).
- Turno: missed notifications and jobs created twice for one stay. Source: [StrHub Turno](https://strhub.com/product/turnoverbnb/).
- Guesty: a reviewer reports a financial reporting bug and an incomplete inbox link. Source: [Capterra Guesty reviews](https://www.capterra.com/p/159377/Guesty/reviews/?page=18).
- Operto: the Capterra review says there is no mobile app (old listing). Source: [Operto (via search)](https://www.capterra.mx/software/170587/opertoteams).

**Missing features**
- Turno: hosts want cleaners to upload photos of finished work and video, and want invoices they can mark as paid. Source: [Capterra Turno reviews](https://www.capterra.com/p/166734/Turno/reviews/?page=5).
- Breezeway: no way to pay the team through the platform. Source: [StrHub Breezeway](https://strhub.com/?p=2351).
- Breezeway: no way for owners to see progress on a checklist still in progress. Source: [Capterra Breezeway reviews](https://www.capterra.com/p/186514/Breezeway/reviews/?page=3).
- Operto: iCal-only sync means manual updates. Source: [Operto (via search)](https://www.capterra.com/p/170587/VRScheduler/).
- Lost and found: no source found for any tool.

**Support**
- Breezeway: an unresolved email and password issue, and slow responses. Anecdotal. Source: [PissedConsumer (via search)](https://www.pissedconsumer.com/breezeway/RT-F.html).
- Turno: support is praised, especially chat. Source: [Capterra Turno reviews](https://www.capterra.com/p/166734/Turno/reviews/?page=5).

**Fit for small hosts**
- Most of these tools are built for 10 or more units. The heavier ones (Breezeway, Guesty, Hostaway) have setup costs a 2-unit host will not recover. Source: [Capterra Guesty reviews](https://www.capterra.com/p/159377/Guesty/reviews/?page=18).
- Turno's free single-property plan is the closest fit for a 1–3 unit host. Source: [StrHub Turno](https://strhub.com/product/turnoverbnb/).

## 6. Ideas for BalayHub

Each idea is native to BalayHub. None needs a link to another tool.

**Must**
- **Cleaner calendar and assignment.** Why: a Filipino host with one or two cleaners needs to see who is doing which unit on which day, and to move jobs when a booking changes.
- **Inspection checklist with pass or fail per item and a simple score.** Why: a host who cannot visit each unit needs proof before the next guest arrives, and a score per cleaner shows who needs help.
- **Damage report from the cleaner's phone.** Why: broken or missing items found during a clean should link to the stay and the security deposit, so the host can claim it.
- **Par levels and restock step in the cleaning checklist.** Why: towels, toiletries and linen run out between guests; a per-unit par list stops last-minute runs to the store.
- **Cleaner time log and pay per clean.** Why: most small hosts pay cleaners by the job or by the hour and do it in cash or GCash; a record of what was earned and paid is the main pain point in the reviews.
- **Owner-visible operations log.** Why: owners want proof of work. BalayHub's `audit_logs` already exists; a plain owner feed of cleaning, damage and restock events would meet the need.

**Should**
- **Lost and found log per unit.** Why: guests often leave chargers, shoes and keys. A photo, a date and a "returned to guest" button fits the existing guest profile.
- **Work orders from a cleaner.** Why: a cleaner who sees a leaking tap should report it once, with a photo, to the host. Extends the existing monthly-rental maintenance to short stays.
- **Recurring preventive tasks.** Why: AC cleaning, filter changes and monthly checks are common and easy to forget. Reuses the existing task engine.
- **Time stamps on checklist photos.** Why: proves the cleaner was on site, which settles disputes about late or missed cleans.
- **Mark cleaner pay as paid.** Why: Turno reviewers ask for this; it is a small record step, not a payments integration.

**Could**
- **Cleaner marketplace.** Why: hosts with no cleaner would benefit, but vetting, ratings and fees are a large project and reviewers complain about fees. Start with a directory of the host's own cleaners.
- **Pay cleaners through PayMongo or GCash payouts.** Why: removes cash handling. Needs a payout check first (unverified that PayMongo supports cleaner payouts).
- **Quality score trends per cleaner over time.** Why: helps a host decide who to keep; needs several months of inspection data first.
- **Offline checklist mode for the cleaner app.** Why: some units have poor signal. The installable app may already cache pages; this needs a test.

## 7. Excluded (integrations/API/AI)

- Integrations and sync with Breezeway, Turno, Properly, Operto Teams, Guesty, Hostaway, TIDY, ResortCleaning and similar tools.
- Operto's QuickBooks and payroll-software sync, and any accounting-software sync.
- Marketplace listings and app-store integrations for these tools.
- Guesty's "AI-powered workflows" and any AI-based task or scheduling.
- Any AI assistant that writes checklists, rules or guest messages.

## 8. Sources

Search results and pages from this run. Pages marked "via search" were not opened directly.

- https://strspecialist.com/reviews/breezeway-cleaning-ops-review (via search; direct fetch failed)
- https://strspecialist.com/reviews/operto-teams-operations-review (via search; direct fetch failed)
- https://pricingsaas.com/companies/breezeway
- https://subscribed.fyi/breezeway/deals/
- https://subscribed.fyi/properly/reviews/
- https://strhub.com/?p=2351
- https://strhub.com/product/turnoverbnb/
- https://www.capterra.com/p/186514/Breezeway/reviews/?page=3
- https://www.capterra.com/p/166734/Turno/reviews/?page=5
- https://www.capterra.com/p/159377/Guesty/reviews/?page=18
- https://www.capterra.com/p/170587/VRScheduler/
- https://www.capterra.mx/software/170587/opertoteams
- https://www.softwareadvice.com/property/turno-profile/reviews/
- https://www.getapp.com/hospitality-travel-software/a/turno/
- https://www.getapp.com/all-software/a/properly/
- https://www.getapp.ie/software/111883/vrscheduler
- https://www.getproperly.com/features/marketplace (via search; direct fetch failed)
- https://getproperly.com/breezeway-alternative (competitor page; self-interested)
- https://turno.com/en-gb/features/problem-reporting/ (via search; direct fetch failed)
- https://www.guesty.com/marketplace-items/opertoteams/
- https://www.guesty.com/marketplace-items/breezeway
- https://www.guesty.com/features/automation-tools/ (AI-heavy page; only the task claims were used)
- https://help-lite.guesty.com/hc/en-gb/articles/24940592448925
- https://support.hostaway.com/hc/en-us/articles/360002564074-Tasks-Use-and-Calendar (via search; direct fetch failed)
- https://support.hostaway.com/hc/en-us/articles/360002564054-Checklist-Templates (via search)
- https://www.hostaway.com/blog/automate-cleaning-tasks/
- https://www.hostaway.com/glossary/inventory-management/
- https://www.hostaway.com/marketplace/properly
- https://www.hostaway.com/marketplace/tidy
- https://stayfi.com/vrm-insider/2025/10/28/hostaway-app-review/
- https://support.lodgix.com/en/articles/8230183-damage-notices-and-checklists-lodgix-admin-app
- https://www.bookerville.com/VacationRentalHousekeepingSoftware
- https://redawning.com/pm/post/property-inspections-for-short-term-rentals-checklists-tools-automation-for-airbnb-hosts
- https://strspecialist.com/airbnb-inventory-that-never-runs-out-par-levels-bins-and-reorder-rules
- https://strspecialist.com/never-run-out-again-airbnb-restock-rules-bins-and-cleaner-prompts
- https://hello.pricelabs.co/vacation-rental-inventory-checklist/?amp=1
- https://go.tidy.com/blog/short-term-rental-inventory-checklist-ultimate-guide
- https://oxmaint.com/industries/property-management/short-term-rental-property-maintenance-airbnb-vacation-rental-2026
- https://clockify.me/cleaning-time-clock
- https://apps.apple.com/ca/app/cleantrackpro/id6743517437
- https://www.getapp.co.uk/software/2142605/cleanclac
- https://www.capterra.com/p/252904/ResortCleaning/reviews/4765221/
- https://www.pissedconsumer.com/breezeway/RT-F.html
- BalayHub: `TRD.MD` (lines on housekeeping job, notification types, audit log) and `docs/research/_BRIEF.md`.
