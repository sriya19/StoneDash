# PLAN — Task 4: UI overhaul + real-data import

Status: **DRAFT — awaiting "go"**

Two parts in one task: (1) the product gets a real brand + a real visual language so it's presentable, and (2) the customer can import his actual jobs so the demo stops being a demo.

This task is **large**. The brief explicitly notes it will span multiple Claude Code sessions. I'll batch sub-steps and call out three natural pause points where you should review before I keep going.

## Scope acknowledgment

I understand:
- Brand rename: `Stone&DesignBoard` → `StoneDash` (platform name; tenants like `Top Marble & Granite` are unchanged).
- New palette: terracotta accent (`#C2410C`), warm cream / zinc neutrals. Replace existing `#4A5D7E` everywhere.
- Typography: Geist for headings, Inter for body (already installed), JBM for mono. Body sizing bumps from 14px → 15px.
- Design pivot: Linear-dense → Notion/Vercel-warm. Generous whitespace, soft shadows, hover-tint not hover-border, rounded 8 / 12 / 16 on inputs / cards / modals.
- New public landing at `/` (currently `/` redirects to `/dashboard` via the `(app)` layout gate).
- Login + signup redesigned with the two-column quote layout.
- Dashboard becomes the polished hero surface — greeting, ops summary, upgraded KPIs.
- Sidebar polish, table polish, empty/loading/toast polish across every surface.
- CSV import for customers / contractors / orders, plus a Quick Add path on `/orders`.

---

## Decisions & questions I'd like you to weigh in on (before I start)

### Q1. Hero screenshot — where does the PNG come from?

