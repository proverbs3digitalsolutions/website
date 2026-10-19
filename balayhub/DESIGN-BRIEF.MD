# BalayHub design brief

Last updated: 2026-10-15 (QA round 17: section 26, the wordmark logotype exemption, the focus key table; D-98 and D-99)

**Summary.** BalayHub is a phone-first web app (also an installable PWA) for Filipino rental and staycation hosts. It is built with plain CSS, one stylesheet (`public/css/app.css`), and small JavaScript helpers (`public/js/ui.js`). There is no framework and no CSS preprocessor. The look is calm and practical: Forest Green on soft off-white, Sand and Sun as warm accents, Poppins for headings, Inter for text, rounded cards, and large touch targets. Colours come from CSS custom properties on `:root`. A dark theme redefines the same tokens, so any component that uses tokens gets dark mode automatically. This brief records what is **actually built**. Every value below comes from the code. Where the code doesn't define a token (spacing, type sizes), the brief lists the values in use and says so.

Source files: `public/css/app.css`, `public/js/ui.js`, `public/js/theme.js`, `public/js/themeswitch.js`, `public/js/filters.js`, `public/js/charts.js`, `public/js/assistant.js`, `public/js/app.js` (shell), `public/js/i18n.js`, `public/js/views/landing.js`, `public/manifest.webmanifest`, `public/icons/`, `public/offline.html` + `public/css/offline.css`, `public/favicon.svg`, `public/index.html`.

---

## 1. Brand

| Item | What is built |
|---|---|
| Name | **BalayHub**. *Balay* means "house" in several Philippine languages. The wordmark in `brand()` renders `Balay` + `<b>Hub</b>`. CSS sets it in uppercase Poppins 700 (`text-transform: uppercase; letter-spacing: .01em`), "Balay" in `--accent` and "Hub" in `--sage`. Its `aria-label` is "BalayHub". **The wordmark is a logotype.** WCAG 1.4.3 exempts it, so "Hub" keeps `--sage` (2.5:1 on white). Sweep lanes do not file it (D-99, O2). |
| Logo mark | `logo()` in `ui.js` and `favicon.svg`: a square-capped **house outline with a door** (stroke `currentColor`, so it takes the Forest Green brand colour) and a **warm sun** circle top right (`#d6a85c`, the `--sun` value). In plain words, it is a home under the sun. The house stands for hosting and the sun for staycations and warmth. |
| Brand colours | Forest Green `#0f5132`, Sage Green `#7fb069`, Sand Beige `#dcc9a3`, Soft Off-White `#f8f9f6`, Charcoal Navy `#1f2937` (named in the `:root` comment). Sun `#d6a85c` is the logo accent. |
| Favicon | `favicon.svg`: the mark on an off-white rounded square (`rx=14`, fill `#f8f9f6`), with the house in `#0f5132`. |
| PWA | `manifest.webmanifest`: name and short name "BalayHub", `theme_color #0f5132`, `background_color #f8f9f6`, `display: standalone`, `start_url /#/home`. Icons: `icon-192.png`, `icon-512.png`, `maskable-512.png` (purpose maskable), and `apple-touch-icon.png`. `index.html` sets `theme-color` to `#0f5132` in light and `#0e1511` in dark. |
| Imagery | One photo, `img/auth-bahay-kubo(.webp / -800.webp)`, a bahay kubo, used on the split login/sign-up screen. Everything else is drawn with icons. |

### Voice and tone

| Principle | In practice (examples from the code) |
|---|---|
| Plain | Say what happened and what to do next: "Couldn't reach BalayHub. Nothing was saved yet — your input is kept. Check your connection and press Save again." |
| Friendly | Greet people by first name: "Hi {first name}! I'm the BalayHub assistant…". Errors are calm: "Something went wrong. Please try again." |
| Practical | Talk about outcomes, not features: "Set up in an afternoon", "Stop switching between three host apps, a spreadsheet, a notebook and a dozen chat threads." |
| Sentence case | Labels, buttons and headings use sentence case: "Help & support", "Unit owners", "Filters", "Contact support with this chat", "Try again". (Known exception: the nav item "Rent & Expenses".) |
| Language | The host app is in **English**. Guest-facing pages (booking, check-in, pay, review) and the landing page offer **English or Tagalog/Taglish** through `i18n.js` (`t()`, `langToggle()`), and set `<html lang>` to `en` or `fil`. The assistant accepts and suggests Taglish ("Paano mag-record ng bayad ng guest?"). Tagalog strings use polite markers ("po") with guests: "Paki-contact po ang host." |
| Money and dates | Peso amounts use `Intl` `en-PH` PHP (`₱1,234.00`), or whole pesos with `pesoShort`. Dates are formatted like "Oct 13, 2026" and times use the `Asia/Manila` timezone. A missing value shows as an em dash "—". |
| Honesty | Say what the system can't do: "It can't see your bookings or guests and may make mistakes." When something is removed, say so: "Nothing was charged." |

---

## 2. Design tokens

All tokens live on `:root` in `app.css`. The dark values are defined **twice**, with identical values: once under `:root[data-theme="dark"]` and once under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`.

### 2.1 Brand and accent colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--forest` | `#0f5132` | `#1f7a4f` | Brand fill: active nav, active tabs and chips, assistant header, avatars, progress dots |
| `--teal` | `#0f5132` | `#1f7a4f` | Alias of forest. Primary button, focus border, bars, checkbox accent |
| `--teal-2` | `#0a3d25` | `#186240` | Primary button hover, text on `--teal-soft` |
| `--teal-soft` | `#e7f1e9` | `#1b3326` | Soft green fills: quick actions, today column, sidebar hover, feature icons |
| `--accent` | `#0f5132` | `#8fd0a6` | Links, brand text, eyebrow text, active bottom-nav item. In dark mode it becomes a light mint so it stays readable on dark surfaces. |
| `--sage` | `#7fb069` | `#8fc27a` | "Hub" in the wordmark, season shading on the calendar |
| `--sand` | `#dcc9a3` | `#c9b68f` | Holiday shading, timeline dots, assistant button focus ring |
| `--sand-soft` | `#f6efe1` | `#2a261d` | Warm fills: landing hero gradient, tab panels, total rows, language menu hover |
| `--sun` | `#d6a85c` | `#e0b56c` | Logo sun (the logo hard-codes `#d6a85c`) |
| `--navy` | `#1f2937` | `#eef2ec` | Heading colour, strong labels |
| `--navy-2` | `#374151` | `#cfd8d1` | Defined but not used in the CSS |

### 2.2 Surfaces, lines and text

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f8f9f6` | `#0e1511` | Page background |
| `--surface` | `#ffffff` | `#161f1a` | Cards, bars, inputs, sheets |
| `--surface-2` | `#f4f6f3` | `#1c2721` | Hover rows, chat and message backgrounds, soft cards |
| `--surface-3` | `#e9ede7` | `#243129` | Skeleton shimmer, past calendar days, channel badges in dark mode |
| `--line` | `#e4e8e1` | `#2a372f` | Dividers, table rules, card borders |
| `--line-2` | `#cfd6cb` | `#3a4a40` | Input borders, secondary button border, empty-state icon |
| `--text` | `#1f2937` | `#e6ebe5` | Body text |
| `--muted` | `#5d6762` | `#a2afa7` | Secondary text, labels, inactive nav |
| `--muted-2` | `#a7b0aa` | `#6c7a71` | Faint text (past calendar cells only) |
| `--ink-bg` | `#1f2937` | `#eef2ec` | Inverted surfaces: toasts, demo plan bar, landing step numbers |
| `--ink-text` | `#ffffff` | `#10241a` | Text on `--ink-bg` |
| `--gray-soft` | `#eef1f5` | `#222c26` | Neutral badge, ghost hover, progress track |

`color-scheme` is `light` on `:root` and `dark` in both dark blocks.

### 2.3 Status colours

Each status has a strong colour (text) and a soft colour (fill). They are used together in badges, alerts, plan bars and deltas.

| Meaning | Strong token (light / dark) | Soft token (light / dark) |
|---|---|---|
| Error, overdue, urgent | `--red` `#b42318` / `#f0857a` | `--red-soft` `#fdecea` / `#3a1d1a` |
| Warning, partial, expiring | `--amber` `#a15c07` / `#f0b45c` | `--amber-soft` `#fef3e2` / `#352914` |
| Info, unpaid, open, occupied | `--blue` `#1d5fb8` / `#8db8f2` | `--blue-soft` `#e8f0fc` / `#1a2738` |
| Success, paid, resolved, active | `--green` `#08744a` / `#6fd3a0` | `--green-soft` `#e4f5ec` / `#15301f` |

### 2.4 Badge mapping (`badge(status)` → `.badge--{status}`)

| Colour | Status classes |
|---|---|
| Green | `paid`, `resolved`, `active`, `low` |
| Teal (`--teal-soft` / `--teal-2`) | `vacant` (overrides the green rule) |
| Amber | `partial`, `in_progress`, `medium`, `expiring` |
| Red | `overdue`, `urgent`, `high`, `voided` |
| Blue | `unpaid`, `open`, `occupied` |
| Neutral (`--gray-soft` / `--muted`) | anything else |

Badges are pills: `padding 2px 9px`, `radius 999px`, `.75rem`, weight 750. The text comes from the `LABELS` map in `ui.js`, so it is always sentence case.

### 2.5 Channel colours (hard-coded, not tokens)

