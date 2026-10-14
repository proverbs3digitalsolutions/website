# BalayHub design brief

Last updated: 2026-10-13

**Summary.** BalayHub is a phone-first web app (also an installable PWA) for Filipino rental and staycation hosts. It is built with plain CSS, one stylesheet (`public/css/app.css`), and small JavaScript helpers (`public/js/ui.js`). There is no framework and no CSS preprocessor. The look is calm and practical: Forest Green on soft off-white, Sand and Sun as warm accents, Poppins for headings, Inter for text, rounded cards, and large touch targets. Colours come from CSS custom properties on `:root`. A dark theme redefines the same tokens, so any component that uses tokens gets dark mode automatically. This brief records what is **actually built**. Every value below comes from the code. Where the code doesn't define a token (spacing, type sizes), the brief lists the values in use and says so.

Source files: `public/css/app.css`, `public/js/ui.js`, `public/js/theme.js`, `public/js/themeswitch.js`, `public/js/filters.js`, `public/js/charts.js`, `public/js/assistant.js`, `public/js/app.js` (shell), `public/js/i18n.js`, `public/js/views/landing.js`, `public/manifest.webmanifest`, `public/icons/`, `public/offline.html` + `public/css/offline.css`, `public/favicon.svg`, `public/index.html`.

---

## 1. Brand

| Item | What is built |
|---|---|
| Name | **BalayHub**. *Balay* means "house" in several Philippine languages. The wordmark in `brand()` renders `Balay` + `<b>Hub</b>`. CSS sets it in uppercase Poppins 700 (`text-transform: uppercase; letter-spacing: .01em`), "Balay" in `--accent` and "Hub" in `--sage`. Its `aria-label` is "BalayHub". |
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
| Sentence case | Labels, buttons and headings use sentence case: "Help & support", "Unit owners", "More filters", "Contact support with this chat", "Try again". (Known exception: the nav item "Rent & Expenses".) |
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
| Switch | `themeSwitch({ compact })` in `themeswitch.js` is a `role="radiogroup"` named "Colour theme". It has three `role="radio"` buttons with `aria-checked`: ☀︎ Light, ☾ Dark, ◐ Match device. The compact version shows icons only. The selected option is filled `--forest` with white text. |
| Where it appears | Sidebar footer (compact), the phone More sheet (full) and the landing footer (compact). |
| CSS | `:root[data-theme="dark"]` forces dark. With no attribute, `prefers-color-scheme: dark` applies dark. With `data-theme="light"`, the page stays light. |

---

## 4. Layout

### 4.1 App shell (`buildShell` in `app.js`)

| Viewport | Structure |
|---|---|
| **Phone and tablet (< 960px)** | A sticky **topbar** (z 30, safe-area aware) with the brand, organisation name and avatar. The `main.content` area is max 1180px wide, with 16px padding and 96px plus the safe area at the bottom. A fixed **bottom nav** (z 40) has 5 equal columns: the first 4 nav items (excluding Launchpad, and with "Rent & Expenses" shortened to "Rent") plus a **More** button. Icons are 24px and labels `.72rem`. The active item is `--accent`. |
| **More sheet** | `.morenav` is a full-screen scrim (`rgba(10,20,35,.4)`, z 50) with a bottom sheet (radius `18px 18px 0 0`). It lists My account, the remaining nav items, the theme switch and Log out. The rows are 14px-padded links with 22px icons. Tapping the scrim closes it. |
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
| **560px** (`max 559` / `min 560`) | Two-column form rows. Below it: modals become bottom sheets, form-action buttons stretch, and the assistant goes full width. |
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

Wrap tables in `.table-wrap` (horizontal scroll). In `.table`, cells have 10px/8px padding and `--line` bottom rules, and headers are uppercase muted `.76rem`. Use `.num` to right-align numbers. `tfoot` and `tr.is-total` (`--sand-soft`) mark totals. `.row-link` makes a whole row clickable: hover is `--surface-2` and focus shows a 2px `--teal` outline. `.table--compact` reduces the padding.

### Badges

See 2.4 and 2.5. Always build badges with `badge(status, text?)`.

### Tabs

`.tabs` holds pill links or buttons (`8px 14px`, `--line-2` border, muted text) and scrolls horizontally. The active tab is marked with `aria-current="true"` or `aria-selected="true"` and filled `--forest` with white text. `.tabs--compact` is a smaller version. The landing page uses its own `.lp-tabs` (selected state `.is-on`).

### Toolbar and filter bar (`filters.js`)