Two paths:
- **(A)** Take a real screenshot of the redesigned `/dashboard` via Playwright (chromium is already installed for Task 3.1's DOM smoke). Commit as `public/landing/dashboard-hero.png`.
- **(B)** Build a hand-coded mockup that visually approximates a dashboard. No binary commit, but extra effort + drifts from reality.

**Recommendation: (A).** Sub-step 3 lands the landing page with a placeholder block. Sub-step 5 (dashboard redesign) captures the real screenshot and replaces the placeholder. The PNG updates rarely (≤ once per design pass), so the binary commit is fine.

### Q2. Server-side CSV parse + 5MB file limit

Next.js server actions default to a 1MB request body cap. A 5MB CSV needs a different path.

**Recommendation:** Route handler at `app/api/import/parse/route.ts` that accepts `multipart/form-data`, parses with `papaparse` server-side, returns `{ headers, rows: rows.slice(0, 10), totalRows }` for the preview. A second server action `commitImport({mapping, rows, options})` does the actual transactional inserts in 100-row chunks.

This splits the heavy upload from the commit decision cleanly + lets us validate the file shape before the user commits to ingesting it.

### Q3. CSV injection sanitization

Standard OWASP shape: strip leading `=`, `+`, `-`, `@`, `\t`, `\r` from every cell before writing to DB. Implement in a small `sanitizeCell()` helper called inside the row-mapping logic. Also: log a counter of how many cells were sanitized; surface in the import summary so the user knows their file had suspicious cells.

### Q4. Date format leniency

CSV exports from QuickBooks, Excel, and shop owners' hand-rolled spreadsheets vary wildly. Accept:
- `YYYY-MM-DD` (ISO)
- `MM/DD/YYYY` (US)
- `M/D/YY` (US short)
- `MM/DD/YY` (US zero-padded short)
- `MMM D, YYYY` (e.g. "Jun 15, 2026")

Try each via `date-fns/parse` in order; the first successful parse wins. If none parse, mark the row as having a date error and let the user fix or skip.

### Q5. Quick Add — does it support inline customer create?

Brief says "customer combobox" — implies picking existing. Real-world friction case: a shop owner is in the back office typing in jobs from a notebook; some customers won't exist yet.

**Recommendation:** Yes — the combobox has the same "+ Add new customer" affordance as the existing New Order dialog (nested mini-form: name + phone). The whole point of Quick Add is "10 orders in 5 minutes"; forcing a /customers detour kills that.

### Q6. Landing page — dark mode

Notion / Vercel landings typically respect `prefers-color-scheme` but don't add a theme toggle to the marketing surface (toggle implies app, not marketing). Brief doesn't specify.

**Recommendation:** Render light by default. Respect `prefers-color-scheme` via `next-themes`'s system mode. **No** theme toggle in the landing nav (keeps it minimal). Same applies to login/signup.

### Q7. Public landing breaks the existing smoke pattern

`scripts/smoke_pages.ts` auths every request via the demo-owner session. The landing at `/` should render correctly **without** auth (it's the public marketing page).

**Recommendation:** Add an optional `public: true` flag to the smoke route schema. When set, the fetch skips the cookie header. Two routes need this initially: `/` and `/j/:slug-*` (which already works because middleware short-circuits public paths). The matrix update is small.

### Q8. Pagination redesign affects multiple pages

Brief: "Pagination: minimal — Prev / Next + page number, no chunky segmented control." Currently the segmented control lives in `orders-table.tsx`, `contractors-table.tsx`, and similar. Refactor target.

**Recommendation:** Extract a `<TablePagination>` component into `components/app/`. Each table imports it. One file changes, every table updates. Lands in sub-step 7 (table polish).

### Q9. Geist font availability

Geist (Vercel's font, donated to Google Fonts) is available via `next/font/google`. I'll verify on first use; if not available there I fall back to the `geist` npm package which Vercel maintains. Either way, integration is via `next/font` (no FOUT, automatic font-display).

### Q10. Pull-quote on login is aspirational

Brief: "I haven't lost track of an install in three weeks." — Owner, Top Marble & Granite. Brief explicitly flags this as placeholder until the customer signs off.

**Recommendation:** Ship the quote as written. Add a `<!-- TODO: confirm with customer -->` HTML comment next to it and a DEVLOG note. Trivial to swap when authorized.

### Q11. Sub-step boundaries and natural pause points

Brief suggested 14 sub-steps. I'll keep that ordering. Three pause points where I'll proactively stop for review:

- **After sub-step 2** (brand rename + design tokens). Visible regression risk — every page now uses new colors / fonts before any redesign work has happened. You'll see the brand color show up in unexpected places. Worth a sanity check before more UI lands.
- **After sub-step 8** (all UI polish wrapped). Half the task done; the app is fully redesigned but no CSV import yet. Worth showing the customer at this point for visual feedback before I spend a session on import infra.
- **After sub-step 12** (orders CSV import). All three import flows working. Worth a smoke test with real-world data before the Quick Add + docs wrap.

You can override these pause points at any time with "go straight through" or "stop now" — they're checkpoints, not commits to wait.

### Q12. Quality bar — manual responsive + dark mode review

Brief mandates: "Open every redesigned page in BOTH light and dark mode before committing the sub-step. Test responsive at 375px, 768px, 1280px."

**Recommendation:** Automate this via Playwright (chromium already installed). Each polish sub-step gets a small `pnpm tsx scripts/screenshot_review.ts <route>` invocation that captures 6 screenshots (3 viewports × 2 themes) to `screenshots/<sub-step>/<route>__<viewport>__<theme>.png`. Screenshots are gitignored (binary churn) but listed in DEVLOG with file counts. Lets me confirm responsively without burning your time.

For sub-step 14, the DEVLOG wrap includes 4–6 **before/after** screenshots committed under `docs/screenshots/` to make the redesign visible in git history.

---

## Sub-step breakdown

Each sub-step: implement → `pnpm typecheck` → `pnpm lint` → `pnpm build` → `pnpm smoke` (SSR + DOM) → update DEVLOG → commit. All existing integration scripts (`test_event_reschedule`, `test_share_link_status`, `test_standalone_event`) must continue to pass.

### Sub-step 1 — Brand rename + grep audit + favicon + meta
**Commit:** `chore(brand): rename to StoneDash + favicon + meta`

- Grep audit + replace:
  - `Stone&DesignBoard` → `StoneDash`
  - `Stone & Design Board` → `StoneDash`
  - `stone-design-board` → `stonedash` (package.json name; routes / paths stay as the file names — only references in copy / metadata change)
  - `#4A5D7E` → `#C2410C` (literal hex string in CSS / config files; deferred to sub-step 2 where the token system gets the proper treatment)
- `app/layout.tsx` metadata: title default → `"StoneDash"`, description, OG tags.
- Favicon: hand-craft `public/favicon.svg` (32×32, terracotta `S`). Plus `public/apple-touch-icon.png` (180×180), `public/manifest.json` referencing the SVG. Wire via `app/layout.tsx` `icons` metadata.
- Update `README.md` heading + intro paragraph.
- Update `DEVLOG.md` heading.
- Update `supabase/seed.ts` — the platform brand mentioned in the console.warn message. The tenant `Top Marble & Granite` org name stays.
- Surface in DEVLOG: list of every file touched + count of replacements per file. Visible audit trail.

**Verification.** Grep for `Stone&DesignBoard\|Stone & Design Board\|stone-design-board` → expected zero hits (except in DEVLOG historical entries, which I'll leave untouched — they're the audit trail).

### Sub-step 2 — Design tokens migration
**Commit:** `feat(design): terracotta palette + Geist + warmer tokens`

- `tailwind.config.ts` color tokens:
  - `brand` → `#C2410C`, `brand-hover` → `#9A3412`, `brand-muted` → `#FED7AA`
  - Background: `#FAFAF7` light / `#18181B` dark
  - Foreground / muted / border per brief
  - shadcn vars (`primary`, `secondary`, etc.) re-rooted on the same palette
- `app/globals.css`: CSS variable definitions for both `:root` and `.dark`.
- `app/layout.tsx`: install Geist via `next/font/google` (verify availability on first run; fall back to `geist` npm package if needed). Wire as `--font-geist`. Bump default body size to 15px via Tailwind base layer override.
- `tailwind.config.ts` font-family: `geist`, `inter`, `mono` as named families.
- shadcn `Button` component: primary uses brand color, rounded-md → rounded-lg (8px).
- shadcn `Card`: rounded-xl (12px) + `shadow-sm`.
- `Dialog` / `Sheet`: rounded-2xl (16px) on the content container.
- DEVLOG: capture before/after screenshot of `/dashboard` to show the visual shift.

**Pause point.** Brand + tokens visible everywhere; surface-level polish hasn't happened yet so some pages will look transitional. Worth a sanity check before more UI work.

### Sub-step 3 — Landing page at `/`
**Commit:** `feat(landing): public marketing page at /`

- New `app/page.tsx` (replaces the current behavior where `/` hits the `(app)` layout's auth gate).
  - Server component. Reads auth via `getCurrentUser()` (lightweight, no redirect). If logged in → `redirect("/dashboard")`. Else → render landing.
- Subroutes inside `app/(marketing)/`:
  - `components/nav.tsx` — sticky nav, scroll-aware blur (small client component just for the IntersectionObserver / scroll listener).
  - `components/hero.tsx` — server component, the centered headline + CTAs.
  - `components/feature-grid.tsx` — 6-up server component.
  - `components/built-inside.tsx` — Two-column shop-story + author bio. Bio uses a circular `bg-muted` placeholder until you give me a photo URL.
  - `components/cta-band.tsx` — full-width terracotta-tinted CTA.
  - `components/footer.tsx`.
- Hero "product screenshot" mounts a placeholder div for now; sub-step 5 replaces with the real PNG once dashboard is redesigned.
- Smooth-scroll via `scroll-behavior: smooth` on `html` (CSS only, no JS).
- OG meta tags + twitter cards.
- Lighthouse target: ≥90 perf + a11y. Verify with `lighthouse` CLI; document scores in DEVLOG.
- Update `scripts/smoke_pages.ts`: add `/` with `public: true` flag (skip auth on this route). Add to the schema with type-checking so future public routes are explicit.

### Sub-step 4 — Login + signup polish + onboarding
**Commit:** `feat(auth): two-column login + signup with quote + polish`

- `(auth)/login/page.tsx` + `(auth)/signup/page.tsx`:
  - Two-column at `lg` breakpoint, single-column below.
  - Left column: form. StoneDash wordmark, heading, Google OAuth button at top with proper Google icon (use `lucide-react`'s `Chrome` or a custom inline SVG — Google's brand guidelines require their exact mark for OAuth buttons; will use the official SVG).
  - Right column: terracotta gradient + pull-quote (placeholder per Q10).
  - Switcher link to the other page at the bottom.
  - Forgot password link below the form on login.
- `onboarding/page.tsx`: matching visual treatment (Geist heading, warmer spacing). Same logic.
- Run screenshot review at 3 viewports × 2 themes per Q12.

### Sub-step 5 — Dashboard redesign + hero screenshot capture
**Commit:** `feat(dashboard): greeting, ops summary, upgraded KPIs, pipeline polish`

- Greeting: time-of-day aware ("Good morning / afternoon / evening"). First name from `profile.full_name` (split on space, take first).
- Ops summary line: dynamic — "You have N installs today and $X in unpaid contractor balances." Query both numbers in the existing dashboard parallel-fetch.
- KPI cards: Geist semibold 32px tabular-nums, trend indicator (▲ X% from last week) computed from a 7-day-back delta. Urgent card (overdue today) gets a subtle terracotta accent.
- Pipeline strip: wider columns, better per-stage colors using the new palette.
- Activity feed: smaller avatars, group same-actor consecutive rows ("Sriya made 3 changes").
- **Capture hero screenshot** via Playwright at 1280×800, light mode, with the seeded Top Marble data. Save to `public/landing/dashboard-hero.png`. Update `(marketing)/components/hero.tsx` to reference it.

### Sub-step 6 — Sidebar + top bar polish
**Commit:** `feat(shell): sidebar wordmark + new active state + user popover`

- `sidebar-nav.tsx`: StoneDash wordmark at top. Active state: 3px terracotta left-edge strip + `bg-accent/40` tint (currently a brand-dot affordance — replace with the strip).
- Org switcher: shadcn `<Popover>` with a chevron, looks like a real dropdown (currently a bordered Button — visually fine but feels click-uncertain).
- User menu at bottom: avatar + name + chevron. Click opens a `<Popover>` with settings / theme toggle / sign-out. Currently those are inline buttons; the popover groups them under the user identity and reads as a single user surface.

### Sub-step 7 — Table-wide polish + pagination
**Commit:** `feat(tables): warmer hover + status pills + minimal pagination`

- Extract `components/app/table-pagination.tsx` per Q8. Used by orders, customers, contractors, team, schedule list.
- All tables:
  - Column headers: Inter 12px uppercase tracking-wide muted.
  - Row hover: subtle warm-tinted background (`bg-accent/20`), no border change.
  - Status badges: pill shape, subtle background tint (`bg-{status}/15`), no border.
  - Action buttons in rows: icon-only, ghost variant.
  - Row height bumped to 44px (currently varies — normalize via Tailwind class on `<TableRow>`).
- The schedule list view (sub-step 6 of Task 3) gets the same treatment.

### Sub-step 8 — Empty + loading + toast polish
**Commit:** `feat(polish): empty states, skeleton loaders, warmer toasts`

- New `components/app/empty-state.tsx` component:
  - `bg-orange-50` background, dashed warm border
  - Lucide icon at 32px in terracotta
  - Headline + subhead + primary action button
  - Used by orders, customers, contractors, team, schedule when the list is empty.
- Skeleton loaders matching content shape:
  - `<TableSkeleton rows={N}/>` for tables (mimics the table chrome).
  - `<CardSkeleton/>` for KPI cards.
  - `<EventBlockSkeleton/>` for the calendar.
  - Inline via React `<Suspense>` boundaries on Server Components where it's natural.
- Toast (sonner) config: top-right, 4-second auto-dismiss, warmer color palette (success: green-600 bg, destructive: red-600 bg, default: bg-card).

**Pause point.** All UI work done. Customer can be shown the redesigned app at this point. Worth a checkpoint before CSV infra.

### Sub-step 9 — CSV import infrastructure
**Commit:** `feat(import): parse route, commit action, papaparse + sanitization`

- `pnpm add papaparse` + `@types/papaparse`.
- `app/api/import/parse/route.ts` — route handler, accepts multipart/form-data with a file field. Validates content-type, size ≤ 5MB, returns `{ headers, sampleRows: rows.slice(0, 10), totalRows, fileHash }`. The fileHash lets the commit step verify we're committing the same file.
- `lib/actions/import.ts` — `commitImport({type, mapping, rows, fileHash, options})` server action. Per-type validators (sub-steps 10/11/12 each register one). Chunked inserts (100 rows / txn).
- `lib/import/sanitize.ts` — `sanitizeCell(value)` strips leading `=`, `+`, `-`, `@`, `\t`, `\r`. Counter of sanitized cells surfaced in the summary.
- `lib/import/dates.ts` — `parseFlexibleDate(value)` tries 5 formats per Q4.
- `app/(app)/import/page.tsx` — server component with three sub-tabs (Customers / Contractors / Orders). Each tab is a separate client component (sub-steps 10/11/12 build them).
- `public/templates/` — three placeholder .csv files (customers-template.csv, contractors-template.csv, orders-template.csv) with headers + 2 example rows.
- Sidebar nav: add Import as an active entry.
- Smoke: add `/import?tab=customers/contractors/orders` to the SSR route list.

### Sub-step 10 — Customers CSV import
**Commit:** `feat(import): customers flow — preview, map, dedupe, commit`

- `components/app/import-customers.tsx` — drag-drop dropzone → POST to `/api/import/parse` → preview UI with column-mapping dropdowns → duplicate detection (match on `(lower(name), phone)`) → confirm summary → call `commitImport`.
- Validation: name required, email valid format if present.
- Duplicate UI: per-row, three radio options (skip / update / import anyway).
- Progress for >50 rows via Server-Sent-Events? **Recommendation:** Skip SSE for v1. Show optimistic indeterminate progress on the client, surface real counts in the final toast. SSE adds complexity I'd rather defer.
- Run a one-off `scripts/test_import_customers.ts` that exercises the full path with a small sample CSV.

### Sub-step 11 — Contractors CSV import
**Commit:** `feat(import): contractors flow — same pattern as customers`

- `components/app/import-contractors.tsx` — same shape as customers, columns from the brief.
- Duplicate detection on `lower(name)` only (contractors don't always have a single phone).
- Integration test: `scripts/test_import_contractors.ts`.

### Sub-step 12 — Orders CSV import (hardest)
**Commit:** `feat(import): orders flow — customer + contractor linking, lenient dates`

- `components/app/import-orders.tsx`:
  - Customer linking dropdown per row: match-to-existing / create-new / skip.
  - Contractor linking dropdown per row: same.
  - Date parsing via `parseFlexibleDate`.
  - Order number: empty → generate via `generate_order_number` RPC. Present → check `UNIQUE(org_id, order_number)`; on collision offer rename.
  - Per-row transaction so failures don't leave partial state.
- Integration test: `scripts/test_import_orders.ts` exercising 4 cases (clean row, missing customer auto-create, contractor collision, bad date).

**Pause point.** All imports working with real data shapes. Worth a checkpoint before Quick Add + docs wrap.

### Sub-step 13 — Quick Add on /orders
**Commit:** `feat(orders): quick add sheet — minimal one-screen new order`

- Button next to "+ New order" labeled "Quick add" with a `Bolt` (lightning) icon.
- Sheet opens. Form: customer combobox (with inline "+ Add new" per Q5), project name, stone type, quote amount, install date. Save.
- Submit calls the existing `createOrder` action with sensible defaults (priority="normal", stage="quote", sink_cutouts=0, etc.).
- The install date populates an `order_event` via the action layer's existing path (Task 3 sub-step 1 wired this).
- One-shot test: `scripts/test_quick_add.ts` exercises create + verify event was scheduled.

### Sub-step 14 — README + DEVLOG wrap + before/after screenshots
**Commit:** `docs: task 4 wrap + before/after screenshots`

- README:
  - Rename "Stone & Design Board" → "StoneDash" throughout.
  - New "Brand + design tokens" subsection under design language.
  - New "CSV import" how-to subsection: file format, column mapping, duplicate handling, template links.
  - "What's intentionally deferred" gets a Task 4 group (SMS, AI extraction, Vercel deploy, custom domain, payments, mobile, analytics — all per brief).
- DEVLOG closing entry per sub-step (written inline as we go).
- **Before/after screenshots** committed to `docs/screenshots/task-4-before/` and `docs/screenshots/task-4-after/`. Capture at 1280×800 for: landing (new only), login, dashboard, orders table, contractor detail, schedule week view. ~12 PNGs total, modest binary commit.
- Final `pnpm smoke` across both stages. typecheck + lint + build green.

---

## Out of scope (restated)

- WhatsApp / SMS automation (Task 5 candidate).
- AI document extraction.
- Production deployment to Vercel (the brand work is the prereq; the deploy itself is separate).
- Custom domain setup.
- Payment processing / Stripe billing.
- Mobile native app.
- Analytics / Posthog / Mixpanel integration.

---

**Waiting for "go" — and your preferences on Q1–Q12 if any differ from the defaults above.**