| Channel | Badge, light (bg / text) | Badge, dark (text on `--surface-3`) | Calendar bar `.cal-bar--*` (white text) | Landing mock bar `.lp-cal__bar--*` |
|---|---|---|---|---|
| Direct | `--teal-soft` / `--teal-2` | `--accent` | `--teal` | `--teal` |
| Airbnb | `#fdecee` / `#c0263a` | `#ff8a9a` | `#d93b52` | `#d93a50` |
| Booking.com | `#e6eefb` / `#1e4fa3` | `#8db8f2` | `#1e4fa3` | `#1e4fa3` |
| Agoda | `#f2ebfb` / `#6a35b5` | `#c4a2f0` | `#6a35b5` | `#6a35b5` |
| Vrbo | `#e0f4f8` / `#0e6f86` | `#7fd3e6` | `#0891b2` | — |
| Expedia | `#fdeee4` / `#b43c0a` | `#f5a77d` | `#c2410c` | — |
| Trip.com | `#ebeafd` / `#4338ca` | `#a5a2f5` | `#4f46e5` | — |
| Other | `--gray-soft` / `--muted` | `--muted` on `--surface-3` | `#5b6878` | — |
| Blocked dates | — | — | `#c9d1dc`, text `#3b4652` | — |

The calendar bars keep the same colours in dark mode.

### 2.6 Radius

| Token or value | Size | Where |
|---|---|---|
| `--radius` | `14px` | Cards, stats, skeletons |
| `--radius-sm` | `10px` | Alerts. Inputs and small buttons also use 10px, but hard-coded. |
| Hard-coded 12px | | Buttons, quick actions, More-sheet rows, toasts |
| Hard-coded 16–20px | | Landing and booking cards (16), modals, auth card, bottom sheets and the assistant (18), landing preview and tab panel (20) |
| Pill | `999px` / `99px` | Badges, tabs, chips, theme switch, deltas, bars |

### 2.7 Shadows and focus

| Token | Light | Dark |
|---|---|---|
| `--shadow` | `0 1px 2px rgba(16,32,56,.06), 0 4px 16px rgba(16,32,56,.05)` | `0 1px 2px rgba(0,0,0,.35), 0 4px 16px rgba(0,0,0,.25)` |
| `--focus` | `0 0 0 3px rgba(15,81,50,.28)` | `0 0 0 3px rgba(143,208,166,.35)` |

Several larger shadows are hard-coded rather than tokens. Modal: `0 20px 60px rgba(10,20,35,.3)`. Assistant panel: `0 18px 48px rgba(0,0,0,.28)`. Assistant button: `0 8px 24px rgba(0,0,0,.22)`. Landing calendar: `0 10px 40px rgba(16,32,56,.12)`. Booking card hover: `0 8px 28px rgba(16,32,56,.12)`. Language menu: `0 10px 30px rgba(16,32,56,.15)`. Popular plan: `0 10px 30px rgba(14,124,102,.15)`.

### 2.8 Layout tokens

| Token | Value |
|---|---|
| `--sidebar` | `248px` (sidebar width on desktop) |
| `--cal-col` / `--cal-side` (local to `.cal`) | `64px` / `190px`, and `54px` / `128px` at 640px or narrower |

### 2.9 Spacing (no tokens)

There are no spacing tokens. Spacing is written in px, and the values cluster on a 2px grid:

| Step | Typical use |
|---|---|
| 2–4px | Gaps inside rows and labels |
| 6–8px | Chip, tab and button-group gaps; field label to input |
| 10–12px | Toolbar, list row and quick-action gaps; row padding (12px) |
| 14–16px | Form gap (14); card stack and grid gap (16); phone page gutter (16) |
| 18–22px | Card padding (18); modal padding (20); landing card padding (22) |
| 28–32px | Desktop content padding (`28px 32px`); empty-state padding (32) |
| 48–80px | Landing sections (64) and hero (48, or 80 at 920px and up) |

### 2.10 Typography

| Item | Value |
|---|---|
| Heading font | `--font-head`: `"Poppins", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Self-hosted weights 500, 600 and 700, latin and latin-ext (OFL). Used for `h1`–`h4`, the brand, and the Launchpad phase numbers. |
| Body font | `"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Self-hosted variable font, 100–900. Inter latin and Poppins 700 latin are preloaded in `index.html`. |
| Base | `16px`, line-height `1.5`, antialiased. Headings use line-height `1.25`, `letter-spacing -0.01em`, colour `--navy`. |
| Monospace | Not defined. `code.var` uses the browser default. |

| Role | Size / weight |
|---|---|
| `h1` | `1.5rem` / 700 |
| `h2` | `1.12rem` / 600 |
| `h3` | `1rem` / 600 |
| Landing hero h1 | `clamp(2.1rem, 6vw, 3.4rem)`, line-height 1.08, `-0.03em` |
| Landing h2 | `clamp(1.6rem, 4vw, 2.2rem)` |
| Stat value | `clamp(1.1rem, 4.6vw, 1.45rem)` / 800, tabular numbers |
| Hero number | `2rem` / 800 |
| Button | `.95rem` / 700 (small: `.88rem`) |
| Field label | `.9rem` / 700 |
| Table header, stat label, subhead | `.76–.82rem` / 700–750, UPPERCASE, `letter-spacing .04–.05em` |
| Hint, sub text | `.82–.85rem`, `--muted` |
| Badge | `.75rem` / 750 |
| Bottom-nav label | `.72rem` / 700 |

Weights in use: 600, 650, 700, 750 and 800 (Inter is variable, so 650 and 750 render). Amounts and numeric columns use `font-variant-numeric: tabular-nums`.

---

## 3. Theme (light, dark, match device)

| Piece | Behaviour |
|---|---|
| Storage | The `localStorage` key `bh-theme` holds `light`, `dark` or `system` (the default). |
| No-flash boot | `theme.js` runs before the CSS loads. It sets `<html data-theme="light|dark">` when a theme is forced and leaves the attribute off for `system`. |
| Switch | `themeSwitch({ compact })` in `themeswitch.js` is a `role="radiogroup"` named "Colour theme". It has three `role="radio"` buttons with `aria-checked`: a sun icon for Light, a moon icon for Dark and a half-filled circle for Match device. The three icons are the same size and are inline SVG (round 5; they were text characters before). The compact version shows icons only. The selected option is filled `--forest` with white text. |
| Where it appears | Sidebar footer (compact), the phone More sheet (full) and the landing footer (compact). |
| CSS | `:root[data-theme="dark"]` forces dark. With no attribute, `prefers-color-scheme: dark` applies dark. With `data-theme="light"`, the page stays light. |

---

## 4. Layout

### 4.1 App shell (`buildShell` in `app.js`)

| Viewport | Structure |
|---|---|
| **Phone and tablet (< 960px)** | A sticky **topbar** (z 30, safe-area aware) with the brand, organisation name and avatar. The `main.content` area is max 1180px wide, with 16px padding and 96px plus the safe area at the bottom. A fixed **bottom nav** (z 40) has 5 equal columns: the first 4 nav items (excluding Launchpad, and with "Rent & Expenses" shortened to "Rent") plus a **More** button. Icons are 24px and labels `.72rem`. The active item is `--accent`. |
| **More sheet** | `.morenav` is a native `<dialog>` opened with `showModal()`, labelled "More". It has a scrim (`--scrim`) and a bottom sheet no taller than the screen less 16px, which scrolls inside. It lists My account, the remaining nav items, the theme switch and Log out. The rows are 14px-padded links with 22px icons. Escape closes it, a tap on the scrim closes it, and focus goes back to the More button (round 5; it was a plain box with menu roles before). |
| **Desktop (≥ 960px)** | A two-column grid: a sticky full-height **sidebar** (`--sidebar` 248px) and the content. The topbar and bottom nav are hidden. Sidebar links are 20px icon + label, radius 10. Hover is `--teal-soft`, and the current page is filled `--forest` with white text. The footer holds the account link (avatar, name, organisation and role), the compact theme switch and a Log out button. Content padding is `28px 32px 48px`. |
| Plan banner | `.planbar` sits above the content: `--blue-soft` by default, `--warn` amber, `--bad` red, `--demo` ink. Hidden in print. |
| Nav sets | `NAV_SHORT` (staycation), `NAV_LONG` (long-term rental), `NAV_BOTH`, filtered by role. Help & support is always shown, and Admin for platform admins. |
| Unread badge | `.navbadge` is a red pill on the Inbox link, labelled "{n} unread". |
| Floating assistant | `.assist-fab` sits bottom right (z 45), raised above the bottom nav on phones. |

Stacking order: landing top bar 20 → topbar 30 → bottom nav 40 → assistant button 45 → More sheet 50 → offline banner and assistant panel 60 → toasts 100.

### 4.2 Breakpoints

The CSS is mobile-first. There are no breakpoint tokens. These are the values in use:

| Breakpoint | What changes |
|---|---|
| **560px** (`max 559` / `min 560`) | Two-column form rows. Below it: modals become bottom sheets, form-action buttons stretch, and the assistant goes full width. Wide tables with four or more columns show one card per row below this width (section 14). |
| 640px | Calendar column widths, booking calendar shows 2 months, Launchpad art hidden below it, landing nav items hidden |
| **760px** | `.grid--2` and `.grid--3`, 4-column stats and quick actions, 2-column listings |
| 880 / 920px | Welcome and landing hero go two-column; booking layout gets a 380px side panel |
| **960px** | App shell switches to the sidebar. Inbox gets its list and thread columns, toasts move to the bottom, help gets two columns. |
| 1100px | Reservations "saved views" side column |
| 1200 / 1280px | 3-column listings, inbox guest summary column |
| 420 / 480px | Small landing tweaks, and "Powered by" hidden on booking pages |

### 4.3 Page structure

| Pattern | Class / helper |
|---|---|
| Page header | `pageHead({ title, sub, back, actions })` renders an optional `.back` link ("‹ Label"), an `h1` with a muted sub line, and right-aligned `.page-head__actions` that wrap on phones. |
| Grids | `.grid` (16px gap) with `--2` and `--3` modifiers; `.stats` (2 columns, or 4 from 760px); `.stack` (16px vertical rhythm) |
| Prose | `.prose`, max 760px (terms, privacy) |

---

## 5. Components and patterns

### Buttons (`.btn`)