| Part | Spec |
|---|---|
| Layout | `filterBar(...)` builds `.flt` → a `.toolbar` row (a search box at `flex: 1 1 220px`, quick selects inline, and a **More filters** secondary button showing a `.flt__count` badge), an optional `.flt__panel` (a `card--soft` grid of fields with **Reset filters** and **Done**), and a `.flt__chips` row. |
| Chips | `.flt__chip`: a `--green-soft` pill with a `--line-2` border and "Label: value ×". Each chip has the label "Remove filter …", and the chip row is `aria-live="polite"`. **Clear all** (`.flt__clear`) appears when there is a search or more than one chip. |
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
| ARIA | The theme switch is a radiogroup with radios and `aria-checked`. The language toggle uses `aria-pressed`. The More filters button has `aria-expanded`. Filter chips are labelled "Remove filter …". Field errors use `role="alert"` and `aria-describedby`, and invalid inputs get `aria-invalid`. Toasts use `role="status"` in an `aria-live` region. Modals are native `<dialog>` with `aria-label`. Charts use `role="img"` with an `aria-label` and offer a table. The tracker step has `aria-current="step"`. The unread badge is labelled "{n} unread". Icons are `aria-hidden`, and `.sr-only` exists. |
| Reduced motion | `@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }` stops the skeleton shimmer, the typing dots and button transitions. |
| Contrast (WCAG ratios computed from the tokens) | Light: text on bg 13.9:1, muted on surface 5.9:1, white on Forest 9.4:1. Status pairs are 4.7–5.8:1 (amber is the lowest at 4.7). Dark: text on bg 15.3:1, muted on surface 7.4:1, accent on surface 9.4:1, status pairs 6.1–7.8:1, white on dark Forest 5.3:1. See section 10 for the known failures. |
| Tap targets | Buttons are at least 46px (small ones 38px), inputs at least 48px, the modal close button is 40×40, the hk checklist boxes are 24px, and bottom-nav items are about 56px tall across a fifth of the screen width. Smaller controls exist (see section 10). |
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
| Use `filterBar()` on every list page, with a search box, quick filters, More filters and chips. | Don't build a one-off filter row. |
| Handle the empty, error and loading states with `emptyState`, `errorState(err, retry)` and `skeleton()`. | Don't leave a blank card or a raw error. |
| Ask before destructive actions with `confirmDialog({ danger: true })`, and add `reason: true` when it should be audited. | Don't use `window.confirm`, and don't put destructive actions in primary green. |
| Use one primary button per view. Use secondary for Cancel and ghost for tertiary actions. | Don't put two primary buttons side by side. |
| Keep tap targets at least 44px (use `.btn`, or `.btn--sm` at 38px only in dense toolbars). | Don't ship icon-only buttons smaller than 34px or without an `aria-label`. |
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
| 10 | Contrast below 4.5:1: white on the Vrbo bar `#0891b2` (3.7:1) and on Airbnb `#d93b52` (4.5:1, borderline); `--muted-2` text (2.2:1 light); chart orange and aqua against white (3.2 and 2.8:1, acceptable for graphics but not for text); review stars `#e0a526` (2.2:1); the sage "Hub" on white (2.5:1, decorative wordmark). | tokens and `app.css` |
| 11 | `offline.html` / `offline.css` have no dark mode and use `system-ui` rather than Inter. | `public/offline.html` |
| 12 | Small tap targets: theme-switch buttons (about 30px), `.langtoggle` buttons (about 26px), `.flt__chip` (about 26px), assistant icon buttons (34px) and `.tabs--compact`. | `app.css` |
| 13 | No spacing, type-size or breakpoint tokens. Radius values of 12, 16, 18 and 20px are hard-coded alongside `--radius` and `--radius-sm`. `--navy-2` is unused. `--teal` and `--forest` are duplicate aliases. | `app.css` |
| 14 | There is no "skip to content" link, even though `main#main` exists. The More sheet uses `role="menu"` without menu keyboard handling and has no Esc-to-close or focus management. | `app.js` |
| 15 | The `theme-color` meta follows the device theme, not a forced `bh-theme` choice. The nav label "Rent & Expenses" breaks sentence case. | `index.html`, `app.js` |

---

## 11. Patterns added in QA round 2 (2026-10-14)

- **Phone row stacking.** At 480px and narrower, a `.row` whose end holds buttons, chips or a label wraps so the actions sit on their own line. Add `.row--stack-sm` to force this on any other row.
- **Scroll cues.** `.table-wrap` and `.tabs` show a faint edge fade only on the side where more content is hidden (`background-attachment: local` over `scroll`). Use it on any new wide table or tab strip.
- **Focus ring token.** `--focus-ring` replaces the old translucent ring (see section 6).
- **Muted text instead of opacity.** Cancelled messages use `var(--muted)` with a dashed border rather than `opacity`, so contrast holds. Mentions use `--teal-ink`; today's calendar day and the Airbnb bar colour were darkened for contrast.
- **Compact Ask button on phones (superseded in round 3: the Ask button is now in the top bar below 960px, see section 12).** Below 560px the assistant button is a 48px icon-only circle (its `aria-label` stays), and the page gets extra bottom padding so it never covers the last line.
- **Stat values** no longer break mid-number: they stay on one line and the font shrinks (`clamp(1rem, 4.2vw, 1.45rem)`).
- **Logo exemption.** The light-green "HUB" in the wordmark keeps its colour. WCAG exempts logo text from the contrast rule (founder question in BLOCKERS).

## 12. Patterns added in QA round 3 (2026-10-14)

- **Ask button in the top bar on phones.** Below 960px the assistant button is a 40px round icon button in the top bar (`.topbar__assist` slot, `.assist-fab--bar`), placed before the account avatar, with the same `aria-label`. It never floats over content. On desktop (960px and up) it stays a floating button. This supersedes the section 11 compact floating button.
- **Table edge cue.** `.table-wrap` shows a real shade on the clipped edge while the box can still scroll, and it shows over solid cell backgrounds (the section 11 fade did not). Use it on any new wide table.
- **Wrapping tabs.** At 560px and narrower, `.tabs` wrap onto as many lines as they need instead of scrolling, so every tab and chip shows.
- **`.col-sm-hide`.** Put it on the header and cells of a low-priority column; it is hidden at 480px and narrower. The reservations list uses it for Channel and Code and shows Total and Balance right after the dates.
- **Alerts wrap long words** (`overflow-wrap: anywhere`), so a long unbroken note can't push the page sideways.
- **Focus clear of the bottom bar (WCAG 2.4.11).** Below 960px the page has bottom scroll padding the height of the bottom bar, and a small focus guard in the app shell scrolls a focused control up if the bar still covers it.
- **Toolbars.** Children can shrink (`min-width: 0`), and selects go full width at 480px and narrower. The Get started sheet follows the phone sheet width at 560px and narrower.