| Variant | Look |
|---|---|
| `--primary` | `--teal` fill, white text, hover `--teal-2` |
| `--secondary` | `--surface` fill, `--line-2` border, `--navy` text; hover border `--navy` |
| `--ghost` | Transparent; hover `--gray-soft` |
| `--danger` | Surface fill, red-tinted border (`color-mix` red 40%), `--red` text; hover `--red-soft` |
| `--sm` | 38px min height, `.88rem`, radius 10 |
| `--block` | Full width |
| `.link-btn` / `.linkbtn` | Underlined `--accent` text button |

Base: min height **46px**, padding `10px 18px`, radius 12, weight 700, 8px gap, 20px icons, `transition .15s`. Disabled is `opacity .6` with a progress cursor. Submit buttons change to "Saving…" while busy.

### Cards, stats and quick actions

| Component | Spec |
|---|---|
| `.card` | `--surface`, `--radius`, `--shadow`, 18px padding. `.card__head` is a flex row (title on the left, link on the right). Modifiers: `--flush` (no padding), `--soft` (`--surface-2`, no shadow). |
| `.stat` | Uppercase muted label, a large 800-weight value, and a muted sub line. `--alert` makes the value red, `--good` green, `--flat` gives a border and no shadow. |
| `.quick` | 2- or 4-column action tiles on `--teal-soft` with `--teal-2` text and 22px icons |
| `.delta--up` / `--down` | Green or red pill for month-over-month change |

### List rows (`.list > li > .row`)

A flex row with `.row__main` (bold title that ellipsises, muted `.row__sub`) and `.row__end` (right-aligned amount and badge). Rows are separated by a `--line` top border. On linked rows the title turns `--accent` on hover. `.amount` is weight 800 with tabular numbers, and `.amount--neg` is red.

### Tables

Wrap tables in `.table-wrap` (horizontal scroll). In `.table`, cells have 10px/8px padding and `--line` bottom rules, and headers are uppercase muted `.76rem`. Use `.num` to right-align numbers. `tfoot` and `tr.is-total` (`--sand-soft`) mark totals. `.row-link` makes a whole row clickable: hover is `--surface-2` and focus shows a 2px `--teal` outline. `.table--compact` reduces the padding. Below 560px, a table with four or more columns becomes one card per row (section 14); tablet and computer keep the table and its edge fade.

### Badges

See 2.4 and 2.5. Always build badges with `badge(status, text?)`.

### Tabs

`.tabs` holds pill links or buttons (`8px 14px`, `--line-2` border, muted text) and scrolls horizontally. The active tab is marked with `aria-current="true"` or `aria-selected="true"` and filled `--forest` with white text. `.tabs--compact` is a smaller version. The landing page uses its own `.lp-tabs` (selected state `.is-on`).

### Toolbar and filter bar (`filters.js`)

| Part | Spec |
|---|---|
| Layout | `filterBar(...)` builds `.flt` → a `.toolbar` row (a search box at `flex: 1 1 220px`, quick selects inline, and a **Filters** secondary button with a funnel icon and a `.flt__count` badge, see section 24), an optional `.flt__panel` (a `card--soft` grid of fields with **Reset filters** and **Done**), and a `.flt__chips` row. |
| Chips | `.flt__chip`: a `--green-soft` pill with a `--line-2` border and "Label: value ×". Each chip has the label "Remove filter …", and the chip row is `aria-live="polite"`. **Clear all** (`.flt__clear`) appears when there is a search or one or more chips (*round 15: was two or more*). The chip look is in section 24. |
| Field types | `select`, `date`, `daterange` (`name_from` / `name_to`), `number`, `check` |
| Behaviour | Search is debounced by 300ms. Values in the URL win, then the person's last filters (`localStorage` `bh-filters:{user}:{page}`), then the defaults. The panel opens on load when "more" filters are active. |

### Forms with validation (`field`, `makeForm`, `formModal`)

| Element | Spec |
|---|---|
| Field | `.field` stacks the label (`.9rem` / 700), the input, a `.hint` and an `.error` with `role="alert"`. Required fields get a red ` *` (`aria-hidden`). Every input has `aria-describedby` pointing to its error. |
| Input | `.input`: min height **48px**, padding `10px 12px`, `--line-2` border, radius 10, `1rem` (so iOS doesn't zoom). Focus shows a `--teal` border plus `--focus`. Textareas are min 96px high and resize vertically. |
| Money | `type: 'money'` wraps the input in `.input-money` with a "₱" prefix and `inputmode="decimal"`. |
| Checkbox | `.check`: a 20px box with `accent-color: --teal` |
| Layout | `.form` (14px gap), `.form-row--2` (two columns from 560px), `.form-actions` (right-aligned, buttons stretch on phones) |
| Validation | When a required field is empty, `makeForm` shows the alert "Please fill in the highlighted fields." and a "{Label} is required." message on each field. Server errors (`err.fields`) are shown the same way. Invalid fields get `.field--invalid` (red border) and `aria-invalid="true"`, and the first invalid field gets focus. When offline, an amber alert says the input is kept. |
| Safety | Double submits are blocked, an idempotency key is optional, and `persistDraft` keeps unsaved input in `sessionStorage` (never passwords). |

### Modals and confirm dialogs

| Item | Spec |
|---|---|
| `openModal({ title, body, wide })` | A native `<dialog class="modal">` opened with `showModal()`, labelled with its title. Width is `min(560px, 100vw − 24px)`, or 760px when wide. Radius 18, backdrop `rgba(10,20,35,.45)`. The 40×40 × close button is labelled "Close". Clicking the backdrop or pressing Esc closes it. The first input gets focus. Below 560px the modal becomes a **bottom sheet** (full width, `18px 18px 0 0`, max 92vh). |
| `confirmDialog({ title, text, confirmText, danger, reason })` | Cancel (secondary) and a confirm button (primary, or **danger** for destructive actions). With `reason: true`, a required textarea is added ("Required — explain why (kept in the audit log)"). Resolves to `true`, the reason text, or `null`. |
| `formModal` | `makeForm` inside a modal. Cancel closes it. |

### Toasts

`toast(message, kind)` appends `.toast` (`role="status"`) to `#toasts` (`aria-live="polite"`). It uses `--ink-bg` / `--ink-text`, radius 12 and weight 650; the error kind uses a `--red` background. At most 2 show at once, each lasts 4 seconds, and they are centred above the bottom nav on phones and 24px from the bottom on desktop.

### Alerts and banners

`.alert--error | --info | --warn | --ok` use a soft background with strong text, radius `--radius-sm` and weight 600. `.offline-banner` is a sticky amber strip at the top ("You're offline…").

### Empty, error and loading states

| State | Helper |
|---|---|
| Empty | `emptyState({ title, text, action, iconName })`: centred, a 48px icon in `--line-2`, an `h3`, muted text (max 30em) and an optional button |
| Error | `errorState(err, retry)`: an empty state inside a card. The title is "Not found" (404) or "Couldn't load this page", followed by the error message and a **Try again** button (not shown for 403/404). |
| Loading | `skeleton(n)`: n blocks, 120px tall, radius `--radius`, with a `--surface-3`/`--surface-2` shimmer (1.2s). App boot shows "Loading BalayHub…". |

### Calendar grid (multi-calendar, `.cal`)

A scroll container (`.cal-scroll`, max height `100vh − 260px`). The header row and the left unit column are sticky. Day columns are 64px (54px on phones). Today's column is `--teal-soft` with an inset `--teal` line. Past cells are hatched with `--surface-2`/`--surface-3`. Holidays are tinted with `--sand` at 38% and seasons with `--sage` at 18%. Price overrides are bold `--navy`. Bookings are `.cal-bar` pills (26px high, radius 13, white `.78rem` text, a 2px surface ring) in channel colours, with `cut-left` / `cut-right` for stays that run past the visible range. A legend uses `.cal-swatch`. The guest booking calendar (`.bk-cal`) is a separate 7-column grid of square days. Picked days are `--teal` with white text, the range is `--teal-soft`, and taken days are struck through.

### Charts (`charts.js`)

| Item | Spec |
|---|---|
| Types | `barChart` (grouped bars with a rounded top and a square base, max 18px wide) and `lineChart` (2px stroke, optional dashed series `5 4`) |
| Colours | `SERIES = ['#2a78d6', '#eb6834', '#1baf7a']` (blue, orange, aqua), in that order. Same in both themes. |
| Axes | 4 gridlines. Axis text is 11px. `.chart-grid { stroke: --line }` and `.chart-axis { fill: --muted }` override the hard-coded SVG attributes, so the axes follow the theme. |
| Interaction | Hover or tap bands show a `.chart-tip` (surface card, `role="status"`). The legend appears only with 2 or more series. |
| Accessibility | The SVG has `role="img"` with an `aria-label`. Every chart has a **Show as table** toggle with the same data. |
| Small bars | `.bar` (8px progress track) and `.sharebars` (share of total, `--forest`) |

### Progress tracker (support tickets)

`.tracker` is an `<ol>` with `aria-label="Ticket progress"` and 4 steps: Received → In progress → Waiting for you → Resolved. Each `.tracker__dot` is 30px. Done steps are `--forest` with a ✓. The current step has a `--forest` border, `--accent` text and a 4px `--green-soft` halo, plus `aria-current="step"`. A 3px connector line turns `--forest` once reached. Related patterns: `.lpad-step` (Launchpad checklist, `<details>`), `.onboard__step` and `.gs-steps` (landing "Get started" wizard).

### Chat panel (`assistant.js`)

| Part | Spec |
|---|---|
| Button | `.assist-fab`: a `--forest` pill with a chat icon and "Ask", bottom right, labelled "Ask the BalayHub assistant" and carrying `aria-expanded`. Its focus ring is a 3px `--sand` outline. It is hidden when the assistant is disabled or the panel is open. |
| Panel | `.assist`: `role="dialog"`, labelled "BalayHub assistant". Up to 400×620, radius 18; on phones it becomes a full-width bottom sheet (`100dvh − 40px`). The header is `--forest` with white **New chat** (+) and **Close** (×) icon buttons. Esc closes it. |
| Messages | `.assist__list` (`aria-live="polite"`, `--surface-2`). Assistant bubbles are surface with a border, aligned left. User bubbles are `--forest` with white text, aligned right. Bubbles have radius 14 and a 4px "tail" corner. Related guides appear as `<details>`. "Contact support with this chat" hands the chat over to a support ticket. |
| Starters | Pill buttons, chosen by role and business type, mixing English and Tagalog |
| Typing | Three dots (`assist-dot` animation) with screen-reader text "Thinking…" |
| Input | A textarea (Enter sends, Shift+Enter adds a new line) and a primary **Send** button |
| Footer | "It can't see your bookings or guests and may make mistakes. Talk to a person" |
| Inbox messages (related) | `.msg--in` (surface), `.msg--out` (`--blue-soft`), `.msg--note` (amber, dashed). The note composer is tinted amber. |

### Icons (`icon(name)`)

Icons are inline SVG on a 24×24 grid with no fill, a `currentColor` stroke at 1.8, and round caps and joins. They are always `aria-hidden="true"`. The set: `home, building, users, wallet, chart, wrench, settings, more, plus, cash, logout, inbox, file, shield, calendar, rocket, sparkle, help, chat, bed`. An unknown name falls back to `more`. Sizes in use: 18–20px (buttons, nav), 22–24px (bottom nav, quick actions), 48px (empty state).

### Other patterns

`.dl` (definition list, 40% muted terms), `.chips`, `.divider`, `.files` / `.file-link`, `.hk-card` (housekeeping, late tasks get a red inset bar), `.stars` / `.rating` (reviews), `.receipt` and `.statement` (printable documents), `.acct-avatar` (initials in a `--forest` circle, 64px or 32px), `.langtoggle` (guest English/Tagalog switch, `aria-pressed`).

---

## 6. Accessibility

| Area | What is built |
|---|---|
| Focus | A global `:focus-visible` draws a 2px solid outline in `--focus-ring` (Forest `#0f5132` in light, `#8fd0a6` in dark) with a 2px offset, so it keeps 3:1 contrast on the page (QA round 2). `--focus` is now a two-layer ring (surface gap, then `--focus-ring`) for inputs. Inputs add a `--teal` border. Clickable table rows, review stars and booking days use 2px outlines. The assistant button uses a 3px `--sand` outline. |
| Landmarks and nav | `<aside>` sidebar, `<header>` topbar, `<nav aria-label="Main">` (both the sidebar and bottom navs), and `<main id="main">`. The current page has `aria-current="page"`. |
| ARIA | The theme switch is a radiogroup with radios and `aria-checked`. The language toggle uses `aria-pressed`. The Filters button has `aria-expanded` and the name "Filters, N active". Filter chips are labelled "Remove filter …". Field errors use `role="alert"` and `aria-describedby`, and invalid inputs get `aria-invalid`. Toasts use `role="status"` in an `aria-live` region. Modals are native `<dialog>` with `aria-label`. Charts use `role="img"` with an `aria-label` and offer a table. The tracker step has `aria-current="step"`. The unread badge is labelled "{n} unread". Icons are `aria-hidden`, and `.sr-only` exists. |
| Reduced motion | `@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }` stops the skeleton shimmer, the typing dots and button transitions. |
| Contrast (WCAG ratios computed from the tokens) | Light: text on bg 13.9:1, muted on surface 5.9:1, white on Forest 9.4:1. Status pairs are 4.7–5.8:1 (amber is the lowest at 4.7). Dark: text on bg 15.3:1, muted on surface 7.4:1, accent on surface 9.4:1, status pairs 6.1–7.8:1, white on dark Forest 5.3:1. See section 10 for the known failures. |
| Tap targets | *Round 13: on phones every button, tab, chip, back link and standalone link is at least 44px (section 22).* Buttons are at least 46px (small ones 38px), inputs at least 48px, the modal close button is 40×40, the hk checklist boxes are 24px, and bottom-nav items are about 56px tall across a fifth of the screen width. Smaller controls exist (see section 10). |
| Text | The base size is 16px and inputs use `1rem`, so iOS doesn't zoom on focus. Text sizing follows the browser setting (`text-size-adjust: 100%`). Long names ellipsise or wrap (`overflow-wrap: anywhere` on stats). |
| Safe areas | `viewport-fit=cover`, plus `env(safe-area-inset-*)` on the topbar, bottom nav, More sheet, content padding, toasts and the assistant button. |
| Language | Guest pages set `<html lang="fil">` when Tagalog is chosen. |

---

## 7. Print styles

`@media print` in `app.css` does the following:

- Hides the sidebar, topbar, bottom nav, `.page-head__actions`, `.toolbar`, `.no-print`, toasts, `.planbar`, and the assistant button and panel.
- Shows the shell as a single column with zero content padding.
- Prints cards without a shadow, with a `1px solid #ccc` border and `break-inside: avoid`.
- Resets the colour tokens to light values on `:root` (`--bg/--surface #fff`, `--text/--navy #1f2937`, `--muted #5d6762`, `--line #e4e8e1`, `--accent #0f5132`) and sets the `body` background to white.
- Keeps gate-pass ID images from splitting across pages.
- `.print-only` blocks are hidden on screen and shown (`display: block !important`) when printing. Use one beside a `.no-print` screen card for a printed acknowledgement (the rent payment page).

Printable views are built from `.receipt` (with a 2px `--navy` rule under the header), `.statement` (owner statements) and `.gp` (gate pass). Use `.no-print` for anything interactive on those pages.

---

## 8. Guest-facing pages vs the app

| | Host app (signed in) | Guest and public pages |
|---|---|---|
| Pages | Everything inside the shell (dashboard, calendar, inbox…) | Landing (`.lp-*`), booking (`.bk-*`), check-in (`.gc-*`), pay, review, and the gate pass for condo admins (`.gp`) |
| Chrome | Sidebar, topbar, bottom nav and assistant | A simple top bar only: the host's name (`.bk__host`), a small "Secure booking by BalayHub" mark (`.bk__powered`, hidden at 480px or narrower), and the language toggle. No app navigation. |
| Branding | BalayHub brand | **The host's brand comes first** on booking pages. BalayHub appears small. The landing page is BalayHub's own marketing. |
| Language | English | English or Tagalog/Taglish through `i18n.js`. The host sets the default, and the guest's choice is saved in `bh-guest-lang`. Server error messages are translated with `tServer`. |
| Width | Up to 1180px | Check-in up to 640px, booking up to 1080px (two columns with a sticky 380px booking panel from 920px), landing up to 1120px |
| Tone | Efficient, operational | Warmer, reassuring ("Nothing was charged", "It takes about 2 minutes", "po") |
| Theme | Theme switch available | Guest pages follow the device theme (no switch). The landing footer has a compact switch. |
| Offline | Offline banner, drafts kept | `offline.html` (served by the service worker): a centred icon, "You're offline", one sentence and a **Try again** button. It uses standalone `offline.css` with hard-coded light colours and the system font. |

---

## 9. Do's and don'ts for new screens

| Do | Don't |
|---|---|
| Use tokens (`var(--surface)`, `var(--muted)`, `var(--red)`…) for every colour, so dark mode works for free. | Don't hard-code hex or `#fff` in components, inline `style`, SVG fills, or `var()` fallbacks. |
| If you add a token, add it to `:root` **and to both** dark blocks. | Don't add a token to only one of the two dark blocks. |
| Build DOM with `h()`, icons with `icon()`, badges with `badge()`, and headers with `pageHead()`. | Don't use `innerHTML` with data (`h()` refuses an `html` prop). |
| Style with CSS classes, or the `style` object in `h()` for dynamic values such as widths and CSS variables. The strict CSP is `script-src 'self'`. | Don't use inline `<script>` or `style="..."` attributes. |
| Build forms with `field()` + `makeForm()` / `formModal()` to get labels, errors, required checks, draft saving and double-submit protection. | Don't write bare `<input>` elements without a label and an error slot. |
| Use `filterBar()` on every list page, with a search box, quick filters, the Filters button and chips. | Don't build a one-off filter row. |
| Handle the empty, error and loading states with `emptyState`, `errorState(err, retry)` and `skeleton()`. | Don't leave a blank card or a raw error. |
| Ask before destructive actions with `confirmDialog({ danger: true })`, and add `reason: true` when it should be audited. | Don't use `window.confirm`, and don't put destructive actions in primary green. |
| Use one primary button per view. Use secondary for Cancel and ghost for tertiary actions. | Don't put two primary buttons side by side. |
| Keep tap targets at least 44px (use `.btn`; `.btn--sm` is 38px only at 960px and wider, and 44px on phones, round 13). | Don't ship icon-only buttons smaller than 34px or without an `aria-label`. |
| Design for the phone first. Check at 375px, 560px, 760px and 960px. Wrap tables in `.table-wrap`. | Don't assume the sidebar is there, or allow horizontal page scroll. |
| Write in sentence case, plainly. Say what happened and what to do next. Use ₱ via `peso()` and dates via `fmtDate()`. | Don't use Title Case, jargon or exclamation-heavy copy. Don't format money or dates by hand. |
| Put guest-facing strings through `t()` and add Tagalog to the dictionary. | Don't hard-code English on booking, check-in, pay or review pages. |
| Give a chart an `ariaLabel` and keep the "Show as table" toggle. Use `SERIES` order for series colours. | Don't rely on colour alone. Don't invent new series colours. |
| Use the channel classes (`badge--ch-*`, `cal-bar--*`) for channels. | Don't define new channel colours elsewhere. |
| Mark print-hidden controls with `.no-print`. | Don't rely on dark-mode colours in printable documents. |
| Respect reduced motion. Keep any animation subtle and CSS-only. | Don't add JavaScript-driven motion that ignores the reduced-motion setting. |

---

## 10. Known inconsistencies (as of this brief)

| # | Issue | Where |
|---|---|---|
| 1 | **Dark mode: `--teal-2` on `--teal-soft` is 1.85:1.** It affects `.quick` tiles, `.badge--vacant`, the current saved view and today's calendar header number. | `app.css` dark tokens |
| 2 | **Dark mode: the login caption is unreadable.** `.auth-split__caption` hard-codes `rgba(255,255,255,.88)` behind `--navy`/`--muted` text, which are light in dark mode (about 1.1:1). | `app.css` split login |
| 3 | `.quick:hover` hard-codes `#d2ece4` (a light fill that flashes in dark mode). | `app.css` |
| 4 | **Print in dark mode.** The print token reset is on `:root`, which loses to `:root[data-theme="dark"]` and `:root:not([data-theme="light"])` (higher specificity), so cards can print with dark surfaces. Only some tokens are reset. | `app.css` `@media print` |
| 5 | `dialog.modal` sets no `background`. It relies on the browser's default canvas colour, not `--surface`. | `app.css` dialog |
| 6 | The dark tokens and dark channel-badge overrides are written out twice and must be kept in sync by hand. | `app.css` |
| 7 | Hard-coded colours that bypass tokens: chart `SERIES`, the hover band `rgba(22,50,79,.05)` and the grid/axis attribute fallbacks (`charts.js`); expense bar `#c2410c` inline (`views/reports.js`); logo sun `#d6a85c` (instead of `--sun`); the welcome tick SVG `%230f5132`; `.stars` `#e0a526`, `.rating` `#b7791f`, `.lpad-status--skip` `#8a6a2c`, `.bk-cal__day:disabled` `#b8c1cc`; white `#fff` on buttons and active states; modal and backdrop rgba values. | various |
| 8 | Fallbacks in `var()` don't match the tokens: `var(--sand, #d9b679)` vs `#dcc9a3`, `var(--teal-soft, #d6efe9)` vs `#e7f1e9`, `var(--line, #e5e7eb)` vs `#e4e8e1`, and `var(--green-soft, rgba(15,81,50,.12))`. | `app.css` |
| 9 | Channel colours drift: the Airbnb calendar bar is `#d93b52` in the app vs `#d93a50` on landing. The Vrbo, Expedia and Trip.com bar colours differ from their badge text colours. Calendar bars and the blocked colour don't change in dark mode. `.lp-plan--pop` uses an old teal `rgba(14,124,102,.15)`. | `app.css` |
| 10 | Contrast below 4.5:1: white on the Vrbo bar `#0891b2` (3.7:1) and on Airbnb `#d93b52` (4.5:1, borderline); `--muted-2` text (2.2:1 light); chart orange and aqua against white (3.2 and 2.8:1, acceptable for graphics but not for text); review stars `#e0a526` (2.2:1); the sage "Hub" on white (2.5:1, a logotype: WCAG 1.4.3 exempts it; do not file it, D-99 O2). | tokens and `app.css` |
| 11 | `offline.html` / `offline.css` have no dark mode and use `system-ui` rather than Inter. | `public/offline.html` |
| 12 | Small tap targets: theme-switch buttons (about 30px), `.langtoggle` buttons (about 26px), `.flt__chip` (about 26px), assistant icon buttons (34px) and `.tabs--compact`. *Round 13: on phones `.flt__chip`, tabs and `.btn--sm` are now 44px (section 22); the theme-switch buttons stay (D-88) *(superseded 2026-10-15 by D-95: they are 44px on phones, section 24)*; `.langtoggle` and the assistant icon buttons: assistant button 44x44.* | `app.css` |
| 13 | No spacing, type-size or breakpoint tokens. Radius values of 12, 16, 18 and 20px are hard-coded alongside `--radius` and `--radius-sm`. `--navy-2` is unused. `--teal` and `--forest` are duplicate aliases. | `app.css` |
| 14 | ~~There is no "skip to content" link, even though `main#main` exists.~~ *Fixed in round 13: a "Skip to main content" link (`.skip-link`, section 22).* The More sheet uses `role="menu"` without menu keyboard handling and has no Esc-to-close or focus management. The More sheet part was fixed in round 5 (section 14: a dialog with Escape and focus handling, and no menu role). | `app.js` |
| 15 | The `theme-color` meta follows the device theme, not a forced `bh-theme` choice. The nav label "Rent & Expenses" breaks sentence case. | `index.html`, `app.js` |

---

## 11. Patterns added in QA round 2 (2026-10-14)

- **Phone row stacking.** At 480px and narrower, a `.row` whose end holds buttons, chips or a label wraps so the actions sit on their own line. Add `.row--stack-sm` to force this on any other row.
- **Scroll cues.** `.table-wrap` and `.tabs` show a faint edge fade only on the side where more content is hidden (`background-attachment: local` over `scroll`). Use it on any new wide table or tab strip. *(For wide tables and the calendar this is superseded in round 4, see section 13.)*
- **Focus ring token.** `--focus-ring` replaces the old translucent ring (see section 6).
- **Muted text instead of opacity.** Cancelled messages use `var(--muted)` with a dashed border rather than `opacity`, so contrast holds. Mentions use `--teal-ink`; today's calendar day and the Airbnb bar colour were darkened for contrast.
- **Compact Ask button on phones (superseded in round 3: the Ask button is now in the top bar below 960px, see section 12).** Below 560px the assistant button is a 48px icon-only circle (its `aria-label` stays), and the page gets extra bottom padding so it never covers the last line.
- **Stat values** no longer break mid-number: they stay on one line and the font shrinks (`clamp(1rem, 4.2vw, 1.45rem)`).
- **Logo exemption.** The light-green "HUB" in the wordmark keeps its colour. WCAG exempts logo text from the contrast rule (founder question in BLOCKERS).

## 12. Patterns added in QA round 3 (2026-10-14)

- **Ask button in the top bar on phones.** Below 960px the assistant button is a 40px round icon button in the top bar (`.topbar__assist` slot, `.assist-fab--bar`), placed before the account avatar, with the same `aria-label`. It never floats over content. On desktop (960px and up) it stays a floating button. This supersedes the section 11 compact floating button.
- **Table edge cue.** `.table-wrap` shows a real shade on the clipped edge while the box can still scroll, and it shows over solid cell backgrounds (the section 11 fade did not). Use it on any new wide table. *(Superseded in round 4, see section 13: the shade did not show on phones, so the edge fade now follows the scroll position.)*
- **Wrapping tabs.** At 560px and narrower, `.tabs` wrap onto as many lines as they need instead of scrolling, so every tab and chip shows.
- **`.col-sm-hide`.** Put it on the header and cells of a low-priority column; it is hidden at 480px and narrower. The reservations list uses it for Channel and Code and shows Total and Balance right after the dates.
- **Alerts wrap long words** (`overflow-wrap: anywhere`), so a long unbroken note can't push the page sideways.
- **Focus clear of the bottom bar (WCAG 2.4.11).** Below 960px the page has bottom scroll padding the height of the bottom bar, and a small focus guard in the app shell scrolls a focused control up if the bar still covers it.
- **Toolbars.** Children can shrink (`min-width: 0`), and selects go full width at 480px and narrower. The Get started sheet follows the phone sheet width at 560px and narrower.

## 13. Patterns added in QA round 4 (2026-10-14)

- **Clipped-edge fade for wide tables and the calendar.** `app.js` sets `is-more-right` or `is-more-left` on a `.table-wrap` or `.cal-scroll` while columns are hidden on that side. CSS then fades the clipped 32px of the content itself with `mask-image`, so the fade shows over any cell colour in either theme. The calendar (`.cal-scroll`) fades the right edge only, because its first column is sticky. The fade is removed when printing. Use the same class pair on any new wide scroll box. Do not use a background gradient for this: it does not show over content. *Round 4 answer (D-80, 2026-10-14): on phones, wide tables become stacked cards. The fade remains for tablet and computer widths, and for the calendar if it stays a grid. The round 5 fix adds the stacked-card pattern.* *Round 5: on phones, tables with four or more columns now stack into cards instead (section 14). The fade stays for tablet, computer and the calendar; do not remove it.*
- **Wide dialogs use a class, not an inline width.** `openModal` with `wide` adds `modal--wide` (760px on a desktop, full width minus 24px). Below 560px every dialog is a full-width sheet, wide or not. Do not set a dialog's width in the style attribute.
- **Theme switch.** The selected icon takes the text colour of the selected button (`color: inherit`), so it reads on the green selected state in both themes.
- **Star rating uses the amber token** (`--amber`), not a fixed colour. It is about 5:1 on white in light mode.
- **Long words in user text wrap.** Lists that show user text, such as the cleaning task history (`.hk-history`) and the work-order and found-item titles, use `overflow-wrap: anywhere` and `min-width: 0`.
- **Names for controls.** Every visible label is tied to its control (`for` and `id`), and a control's spoken name starts with the words on screen. A table header that has no title uses a screen-reader-only word (`.sr-only`, for example "Actions"), never an empty cell. Any text box a person copies from has a name.
- **Round 4 supersedes sections 11 and 12 for the wide-table edge cue** (section 11 and 12 bullets are kept, marked as superseded).

## 14. Patterns added in QA round 5 (2026-10-14)

- **Stacked cards on phones (D-80, D-81).** Below 560px, a table with four or more columns shows one card per row. The helper `stackTables` in `public/js/app.js` runs whenever the page changes, so rows added later (a search, "show more", a re-render) get their labels too. It copies each column header onto that column's cells as a label. No view needs code to stack. Tables with three or fewer columns stay tables.
  - **Opting out:** tables that already stack themselves (`op-stack`, `ops-stack` and `op-pnl`) are left alone. A view adds `table--nostack` to keep a wide table as a table on phones.
  - **The card:** each row is a bordered card on the surface colour, with 12px rounded corners. Each cell is one line: its label on the left (small and muted) and its value on the right. The first cell is the card's bold title. Action buttons sit at the right. Total rows keep the sand total background.
  - **Screen readers:** the header row is hidden on screen but is still read out. Explicit table, row, cell and column header roles keep the table meaning when the layout changes.
  - **Where it does not apply:** the calendar (a grid with its own edge fade), printed statements (the card layout is for screens only), and tablet and computer (the table and its fade stay).
  - **Check:** at 390px, one card per row with no sideways scroll. At 768px and 1280px, the same table is a table.
- **Money boxes.** A suggested price fills a box only while the person hasn't typed in it, and each box remembers its own typing. When a typed amount differs from the suggestion, a button reads "Use ₱X from your rates" next to the quote. When a rate can't be worked out, a box that still holds an old suggestion is emptied. A box for a room type (any free room of a type) stays empty unless it is typed in, and the note under it says each room is priced from its own listing.
- **Amounts in boxes.** Every preview and confirmation reads a typed amount the way the server does (`parseAmount` in `public/js/ui.js`): commas only between thousands. An amount that can't be read shows no figure instead of "NaN".
- **Forms.** A field's message clears when the person changes that field, and the summary clears with the last one. A save that answers "nothing saved" (for example Cancel on a question) keeps the typed draft and leaves the dialog open. While a question waits, the button keeps its own words. "Saving…" shows only while a save is running.
- **The More menu** is a native dialog (section 4.1). Escape and a tap outside it close it, and focus returns to the More button.
- **Placeholder text** uses the muted colour token at full opacity, in both themes.
- **Long words wrap.** Headings, table and list titles, alerts and definition values use `overflow-wrap: anywhere`. Grid and flex children that hold text can shrink (`min-width: 0`), so no page scrolls sideways at 390px.
- **Names for controls.** A repeated button names its row, for example "Edit template: Booking confirmation". The two boxes of a date range are named "<label>, from" and "<label>, to". A rating star is a radio with a checked state. The account link at the top starts with the workspace name. The theme switch uses three equal-size inline SVG icons.
- **Taglish.** New guest-facing and cleaner-facing lines go through the file's own translation table (`t()` or `T()`). BLOCKERS question 12 lists this round's new lines for a Taglish check.

## 15. Patterns added in QA round 6 (2026-10-14)

- **Stacked-card labels stay on one line.** On the phone card layout, a label (for example "Check-in") never wraps onto two lines.
- **Nothing focusable in a clipped table header.** A control in a header that scrolls out of view can be tabbed to but not seen. "Select all" lives in the visible bar above the table.
- **Card heads keep their badge on the heading line.** A badge such as "All clear" sits next to the heading at 390px, not on a line of its own.
- **Narrow filter panels put range fields on their own row.** A from and to pair gets a full row so the two boxes and their messages fit.
- **A control's name includes its visible label.** The language switch is named "Language: EN" or "Wika: TL", matching what is on screen.
- **Each problem is said once, at its field.** A banner or summary doesn't repeat a field message.

## 16. Patterns added in QA round 7 (2026-10-14)

- **A dialog sheet takes focus on its first item and has a visible Close button.** On phones the More menu lists Close first, keeps Tab and Shift+Tab inside the menu, and returns focus to More when it closes.
- **Repeated per-photo and per-card buttons name what they act on:** "Make cover, photo 2", "Delete, photo 2", "Archive, <listing>". Photos carry alt text with their number.
- **Date boxes in filter ranges are wide enough for a full date with the year** (From and To in the inbox, reports and statements).
- **Long names in statement and page headers wrap** instead of pushing the page sideways at 390 px.
- **A money question uses the same confirm dialog pattern as payouts.** Plain sentence, the amount and the balance in the text ("This is ₱500.00 more than the balance of ₱5,500.00. Record it?"), a clear yes button, and cancel leaves the form as it was with "Payment not saved." *(Superseded in part 2026-10-14, round 8 / D-84: Cancel is quiet, with no message. See section 17.)*
- **A field error moves focus to the first field with a message** (Get started). Known gap: sheet inputs do not yet set `aria-invalid` or `aria-describedby` (round 8).

## 17. Patterns added in QA round 8 (2026-10-14)

- **Repeated per-row controls always carry the row's name.** A button or link that appears on every row or card ("Void", "Record", "Open channels", "Bookings", a Save on each settings card) gets an accessible name that says what it acts on ("Record payment for Liza Reyes, Unit 2, September", "Void refund of ₱500.00 on Oct 3", "Save booking page"). Round 8 swept this file by file; a new screen is not done until no two controls on it share a name.
- **A dialog that redraws keeps focus on a sensible control.** After Make cover or Delete on a photo, or any action that rebuilds the list, focus goes to the acted-on item, or its neighbour when it is gone, never to the page body. Known gap carried to round 9: pricing rules, rent, refunds and cleaner pay still drop focus after a save or Undo.
- **A field shows its error in place of its hint while the error stands,** and brings the hint back after the next change ("said once", D-82). Errors also set `aria-invalid` and tie the message to the field with `aria-describedby` (Get started, check-in).
- **Owner cards in a grid share a top edge** (no staggered cards when one has a longer note).
- **Composer mode switches are toggle buttons, not tabs.** Reply, Internal note and similar switches are buttons with `aria-pressed`, one Tab stop each. A true `role="tablist"` answers to arrow keys, Home and End (one shared handler in `app.js`).
- **Cancel means discard; closing means keep.** An explicit Cancel on a form throws away a saved draft. Escape, clicking away or losing the session keeps it. An over-amount money question's Cancel returns to the form with no message (supersedes the round 7 "Payment not saved." line).
- **Language switches never clear input.** On guest pages (booking, quote) switching language redraws the words and keeps what the guest typed or picked.

## 18. Patterns added in QA round 9 (2026-10-14)

- **Grouped navigation.** The sidebar and the phone More sheet show headings (Every day, Money, More tools, Setup). More tools is a folded group that opens itself on one of its pages. Nothing is removed, only grouped (D-85).
- **Collapsed form sections.** Optional groups of fields sit in `details.form-section` (Price extras, Guest info, Booking page and payments, Booking rules on the listing form). Never use one for a required field. A section opens by itself when an error is inside. The section titles are plain sentence-case words; "Price extras" replaces "Pricing helpers".
- **Image attachments show a thumbnail** (`file-thumb`) instead of a file icon.
- **An offer inside a form keeps its space.** A line that appears while the person works (a rate offer, a new price) reserves its room so nothing under the pointer moves and a click is never lost.
- **Focus returns to the opener or its replacement** after a save or redraw: dialogs, buttons whose redraw rebuilds them, and tab rows (completes D-81).
- **The content area leaves room for the floating Ask button** on desktop, and the top bar's account area can shrink (no sideways scroll at 390 px).
- **Money text has two decimals** wherever a peso amount appears, in the app and on public pages (₱1,500.50).

## 19. Patterns added in QA round 10 (2026-10-15)

- **Focus is kept through slow redraws.** After a click, the shared watcher (`keepFocus` in `ui.js`) looks for 2 seconds and puts focus back on the same control, then on a replacement with the same name, then on the control at the same place (a toggle that renamed itself), then on the page heading. It never takes focus from something the person moved to. Dialog buttons are covered; tab rows wait for the new row. Views add no focus code for redraws and must not rename a control only to change its look; moving focus to the field with an error is still fine.
- **Tap targets.** Link-style buttons (`.link-btn`, `.linkbtn`) are at least 24px tall (the minimum for inline text links); real buttons keep the 44px house size; the chart "Show as table" toggle is 32px tall on screens up to 480px wide.
- **Print-only acknowledgement blocks:** `.print-only` (hidden on screen, shown in print) paired with `.no-print` on the screen card.
- **Guest money format:** an amount owed, charged, paid, refunded or totalled always has two decimals. An advertised price (per night, "from") may show whole pesos when exact, and a calendar tile may be compact (₱2.8k) when its accessible name has the exact price.
- **A form's own field checks** run in the same first pass as the required check (`makeForm({ check })` returns `{ field: message }`), so every problem shows at once and a required message is never replaced.
- **Language switch keeps typed input:** a guest page that redraws itself calls `keepFormValues(root)` before and `restoreFormValues(root, snapshot)` after (`i18n.js`). File inputs can't be kept, and the page says so when a file was chosen.
- **Report tiles say their basis** in the tile's sub-line.

## 20. Patterns added in QA round 11 (2026-10-15)

- **Focus with no opener:** a dialog opened by a link (`?new=1`, `?assign=1`) has no button to return to, so when it closes focus goes to the page heading (`h1`, given `tabindex="-1"`) at once. *Extends section 19's watcher.*
- **The focus watcher keeps checking up to 10 seconds** (`FOCUS_WATCH_MS` in `ui.js`), every 500 ms after the first 2 seconds, so a redraw on a slow network still gets focus back. It never moves focus off something the person chose. Views add no focus code for redraws.
- **Chart axes never repeat a label,** and an all-zero chart shows one 0 label (`axisLabels` in `charts.js`).
- **Chart "Show as table" sits at the left** of the chart footer, clear of the floating Ask button.
- **Sidebar scroll cue:** the scrolling nav fades at its bottom edge while more is below, with a thin scrollbar, in token colours.
- **A money document shows an overpayment and a void,** never a clamp: "Overpaid by ₱800.00", and a voided payment prints "VOID" and offers no receipt.

## 21. Patterns added in QA round 12 (2026-10-15)

- **Star tokens:** review stars use `--star-off` and `--star-on`, set in every theme block so both pass 3:1 contrast. Never hard-code a star colour.
- **Looks disabled, stays reachable:** `.btn[aria-disabled="true"]` is dimmed (opacity 0.6) with the `not-allowed` cursor and no link. Use it when a keyboard or screen reader user should still land on the control and read the hint beside it (Reports Export). A real `:disabled` button keeps its own look, which also shows progress.
- **Switch rows:** notification rows are at least 44px tall and are no longer capped at 220px wide. *Closed in round 13: `.checks` rows are 44px on phones (section 22).*
- **Chart hover band:** a class using a token (navy at 5%), not a hard-coded colour in the chart code. Grid and axis colours in `charts.js` are overridden by CSS; the series palette is still fixed in code (low).
- **Reservations on phones (480px and below):** the Channel and Code columns are hidden. The hiding rule has higher specificity than the stacked-card rule, so the card no longer shows them. *Brings the code to what this brief already said.*
- **Page headings and focus:** a route change focuses the new page's `h1` (`tabindex="-1"`). A page reloading in place keeps the old `main` on screen with `aria-busy` until the new one is ready. A refused form focuses, in order: the row input, an element marked `data-focus`, then the group's button. A page-level error has an `h1`.
- **Extra row actions:** a row's less common actions sit under a "More for <name>" disclosure (supply rows: Count, History, Edit, Archive).

## 22. Patterns added in QA round 13 (2026-10-15)

Decision D-89. These lines replace the older tap-target wording in sections 5 and 9 where they differ.

- **Phone 44px block (under 960px).** In one block in `app.css`: `.btn--sm`, `[role="tab"]` (tabs), `.flt__chip` (filter chips), `.back`, `.inbox__back`, `.link-tap`, `.checks label` (checklist rows), `.topbar .brand`, `.topbar__me` (the account link) are at least 44px tall; the assistant button `.assist-fab` is 44x44. At 960px and wider, `.btn--sm` stays 38px, and `.back` and `.link-tap` are at least 24px. *Settles the earlier "`.btn--sm` 38px only in dense toolbars": on phones it is 44px everywhere. Theme buttons are unchanged (D-88: about 33px high, pass the 24px minimum).* The mobile More sheet's "More tools" fold summary is also a 44px tap target, with an arrow and a focus ring.
- **`.link-tap`:** a shared class for a standalone text link that must be easy to hit (for example the four links in the inbox). `display: inline-flex; align-items: center; min-height: 24px`, and 44px below 960px. Use it instead of per-component sizes.
- **Skip link (`.skip-link`):** the first child of the app shell, "Skip to main content". Visually hidden until it has focus, then a visible pill at the top left above the top bar. Tokens only, no hex. Debt row 14 ("no skip to content link") is closed.
- **Calendar tile at 24px:** the calendar's booking tiles (`.cal-bar`) are at least 24px tall (a dense grid; WCAG 2.5.8 minimum) and carry a `data-focus-key`.
- **Checkboxes at 24px:** the cleaner pay row checkboxes are 24px on phones. Other `.checks` lists (settings property picker, owner units, add-on listings) are covered by the 44px row rule on phones. The "Not yet done" note in section 21 is closed, except the cleaner pay "select all" box at 20px (its label is 44px high; round 14). *Superseded by D-99 (O3): the label is the 44px tap target and the box may stay 24px (section 26).*
- **More-sheet fold:** on phones, "More tools" is a fold (a `details` with a summary) inside the More sheet, the same as in the sidebar. Closed when the current page is outside it, open when inside, remembered in the same place as the sidebar's state (`bh-nav-more`). The Tab trap counts the summary and skips links inside a closed fold.
- **The `data-focus-key` convention.** Put `data-focus-key` on a control whose label or presence changes when it is used (Publish becomes Unpublish to correct; Close the day becomes Update close), so the focus guard can find "the same control" after a redraw. Every control that can take the same place carries the same key. Views never call `.focus()` after a redraw themselves. A scan test (`qa-r13-focus-scan`) checks that every key below is present. Keys:

  | Key | Control | File |
  |---|---|---|
  | `stay-status` | Check in, Check out, Undo check-in, Undo check-out | `views/reservations.js` |
  | `deposit-action` | Record deposit, Return deposit, Undo | `views/deposits.js` |
  | `cal-night-<night>`, `cal-booking-<id>` | a calendar night cell; a booking tile | `views/calendar.js` |
  | `stmt-publish`, `stmt-send` | Publish / Unpublish to correct; Send to owner / Send again | `views/owners.js` |
  | `owner-invite-<id>` | Invite to owner portal / Invite again / Send the invite again | `views/owners.js` |
  | `conv-snooze`, `conv-archive` | Snooze / Unsnooze; Archive / Unarchive | `views/inbox.js` |
  | `mt-status-<status>` | each maintenance status button, keyed by the status it sets (Start work, Mark resolved, Reopen), so focus never matches the button that undoes the change and falls to the page heading (round 17, D-99) | `views/maintenance.js` |
  | `tenant-archive` | tenant Archive / Restore | `views/tenants.js` |
  | `hk-status`, `hk-pay` | Start / Mark done / Reopen; Set pay / Edit pay | `views/housekeeping.js` |
  | `cp-pay-<id>` | a cleaner pay row's Edit pay and Undo paid | `views/cleanerpay.js` |
  | `dc-close`, `dc-reopen` | Close the day / Update close; Reopen day | `views/dailyclose.js` |

- **The top bar (D-90, built in round 14).** See section 23.

*Added in round 14 (D-92), completing the lists above:*

- **More 44px classes under 960px.** `.check` (checkbox rows, text centred), `.link-btn`, `.linkbtn`, `.flt__clear`, `.chart-foot .link-btn` (repeated because its own rule is more specific), `.input--sm` (Go to date, Month), `.langtoggle button` (guest language toggle), `.lp-top .btn--sm` (landing page), `.gc__foot a` (guest footer Privacy link, `inline-flex`), `.lpad-guide summary` (10px top and bottom padding) are at least 44px tall, and `.modal__close` is 44x44 (40x40 on desktop). Plain links with no class use `.link-tap`. `.btn--sm` still follows the 44px phone rule from the list above.
- **24px boxes.** Row checkboxes in the ops and cleaner-pay tables (`.table .ops-check input`) and the select-all box in the ops bar (`.ops-bar .check input`) are 24x24 on phones; their label rows are 44px. Theme buttons and calendar tiles are unchanged (D-88). *Superseded by D-99 (O3): on phones the label is the 44px tap target (`.ops-check__tap`, section 26); the box itself may stay 24px.*
- **Scroll anchoring off, space under the last row.** `.content` has `overflow-anchor: none`. On desktop (960px and wider) `.content` keeps `padding-bottom: 96px` so the Ask button never covers the last row.
- **The scroll keeper rule.** `ui.js` holds the page height during a redraw and undoes any scroll the redraw caused (a scroll within `SCROLL_SETTLE_MS` = 150 ms of the change). It releases on a route change, wheel, touch, keys or when things go quiet. **Views never read or set `window.scrollY` or call `scrollTo` themselves;** a scan test enforces it. Only a page change scrolls to the top, once (D-89). A page that draws several cards (Home) draws them in one go.
- **Heading at once.** `HEADING_AFTER_MS` is 0: when the control the person used is gone and nothing took its place, focus goes to the page heading immediately; if the control (or a match) returns within `FOCUS_WATCH_MS` (10 s), focus moves to it. The "same position in the same labelled group" match is for `tab` and `radio` controls only.
- **New `data-focus-key` values:**

  | Key | Control | File |
  |---|---|---|
  | `auto-toggle-<automation_id>` | automatic message Turn on / Turn off | `views/inbox.js` |
  | `mt-pause-<schedule_id>` | recurring maintenance Pause / Resume | `views/maintenance.js` |
  | `lp-step-<step key>` | Launchpad Skip for now / Show again | `views/launchpad.js` |
  | `dc-toggle-<code_id>` | discount code Turn on / Turn off | `views/guestcare.js` |
  | `dc-close`, `dc-reopen` | Close the day / Update close; Reopen day (already listed above) | `views/dailyclose.js` |

---

## 23. Top bar (QA round 14, 2026-10-15)

Decisions D-90, D-91. Styles are in `public/css/topbar.css` (loaded after `app.css`); tokens only, no hex. The behaviour is in APP-FLOW section 27.

- **Layout, desktop (960px and wider).** The shell grid has two rows (`--topbar-h`: 64px, then the page). The sidebar spans both rows in column 1. The bar sits in column 2, `position: sticky; top: 0`, 64px tall, 24px side padding, 16px gap, background `--surface` with a `--line` bottom border. The brand is hidden in the bar (the sidebar shows it). The search box is centred (`flex: 1 1 auto; max-width: 560px; margin: 0 auto`), 40px tall, radius 10, `--surface-2` background (becomes `--surface` with an `--accent` border while focused), with a "/" key cap (`.tb-kbd`) at its right end while empty. Right side: Bookmarks, Add new, Notifications, Help, then the avatar, 4px apart.
- **Icon buttons (`.tb__icon`).** 40x40 on desktop (44x44 under 960px), radius 10, 22px icon, colour `--navy`; hover or open (`aria-expanded`) uses `--teal-soft` with `--accent`. Focus ring `2px solid var(--focus-ring)`, offset 2px. The unread badge (`.tb__badge`) is an 18px pill, `--badge-bg`, white 0.72rem bold text, top right of the bell. The avatar (`.tb__avatar`) is a round 40px button (44px on phones) holding the initials.
- **Icons** (`icon(name)` in `ui.js`, 24px viewBox, stroke style like the rest): `search`, `bookmark`, `bell`, `star` (filled with `.is-on` when saved), `close`, `help`, `plus`. Menu rows use the existing `bed`, `building`, `users`, `sparkle`, `wallet`, `cash`.
- **Panels (`.tb-pop`).** Anchored under the button: `position: absolute; right: 0; top: calc(100% + 6px)`, 320px wide (`.tb-pop--wide`: 400px, used by the bell and help), `max-width: calc(100vw - 16px)`, `max-height: min(80vh, 640px)`, `--surface`, `--line` border, `--radius`, `--shadow`. Head, scrolling body (`overscroll-behavior: contain`) and foot. Rows (`.tb-item`) are 8px/10px padded, radius 10, hover `--gray-soft`, active `--teal-soft`. One panel is open at a time; Escape closes it and returns focus to the button.
- **Search results (`.tb-results`).** Under the box, at least 420px wide, at most `min(70vh, 560px)` tall, scrolling. Group titles are 0.78rem, 600, `--muted`. The active option (`.tb-opt.is-active`) uses `--teal-soft`.
- **Sticky behaviour and the kept bar.** The bar is built once and kept across page changes (round 13 shell), so it never flickers; it stays at the top while the page scrolls. On phones the same sticky bar (12px/16px padding) holds the controls described below.
- **Stacking order (z-index).** Top bar 30; **top bar panels and search results 35**; bottom nav 40; **Ask button (`.assist-fab`) 45**; More sheet and **phone search sheet 50**; offline banner and the Ask panel 60; toasts 100; skip link 200. Dialogs opened with `showModal()` sit in the browser's top layer above all of these. The Ask button stays at the bottom right on desktop and never covers a row (the 96px bottom space above).
- **Phone and tablet (under 960px).** The bar holds the brand, Ask, Search, Add new, the bell and the avatar. Below 560px the brand shows only the logo (the text is hidden). Bookmarks and Help are hidden in the bar (`.tb-desktop-only`) and appear as menu items in the avatar menu (`.tb-phone-only`). Every control and panel row is at least 44px. Panels become a fixed layer 8px from each side, starting 56px under the top safe area, with `max-height: calc(100dvh - top - 56px - var(--bottomnav-h) - 16px - env(safe-area-inset-bottom))`, so they never sit under the bottom nav. Search opens a full-screen `dialog.tb-sheet` (z-index 50, `--surface`, a 44px back button and the box in its head, results below, `--scrim` backdrop).
- **`data-focus-key` values** (added to the table above): `tb-search`, `tb-bookmarks`, `tb-add`, `tb-bell`, `tb-help`, `tb-profile`, `tb-mark-all`, `tb-older`, `tb-bm-toggle`.
- **Motion.** Icon hover colour changes take 0.15 s and are turned off for `prefers-reduced-motion`.

## 24. Patterns added in QA round 15 (2026-10-15)

Decisions D-94 and D-95. All new rules are in one block at the end of `public/css/app.css`, headed "QA round 15: call-to-action cards and clear filters (D-94)", plus a second block "QA round 15: sweep fixes (D-95)". Use tokens only; the one new token is below.

- **`.cta-card`: a card with one message and an action.** Use it instead of `div.card > p + a.btn`. Markup: `.cta-card` containing `.cta-card__icon` (44px round, `--teal-soft` fill, `--accent` icon, 24px svg), `.cta-card__text` (a grid with a 4px gap that takes the remaining width, at least 260px) and `.cta-card__actions` (a wrapping row, 8px gap). The card is a flex row that wraps, with a 12px row gap and 16px column gap. Under 560px it stacks: the icon and text on top, and the actions take the full width with buttons that grow. The Home first-run card is the first user. Card padding stays the `.card` 18px.
- **Text, then button: a 12px gap.** Any card whose paragraph or `.muted` line is followed straight by a `.btn`, a `.chips` row or `.form-actions` gets `margin-top: 12px` (`.card > :is(p, .muted) + :is(.btn, .chips, .form-actions)`). It fixes Security deposit "None", the cleaner pay load error and the booking result without touching those views. Do not remove it when adding a new card; prefer `.cta-card` for new work.
- **Filters that look like filters.**
  - **Filters button** (`.flt__more`, still `btn btn--secondary`): a 20px funnel icon, the word **Filters**, and a `.flt__count` badge counting every active filter except the search box. Name "Filters, N active". With a filter set it gets `.is-active`: `--forest` border, `--teal-soft` fill, `--teal-ink` text. The same button object stays in the page across repaints, so focus is kept.
  - **Selects** (`select.input`, every select in the app): `appearance: none` with a chevron drawn from two linear gradients in `--muted` (works in both themes, no hex) and `padding-right: 36px`. A filter select whose value is not its default gets `.is-set`: `--forest` border, `--teal-soft` background (`background-color`, so the chevron stays), `--teal-ink` text, weight 650.
  - **Chips** (`.flt__chip`): `--forest` border, `--teal-soft` fill, `--teal-ink` text, a tick before the text (CSS only) and the × drawn as an 18px `--surface` circle that turns `--forest` on hover. Hover `--teal-soft-hover`; pressed (`:active`) `--forest` fill with `--on-forest` text. 32px tall on desktop, 44px under 960px.
  - **Clear all** (`.flt__clear`): a bordered ghost pill (`--line-2` border, `--accent` text, no underline); `--accent` border on hover; 44px under 960px.
  - **Check toggles** (`.flt__check`, such as Inbox "Unread only"): a bordered pill; when checked (`:has(input:checked)`) `--forest` border and `--teal-soft` fill. 38px on desktop, 44px under 960px.
  - **Tabs used as filters** use `--text` (not `--muted`) and a `--forest` border on hover. **Saved views** get a 3px left border (`--forest` when current) and a trailing ›.
  - Small hosts: the bar is search plus the Filters button, with the quick filters inside the panel (Listings, Rent and Calendar).
- **`--on-forest` token** (`:root`): text colour on a `--forest` fill. Today `#fff`, used for the pressed chip and the chip × on hover, so there is no raw white in the new block. Use it for any new text on a forest-green fill.
- **Phone 44px, new members (under 960px, the one block in `app.css`).** The theme-switch buttons (`.themeswitch button`, `.themeswitch--compact button`, `.morenav__theme .themeswitch button`; *ends the D-88 exemption*), the guest footer links `.bk__foot a`, the landing footer links `.lp-foot a`, review stars `.stars button` and `.stars--sm button` (44x44 with a 4px gap), the housekeeping calendar unit link `.hk-job__unit`, the bell panel footer link `.tb-pop__foot a` (in `public/css/topbar.css`, `inline-flex`, `min-height: 44px`), the check pill `.flt__check`, and **every `.btn--sm` is also 44px wide** (`min-width: 44px`). The footer links and the unit link are `inline-flex` with centred text.
- **Standalone links versus links inside a sentence.** A link on its own line, in a list or a footer is a *standalone* link and gets `.link-tap` or the 44px rule on phones. A link inside a sentence (the consent "privacy notice", "Ask BalayHub Support" in a paragraph) is exempt (the WCAG inline exception) and keeps the text's size. Calendar booking tiles (`.cal-bar`) and the cleaner-pay row boxes stay 24px.
- **`col-md-hide` and `col-md-show`.** Two helper classes for a table column that folds at middle widths. From 960px to 1439px `.col-md-hide` is hidden and `.col-md-show` is shown (as a muted line under the main cell); outside that range it is the other way round (`.col-md-show` is hidden; under 960px the table uses the card layout and a `[data-label]` cell of `.col-md-show` is dropped there). The Reservations Channel column is the first user. `.res-listing` clamps the listing name to two lines.
- **The theme switch is one radio group.** `role="radiogroup"` with `role="radio"` buttons and a roving `tabindex` (only the selected one is a Tab stop); the arrow keys, Home and End move and select. Its buttons are updated in place, never rebuilt, so focus stays on them.
- **Labels on the phone bottom bar:** "Groups" and "Help" for the long names (`BOTTOM_LABELS` in `app.js`: "Rent & Expenses" is "Rent"); the sidebar keeps the full names.
- **Page title of My account:** the h1 reads "My account"; the person's name is `.acct-hero__name`, an h2.
- **The scroll keeper never reveals an off-screen control.** When focus is put back after a redraw (`focusIt`), the control is scrolled into view only if it was visible before the redraw; error toasts are `role="alert"`.

## 25. Patterns added in QA round 16 (2026-10-15)

Decision D-97. All CSS changes are in `public/css/app.css`.

- **Landing hero calendar, Airbnb bar:** `#c8344a` (white text 5.19:1, WCAG AA). The wordmark stays the logo exemption.
- **`.flt` grid:** one `minmax(0, 1fr)` column, so a long select cannot push the bar wider than the screen; chips wrap.
- **Quick selects** (the filter bar's selects) size to their content above 480px.
- **`.coupon-row`:** the code box and its Apply button sit on one row.
- **`.cal-name`:** a block-level element, so the calendar's guest names do not run into the next tile.
- **`.toolbar > .cal-nav`:** the calendar's month bar (previous, month, next, Today) stays on one row.
- **Short-screen desktop sidebar:** smaller vertical padding on short screens so the whole menu fits.
- **`.lpad-later`:** the Launchpad's "Later (N more steps)" fold uses a styled `summary` (same look as the other folds).
- **Busy Save button:** `.btn[aria-disabled="true"]` (the existing grey look). A form's Save is marked busy, not `disabled`, while saving, so keyboard focus stays on it.

## 26. Patterns added in QA round 17 (2026-10-15)

Decisions D-98 and D-99. Changes are in `public/css/app.css` except the card step, which has its own file.

- **`.mention-list`** sits in the flow under the note box (`position: static`), so it never covers the composer's mode tabs.
- **`.hk-day__today`** text uses `--on-forest` (white on teal, about 5.3:1 in dark mode).
- **`.ops-check__tap`:** a 44x44 label around a row box, on phones, for the cleaner pay rows and the "Select all unpaid" label. The box stays 24px. This replaces the 24px exemption of D-92 and D-95.
- **`.themeswitch`** is an equal-column grid (`grid-auto-columns: 1fr`) everywhere, so Settings and My account show equal segments (103px each at 390px).
- **Focus keys:** `mt-status` becomes `mt-status-<target status>` (the table in section 22 is updated).
- **"Skip to conversation"** in the inbox reuses `.skip-link`.
- **The wordmark is a logotype** (section 1; D-99 O2).
- **Card on file (D-98), `public/css/cardcheck.css`** (linked from `index.html`; kept apart from `app.css`): `.cc-card` (the page card), `.cc-what` (the "what happens" list), `.cc-form` and `.cc-row` (fields stack one per row; expiry and CVC share a row from 360px), `.cc-wait` and `.cc-success` (the waiting-for-bank and confirmed states, whose h2 takes focus) and `.cc-footer` (Help, Account, Log out). Colours come from tokens only. Inputs carry no `name` and sit in no submitting form. The error summary is `role="alert"` and takes focus. Phone buttons are at least 44px.
- **Plan & billing card rows** (`cardBlock` in `settings.js`) use `.payonline__row`, with **Remove card**, **Change**, **Turn on automatic payment** and **Cancel automatic payment** as `btn--secondary btn--sm` buttons (not link-style), which keeps them at 44px on phones.
