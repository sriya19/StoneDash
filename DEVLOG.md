# DEVLOG — StoneDash

Running log of decisions, assumptions, and deferred items. Newest first.

---

## Task 4 — UI overhaul + real-data import (2026-06-15)

Two-part task driven by direct customer feedback after a live demo: "I want to see it working — full functional model — and I want to see better UI." The brand + visual language land first so all subsequent UI work happens in the new design system; CSV import lands last as the unlock for real-world validation. See `PLAN.md` for the full sub-step breakdown.

### Sub-step 1 — Brand rename + favicon + meta (complete)

**Renamed `Stone&DesignBoard` / `Stone & Design Board` → `StoneDash`** across the codebase. Tenants (`Top Marble & Granite`, etc.) are unchanged — they're customers inside the platform, not the platform brand.

**Files touched (13 source/doc files, 14 string replacements):**

| File | Replacements | Notes |
|---|---|---|
| `app/layout.tsx` | 1 → expanded | Default title now `"StoneDash"` with `template: "%s · StoneDash"`; description + OG + icons + manifest wired here |
| `app/(app)/customers/page.tsx` | 1 | Per-page metadata title collapsed to `"Customers"` (template appends suffix) |
| `app/(app)/settings/page.tsx` | 1 | Same |
| `app/(app)/schedule/page.tsx` | 1 | Same |
| `app/(app)/team/page.tsx` | 1 | Same |
| `app/(app)/orders/page.tsx` | 1 | Same |
| `app/(app)/contractors/[id]/page.tsx` | 1 | Same |
| `app/(app)/contractors/page.tsx` | 1 | Same |
| `app/invite/[token]/page.tsx` | 1 | Same |
| `app/(auth)/signup/page.tsx` | 1 | Same |
| `app/(auth)/login/page.tsx` | 1 | Same |
| `app/onboarding/page.tsx` | 1 | Same |
| `supabase/seed.ts` | 1 | Header comment only — no demo content reads the platform name |
| `package.json` | 1 | `"name": "stone-design-board"` → `"stonedash"` |
| `README.md` | 2 | Heading + tagline + example Vercel domain |
| `DEVLOG.md` | 1 | Heading |

**Title-template pattern.** Instead of touching all 12 page metadata files every time the brand changes, I switched the root layout's title to a `{ default, template }` shape:

```ts
title: { default: "StoneDash", template: "%s · StoneDash" }
```

Each page now only supplies its own segment (`"Customers"`, `"Schedule"`, etc.) and Next.js synthesizes the full document title. Cleaner contract for future rebranding and reduces the surface area of any future audit.

**`metadataBase`** now reads `NEXT_PUBLIC_SITE_URL` so OG / Twitter tags get absolute URLs in production. Falls back to `undefined` in dev (Next.js handles relative paths fine there).

**Favicon + icons + manifest.**
- `public/favicon.svg` — 32×32, terracotta `S` on a warm cream square. Renders crisp at 16px through 180px. Geist with system-font fallback chain.
- `public/icon.svg` — 180×180 apple-touch / maskable icon. Solid terracotta background, off-white `S`. Apple home-screen icons get OS-rounded corners; the SVG draws a full-bleed background so the rounding looks clean.
- `public/manifest.json` — `name: "StoneDash"`, `theme_color: #C2410C`, `background_color: #FAFAF7`, `start_url: /dashboard`, display standalone.
- Wired via `app/layout.tsx` metadata.icons + .manifest. No `apple-touch-icon.png` because modern iOS (14+) accepts SVG; documented as a known gap if we ever need to support older iOS reliably (no current evidence we do).

**Verification.** Grep across `*.{ts,tsx,json,md,css,mjs,js}` excluding `node_modules/` and `.next/`:
- `Stone&DesignBoard` / `Stone & Design Board` / `stone-design-board` → **0 hits in source/docs** (only `PLAN.md` mentions remain, intentionally — they describe the rename).
- `DEVLOG.md` historical entries had no brand mentions to preserve. The rename is the audit trail.

The local filesystem path `/Users/sriyapothula/stone-design-board/` is out of scope (renaming the dir would break the user's tooling).

**Gates.** `pnpm typecheck` + `pnpm lint` + `pnpm build` + `pnpm smoke` all green. Package name in build output reads `stonedash@0.1.0` confirming the rename took.

### Sub-step 2 — Design tokens migration (complete)

**The visible visual shift.** Every component that reads `bg-primary`, `text-primary-foreground`, `bg-accent`, `border-border`, `ring-ring`, `bg-card`, etc. now inherits the new warm terracotta-on-cream palette automatically. No per-component rewrites in this sub-step — that's what sub-step 6–8 are for. This sub-step just changes what the existing classes resolve to.

**`app/globals.css` — total rewrite of the token block.**
- Switched from `oklch()` to hex literals throughout. Modern CSS handles both; Tailwind's `bg-primary/90` opacity modifier resolves via `color-mix(...)` either way. Hex is easier to verify against the brief (terracotta = `#C2410C`, not `oklch(0.55 0.18 38)`).
- Light-mode tokens: `--background: #FAFAF7` (warm cream), `--foreground: #18181B` (zinc-900), `--primary: #C2410C` (terracotta = brand). `--brand` mirrors `--primary` for backward-compatible class names; `--brand-hover: #9A3412`, `--brand-muted: #FED7AA` are new variables Tailwind picks up via the config below.
- `--accent: #FFF7ED` (orange-50) for warm hovers per brief.
- `--destructive: #DC2626` kept neutral red — brief was explicit about not warming it.
- Dark-mode tokens shift the brand one stop lighter (`#EA580C` orange-600 instead of `#C2410C` orange-700) so contrast against the dark `#18181B` background reads clean. Same hue family; just a lightness pump.
- New `--success: #16A34A` / `--success-foreground` token (was hardcoded green elsewhere; now centralized).
- Sidebar tokens re-rooted on the same palette. Active state will use `bg-sidebar-accent` (orange-50 light / warm-dark dark) once sub-step 6 wires it.
- Chart palette goes warm-leaning (terracotta → orange-600 → orange-500 → orange-400 → orange-200) so any future data viz inherits a brand-consistent gradient.

**Typography.**
- Body bumps from 14px → 15px in the `body` base rule. Tables / dense surfaces opt back to 13–14px via Tailwind `text-xs` / `text-sm` classes they already had.
- New global rule: `h1, h2, h3, h4, h5, h6 { font-family: var(--font-geist-sans), ...; letter-spacing: -0.01em; }`. Cascades automatically — no per-heading className change required across the codebase. Geist comes via the `geist` npm package, not `next/font/google`.

**Geist install — `next/font/google` fallback realized (PLAN Q9).** Next 14.2.35 was built before Geist landed in Google Fonts, so `Geist` isn't an export of `next/font/google` — typecheck caught this immediately. Switched to Vercel's `geist` npm package (`pnpm add geist`); imports `GeistSans` from `geist/font/sans` and wires `GeistSans.variable` into the body className. The variable name the package exposes is `--font-geist-sans`, so `tailwind.config.ts` and the heading CSS rule both reference that exact name.

**`tailwind.config.ts`.**
- `fontFamily.geist` family added alongside `sans` (Inter) and `mono` (JetBrains Mono). Class `font-geist` is now usable directly when explicit override is needed (the wordmark in sub-step 6 will use it).
- `colors.brand` gains `hover` and `muted` keys → `bg-brand-hover` and `bg-brand-muted` are now valid Tailwind classes.
- `colors.success` added (matches the new `--success` CSS var).
- Borderradius config unchanged — Tailwind's defaults (`rounded-lg = 8px`, `rounded-xl = 12px`, `rounded-2xl = 16px`) already hit the brief's targets at the right component layers (buttons / cards / modals).

**shadcn primitive updates** to hit the brief's radius scale at the component layer:
- `components/ui/button.tsx` — every `rounded-md` (6px) → `rounded-lg` (8px). Default variant still `bg-primary text-primary-foreground` → renders terracotta automatically.
- `components/ui/dialog.tsx` — `DialogContent`'s `sm:rounded-lg` → `sm:rounded-2xl` (16px).
- `components/ui/sheet.tsx` — each `side` variant gets inner-edge rounding: `top/bottom` get `rounded-b-2xl` / `rounded-t-2xl`, `left/right` get `rounded-r-2xl` / `rounded-l-2xl`. Outer edge stays square (the sheet butts against the viewport, no need to round into nothing).
- Raw-`<div>` "cards" throughout the codebase already use `rounded-xl` (12px) where they exist — the brief's 12px target is met without further per-file edits.

**`#4A5D7E` audit.** Grep across `*.{ts,tsx,css,json,mjs,js}` excluding `node_modules` / `.next`: **zero hits.** The old slate-blue was always defined via the `--brand` CSS variable in `globals.css`; no component had the hex literal embedded. Replacing the CSS var was sufficient.

**Verification.**
- `pnpm typecheck` + `lint` + `build` all green after the Geist swap.
- `pnpm smoke` → **26 SSR OK + 3 DOM OK / 0 FAIL.** No route regressions from the palette change.
- Probed the compiled CSS at `/_next/static/css/app/layout.css` — contains `#C2410C`, `#FAFAF7`, `--brand`, `--brand-hover`, `--primary:`, `--font-geist-sans`, `rounded-2xl`. All tokens shipping.

**Known visual state.** Pages aren't redesigned yet; they're rendering with old layout + new colors. Some surfaces (sidebar active state, buttons everywhere) now show terracotta where they used to show slate-blue — that's the only visible difference until sub-step 3+ start touching layouts. Per PLAN, this is a natural pause point: the customer-visible regression risk is at its peak. Sub-steps 3–8 walk it back into a coherent designed surface.

### Sub-step 3 — Landing page at `/` (complete)

**Replaces the placeholder marketing page** with a six-section landing that puts the product, the story, and a single conversion action in front of an unauthenticated visitor.

**Auth-aware root.** `app/(marketing)/page.tsx` calls `getCurrentUser()` (the lightweight, non-redirecting accessor from `lib/auth.ts`) and `redirect("/dashboard")`s when a session exists. Anonymous visitors get the landing. The `(marketing)` route group means `/` resolves to this page without inheriting the `(app)` layout's auth gate — same separation Vercel / Linear / Notion use for their marketing surfaces.

**`app/(marketing)/_components/`** (underscore prefix so Next doesn't treat the directory as a route):

- **`nav.tsx`** — sticky header. The ONLY client component on the landing. Tiny `useEffect` listens for `window.scroll`; background transitions from transparent → `bg-background/80 backdrop-blur-lg` past 8px. StoneDash wordmark left (Geist semibold), Log in + Get started CTAs right.
- **`hero.tsx`** — server component. Centered max-w-3xl. Eyebrow ("OPERATIONS SOFTWARE FOR STONE FABRICATORS"), Geist 4xl→6xl headline, Inter subhead, primary + outline CTA, "Free during open beta" microcopy. **Product screenshot is a placeholder** — a 16:10 aspect-ratio gradient div with rounded-2xl + shadow-2xl. Sub-step 5 captures the live dashboard PNG and swaps in the image. The aspect-ratio match means layout doesn't shift when the image lands.
- **`feature-grid.tsx`** — six-up responsive grid (1 / 2 / 3 cols at sm / md / lg). Each tile: 36px terracotta-on-brand-muted icon square, Geist 18px headline, Inter 14px blurb. Tiles match the brief verbatim (orders kanban, contractor ledger, scheduling, files, fast UI, multi-tenant RLS).
- **`built-inside.tsx`** — two-column at lg, single-column below. Left: 3-paragraph shop story paraphrased per brief. Right: author card (SP placeholder avatar circle, "Sriya Pothula · Founder & engineer", LinkedIn link to `#` per Q10 — real URL when provided). `lg:sticky lg:top-24` so the author card pins as the reader scrolls the story.
- **`cta-band.tsx`** — full-width terracotta-tinted band (`bg-brand-muted/40` = orange-200 at 40%, with matching border above/below). Single primary CTA → /signup.
- **`footer.tsx`** — wordmark left, Product + Company columns right (with placeholder `#` href for items not yet built). Copyright row separated by a top border.

**Smooth scroll** via a CSS-only `html { scroll-behavior: smooth }` rule in `globals.css`. Hero's "See it in action" link to `#features` triggers it. No JS needed for fragment navigation.

**Metadata override.** The landing's `Metadata` uses `title: { absolute: "StoneDash — The dashboard..." }` so the root layout's `template: "%s · StoneDash"` doesn't append a duplicated " · StoneDash" on the home page (the wordmark is already StoneDash; the suffix would read as repetition). Open Graph + Twitter card tags include the tagline.

**Smoke schema extended (PLAN Q7).** Added a `public: true` flag to the `Route` shape. Routes with `public: true` are fetched **without** the auth cookies — important for the landing because an authenticated request to `/` would 307 to `/dashboard` and mask whether the public path actually works. The `/` entry asserts the headline string is in the body. Smoke output:
```
27 route(s): 27 OK, 0 SKIP, 0 PENDING, 0 FAIL    [SSR]
3 target(s): 3 OK, 0 FAIL                         [DOM]
```
(Up from 26 SSR routes — the landing is the new one.)

**Lighthouse score** deferred to a manual run during sub-step 14's wrap (when all UI is polished and the screenshot has landed; running it now would score the placeholder which isn't representative). Documented as a sub-step 14 verification step.

**Stale `app/favicon.ico` removed.** Was a legacy Next-scaffolded artifact that overrode the new SVG favicon in browser tabs.

### Sub-step 4 — Login + signup + onboarding polish (complete)

**Two-column shell** lives in `components/app/auth-layout.tsx`. Used by all three auth pages. Form on the left, terracotta-tinted pull-quote on the right at `lg`+; collapses to single-column below. Pull-quote can be set to `null` to drop the right column entirely (onboarding does this — user is already authenticated, the quote is a conversion tool).

**Layout contract.** Wordmark in Geist semibold top-left. Optional `topRight` slot (used by onboarding for a "Sign out" form-button). Page-supplied `title` (Geist 2xl semibold) + optional `subtitle`. Optional `switcher` block at the bottom of the form column for the "Don't have an account? Sign up" / "Already have an account? Log in" cross-link, using the brand-accent color for the link instead of a generic underline.

**Pull-quote** (PLAN Q10 placeholder, with a TODO note in `auth-layout.tsx`): *"I haven't lost track of an install in three weeks." — Owner, Top Marble & Granite — Sterling, VA.* Background is a soft gradient from `bg-brand-muted/60 → /30 → bg-accent`. A giant `&ldquo;` glyph at `text-brand/15` sits behind the quote text — gives the right column visual weight without competing with the form.

**Forms reordered** (`components/app/login-form.tsx`, `signup-form.tsx`):
1. **Google OAuth button at the top.** Fast path for repeat visitors who've already linked Google. Now uses the official 4-color Google G mark (`components/app/google-icon.tsx`) — Google's branding guidelines require their exact mark for "Sign in with Google" buttons; a single-color lucide icon wouldn't meet identity requirements.
2. **"or continue with email" divider** — `Separator` flanking a small uppercase label. Replaces the previous bare "or".
3. **Email + password** below. Label sized 13px medium per brief. Password row has a **"Forgot?" link** on the right edge of the label row, pointing to `/login?reset=1` (the actual reset flow isn't built — query param is the seam for it).
4. Submit button uses the new terracotta primary automatically (sub-step 2 reroots `--primary`).

**Onboarding** (`app/onboarding/page.tsx`) gets the same shell. Server-side auth check is unchanged from before; the only difference is now it renders inside `AuthLayout` with `quote={null}` and a `topRight` sign-out form. The "Set up your shop" form (`OnboardingForm`) is untouched — it gets the visual treatment from its container.

**Verification.**
- `pnpm typecheck` + `pnpm lint` + `pnpm build` all green.
- `pnpm smoke` → **27 SSR OK + 3 DOM OK / 0 FAIL.**
- Spot-checked rendered bodies for `/login`, `/signup`, `/onboarding`: wordmark, headlines, Google button, divider copy, switcher link copy, and the pull-quote text all appear as expected.

**One operational hiccup worth recording.** First smoke run after this sub-step reported 6 failures (3 contractor detail + 3 `/j/:slug-*` routes 500'ing) — but no contractor / share-link code changed in this sub-step. Root cause: two `next dev` processes were racing on port 3000 (the user had started one manually for review while I had one running). Stale `.next/` chunks from the colliding builds 500'd the dynamic routes. Killed both, wiped `.next/`, restarted clean — smoke returned to 27 OK. This is the same workflow gotcha already documented in the Task 2B post-ship DEVLOG entry; logging it again here because it cost a few minutes to diagnose.

### Sub-step 5 — Dashboard redesign + hero screenshot (complete)

**Dashboard now opens with a greeting line, not a slug.** `app/(app)/dashboard/page.tsx` computes the local hour using the *org's* timezone (not the request server's) and the first token of `profile.full_name`, then renders `Good morning, Sriya.` / `Good afternoon, Sriya.` / `Good evening, Sriya.` in Geist 28px semibold. Below it: a one-sentence ops summary — `Here at Top Marble & Granite you have 1 install today and $19,050 in unpaid contractor balances.` — that branches on what's actually happening (no install today + no balance → `quiet day` copy; either or both → only the parts that apply). The greeting is intentionally personal and slightly informal to match the Notion-warm tone the brief asked for.

**KPI cards** (`components/app/kpi-card.tsx`) now use Geist semibold at **32px tabular-nums** with `leading-none`, an optional trailing `trend` indicator (`▲ 12% from last week` in success-green or `▼ 8%` in muted), and an optional `urgent` boolean that tints the whole card with `border-brand/40 bg-brand-muted/30` and flips both the icon and the eyebrow label to terracotta. Urgent fires automatically on the *Installs this week* card when there's an install scheduled inside today's local window — the brand color earns its keep when the customer needs to look at something today, and only then.

**Trend math.** We don't track stage transitions historically, so the trend on the *In fabrication* card uses `orders.created_at` as an intake-velocity proxy: count rows with `created_at >= now - 7d` vs rows with `created_at >= now - 14d AND < now - 7d`, return the signed percent. When the prior window is empty we return `null` (no baseline → don't render a misleading trend); when both windows are zero we return `0` (renders as `flat from last week`). Only the fabrication card opts into this for now — the others (installs, awaiting measurement, outstanding balance) don't have a clean "last week's value" without a snapshot table, and faking it would erode trust in the indicator.

**Pipeline strip** (`components/app/pipeline-strip.tsx`) gets per-stage colored dots — zinc → amber → terracotta → blue → indigo → violet → success — instead of a uniform muted header. The dot carries the disambiguation; the cell body stays neutral so seven cards in a row don't read as a rainbow. First capture made it obvious that `Measurement` and `Ready for Install` were truncating in the 7-column strip; added `STAGE_STRIP_LABELS` with single-word abbreviations (`Quote`, `Measure`, `Fab`, `Ready`, `Install`, `Invoiced`, `Paid`) used *only* on the dashboard strip — the full `STAGE_LABELS` and `STAGE_SHORT_LABELS` are untouched so kanban, badges, and the order detail sheet still read naturally.

**Activity feed** (`components/app/activity-feed.tsx`) collapses runs of 3+ consecutive same-actor rows into a single `Demo Owner made 13 changes` group with the latest timestamp and a 4-line preview of the underlying actions (indented, muted, `border-l` on the left). Runs of 1–2 stay individually rendered so we don't lose detail in the common case; anonymous shared-link rows never collapse together (each one is a distinct external action). Why this matters: a single bulk session can flood the feed with 10+ near-identical lines, and the collapsed form is a much better signal of "Demo Owner did a sweep" than a wall of repeated avatars.

**Hero screenshot.** `scripts/capture_landing_hero.ts` is a new one-shot script that signs in as the demo owner, navigates the live `/dashboard` in playwright/chromium at 1280×800 with `colorScheme: "light"` and `deviceScaleFactor: 2`, waits 400ms past `networkidle` for client hydration to settle, and writes `public/landing/dashboard-hero.png` (268 KB). PNG is committed to the repo because the source of truth for "what the marketing page shows" should be the actual screenshot; otherwise drift between the landing PNG and the live dashboard is invisible until someone notices.

**Marketing hero** (`app/(marketing)/_components/hero.tsx`) swaps the placeholder gradient div for `next/image` at 1280×800, `priority` (it's above the fold), `sizes="(min-width: 1024px) 1024px, 100vw"`. The placeholder's aspect ratio matched 16:10 from the start, so layout doesn't shift when the real PNG drops in.

**Verification.**
- `pnpm typecheck` + `pnpm lint` + `pnpm build` all green.
- `pnpm smoke` → **27 SSR OK + 3 DOM OK / 0 FAIL.**
- Manual: re-ran `pnpm tsx --env-file=.env.local scripts/capture_landing_hero.ts` after the label tightening and confirmed the captured PNG shows all seven pipeline columns single-line, the urgent terracotta wash on Installs This Week, the trend badge on In Fabrication, and the collapsed `Demo Owner made 13 changes` group at the top of the activity feed.

### Sub-step 6 — Sidebar + top bar polish (complete)

**StoneDash wordmark in the topbar** (`components/app/topbar.tsx`). Left edge of the topbar gets a small terracotta dot + `StoneDash` in Geist semibold, linking to `/dashboard`. Hidden below `md` (mobile uses the sidebar's org pill for branding). A `/` glyph separates it from the breadcrumbs so the wordmark reads as a root crumb rather than as competing chrome. The wordmark intentionally lives in the topbar — not the sidebar — because the sidebar header is dedicated to the per-tenant `OrgSwitcher`, and giving the platform name top-billing there would crowd the org identity that owners actually care about.

**Topbar + sidebar header heights aligned at `h-14`** (was `h-12`). The 8px bump gives the topbar enough room for the wordmark + breadcrumbs without feeling cramped, and matching the sidebar header keeps the horizontal rule a single straight line across the viewport.

**Sidebar nav active treatment** (`components/app/sidebar-nav.tsx`) swaps the small terracotta dot on the right for a 2px terracotta **left-edge strip** + a brand-tinted icon. The Linear / Vercel pattern, basically. To prevent reflow on hover or route change, every nav row (including the disabled `coming_soon` stubs) reserves the gutter via `border-l-2 border-l-transparent`; only the active row paints it `border-l-brand`.

**User popover** (`components/app/user-menu.tsx`) is now a single richer surface instead of the prior "tiny dropdown + standalone theme toggle button" pair. The popover content:
- **Header row** with a larger 36px avatar (bg-brand for warmth), full name on top, email below.
- **Theme segmented control** — three-up Light / System / Dark with the active option carrying a `bg-card shadow-sm` lift inside a `bg-muted/40` track. Implemented as a small `ThemeSegmented` component inside `user-menu.tsx` (couldn't share with the old `ThemeToggle` shape because the segmented variant is fundamentally different ergonomics — picking from three visible options vs. opening a second dropdown).
- **Sign out** row at the bottom.
The standalone `components/app/theme-toggle.tsx` was deleted; the theme switch only ever appeared inside the sidebar foot, so consolidating it into the user popover removed an orphan icon that wasn't pulling its weight.

**Avatar color in the sidebar foot** is now `bg-brand text-brand-foreground` (was the default neutral). Small thing — but it makes the sidebar terminate with a visible brand cue, matching the org pill at the top.

**Verification.**
- `pnpm typecheck` + `pnpm lint` + `pnpm build` all green.
- `pnpm smoke` → **27 SSR OK + 3 DOM OK / 0 FAIL.**
- Re-captured `public/landing/dashboard-hero.png` so the marketing landing reflects the new chrome (wordmark, terracotta left edge on active sidebar item, brand-tinted icon, brand avatar at sidebar foot).

### Sub-step 7 — Table-wide polish + pagination extraction (complete)

**Table primitive polish** (`components/ui/table.tsx`). Three changes, applied site-wide so every list surface inherits them:
- `TableHead` bumped from `h-10 px-2` text-sm to `h-11 px-3` with `text-[11px] font-medium uppercase tracking-wider`. The uppercase tracked label gives the header a clear visual rank without being heavy — matches the Notion-warm direction from the brief.
- `TableCell` bumped from `p-2` to `px-3 py-2.5`. Adds 2px of vertical breathing room per row without dropping density to a level that hurts scannability on long lists.
- `TableRow` hover softened from `bg-muted/50` to `bg-muted/40`. The old hover was strong enough to read as "selected"; the new one reads as "ready to click".

**Sortable headers in `OrdersTable`** (`components/app/orders-table.tsx`) re-tuned to fit the new TableHead style: `-ml-3` (was `-ml-2`) negates the new `px-3` cell padding so the button label aligns with the cell's natural left edge; text uses the same `text-[11px] uppercase tracking-wider` as static headers. Active sort column flips the button text to `text-brand` so the sort axis is glanceable without a separate badge.

**`<TablePagination>` extracted** to `components/app/table-pagination.tsx`. Takes `{ total, page, pageSize, hrefForPage, unit }`, renders the `N items · page X of Y` indicator + Prev/Next buttons with chevrons. The component owns disabled-state styling (`pointer-events-none opacity-50`) and the `asChild` toggle that switches between `<Link>` (active) and plain `<span>` (disabled — `<Link>` can't be `disabled`-attributed cleanly). Callers pass an `hrefForPage(p)` function so this works on any route and preserves the current URL state — typical wiring is `hrefForPage={(p) => withParams({ page: String(p) })}`.

**`OrdersTable` now consumes `<TablePagination>`**. Dropped the local `totalPages` derivation (now lives inside `TablePagination`) and the inline Button/Link pair. The unit prop (`{ singular: "order", plural: "orders" }`) keeps the "3 orders" / "1 order" reading natural — important when the same component drops into customers/contractors/imports later.

**Why a unit prop instead of hardcoded "items":** when the CSV import previews land in sub-steps 9-12, each will paginate ("3 errors · page 1 of 2", "412 rows · page 1 of 5"). Burning "items" into the component would force every caller to wrap it in their own label, defeating the extraction. The unit-prop default is "item / items" so generic surfaces (admin tables, future settings lists) still read fine without configuration.

**One operational hiccup.** First smoke run after the Table changes reported 1 FAIL on `/schedule` (body missing `data-testid="send-to-crew"`). Spent a beat sanity-checking my changes — none of them touched event-block.tsx or the week view. Root cause was seed-data date drift: `supabase/seed.ts` builds events at offsets from `new Date()`, so a seed run from late May placed events at 2026-05-04. The default `/schedule` view is "this week starting today" — by 2026-06-21 those events were a month behind, so the week view rendered empty (no event blocks → no testid in body). `pnpm db:seed` re-populated relative-to-today and smoke went green. Same gotcha is worth keeping in mind for any future smoke surface that depends on seeded calendar data.

**Verification.**
- `pnpm typecheck` + `pnpm lint` + `pnpm build` all green.
- `pnpm smoke` → **27 SSR OK + 3 DOM OK / 0 FAIL** (after the seed refresh).
- Re-captured `public/landing/dashboard-hero.png` against the fresh seed so the marketing screenshot stays in sync with what a brand-new demo session would show.

### Sub-step 8 — Empty + loading + toast polish (complete)

**Shared `<EmptyState>`** at `components/app/empty-state.tsx`. One component, two variants:
- **`default`** — rounded-xl card with optional icon in a `bg-brand-muted/40` circle, title, optional description, optional action slot. Used for "you have no Xs yet" / "no Xs match" first-touch surfaces.
- **`inline`** — compact text-only block for filter-mismatch states inside an already-bordered shell (contractors/crew tables had their own different-from-everything-else compact variant).

Migrated all the page-level empties: orders-table (Wrench), customers-table (Users), contractors-table (HardHat + inline variant for filter mismatch), crew-table (Users2 + inline), calendar-list (CalendarDays), contractor-jobs-tab (Wrench), order-events-tab (Calendar). Six different copy-paste blocks with subtly different padding/copy/tone collapsed into one component that every list surface inherits. Tab-embedded inline empties (e.g. customer detail's "No orders yet for this customer.") stay as plain text — they're contextually different and don't need the empty-state chrome.

**`<TableSkeleton>`** at `components/app/table-skeleton.tsx`. Shapes like a real list page: optional header strip, filters row, column-header bar, then rows with varied column widths (cycling through `w-20 / w-32 / w-40 / w-24 / w-16 / w-28`). Varied widths matter — equal-width grey bars read as "loading bar" rather than "data coming". Used by:
- `app/(app)/orders/loading.tsx` (7 cols, 10 rows)
- `app/(app)/customers/loading.tsx` (6 cols, 8 rows)
- `app/(app)/contractors/loading.tsx` (6 cols, 6 rows)

**Dashboard-specific skeleton** at `app/(app)/dashboard/loading.tsx` — mirrors the eventual dashboard shape (greeting block → 4 KPI cards → pipeline strip + activity feed) at the same outer max-width and spacing as `page.tsx`. The 7-column pipeline skeleton shows that all seven stage cells will be there. Nothing reflows when data lands.

**Why route-level `loading.tsx` files rather than client-side spinners:** App Router's `loading.tsx` files automatically wrap the segment in a `<Suspense>` boundary, so the layout (sidebar, topbar, wordmark, breadcrumbs) stays visible while the page-level data loads. Spinners in the page body would leave the sidebar / topbar feeling frozen during slow Supabase calls.

**Toast polish** at `components/ui/sonner.tsx`. Toast radius bumped to `rounded-lg` (`var(--radius)` = 8px) so toasts match cards/dialogs. Shadow swapped to `shadow-[0_8px_24px_-8px_rgb(194_65_12_/_0.18)]` — a soft terracotta tint at 18% so toasts read as a StoneDash surface rather than an OS notification. Action button now uses `bg-brand` instead of `bg-primary` so it explicitly ties to the brand color (in practice the same value, but the explicit token name makes the intent legible).

**What I deliberately did *not* change.** Kept `richColors` enabled on the Toaster mount in `app/layout.tsx` — Sonner's built-in green/red for success/error severity is correct (those colors don't belong to any one brand). Kept `position="top-right"` and `closeButton`. Kept the toast copy across the app as-is; the polish is purely structural / visual.

**Verification.**
- `pnpm typecheck` + `pnpm lint` + `pnpm build` all green.
- `pnpm smoke` → **27 SSR OK + 3 DOM OK / 0 FAIL.**
- Captured an empty-state preview against `/orders?q=zzzzz_nothing_here` to confirm the terracotta-circle icon + "No orders match." + description renders inside the card cleanly, with the rest of the chrome (sidebar active strip, topbar wordmark, filter row) intact around it.

### Sub-step 9 — CSV import infrastructure (complete)

Infrastructure-only sub-step: the parse pipeline, the commit orchestrator, the shared dialog shell, and the import helpers all land here. Sub-steps 10-12 each instantiate the shell + plug a per-entity commit handler — they should be ~150 lines each once this scaffolding exists.

**Dependencies.** `papaparse@5.5.4` + `@types/papaparse@5.5.2`. Standard CSV parser; the one Node ecosystem agreement on which library to use for this.

**Helpers** at `lib/import/helpers.ts`:
- `sanitizeCell(raw)` — strips a leading `=`, `+`, `-`, `@`, TAB, or CR per OWASP CSV-injection guidance. Returns `{ value, sanitized }` so the caller can count touched cells and surface the count in the import summary. Conservative shape: only strips the *lead* offender so legitimate cells like `"+1 (555) 123-4567"` survive when the `+` sits inside the value rather than at position 0.
- `parseFlexibleDate(raw)` — tries `yyyy-MM-dd`, `MM/dd/yyyy`, `M/d/yyyy`, `MMM d, yyyy`, `MMMM d, yyyy`, `MM/dd/yy`, `M/d/yy` in order via date-fns. First successful parse wins; returns `null` when none match. Order matters — more specific first so `"2026-06-21"` hits ISO and two-digit-year patterns sit last to avoid ambiguous parses.
- `normalizeHeader(raw)` + `autoMapHeaders(headers, aliases)` — turns `"Customer Name"` and `"customer_name"` into the same shape, then matches each parsed header against the per-entity alias list so the user gets a pre-filled column mapping. Uses each canonical field at most once (a duplicate-header CSV won't bind the same field twice).
- `cleanCell(raw)` — convenience wrapper: trim → sanitize → `""` becomes `null`. The transform every non-required text field will need.

**Parse route** at `app/api/import/parse/route.ts`:
- Auth-gated via `getCurrentUserAndOrg()` even though no writes happen.
- 5 MB ceiling on file size (PLAN Q2 lock — Next 14 Server Actions cap at 1 MB which is why this is a route handler, not an action).
- Returns `{ ok, headers, rows: rows.slice(0, 10), totalRows, sanitizedCells }`. Sanitizes every row up-front (not just the preview slice) so the count is honest before the user commits.
- `dynamicTyping: false` so every cell stays string — the sanitizer sees the raw input, the entity importer coerces.

**Shared commit orchestrator** at `lib/import/commit.ts`:
- `runImportCommit(request, config)` is the one-shot entry point each per-entity route will call. Handles auth, multipart parsing, mapping JSON validation (rejects unknown target fields server-side — never trust the client gate alone), required-field re-validation, CSV parsing, sanitization, chunked inserts.
- Per PLAN Q2 lock: 100-row chunks. The per-entity handler receives `(chunk, rowOffsets)` and returns `{ inserted, skipped, warnings }`; the orchestrator aggregates across chunks into the final response.
- Per-entity handlers code against `{ canonicalField: rawValue }` shape — the orchestrator applies the user's column mapping uniformly, so each handler stays focused on "given a list of customer fields, insert customers".

**Shared dialog shell** at `components/app/csv-import-sheet.tsx`:
- Three steps: **pick** (drag-target card + native file input), **preview** (file summary, sanitized-cells count, column mapping table with auto-guessed values, required-field validator, "Import N rows" CTA), **done** (success card with inserted/skipped counts + first 10 warnings, or error state with a "Try again" button).
- A `committing` step in between with a centered loader and "Importing N rows…" copy so the user has continuity feedback during the longest part.
- File ref kept across stages via `useRef` — the commit POST re-uploads the same File bytes (no JSON serialization of large row arrays through the 1 MB Server Action ceiling). Same file the parse route already saw.
- Calls `router.refresh()` on success so the underlying page (customers / contractors / orders) re-fetches and the freshly-imported rows appear without a reload.
- Required fields are visually flagged with a terracotta dot in the mapping picker; the commit button stays disabled until every required field is mapped.

**Smoke** at `scripts/smoke_import_parse.ts` + wired into `pnpm smoke` via `pnpm smoke:import`. Uploads a tiny CSV with one CSV-injection cell (`=SUM(A1:A9)`) and asserts six things: response ok, headers in file order, totalRows = 3, preview slice length = 3, sanitizedCells = 1, and the sanitized value reads as `SUM(A1:A9)` (lead `=` stripped). Six checks because each one catches a different failure mode in the parse + sanitize chain.

**What this sub-step does NOT include.** No entity-specific commit routes yet — those land in sub-steps 10 (customers), 11 (contractors), 12 (orders). No UI trigger to open the dialog from /customers etc.; that wires up per-entity in the next three sub-steps. Quick Add on /orders is sub-step 13.

**Verification.**
- `pnpm typecheck` + `pnpm lint` + `pnpm build` all green. Build shows `/api/import/parse` as a registered route handler.
- `pnpm smoke` → **27 SSR OK + 3 DOM OK + 6 import-parse checks OK / 0 FAIL.**

### Sub-step 10 — Customers CSV import (complete)

First per-entity instantiation of the import infrastructure from sub-step 9. Thin layer; most of the work is the entity field config + the row-level validator.

**Split-module shape.** The customers import lives in two peer modules so the field config can be shared between client and server without dragging server-only imports into the client bundle:
- `lib/import/entities/customers.config.ts` — client-safe. Defines `CustomerField`, `CUSTOMER_IMPORT_FIELDS` (with per-field aliases for the auto-mapper), and the `CUSTOMER_IMPORT_CONFIG` consumed by `<CsvImportSheet>`.
- `lib/import/entities/customers.ts` — `import "server-only"`. Defines the Zod validator + the chunk handler. Imports the field list from `.config.ts` so a future field addition lives in one place.

**Required field: just `name`.** Mirrors the existing `CustomerFields` validator from `lib/validators/customers.ts`. Eight optional fields cover the realistic QuickBooks / Excel customer export shape (company, email, phone, address × 5, notes). Aliases include common spreadsheet variants — "customer", "customer_name", "contact" all map to `name`; "phone", "telephone", "mobile", "cell" all map to `phone`; etc.

**Per-row validation.** `ImportCustomerRow` is a Zod object that mirrors the existing CustomerFields validator but operates on the canonical-key shape `runImportCommit` produces. Validation failures are caught per-row and surface as `Row N: <message>` warnings; the rest of the chunk still inserts. Whole-chunk failures (RLS denial, constraint violation) skip every row in the chunk and emit one chunk-scoped warning so the user gets actionable feedback instead of just "0 inserted".

**Commit route** at `app/api/import/customers/route.ts`. Three-line body: auth-gate → RBAC gate (`canManageCustomers`) → `return runImportCommit(request, config)`. The RBAC check sits in the route (not in the orchestrator) because permissions are per-entity — contractor and order imports will have their own gates.

**Trigger button** at `components/app/customers-import-button.tsx`. Thin client wrapper that owns the `open` state for `<CsvImportSheet>`. Wired into the `/customers` page header next to "+ New customer" (only rendered when `canManageCustomers(role)` is true — same gate as the server route).

**One pre-flight bug caught by the new smoke.** First run of `scripts/smoke_import_customers.ts` reported the validation message for a blank-name row as `"expected string, received undefined"` instead of `"Name is required"`. Cause: I was filtering empty strings out of the row before passing to Zod ("coerce empty strings → undefined so optional() applies cleanly"). For required fields that turned a clean validator message into a generic Zod default. Fix: pass the row through with empty strings intact, let `z.string().trim().min(1, "Name is required")` produce the right message, and lean on the existing union schemas on optional fields (already accept `z.literal("")`) plus a `blankToNull` pass on the insert side. One-line change in `customers.ts`, both warning messages now read correctly.

**Smoke** at `scripts/smoke_import_customers.ts`. End-to-end:
1. Pre-cleanup any leftover `__SMOKE_CUSTOMER__*` rows from a prior failed run.
2. Sign in as demo owner.
3. POST a 5-row CSV (3 valid rows, 1 invalid email, 1 empty name) plus the column mapping to `/api/import/customers`.
4. Assert response.ok, inserted=3, skipped=2, both expected warning messages present.
5. Service-role-read to verify the 3 rows actually exist in the DB.
6. Cleanup. Wired into `pnpm smoke` via `pnpm smoke:import` (chained after the parse smoke).

**Verification.**
- `pnpm typecheck` + `pnpm lint` + `pnpm build` all green. Build registers `/api/import/customers` as a route handler; `/customers` bundle grew from 9.22 kB → 13.2 kB (the import sheet + papaparse type imports pulled into the client).
- `pnpm smoke` → **27 SSR + 3 DOM + 6 import-parse + 6 import-customers / 0 FAIL.**
- Captured `/customers` in a browser to confirm the "Import CSV" outline button sits next to "+ New customer" without crowding, and the polished table chrome (uppercase headers, brand avatar at sidebar foot) reads as intended.

### Sub-step 11 — Contractors CSV import (complete)

Second per-entity instantiation. Same split-module pattern as customers (sub-step 10) — the only deltas are the field set, the destination table, and the RBAC gate.

**Field set** (11 fields): `name` (required); `primaryContact`, `phone`, `email`, address × 5, `paymentTerms`, `notes`. The validator mirrors `ContractorFields` from `lib/validators/contractors.ts` for shape parity — same length caps, same email validation, same trimming.

**`isActive` is deliberately NOT in the import schema.** All imported contractors default to active via the table's `is_active boolean DEFAULT true`. Surfacing an `isActive` column on the mapping picker would either force every importer to pick something for a column 99% of files won't have, or quietly mis-map a "Status" header to a boolean it can't represent. If an owner needs to deactivate a freshly imported contractor they can do it on the contractor detail page where the toggle is already wired.

**Payment terms** mapped as free-form text per the existing validator's shape (`paymentTerms: optionalString(z.string().trim().max(100))`). The `PAYMENT_TERMS_SUGGESTIONS` array in the validator only powers a datalist on the manual New Contractor dialog — imports accept anything the CSV provides, which is right for messy real-world data where one shop's "Net30" and another's "30 days" should both survive.

**Smoke** at `scripts/smoke_import_contractors.ts`. Same 5-row pattern as the customers smoke (3 valid, 1 bad email, 1 empty name), plus a 7th check that verifies `payment_terms` round-trips through the import unchanged — caught a class of bugs where a future entity-handler refactor could drop a non-required string field silently.

**Verification.**
- `pnpm typecheck` + `pnpm lint` + `pnpm build` all green. New route registered at `/api/import/contractors`.
- `pnpm smoke` → **27 SSR + 3 DOM + 6 parse + 6 customers + 7 contractors / 0 FAIL.**

---

## Task 3.1 — Scheduling UX fixes from shop-floor use (2026-05-31)

Four fixes uncovered when the shop actually started using the calendar from Task 3: events that aren't tied to an order, all-day events, location autocomplete, and a discoverability bug where "Send to crew" only existed on one of five surfaces. See `PLAN.md` for sub-step breakdown + the Q1–Q11 + the locked refinements.

### Sub-step 1 — Migration 0016: standalone + all-day + 'task' kind (complete)

**What shipped.**
- **`0016_scheduling_v2.sql`** — three column changes + two CHECK rewrites + a view rebuild.
  - `order_events.order_id` → nullable.
  - `order_events.title text NULL` + new `order_events_title_or_order` CHECK: `order_id IS NOT NULL OR (title IS NOT NULL AND length(trim(title)) > 0)`. Either you reference an order or you give the event a title.
  - `order_events.is_all_day boolean NOT NULL DEFAULT false`.
  - `order_events_kind_valid` rewritten to include `'task'` (the brief referred to `order_events_kind_check`, which doesn't exist — actual name was `order_events_kind_valid`).
  - `order_events_same_utc_day` rewritten per **PLAN Q1 lock** (see below).
  - `v_calendar_events` dropped + recreated with `LEFT JOIN orders` (was `JOIN`), `title = COALESCE(o.project_name, e.title)`, `is_all_day`, and derived `is_standalone = (order_id IS NULL)`. Standalone rows correctly return NULL for order_number / customer_name / stone_type / contractor — falls out of the LEFT JOIN.
- **`prisma/schema.prisma`** — `orderId` becomes nullable, `title String?` and `isAllDay Boolean @default(false)` added, `order` relation becomes `Order?`. `pnpm db:generate` regenerated the client.

**The all-day CHECK choice (PLAN Q1 lock).** The simpler form:
```sql
(is_all_day = true AND duration_min = 1440)
OR (is_all_day = false AND <same-UTC-day expression>)
```
Why simpler over rigorous: a truly-rigorous CHECK ("starts_at = midnight org-local") needs per-row org tz, which is STABLE not IMMUTABLE — and the constraint expression needs IMMUTABLE. The duration lock catches the most common accidental shape (someone sets `is_all_day=true` with a stray 60-minute duration); the rest of the invariant (00:00 org-local normalization) is enforced in sub-step 2's server action.

**Verification.** Five direct-insert probes through the service-role client:

| Probe | Expected | Result |
|---|---|---|
| Standalone event (title, no order_id, kind='task') → view query | `is_standalone=true`, `order_number=null`, title set | PASS |
| No title + no order_id INSERT | rejected by `order_events_title_or_order` | PASS |
| `kind = 'bogus'` INSERT | rejected by `order_events_kind_valid` | PASS |
| `is_all_day=true, duration_min=60` INSERT | rejected by `order_events_same_utc_day` | PASS |
| `is_all_day=true, duration_min=1440, starts_at='2026-06-10T04:00:00Z'` (00:00 ET) INSERT | accepted | PASS |

Plus the pre-existing gates re-run cleanly:
- `verify_event_backfill.ts` → 8 measurement + 8 install, counts match (no impact on legacy backfill).
- `smoke_scheduling_rls.ts` → all 3 RLS claims still pass (column changes don't move RLS surface).

**Why the rigorous variant was tempting but wrong.** Postgres CHECK expressions must be IMMUTABLE — they're cached by the planner and evaluated against the row alone, no session context. `AT TIME ZONE '<org_tz_column>'` is STABLE (depends on `pg_timezone_names` which is a table read), not IMMUTABLE. We can't ask "is starts_at exactly midnight in the org's tz?" from within the constraint. The action-layer assertion (sub-step 2) closes the gap by computing `parseLocalDateTime(date, '00:00', orgTz)` and asserting equality before the RPC call.

### Sub-step 2 — RPCs + validators (complete)

**`0017_scheduling_v2_rpcs.sql`** rewrites three functions to accept the new shape. Because `CREATE OR REPLACE` requires identical signatures, all three are `DROP`-and-recreated.

- `_validate_event_same_utc_day(p_starts_at, p_duration_min, p_is_all_day)` — new third param. Returns immediately when `p_is_all_day=true` (table CHECK already validates `duration_min = 1440` for that branch).
- `create_order_event` — new trailing params `p_title text DEFAULT NULL` and `p_is_all_day boolean DEFAULT false`. `p_order_id` is now legitimately nullable (it always was at the type level; behavior is what changed). For standalone events (`p_order_id IS NULL`):
  - org_id resolved from `profiles.active_org_id` of the caller (RPC RAISEs if no active org).
  - Title required (RPC RAISEs friendly error before the table CHECK fires).
  - All-day forces `duration_min = 1440` silently (the dialog hides the duration controls; this is the last line).
- `update_order_event` — same two new params, same handling. Title is only writable for standalone events (the WHERE clause: `CASE WHEN v_order_id IS NULL THEN NULLIF(p_title, '') ELSE title END`). The brief's Q3 decision — type fixed at create time — is enforced here: `update_order_event` doesn't accept a `p_order_id`, so callers can't move events between orders or convert order↔standalone.

**Action layer (`lib/actions/events.ts`).**
- `computeStartsAt` gains `isAllDay` param and returns `{startsAtIso, effectiveDurationMin}`. When `isAllDay=true`:
  - `starts_at` is computed from `parseLocalDateTime(date, '00:00', tz)`. The literal `'00:00'` ignores whatever the caller passed in `startTime`.
  - **Assertion (PLAN Q1 lock):** `formatInTimeZone(starts, tz, 'HH:mm') === '00:00'`. By construction this is always true, but the assertion catches a future refactor breaking the invariant. Throws "all-day event must start at midnight org-local" if it ever fails.
  - `effectiveDurationMin` forced to 1440.
- `createOrderEvent`, `updateOrderEvent` thread `title` + `isAllDay` to the RPC. `rescheduleOrderEvent` pre-fetches the existing `title` + `is_all_day` and re-passes them — preserve-fields semantics extended to the new columns. **Crucial for drag-to-reschedule** (Task 3 sub-step 7): a future drag on an all-day event would otherwise wipe the flag and turn it into a 1-minute event at midnight.

**Validator (`lib/validators/events.ts`).**
- `EVENT_KINDS` adds `'task'` (sixth kind). `EVENT_KIND_LABELS.task = "Task"`. `DEFAULT_DURATION_MIN.task = 60`.
- `EventBase` now: `orderId: optionalString(uuid)`, `title: optionalString(...max 200)`, `isAllDay: boolean default false`. `.refine` adds: "orderId or title required" with the error pointing at `title` (the field the dialog highlights). `UpdateEventInput` switched from `.extend()` to `.and(z.object({eventId}))` because `.extend()` collides with `.refine()` in zod 4.

**Verified end-to-end.**
- **`scripts/test_event_reschedule.ts`** extended: now asserts `title` and `is_all_day` survive an `update_order_event` round-trip. (Result: PASS.)
- **`scripts/test_standalone_event.ts`** new: creates a standalone task via `create_order_event`, verifies row + view shape, mutates kind via `update_order_event` and verifies title preserved, then asserts `update_order_event` with empty title on a standalone event REJECTS. (Result: PASS.)
- `smoke_scheduling_rls.ts` re-run — all three RLS claims still pass.

**EventDialog quick patch.** The dialog's submit payload now needs `title` + `isAllDay` to satisfy the new validator type. Stubbed to `{title: undefined, isAllDay: false}` for this sub-step so typecheck stays green; sub-step 3 wires the actual UI controls.

### Sub-step 3 — New Event dialog UX (complete)

**Three new dialog primitives.**
- **Type segmented control** at the top of the form. Two options: "For an order" / "Standalone". Disabled in edit mode with a helper line ("Event type is fixed after creation — delete and recreate to change") per PLAN Q3 lock. Toggling clears the side-specific fields (orderId on "Standalone", title on "For an order") and snaps `kind` to the type-appropriate default (install vs. task).
- **Title input** replaces the order combobox when type=standalone. Max 200 chars, placeholder examples from the brief ("Call customer about template / Pick up checks / Crew meeting").
- **All-day checkbox** below the Date/time/duration row. Toggling on collapses the grid from `grid-cols-3` → `grid-cols-1` (only Date remains visible), hides the duration quick-pick row, and hides the tz abbreviation label under the start time.

**Conflict-check accommodates all-day events.** The debounced `getCrewConflicts` call now uses a midnight-to-midnight window when `isAllDay=true` (parseLocalDateTime(date, '00:00', tz) → +1440 min) regardless of what the hidden time/duration controls say. Without this an all-day event with a non-zero `durationMin` in local state would query the wrong window.

**Kind grid widens for 'task'.** `grid-cols-5` → `grid-cols-3 sm:grid-cols-6` (6 kinds now). On narrow widths the kind options wrap to two rows; on dialog-wide they stay single-row.

**CalendarEvent type updated.** `orderId`, `orderNumber`, `stage` become nullable. New fields `isAllDay`, `isStandalone`, `title`. All three `listCalendarEvents` / `listEventsForOrder` / `getEventForEdit` SELECT statements + row-mappings updated. `calendar-list.tsx` sort-by-order-number uses a `"zzz"` sentinel for standalone rows so they sort after order-tied rows.

**event-block.tsx renders standalone events differently.**
- Order-tied: mono `orderNumber` + project name (unchanged from sub-step 5 of Task 3).
- Standalone: `title` in the header slot (sans-serif, truncate), no body project line, no customer line.
- All-day: time slot reads `"All day"` instead of `h:mm a`.
- New `task` chip color = slate (cool-tinted gray, distinguishable from `other`'s warmer zinc per PLAN Q4 lock).

**Verified.** `pnpm smoke` → **25 OK, 0 SKIP, 0 PENDING, 0 FAIL**. typecheck + lint + build all green. The dialog now compiles and renders both event-type modes — full all-day-strip rendering on the calendar grid is sub-step 4.

### Sub-step 4 — Calendar rendering for all-day + standalone (complete)

**`calendar-grid.tsx` gains an all-day strip.** Inserted between the day-header row and the hour grid. Renders **only when at least one visible day has an all-day event** — saves vertical space on the common case (no all-day items this week).

- Each day's all-day cell is a `useDroppable` with id `allday:<dateKey>`. Drop ID format mirrors the existing `slot:<dateKey>:<hour>` pattern.
- Each pill is a `useDraggable` wrapped around `EventBlock variant="pill"`.
- The strip's left column matches the 64px width of the hour-label column and shows a small "all-day" label.
- Per-cell `min-h-[28px]` so the strip stays usable when a day has zero pills.

**Drag-end handler dispatches on the `over.id` prefix.**
- All-day event → `allday:<dateKey>` → reschedule to new date, preserves `is_all_day=true` (via the action's pre-fetch+pass behavior).
- Timed event → `slot:<dateKey>:<hour>` → unchanged (existing sub-step 7 of Task 3).
- **Cross-strip drags are rejected** with a toast: `"Open the event to convert all-day → timed."` (or the reverse). Reasoning: converting between timed and all-day flips a semantic bit, not just a position. Silent conversion via drag would surprise the user; we route them through the dialog where the all-day checkbox is explicit.
- Same-UTC-day guard skips for all-day drags (the table CHECK relaxation from 0016 allows them).

**Success toast adapts to all-day.** Timed: `"Rescheduled to Mon, Jun 2, 10:00 AM"`. All-day: `"Rescheduled to Mon, Jun 2 (all day)"`. The time stamp would be misleading for all-day.

**`EventBlock` gains a `variant` prop.**
- `variant="block"` (default) — the existing column-positioned card used inside the hour grid.
- `variant="pill"` — one-line horizontal strip for the all-day row. No customer line, no crew avatars, no time. Stays kind-colored and respects terminal status (line-through on cancelled / complete).

**`calendar-list.tsx` adapts both fields:**
- Time/duration cell shows `"All day"` when `isAllDay`, instead of `h:mm a · 60m`.
- Order # cell shows a muted dash for standalone events (no order# to display).
- Project name cell shows `event.title` for standalone, `projectName` for order-tied.
- `KIND_DOT` adds `task: "bg-slate-500"` (matches the slate chip color from sub-step 3).

**Verified end-to-end.** Spot-checked the rendered `/schedule` body after seeding one all-day standalone task ("__probe_all_day__") at today's midnight ET:
```
status: 200
contains 'all-day' label (lowercase strip header): true
contains '__probe_all_day__' (title): true
```
Both render as expected. `pnpm smoke` still: **25 OK, 0 SKIP, 0 PENDING, 0 FAIL**.

**Minor flag for follow-up (non-blocking).** The "click an empty slot in the all-day strip → open New Event dialog" path doesn't yet pre-fill the all-day flag. The dialog opens in timed mode and the user has to flip the checkbox. Sub-step 3 would need a new URL param (e.g. `?allDay=1`) for the dialog to read. Flagging here; trivial to add later if friction surfaces.

### Sub-step 5 — Google Places autocomplete with graceful fallback (complete)

**`components/app/location-autocomplete.tsx`** — drop-in replacement for the location `<Input>` in `event-dialog.tsx`. The brief's Q8 choices are all locked in.

**Element choice.** `google.maps.places.PlaceAutocompleteElement` (GA-in-2025 web component, mounted via `document.createElement("gmp-place-autocomplete")`). The legacy `Autocomplete` class is deprecated and we don't use it.

**Cost = $0/month.** We consume `place.formattedAddress` from the `gmp-select` event and nothing else. The PaaS pricing model (post-March-2025) charges only when you call **Place Details** (which we don't). Autocomplete predictions + selecting an address from the dropdown are billed at $0.00 per session. For a single shop scheduling 50 events/month the autocomplete itself costs literally nothing; the only spend would be if/when we later need lat/lng/place_id for routing or directions (deferred to a future task per the original brief). Documented inline in the component.

**Dynamic loading.** The Maps JS SDK is ~200KB. We load it lazily on the LocationAutocomplete component's first mount via a `<script>` injection (module-scoped `Promise` dedupes concurrent loads + repeat mounts). No impact on the main bundle size for users who never open the Event dialog.

**Graceful fallback (Q8 lock).** Two failure paths:
- **Missing `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`** → render plain shadcn `<Input>`, `console.warn` once in dev.
- **SDK fails to load** (offline, ad-blocker, restricted referrer) → catch the load promise rejection, fall back to plain `<Input>`, `console.warn` with the error.

Either way the address still saves; the user just types it manually.

**Free-text capture.** The web component's `gmp-select` fires only when the user picks from the dropdown. If they type and submit without picking, we'd lose their input — so we also listen for `input` events on the host element and update parent state on every keystroke. Tested by typing without selecting → the form submits correctly with the typed string.

**External value sync.** A separate effect pushes `value` prop changes into the live element's `.value` (handles the "Use customer address" hint click case — the parent state changes, the web component needs to follow). Skipped when `fallback=true` so the plain Input handles its own state.

**API key security (Q8 lock).** `.env.example` gains a new `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` entry with a four-line warning block:
- The key is browser-visible (normal for the Maps JS SDK).
- **HTTP referrer restrictions are mandatory** — configure in Google Cloud Console → Credentials → "Application restrictions" → HTTP referrers:
  - `http://localhost:3000/*` for dev
  - `https://your-production-domain/*` for prod
- "API restrictions" should be set to "Places API (New)" only.
- Without restrictions, anyone can scrape the key from the client bundle and run up your bill.

README's Google Maps key setup section will be added in sub-step 8 (docs wrap).

**Verified.** `pnpm smoke` → **25 OK, 0 SKIP, 0 PENDING, 0 FAIL**. Without the env var set, the dialog renders the fallback `<Input>` and submits address strings correctly. The autocomplete element itself is only exercised when a real key is set — that happens at the user's hosted deploy.

### Sub-step 6 — Open-in-Maps link buttons (complete)

**`components/app/maps-links.tsx`** — small shared component. Two variants:
- `variant="inline"` (default) — paired text-only links separated by a middot, sized for the dialog / table cells / list rows. `Google · Apple`.
- `variant="buttons"` — bordered chip-style links for the public `/j/[slug]` page where the crew taps with their thumb. Larger touch target.

Both render nothing when `location` is empty / null / whitespace-only. URL construction is pure string templates — no API calls:
- Google: `https://www.google.com/maps/search/?api=1&query=<encoded>`
- Apple: `https://maps.apple.com/?q=<encoded>`

PLAN Q9 lock: render both side-by-side, **no UA sniffing**. The user picks the one they prefer; UA detection in 2026 isn't reliable enough to justify the complexity (Chromium-on-iOS shares Safari's UA, Android tablets sometimes mis-identify).

**Mount points (4):**
- `components/app/order-events-tab.tsx` — under the location line of each event row in the order detail Events tab.
- `components/app/calendar-list.tsx` — in the Location cell. `e.stopPropagation()` on the wrapping div so the link clicks don't also open the event dialog (the row click handler).
- `components/app/event-dialog.tsx` — to the right of the "Use customer address" hint when the location field has a value. Lets the user verify the address they typed is the right one before saving.
- `app/j/[slug]/page.tsx` — replaces the single Google-only link from sub-step 9 with the `buttons` variant (both options for the crew).

**Seed update.** Added a real Falls Church address (`6701 Wilson Blvd, Falls Church, VA 22044`) to the first upcoming install event, so the smoke and the demo UI always have something to render. Re-seeded cleanly.

**Smoke now asserts both URL substrings.** `/schedule?view=list` has `expectBody: "maps.apple.com"` (the apple URL is the more distinctive substring; `google.com` would match other content). Sub-step 8's wrap will add a probe to the public page once the seed has a share link with a location.

Spot-checked rendered `/j/<live-slug>` body: contains both `www.google.com/maps` and `maps.apple.com`. The earlier confusion about `maps.google.com` not appearing was my probe asserting the wrong substring — Google's URL is `www.google.com/maps`, not the older `maps.google.com` host. Documented inline.

**Final.** `pnpm smoke` → **25 OK, 0 SKIP, 0 PENDING, 0 FAIL**. typecheck + lint + build green.

### Sub-step 7a — Send-to-crew discoverability AUDIT (complete; no code)

Five event-display surfaces, one wired:

| # | Surface | Reachable? | Detail |
|---|---|---|---|
| 1 | `/schedule` week view event block | NO | `EventBlock` had no Send affordance |
| 2 | `/schedule` day view event block | NO | Same component, same gap |
| 3 | `/schedule` list view event row | NO | No action column / button |
| 4 | Order detail Sheet → Events tab event row | YES | Sub-step 9 of Task 3 (`cd1cd66`) |
| 5 | Event edit dialog | NO | Footer had Cancel + Save only |

Diagnosis matches the user report ("cannot find Send-to-crew anywhere") — only path was orders → detail → Events tab → small Send icon. `/schedule` had **zero** discoverable path. Also flagged: `SendToCrewModal` mounted only on `/orders`; `?send=<id>` from `/schedule` URLs would have nowhere to land.

### Sub-step 7b — Send-to-crew on every event surface + DOM smoke (complete)

**Send buttons added (all carry `data-testid="send-to-crew"`):**
- **`EventBlock`** — new `sendHref?: string` prop. Renders an absolute-positioned `<Share2>` icon in the top-right corner of both block + pill variants. Click stops propagation so the surrounding event-click (which opens the edit dialog) doesn't also fire. Component goes `"use client"` for the propagation handler.
- **`calendar-grid.tsx`** — both `DraggableEvent` and `DraggableAllDayPill` pass `sendHref={?send=${event.id}}`.
- **`calendar-list.tsx`** — new actions column at the end of the table. Small `<Share2>` icon button per row with `stopPropagation` (row click otherwise opens edit dialog). `sendHref()` helper builds the URL preserving filter state.
- **`event-dialog.tsx`** — footer button between Cancel and Save (edit mode only — can't Send a not-yet-created event). Click swaps modals via URL: drops `?event`/`?date`/`?time`, adds `?send=<id>`, pushes to current pathname. The page server-re-renders with EventDialog unmounted and SendToCrewModal mounted.

**`SendToCrewModal` mounted on `/schedule`** via a `SendModalMount` server component mirroring the `/orders` pattern from sub-step 9. URL param `?send=<uuid>` now opens the modal on either page.

**`getSendModalContext` made standalone-friendly.** Was `orders!inner` → null for standalone events. Switched to `LEFT JOIN orders` + sensible fallbacks (`orderNumber → "—"`, `projectName → event.title`, customer fields → null). The format-text helper degrades cleanly; standalone events get a usable share block.

**SSR smoke** asserts `data-testid="send-to-crew"` body content on `/schedule` (week), `/schedule?view=day&date=:eventDate` (anchored to a real seeded event date — week always has content but day is "today"-relative and seeded dates drift), and `/schedule?view=list`. Plus a new `/schedule?send=:eventId` route to verify the modal mounts there. **26 OK, 0 SKIP, 0 PENDING, 0 FAIL** for the SSR layer.

**DOM smoke** (`scripts/smoke_send_to_crew_dom.ts`) — PLAN Q7 lock fulfilled.
- Adds `playwright` as a devDependency. First run requires `npx playwright install chromium` (~90MB, one-time).
- Boots headless chromium, authenticates by signing in via the anon Supabase client and pushing the cookies onto the browser context.
- Hits each portal-mounted surface, waits for hydration (`waitForSelector` with a 3s ceiling for Radix mount animations), counts `data-testid="send-to-crew"` nodes.
- Targets: Order detail Sheet → Events tab (verifies Sheet portal); EventDialog footer on `/schedule` (verifies Dialog portal); EventDialog footer on `/orders` (same Dialog but inside a Sheet — two stacked portals).
- Graceful skip if playwright or chromium isn't installed: prints a warning, exits 0. Devs without it can still run `pnpm smoke:ssr`.
- Wired into `pnpm smoke` as the second stage. `pnpm smoke:ssr` and `pnpm smoke:dom` callable individually.

**Result:**
```
$ pnpm smoke
26 route(s): 26 OK, 0 SKIP, 0 PENDING, 0 FAIL    [SSR]
[OK     ] 2× testid  Order detail Sheet — Events tab
[OK     ] 4× testid  EventDialog footer (on /schedule)
[OK     ] 3× testid  EventDialog footer (on /orders)
3 target(s): 3 OK, 0 FAIL                         [DOM]
```

**One bug found during smoke iteration.** The DOM smoke initially picked any order via `.limit(1)` — landed on an order with no events, the Events tab rendered empty, the testid wasn't there. Fixed by anchoring the resolver to an order **that has at least one event** (`.from("order_events").not("order_id", "is", null).limit(1)`, then use that event's `order_id`). The same class of bug — "smoke route resolver picks the wrong row" — could bite future additions; documented as a watch-item in the script's comment header.

### Sub-step 8 — README + DEVLOG wrap + seed (complete)

**Seed (`supabase/seed.ts`).** Two new standalone events at the end of the seed so the calendar always has Task 3.1 demo content:
- `"Pick up checks from Ameer"` — kind=task, +2 days at 14:00 org-local, 30-min duration, location set. Shows up in the calendar as a standalone task with the Send-to-crew button reachable.
- `"KBIS trade show"` — kind=task, +5 days, is_all_day=true (1440 duration), location set. Shows up as an all-day pill above the hour grid.

Both rely on a small `localToUtc(dateOffsetDays, hhmm)` helper that converts a wall-clock-in-org-tz to UTC via `Intl.DateTimeFormat`. Could have used `lib/tz.ts`'s `parseLocalDateTime` but that's a Node-side import path the seed doesn't currently pull in; the inline helper is ~15 lines and isolated.

Seed re-runs cleanly. Output:
```
8 customers, 3 contractors, 10 orders, 2 contractor payments,
5 crew, 5 upcoming installs, 2 share links,
2 standalone events (1 task, 1 all-day).
```

**README updates.**
- "Understand the scheduling model" gains a paragraph on **Standalone events and all-day events** — title-instead-of-order, the all-day CHECK exemption rationale, the action-layer normalization.
- Crew dispatch table's `order_events` row gains the `'task'` kind in the comment.
- New **Google Maps API key setup** section under the scheduling how-to. Step-by-step: create credential → set HTTP referrer restrictions (`localhost:3000/*` dev + prod) → restrict API to Places API (New) → enable the API → paste into `.env.local`. Cost explained ($0/month — we don't call Place Details). Fallback behavior documented (graceful degradation to plain Input + one-time console.warn). Restrictions called out as **not optional**.
- "Render-time smoke gate" section rewritten for the two-stage `pnpm smoke` chain (`smoke:ssr` + `smoke:dom`). Playwright install note for first-time setup.
- "What's intentionally deferred" gains a Task 3.1 group: recurring events (still), address structured fields (still), multi-day all-day, custom event kinds, UA-driven Maps selection, notifications/reminders, full Playwright test framework.

**Final smoke after re-seed:**
```
$ pnpm smoke
SSR: 26 OK, 0 SKIP, 0 PENDING, 0 FAIL
DOM: 3 targets, 3 OK, 0 FAIL
```

`pnpm typecheck` + `pnpm lint` + `pnpm build` green at the head of every commit.

### Closing — deferred (Task 3.1)

- **Recurring events.** Still deferred from Task 3. Every event is a one-off.
- **Address structured fields** (lat/lng/place_id). Still deferred. The location field stores the formatted-address string only; routing-by-coordinates would need Place Details calls + columns.
- **Multi-day all-day events.** Single-day is the v1 shape.
- **Custom event kinds** beyond the six (`measurement`, `install`, `delivery`, `pickup`, `other`, `task`).
- **UA-driven primary-Maps-link selection.** We render both side-by-side per Q9 lock. Revisit if user feedback explicitly asks for it.
- **Notifications / reminders.** "Ping me 1h before this event" — separate feature.
- **A proper Playwright test framework.** The DOM smoke is a one-off script for the Send-to-crew testids. If testing pressure grows (more portal-mounted UI to verify, drag-to-reschedule behavior, status-update flows), promote to a full suite.
- **Pre-fill all-day on calendar empty-slot click** — flagged in sub-step 4 DEVLOG. Trivial URL param wire-up.
- **Same-day CHECK relaxation refinement** — the simpler form approved in Q1 doesn't validate "starts_at is exactly midnight org-local"; the action layer does. Tighter PostgreSQL invariants would need a SECURITY DEFINER function called from the CHECK, which is more machinery than worth it for v1.

### Closing — verified surfaces (Task 3.1)

| Surface | Gate |
|---|---|
| Schema (nullable order_id, title, is_all_day, 'task' kind, relaxed CHECK, view LEFT JOIN) | 0016 + service-role probes for all five CHECK paths |
| RPCs (DROP+CREATE for create/update/_validate; standalone org resolution via profiles; is_all_day branch) | 0017 + `scripts/test_event_reschedule.ts` (preserves title/is_all_day) + `scripts/test_standalone_event.ts` (full create→view→update→reject-empty-title→delete) |
| Dialog type/title/all-day UX | Smoke + manual spot-check on rendered body |
| All-day strip rendering + drag dispatch | Spot-check on rendered body (`all-day` label + seeded title) |
| Google Places autocomplete | Graceful fallback covered (plain Input renders without env key); SDK path exercises on the user's hosted deploy |
| Open-in-Maps URLs | SSR body assertion (`maps.apple.com`) on `/schedule?view=list`; spot-check both URLs on `/j/<live-slug>` |
| Send-to-crew on every event surface | SSR `data-testid="send-to-crew"` assertions on week / day / list; DOM smoke (`playwright`) on Sheet + 2 Dialog mounts |
| `/j/[slug]` matrix (valid / revoked / fake) | Unchanged from Task 3 sub-step 9 — still 3 entries in the SSR smoke |

---

## Server-side timezone discipline (code rule, 2026-05-26)

Adopted as part of Task 3, Q3. Permanent rule, not task-scoped.

All DB-side comparisons and indexes operate on UTC `timestamptz`. The same-day CHECK on `order_events` evaluates UTC calendar days via `AT TIME ZONE 'UTC'`. Conversion to the org's IANA timezone happens **only** in React render paths via `lib/tz.ts` (`formatInTimeZone`, `dateInTimeZone`).

The input boundary is the one exception: when a user picks "2026-05-12 10:00" in the org's local tz, the server action parses that as a wall-clock-in-org-tz moment and stores the resulting UTC `timestamptz`. After that parse, everything server-side is UTC.

Code smells to flag in review:
- A query against an `order_events.starts_at` filter that constructs a `timestamp` (no tz) on the client without going through `parseLocalDateTime`.
- A `formatInTimeZone` call that runs server-side outside a render path. Either it should be done client-side, or the call site doesn't actually need a localized representation.
- A view or trigger that uses `AT TIME ZONE <variable>` where the variable is a per-row column (org tz). That's STABLE not IMMUTABLE and won't work in STORED generated columns or CHECK constraints — both must use UTC.

---

## Task 3 — Scheduling + crew dispatch (2026-05-26)

Replace Google Calendar + WhatsApp dispatch with a first-class scheduling surface. The unit being scheduled is the **JOB EVENT** (measurement / install / delivery / pickup / other), not the crew. Crew members are tracked in their own table — they are people assigned to events, not Throughstone users. See `PLAN.md` for the sub-step breakdown and Q1–Q15 + the locked refinements (ADD-1/2/3).

### Sub-step 1 — DB schema, RPCs, RLS, view, backfill (complete)

**What landed.**
- **`0013_scheduling.sql`** — four new tables (`crew_members`, `order_events`, `order_event_assignments`, `event_share_links`), `v_calendar_events` and `v_orders_with_event_dates` views (both `security_invoker=true`), RLS policies, audit triggers (with the cascade-delete-of-org guard from 0006), `REVOKE INSERT/UPDATE/DELETE` + `WITH CHECK (false)` lockdown on event tables and share-link table, and the one-time backfill from `orders.measured_at` / `orders.scheduled_install_date`.
- **`0014_scheduling_rpcs.sql`** — seven SECURITY DEFINER RPCs: `create_order_event`, `update_order_event`, `delete_order_event`, `update_event_status` (with `p_via_shared_link` branch for the public route), `create_event_share_link`, `rotate_event_share_link`, `revoke_event_share_link`. State machine in `update_event_status` blocks `complete → scheduled` and `cancelled → in_progress` (PLAN Q7).
- **`0015_orders_sync_legacy_dates.sql`** — bridge trigger. The action layer (`createOrder`) no longer writes `orders.measured_at` / `scheduled_install_date` — it calls `create_order_event` directly. But the seed still writes those legacy columns through Prisma. This AFTER INSERT trigger mirrors legacy-column values into matching events at the org-local default time (9 AM measurement, 10 AM install). Drops alongside the legacy columns in a future migration.
- **Prisma** schema mirrors the four new tables + the two new relations on `Order` and `Organization`. Views intentionally not modelled (consistent with Task 2B).
- **Read-path switch.** `lib/queries/orders.ts` now reads from `v_orders_with_event_dates`; the row shape (`scheduled_install_date` / `measured_at` as YYYY-MM-DD) is preserved by deriving via `dateInTimeZone(next_install_at, org.timezone)` in the query layer. Same change in `lib/queries/contractors.ts` (contractor jobs tab) and `lib/queries/customers-full.ts` (customer detail orders). `app/(app)/dashboard/page.tsx`'s "Installs this week" KPI queries `v_calendar_events` directly with org-tz-derived UTC range bounds.
- **Action layer.** `createOrder` calls `create_order_event` for measurement/install dates (legacy column writes removed). `updateOrder` rejects `measuredAt` / `scheduledInstallDate` patches with a clear error ("managed via the Events tab") — defense in depth.
- **Order detail sheet.** Measured / Install date fields became read-only displays sourced from the events table, with a hint: "Edit via /schedule". Sub-step 8 surfaces the editing flow.
- **`lib/tz.ts`** new helper module wrapping `@date-fns/tz`. All UTC↔org-tz conversion goes through here. Code rule above.
- **`scripts/verify_event_backfill.ts`** — pre-flight check that compares legacy-column counts to event counts, prints the date distribution, and detects "migration not yet applied" via SELECT (not HEAD) since HEAD requests on a missing table silently return 204/null instead of an error.
- **`scripts/smoke_scheduling_rls.ts`** — RLS verification script (ADD-2).

**Generated column gotcha.** First attempt at the `ends_at` STORED generated column was:
```sql
ends_at timestamptz GENERATED ALWAYS AS
  (starts_at + (duration_min || ' minutes')::interval) STORED
```
Postgres rejected with `42P17 generation expression is not immutable`. Two stacked culprits: `text::interval` (STABLE — parsing depends on `IntervalStyle`) and `timestamptz + interval` (STABLE — output depends on session timezone). Fixed both:
```sql
ends_at timestamptz GENERATED ALWAYS AS (
  ((starts_at AT TIME ZONE 'UTC') + make_interval(mins => duration_min))
  AT TIME ZONE 'UTC'
) STORED
```
`make_interval(mins => …)` is IMMUTABLE. `timestamp + interval` (no tz) is IMMUTABLE. `AT TIME ZONE 'UTC'` (constant) is IMMUTABLE. Round-trip preserves the moment. Same fix applied to the in-RPC `_validate_event_same_utc_day` helper for symmetry.

**Backfill verified.** Pre- and post-migration verification:
```
$ pnpm tsx --env-file=.env.local scripts/verify_event_backfill.ts
orders.measured_at populated:           8
orders.scheduled_install_date populated: 8
order_events kind=measurement:           8
order_events kind=install:               8

Install-date distribution by YYYY-MM:
  2026-05  5
  2026-06  3

OK: event counts match legacy column counts.
```
The in-migration `DO $$ … RAISE EXCEPTION … END $$` assertion is the safety net: if the backfill INSERT drops or duplicates any row, the entire migration transaction rolls back.

**Manual SQL tests (ADD-2).** Via `scripts/smoke_scheduling_rls.ts`, which creates a throwaway field-role user + a throwaway outsider, runs the assertions, and cleans up:

| Claim | Result |
|---|---|
| Field can call `update_event_status` RPC; direct INSERT into `order_events` is rejected | PASS — RPC returns no error; direct INSERT returns permission/RLS error |
| Field cannot UPDATE non-status columns of `order_events` directly | PASS — direct UPDATE on `status` itself is also rejected (only the RPC works) |
| `v_calendar_events` returns 0 rows to a non-member user | PASS — silent zero, no error |

Output verbatim: `smoke test passed — scheduling RLS + RPCs enforced as expected.`

**Practical limitation of the UTC same-day CHECK** (PLAN Q4 locked). The constraint
```sql
date_trunc('day', starts_at AT TIME ZONE 'UTC')
= date_trunc('day', ends_at AT TIME ZONE 'UTC')
```
rejects events that cross UTC midnight. For Top Marble (Eastern, UTC−5 / −4) that's events starting after ~7 PM local and running past midnight UTC — well outside install business hours. For a Pacific shop the cutoff would be around 4 PM local, which is more restrictive but still acceptable for v1. Revisit when/if we onboard one. Belt-and-suspenders against bad data; org-tz-aware validation in the server action gives the friendlier error message first.

**The orders.scheduled_install_date / measured_at columns are now legacy.** They remain on the `orders` table (no DROP), still get written by the seed (and any direct DB insert via the 0015 bridge trigger), but no read path consults them. A future migration drops them; sub-step 5 is the place where the New Order dialog UI swaps date inputs for an event-aware schedule step.

### Deferred (for sub-steps later in Task 3 or beyond)

- `/team`, `/schedule`, `/j/[slug]` pages — sub-steps 4, 5, 9.
- Slug generator (`lib/share-link/slug.ts`) and rate limiter (`lib/share-link/rate-limit.ts`) — sub-step 9.
- Event dialog UI and conflict-warning query helper — sub-step 5.
- Drop of `orders.measured_at` + `orders.scheduled_install_date` columns + the 0015 bridge trigger — future task once sub-step 5 has landed in production for one release cycle.

### Sub-step 2 — generalize render-smoke to scripts/smoke_pages.ts (complete)

**The Task 2B post-ship fix (commit 8eeee86) added `scripts/smoke_contractor_render.ts` after the balanceClass bug shipped through typecheck + lint + build undetected.** Generalized here into a route-list-driven script that every subsequent sub-step adds to.

**Shape.**
- `scripts/smoke_pages.ts` takes a typed `Route[]` list. Each route has an optional `resolver` (async, looks up a real DB id/slug via service-role), optional `expectStatus` (default 200), optional `expectBody` substring assertion, and a `pending` flag for routes whose implementing sub-step hasn't landed yet.
- CLI: `pnpm smoke` runs the full list. `pnpm smoke /contractors /j` runs only routes whose template path starts with one of those prefixes. Filters are exclusive — no positional args = "all routes".
- Four outcomes per route: **OK** (status + body match), **FAIL** (status or body mismatch, or one of the Task 2B error markers appears in the body — `"is not a function"`, `"Server Error"`, `"Application error: a server-side exception"`), **SKIP** (resolver returned null, e.g. no `event_share_links` row exists yet), **PENDING** (expected 404 because the route hasn't shipped; a non-404 here prints "remove pending flag" instead of failing).
- Auth path unchanged from the Task 2B script: `@supabase/ssr.createServerClient` with an in-memory cookie jar, signs in as the demo owner. Service-role client created separately for resolver lookups.

**Default list as of this sub-step.** 15 entries covering the existing surfaces (`/dashboard`, `/orders[?new=1]`, `/customers[?new=1]`, `/contractors[?new=1]`, `/contractors/:id` with `?tab=payments` / `?tab=details`) plus four pending entries (`/team`, `/schedule`, `/j/:slug-valid`, `/j/:slug-revoked`, `/j/:slug-fake`). Sub-steps 4, 5, and 9 each flip their entry off `pending`.

**Verified.** Against a live `pnpm dev`:
```
10 OK, 2 SKIP, 3 PENDING, 0 FAIL
```
Two SKIPs are `/j/:slug-valid` and `/j/:slug-revoked` (no event_share_links rows — seed update is sub-step 3). Three PENDINGs are `/team`, `/schedule`, `/j/:slug-fake` (routes not yet implemented; 404 is the expected state). Zero FAIL.

`pnpm smoke /contractors` filter test: 5 routes, all OK. CLI filtering confirmed.

**Why "pending" instead of "skip" for routes that don't exist yet.** SKIP means "can't verify right now, no input data available". PENDING means "I know this route doesn't exist and the smoke gate is intentionally tracking it". The distinction matters for the final smoke pass (sub-step 10): SKIP is fine to leave forever, PENDING must be cleared by the implementing sub-step.

**`pnpm smoke` added to package.json scripts** so the command is the same in dev, CI, and any future automation.

### Sub-step 3 — seed crew, events, share links, field-role user (complete)

**Why a field-role demo user.** The scheduling RLS smoke (sub-step 1) created a throwaway field user, ran its tests, cleaned up. That worked for the smoke but it left no persistent way to *click through* the app as field role. Demoing the install-status-update flow needs a real account. Added `field@topmarble.local` / `StoneDemo!2026` to the seed alongside the existing owner.

**Crew + assignments.** Five members across the four shop roles (Carlos / Mike — lead installer; Jorge — helper; David — fabricator; Ana — measurement tech). Phone numbers in 703 area code matching Top Marble's Falls Church location. Carlos + Jorge are assigned to the next 3 upcoming installs (chronological by `starts_at`), Mike + David to the 4th, the rest stay unassigned. That gives the future calendar surface real assignments to render AND an unassigned-event state to demo.

**Events created by the 0015 bridge trigger, not by explicit seed RPC calls.** Seed inserts orders via Prisma (legacy `measured_at` + `scheduled_install_date` columns); the AFTER INSERT trigger creates matching `order_events` automatically. So the seed only has to insert the **assignments** + **share links** after orders — events appear on their own. Verified by reading `order_events` from Prisma immediately after the orders block (5 future-install events returned, all sorted by `starts_at`).

**Share links: one live, one revoked.** Matches PLAN ADD-1. Generated via `lib/share-link/slug.ts` (16-char base62 from `crypto.randomBytes` with rejection sampling — landed early since seed needs it; reused by sub-step 9's RPC callers). After re-seed:
- `pnpm smoke /j` resolves both `:slug-valid` and `:slug-revoked` to real DB rows; both `PENDING` because the public route doesn't exist yet (sub-step 9 flips them off).
- `verify_event_backfill.ts` still reports `OK: event counts match` (8 measurement + 8 install events).
- `smoke_scheduling_rls.ts` still passes — RLS unchanged.

**Output of `pnpm db:seed`:**
```
Seed complete. Demo logins:
  owner:  owner@topmarble.local / StoneDemo!2026
  field:  field@topmarble.local / StoneDemo!2026
8 customers, 3 contractors, 10 orders, 2 contractor payments,
5 crew, 5 upcoming installs, 2 share links.
```

**Prisma client regenerated** (`pnpm db:generate`) so the new `CrewMember`, `OrderEvent`, `OrderEventAssignment`, `EventShareLink` models are typed in seed.ts. Sub-step 1 added them to `schema.prisma` but didn't regenerate the client; this sub-step's first typecheck caught the missing exports, fixed by regenerating.

**README updated** with both demo logins, the crew + share-link counts. Operators trying the app as a non-admin role have a clear starting point.

### Sub-step 4 — /team page (complete)

**Sidebar activated.** "Team" coming-soon stub flipped to an active link (still `Users2` icon — same as the stub, no visual surprise). Sits between Contractors and the remaining stubs.

**`/team` is for crew you assign work to, NOT app users.** Stated explicitly in the subhead since it's an easy point of confusion alongside `/settings/members`. The two manage different populations: members = people who can log in; crew = people who get sent to job sites.

**Shape.**
- `lib/validators/crew.ts` — `CreateCrewMemberInput`, `UpdateCrewMemberInput`, `DeleteCrewMemberInput`. `optionalString` wrapper matches the contractor validator pattern so empty strings round-trip cleanly to NULL.
- `lib/actions/crew.ts` — `createCrewMember`, `updateCrewMember`, `deleteCrewMember`. Delete is **gated on `totalAssignmentCount === 0`** at the action layer too (UI gate is the first defense). The FK from `order_event_assignments → crew_members` is `ON DELETE CASCADE` — deleting a crew member with history would silently wipe every assignment row they were ever on, eliminating the audit trail. The action returns "deactivate instead" before that can happen.
- `lib/queries/crew.ts` — `listCrewMembersWithActivity` (crew rows + active-assignment count + last-assignment timestamp; parallel-fetch + JS-stitch pattern from `lib/queries/contractors.ts`); `getCrewMemberDetail` (crew row + last-30-event history via a nested `order_event_assignments → order_events → orders → customers` select); `listCrewLite` for the sub-step 5 crew picker.
- `components/app/crew-table.tsx` — Name / Role / Phone / Email / Active assignments / Last assignment. Phone + email render as `tel:` / `mailto:` links with `e.stopPropagation()` so clicking them doesn't also open the detail sheet. Active-only filter (default on), search across name/role/phone/email, sortable columns via query params.
- `components/app/new-crew-dialog.tsx` — shadcn `Dialog` opened via `?new=1`. Role is a free-text `Input` backed by a `<datalist>` of suggestions (Lead Installer / Helper / Fabricator / Measurement Tech / Driver). On success redirects to the detail sheet for that crew member.
- `components/app/crew-detail-sheet.tsx` — right-side `Sheet` opened via `?id=<uuid>`. Inline edit fields save on blur. Assignment history below with kind-colored chips (mirrors sub-step 5's calendar palette: purple/green/blue/sky/zinc). Danger zone: Deactivate/Reactivate + Delete (disabled until zero history with a hover hint explaining the rule).
- `app/(app)/team/page.tsx` — server component, parallel fetches the list + (optional) detail + total count for the empty-state branch.

**Smoke updates.** `/team`, `/team?new=1`, and `/team?id=:crewId` added to `scripts/smoke_pages.ts`. The detail-sheet route resolves through a service-role lookup of any `crew_members.id`. The seed (sub-step 3) creates 5 crew rows so all three return 200.

Smoke output:
```
13 OK, 0 SKIP, 4 PENDING, 0 FAIL
```

**RBAC.** `canManageMembers(role)` (re-used from Settings → Members) gates the New Crew button and is checked in the action layer. Field role can view `/team` (read-only) but won't see the create CTA or the danger zone.

### Sub-step 5 — /schedule WEEK view + event dialog (complete)

**The single biggest sub-step of Task 3.** The week view is the dominant scheduling surface; the dialog is the only mutation surface for events (besides the inline reschedule via drag in sub-step 7). Day view + list view + filters are sub-step 6.

**Shape.**
- `lib/validators/events.ts` — `Create/Update/Delete/RescheduleEventInput` + `UpdateEventStatusInput`. Date and start-time arrive separately (YYYY-MM-DD + HH:mm), assembled into a UTC `timestamptz` on the server via `parseLocalDateTime`. `DEFAULT_DURATION_MIN` constants match the seed defaults so the dialog's kind segmented control snaps the duration to a sensible value when the user changes kind without overwriting custom values.
- `lib/queries/events.ts` — `listCalendarEvents({fromUtc, toUtc, ...filters})` reads from `v_calendar_events` (the joined read-model shipped in sub-step 1). Crew filter is JS-side because the view's `crew` is a `jsonb` array; bounded by the time window, the in-memory pass is trivial. Also: `listOrdersForEventPicker` (for the dialog combobox; pre-loads customer address so location_text can auto-default) and `getEventForEdit` (single-event fetch with the same shape as a list row).
- `lib/actions/events.ts` — `createOrderEvent`, `updateOrderEvent`, `deleteOrderEvent`, `rescheduleOrderEvent`, `updateOrderEventStatus`. All call the 0014 RPCs. `rescheduleOrderEvent` pre-fetches the existing event + assignments and re-passes them so a drag doesn't wipe assignments / notes / location_text. **Critical for sub-step 7.** Also `getCrewConflicts({crewIds, startsAtIso, endsAtIso, excludeEventId?})` for the soft warning shown inline in the dialog.
- `components/app/event-block.tsx` — the colored block primitive used in the week grid. Color palette per kind matches the crew-detail-sheet history list (purple/green/blue/sky/zinc). Terminal statuses (cancelled/no_show/complete) render at 60% opacity with a strikethrough on the order number. Shows crew initials (up to 3) bottom-aligned.
- `components/app/calendar-week.tsx` — 7-day × 14-hour (6 AM – 8 PM) grid. CSS grid for layout, absolute positioning inside each day column for the events. Today highlighted via `bg-brand/5`; weekends muted via `bg-muted/10`. Empty time slots are buttons that pre-fill `?event=new&date=&time=` on the dialog URL.
- `components/app/event-dialog.tsx` — the create/edit dialog. Order combobox (search by order# / project / customer), kind segmented control (5 buttons), date+time pickers, duration `Input` plus four quick-pick buttons (1h/2h/3h/4h), location text with a "Use customer address" affordance, crew multi-select with inline role override per assignment, notes textarea, delete (edit mode only) behind an AlertDialog. The order picker is **disabled** in edit mode — moving an event between orders is rare enough that we'd rather force delete-and-recreate than make the constraint slippery.
- `components/app/schedule-nav.tsx` — small client component wrapping the prev/today/next buttons in `next/link` Buttons, so the schedule page can server-render and still navigate without a full refresh.
- `app/(app)/schedule/page.tsx` — server component, fetches the week's events + (when the dialog is open) the order picker list + active crew list + the edit-target event. Anchor date via `?date=YYYY-MM-DD`; defaults to "today in org tz".

**Conflict warning — debounced live check.** The dialog runs `getCrewConflicts` 250ms after the last form change (whenever the crew set, date, time, or duration shifts). Conflicts render inline under each crew row that has one: `⚠ Already on TM-1042 — Park kitchen 10:00 AM-1:00 PM`. Soft warning, never blocks submit. Same helper will be re-used by sub-step 7's drag toast.

**Time-zone discipline (Q3 of the plan).** All event timestamps are stored as UTC. The dialog reads/writes YYYY-MM-DD + HH:mm in **org-local time**, with a small "EDT" / "EST" / etc. label under the start-time input so a traveling owner who's in a different tz than the shop sees the disconnect. Conversion happens at the action-layer boundary via `parseLocalDateTime`. The week view renders all positioned events using `formatInTimeZone(startsAt, orgTz, …)`. No server-side comparison touches non-UTC.

**Two minor `tzAbbreviation` adjustments.** First cut used `formatInTimeZone(now, tz, "zzz")` for the small "EDT" label, but date-fns' `z*` tokens render long names ("Eastern Daylight Time"). Added `tzAbbreviation()` in `lib/tz.ts` that calls `Intl.DateTimeFormat({timeZoneName: "short"})` directly. Same helper used in the schedule header and the dialog.

**Smoke updates.** `/schedule`, `/schedule?event=new`, `/schedule?event=:eventId` added; resolver picks any seeded event. Smoke output: **16 OK, 0 SKIP, 3 PENDING, 0 FAIL** (the three `/j/:slug-*` entries are sub-step 9). Spot-checked the rendered week body for the demo: `TM-1043 — Rodriguez master bath vanity` shows up in the install column with the correct project name from the seed.

**Click-through behaviour.** Clicking an event opens the dialog in edit mode (sub-step 8 will redirect this to the order detail Events tab). Clicking an empty time slot opens the dialog in create mode with `date` and `time` pre-filled. The brief explicitly listed both interactions; the empty-slot one is the actual workflow accelerator for the shop (drag your finger across the screen looking for a slot, click).

### Sub-step 6 — Day view + List view + filters + URL state (complete)

**Shape.**
- **`calendar-week.tsx` generalized to `calendar-grid.tsx`.** Takes a `days: Date[]` array (1 = day view, 7 = week view) and an optional `hourPx` (default 56; day view uses 80 for taller rows since blocks have a whole screen to breathe). Single-day mode skips the weekend mute and renders the column header as "MMM d" instead of just the day-of-month — week view's vertical-stacked "EEE / d" doesn't read as a self-contained date on its own.
- **`calendar-list.tsx`** — table view. Date+time / Kind (color-dot prefix) / Order # (mono) / Project / Customer / Crew / Location / Status (status-tone tinted, line-through on cancelled/no_show). Click row → opens edit dialog. Sortable on date/kind/order/status; default sort is starts_at desc (newest events first — this is the "look something up" view, not "what's happening today"). Pagination 50/page.
- **`schedule-view-tabs.tsx`** — small client component for Week / Day / List toggle. Switching to a non-list view strips `from`/`to` from the URL (they're list-only).
- **`schedule-filter-bar.tsx`** — uses `nuqs` `useQueryStates` with `shallow: false` to push URL changes that trigger the server re-fetch. Same shape as `orders-filter-bar.tsx`. Four filter dimensions: kind multi-select, status multi-select, crew multi-select, free-text search (debounced 250ms). List view exposes two additional date-input filters (`from`/`to`) — week and day anchor on a single date, so date range doesn't fit.
- **`/schedule` page** now dispatches on `?view=week|day|list`:
  - **week** — anchors at `?date=YYYY-MM-DD`, computes week start in org tz, queries `[weekStart, weekStart+7d)`.
  - **day** — anchors at `?date=`, queries `[dayStart, dayStart+1d)`.
  - **list** — query window comes from `?from`/`?to` (each interpreted as YYYY-MM-DD in org tz, midnight to midnight + 1 day for to-inclusive); defaults to all events forward of the unix epoch if unset.

**URL state design.**
- All filter params live alongside the view + date params on the URL — switching views preserves filters. CSV-encoded for multi-selects (`?kind=install,measurement`).
- View tabs use `?view=` (omitted = week, the default).
- Prev/Next/Today buttons only render on week + day views (list doesn't have a natural "next" — Today clears the date range).
- Per-route navigation (prev/today/next clicks) is `router.push` not nuqs — these are page-level navigation, not filter mutations.

**Filtering performance note.** Kind / status / search filters push to PostgREST. Crew filter applies JS-side in `listCalendarEvents` since the view's `crew` column is a `jsonb` array and PostgREST's nested-array filters are finicky. Bounded by the time window, the in-memory pass is cheap (the week view returns ≤ a few dozen rows in practice; the list view caps at the seeded ~20 today).

**Smoke updates.** Added `/schedule?view=day`, `/schedule?view=list`, and one filter-combo route (`?view=list&kind=install&status=scheduled`) to guard against renderer bugs that only show up with the filter chip count > 0. Smoke output: **19 OK, 0 SKIP, 3 PENDING, 0 FAIL**.

**Not in this sub-step.** Drag-to-reschedule (sub-step 7). Click-event → order-detail Events tab (sub-step 8). The week/day grids' event click currently opens the edit dialog as a stand-in.

### Sub-step 7 — drag-to-reschedule on week and day views (complete)

**Shape.** `calendar-grid.tsx` becomes a `DndContext` with `PointerSensor`. Each event block is a `useDraggable`; each hour cell is a `useDroppable`. Drop ID format `slot:<dateKey>:<hour>` so the handler can decode the target without any cross-component state. Activation constraint is `distance: 6` — taps under that threshold remain clicks (still open the dialog).

**Drop semantics.** Target hour determines the new start time (`HH:00`); duration is preserved. Snapping to the hour (rather than a 15-min sub-grid) matches the visual hour rows — no surprise about where the event will land. Future polish could read pointer Y for 15-min increments.

**Same-UTC-day guard at the action layer too.** The DB CHECK catches this regardless, but the action computes the new ends_at locally and short-circuits with a friendly toast (`"Can't reschedule there — event would cross UTC midnight"`) before round-tripping to the server. For Eastern Time shops the constraint is theoretical (8 PM Eastern install isn't a real workflow), but the message is the polite version of `check_violation`.

**Optimistic updates.** Local `useState<CalendarEvent[]>` mirrors the prop on mount and re-syncs whenever the prop changes (after `router.refresh()`). On drop, the local state moves immediately; the server action runs in a `startTransition`. On failure, the previous state is restored and an error toast surfaces. On success, `router.refresh()` pulls the canonical state — which should match what the optimistic update showed, so the user sees no flicker.

**Post-drop conflict toast.** After a successful reschedule, the grid re-runs `getCrewConflicts({crewIds, startsAtIso, endsAtIso, excludeEventId})` for the event's assigned crew. Any hits render as a separate `toast.warning` so the success message ("Rescheduled to …") gets acknowledged first. Skips entirely when there are no assigned crew. Same helper that the dialog uses for its inline warning, so consistency is automatic.

**Activity log.** No DB changes needed — the `tg_order_events_after_update` trigger from 0013 already routes `starts_at` or `duration_min` changes through the `'rescheduled'` action with `metadata.from` + `metadata.to` carrying the old and new (starts_at, duration_min) pair. Confirmed in the integration test below.

**Preserve-fields path.** `rescheduleOrderEvent` fetches the existing `location_text`, `notes`, and assignments before calling `update_order_event` (which has full-replace semantics). Without this, a drag would silently wipe assignments and notes — exactly the kind of bug that hides behind a passing typecheck. Covered by **`scripts/test_event_reschedule.ts`**:

- Picks one upcoming install event with at least one crew assignment.
- Stamps a marker location + notes, captures the assignment set.
- Calls `update_order_event` (the same RPC `rescheduleOrderEvent` does) with `starts_at + 1h`, passing the existing location/notes/assignments explicitly.
- Asserts: starts_at moved, location_text preserved, notes preserved, duration unchanged, assignment set unchanged, and an `activity_log` row with `action = 'rescheduled'` exists.
- Restores the original time. Idempotent — run it any number of times.

Auth gotcha resolved in the test: SECURITY DEFINER RPCs reject service-role callers with `'not authenticated'` because `auth.uid()` is NULL. The script signs in as the demo owner via the anon client first (same path the app uses), keeping the service-role client for introspective SELECTs that need to bypass RLS.

**Smoke unchanged from sub-step 6** — drag is interactive, not URL-visible. The route inventory still reads **19 OK, 0 SKIP, 3 PENDING, 0 FAIL**.

**Not in this sub-step.** Click-to-open → order detail Events tab (sub-step 8). The grid's event click still opens the edit dialog directly.

### Sub-step 8 — Order detail sheet Events tab (complete)

**New tab between Overview and Files** (final tab order: Overview | Events | Files | Activity). URL-controllable via `?tab=events` for deep-linking; Tabs `defaultValue` honours it on first render. Tab count badge on Events when > 0 to mirror the existing Files counter.

**Shape.**
- `lib/queries/events.ts` adds `listEventsForOrder(orderId)` — reads the same `v_calendar_events` view used by the schedule page, scoped to one order, sorted by `starts_at asc`.
- `components/app/order-events-tab.tsx` — new client component for the tab body. Splits events into Future and Past (past go below a small "Past" divider so the eye lands on what's coming, not what's done). Each row renders:
  - Kind chip (colored to match the calendar palette — purple/green/blue/sky/zinc)
  - Date + time + duration
  - Status pill (status-tone tinted — `bg-emerald-100` for complete, `bg-destructive/15` for cancelled / no_show, muted for scheduled, amber for en_route, blue for in_progress)
  - Crew list (or "No crew assigned" italic muted)
  - Location with MapPin icon when set
  - Notes inline (whitespace-pre-wrap so multi-line notes flow)
  - Action group: **Open** (deep-links to `/schedule?view=day&date=<event-day>` so the user sees the day context), **Edit** (opens the EventDialog), **Delete** (AlertDialog confirm), **Mark done** (one-click status → complete; hidden on terminal-status events), **Send** (disabled stub — wires up in sub-step 9 with the send-to-crew modal).
- `components/app/order-detail-sheet.tsx` — three new props (`events`, `defaultTab`, `orgTimezone`), one new TabsTrigger, one new TabsContent rendering `<OrderEventsTab>`. Tab count badge format matches the existing Files counter.

**EventDialog made pathname-aware** so it works on both `/schedule` and `/orders`. The dialog's `close()` previously hard-coded `router.push("/schedule"…)`; now uses `usePathname()`. Also no longer strips `?order` (the orders page's detail-sheet anchor) — only the dialog's own params (`event`, `date`, `time`). On `/schedule`, `order` has no semantic effect; on `/orders`, preserving it keeps the detail sheet open after the dialog closes.

**Dialog mount on `/orders`.** New `EventDialogMount` server component inside `orders/page.tsx` fetches the order picker + active crew + (for edit) the event being edited, then renders `<EventDialog>`. Triggered by `?event=new` or `?event=<uuid>` AND `?order` set. When creating from inside an order's Events tab, `initialOrderId={detailOrderId}` is passed directly as a prop — no `?preOrder=` URL param needed — so the picker is pre-populated without polluting the URL with a separate field.

**Smoke updates.** Two new routes — `/orders?order=:orderId&tab=events` and `/orders?order=:orderId&tab=events&event=new` — resolvers pick the first seeded order. Catches the runtime path where `OrderEventsTab` + `EventDialog` co-exist on the same page (separate Radix portals). Smoke output: **21 OK, 0 SKIP, 3 PENDING, 0 FAIL** (up from 19; the only PENDINGs are the three `/j/:slug-*` entries for sub-step 9).

**Sheet + Dialog portal note.** Both the Sheet (detail) and Dialog (event) portal to `document.body`. They co-render server-side but their content is invisible in the SSR HTML — a body fetch will return the page chrome without the panel content. Spot-checked this with a `_check.ts` script: the SSR body returns 200 without "Overview" / "Events" tab labels in the markup, because Radix portals fill on client hydration. Smoke's `200 + no error markers` check is the meaningful signal here.

**Mark complete uses `updateOrderEventStatus`** (the action wrapping the sub-step 1 RPC). The state-machine block (`complete → scheduled` rejection) doesn't fire on this transition — `scheduled → complete` is always allowed. Field role can also hit this RPC from this surface in a future task (when field gets access to the orders sheet beyond its current read-only state).

### Sub-step 9 — Send-to-crew modal + /j/[slug] public route (complete)

**The feature this whole task was about.** Closes the gap from "owner types the address into WhatsApp" to "one click → formatted text block + a mobile URL the crew can mark status from."

**Send-to-crew modal (`?send=<eventId>` on /orders).**
- Two tabs: **Copy text** and **Shareable link**.
- Copy text: pre-formatted block matching the brief exactly (📍 / 🕐 / 📌 / 👤 / 🪨 / 📝 / 🔗 emoji prefixes), `formatShareText()` is a pure function in `lib/share-link/format-text.ts`. Big Copy button hits `navigator.clipboard.writeText`. Three intent links (WhatsApp / Messages / Email) prefill the encoded text via `whatsapp://send?text=`, `sms:?body=`, `mailto:?body=`.
- Shareable link: if no live link → single Generate button. If live → URL field + copy + "Last opened X ago" + Rotate (revoke+regenerate atomic) + Revoke (AlertDialog confirm). Slugs are 16-char base62 from `crypto.randomBytes` via `lib/share-link/slug.ts` (already landed early in sub-step 3 for the seed; reused unchanged).
- Mounted by `orders/page.tsx` when `?send=<uuid>` is present alongside `?order=<uuid>`. Server-fetches the assembled `SendModalContext` (event + extra order fields + customer + live link in one shot). Passed as props, so the modal opens fully populated — no client-side fetch flash.

**Public `/j/[slug]` page — outside `(auth)`.**
- `export const dynamic = "force-dynamic"; export const revalidate = 0;` per Q10/Q11. Signed photo URLs (1h TTL) are regenerated per request, never cached in HTML.
- Service-role lookup of slug → notFound() if missing or `revoked_at IS NOT NULL`. notFound() renders `/j/[slug]/not-found.tsx` (a neutral "no longer active" card) with HTTP 404. **Uniform 404 shape across missing / revoked / fake slugs per Q2.** Timing differences are within network jitter.
- Layout: kind chip + status pill, "Install — TM-1042 — Johnson kitchen" title, date+time block in org tz, location with "Open in Maps" link (`https://maps.google.com/?q=…`), tap-to-call customer phone, stone/edge/cutouts, notes, photo grid (3-col, square thumbs, tap to open full size in a new tab), crew list, status-action buttons via `<SharePageActions>`, footer "Throughstone — sent by {org.name}".
- `<meta robots="noindex,nofollow">` and `referrer="no-referrer"` on the page metadata so the URLs never land in a search index and don't leak the Throughstone URL when the user opens Maps.
- `last_opened_at` is bumped via fire-and-forget service-role UPDATE — the render path doesn't wait on a one-row INSERT.

**Status updates from the public page.**
- `SharePageActions` (client component) renders forward-progress buttons appropriate to the current status: scheduled → "On my way" / "No-show"; en_route → "Arrived" / "No-show"; in_progress → "Mark complete"; terminal → nothing (the state machine in `update_event_status` would reject anyway).
- Clicks call `markEventStatusViaShareLink({slug, status})` action. The action re-validates the slug (defense in depth on top of the route's check) via service-role lookup, then calls `update_event_status` RPC with `p_via_shared_link=true`. The RPC asserts the caller is `service_role` AND sets the `app.event_status_via_shared_link` transaction-local GUC, so the AFTER UPDATE trigger writes `activity_log.metadata.via = 'shared_link'` AND `actor_id = NULL`.

**Rate limit (Q2 lock).** `middleware.ts` enforces 30 req/min per IP on `/j/*` before the page handler runs. In-memory token bucket in `lib/share-link/rate-limit.ts` (module-scoped Map keyed by IP). Hits over the limit return HTTP 429 with `Retry-After`. **Caveat documented inline in the rate-limit module:** in a single Next instance the bucket is shared across requests; on Vercel each warm function instance has its own bucket, so the effective limit is somewhere between 30/min and N × 30/min for N warm instances. Defeats naive enumeration; a distributed limiter is a Task 4+ infra concern.

**Activity feed phrase rendering (Q1 lock).** `phraseFor` in `activity-feed.tsx` gains branches for `order_event:created/rescheduled/status_changed/updated/deleted`, `crew_member:created/updated/deleted`, and `event_share_link:created/revoked/deleted`. For `order_event:status_changed` with `metadata.via === "shared_link"` the phrase renders as `"install marked en route (via shared link)"` — no "Someone …" actor prefix, because `actor_id` is NULL and the suffix is the disambiguator. `shouldHide` extended to suppress `order_event_assignment` rows from the feed (same dedupe pattern as `contractor_allocation` from Task 2B).

**Verified end-to-end via `scripts/test_share_link_status.ts`:**
- Pick a live share link from the seed.
- Capture original status.
- Call `update_event_status` with `p_via_shared_link=true` → status changes to `en_route`.
- Look up the resulting `activity_log` row: `actor_id IS NULL`, `metadata.via === 'shared_link'`, `metadata.from === <originalStatus>`, `metadata.to === 'en_route'`. **All four assertions pass.**
- Restore original status. Idempotent.

**Smoke matrix flipped off pending (ADD-1):**
```
/j/:slug-valid     → 200, body contains "TM-"
/j/:slug-revoked   → 404, body contains "no longer active"
/j/:slug-fake      → 404, body contains "no longer active"
```
Plus a new check for the modal mount path: `/orders?order=:orderId&tab=events&send=:eventId` → 200. Final smoke output: **25 OK, 0 SKIP, 0 PENDING, 0 FAIL** — the route inventory is now fully covered.

**Single-link semantic preserved.** `create_event_share_link` RPC RAISEs `unique_violation` if a live link already exists for the event. The modal disables the Generate button when one exists (showing the URL + Rotate + Revoke instead), so the race condition only matters if two managers click Generate within the same millisecond — in which case one of them gets a polite error toast and the other gets the link.

### Sub-step 10 — README + DEVLOG wrap + final smoke (complete)

**README updates.**
- Two new how-to sections: **Understand the scheduling model** (data model summary, bridge trigger, write-path lockdown, timezone discipline) and **The /j/[slug] public surface** (rate limit + service-role lookup + uniform 404 + status-update trust chain + send-to-crew flow + integration test).
- New **Render-time smoke gate** section explaining `pnpm smoke` (route-list shape, resolvers, expectStatus / expectBody / pending fields).
- Project-structure block updated for `/team`, `/schedule`, `/j/[slug]`, and the new migration range (0001..0015).
- "Intentionally not in Task 1" replaced by **What's intentionally deferred** — grouped by task (3, 2B, 2A, 1, cross-cutting) so each task's known-gaps live near each other.
- Demo logins block already lists the field-role user (added in sub-step 3).

**Final smoke pass.** Against a fresh `pnpm dev` after re-seeding:
```
$ pnpm smoke
25 OK, 0 SKIP, 0 PENDING, 0 FAIL
```
Every route in the default list passes — `/j/:slug-valid` returns 200 with the order number in body, `/j/:slug-revoked` and `/j/:slug-fake` both return 404 with the "no longer active" copy. No SKIPs (seed provides all the resolver rows). No PENDINGs (every sub-step that owed a route flip has flipped it).

### Closing — deferred (Task 3)

The list below was decided up-front in the brief (Out of Scope) plus a handful of things discovered during implementation. Each item is intentionally NOT in this task.

- **Two-way calendar sync** (Google Calendar, iCal, Outlook). `/j/[slug]` is a one-way push; nothing reads external calendars. Task 5 candidate.
- **SMS / WhatsApp / Email auto-send.** The copy-text block + intent links + share URL are the v1 stand-in. Task 4 wires real-time push.
- **Recurring events.** Every event is a one-off.
- **Crew availability / scheduling optimization / route optimization.** The owner picks the slot and the crew; we surface conflicts but don't suggest.
- **Crew portal with auth.** `/j/[slug]` is intentionally login-free for the v1 dispatch case. A separate authenticated crew surface (with their own job history, time-tracking, photo upload) is a future task.
- **Pay tracking per crew** (hours worked, piecework, commissions). Not in scope.
- **Multi-timezone support beyond the org tz.** Travel-from-another-tz edge documented in PLAN Q3; the picker labels its tz inline so a traveling owner knows what they're scheduling.
- **Install-site-specific photos.** The `/j/[slug]` photo gallery surfaces the parent order's attachments; site-specific (template photos, completion photos) is a separate model.
- **Distributed rate limit** (`@upstash/ratelimit` etc.). In-memory bucket in `middleware.ts` is per-instance; production multi-instance would have an effective limit of N × 30/min. Task 4+ infra.
- **Drop of `orders.measured_at` + `orders.scheduled_install_date` columns + the 0015 bridge trigger.** Defer until the events read paths bake for a release.
- **ESLint rule that flags `import { value } from "<'use client' file>"` from server components.** Would have caught the Task 2B `balanceClass` bug at lint time instead of runtime smoke. Tracked since Task 2B shipped; its own small task.

### Closing — verified surfaces (Task 3)

What the smoke + integration scripts cover end-to-end:

| Surface | Gate |
|---|---|
| Schema, RLS, RPCs, views, backfill assertion | `0013` + `0014` + `0015` migrations; in-migration `RAISE EXCEPTION` if backfill counts diverge; `scripts/smoke_scheduling_rls.ts` for field-role + non-member RLS |
| Reschedule preserves location / notes / assignments | `scripts/test_event_reschedule.ts` (moves +1h, asserts, restores) |
| via-shared-link status updates | `scripts/test_share_link_status.ts` (asserts `actor_id IS NULL` + `metadata.via = 'shared_link'` on the resulting audit row) |
| Every page render | `scripts/smoke_pages.ts` — 25 OK, 0 PENDING, 0 FAIL |
| `/j/[slug]` matrix (valid / revoked / fake) | Same script per PLAN ADD-1; valid → 200 + `TM-`, revoked + fake → 404 + `"no longer active"` |
| Backfill consistency | `scripts/verify_event_backfill.ts` (run before / after migration; reports count mismatches and date distributions) |

`pnpm typecheck` + `pnpm lint` + `pnpm build` all green at the head of every commit in the task.

---

## Task 2B — Contractor tracking (2026-04-23)

A new first-class entity so Top Marble can see which customers came through a contractor, tag orders with a contractor, and track balances across all of a contractor's jobs. See `PLAN.md` for the sub-step breakdown and the Q1–Q9 decisions that came out of the review.

### Sub-step 1 — DB schema, views, RLS, RPCs (complete)

**Why.** Before UI, lock the shape of the data. Three tables (`contractors`, `contractor_payments`, `contractor_payment_allocations`) plus one nullable FK on `orders`. Two views expose per-order paid-by-contractor and per-contractor balance so the app reads a fresh number under RLS instead of re-aggregating in the client.

**What shipped.**
- **`0011_contractors.sql`** — tables + indexes + FK + views + RLS + audit triggers.
  - `orders.contractor_id` FK is `ON DELETE SET NULL`. Deleting a contractor must not delete jobs — flagged explicitly in the migration header.
  - `enforce_field_role_columns()` extended to block `contractor_id` changes by field users. Consistent with the 0002 policy that field may only touch `stage` and `notes`.
  - `v_order_contractor_paid` + `v_contractor_balances` created with **`WITH (security_invoker = true)`**. Default view behaviour in PG 15+ runs as the view owner, which would bypass RLS on the underlying tables and leak cross-org data. `security_invoker = true` makes view queries run under the caller's session, so `orders` / `contractors` / allocations RLS enforces tenancy automatically.
  - `v_contractor_balances` aggregates from `contractors LEFT JOIN orders (stage <> cancelled) LEFT JOIN v_order_contractor_paid`. No double-counting because `paid` is already one-row-per-order before the outer SUM.
  - Audit triggers written for contractors, payments, and allocations — same shape as the existing 0005/0006 pattern for customers/orders/attachments. `AFTER DELETE` guards with `IF NOT EXISTS (SELECT 1 FROM organizations …)` so cascade-deletes of an org don't try to INSERT audit rows into the org that's going away.
- **`0012_contractor_payment_rpc.sql`** — write-path lockdown.
  - `record_contractor_payment`, `update_contractor_payment`, `delete_contractor_payment`, all `SECURITY DEFINER`. Each does its own auth check (`auth.uid()` is non-null, `is_org_member(org_id)`, `org_role(org_id) IN ('owner','admin','manager')`) because SECURITY DEFINER bypasses RLS.
  - **RPCs are the only write path.** Belt-and-suspenders lockdown in 0011 adds `RLS WITH CHECK (false)` on INSERT/UPDATE/DELETE for both `contractor_payments` and `contractor_payment_allocations`, **plus** `REVOKE INSERT, UPDATE, DELETE … FROM authenticated, anon`. Either by itself would be enough; together means a future dev dropping one of them still can't accidentally open a direct-write hole.
  - Sum invariant: the RPC validates `ROUND(sum(alloc.amount), 2) = ROUND(payment.amount, 2)` (both sides are `numeric(12,2)`, so no float tolerance — strict equality at 2dp). Also checks each allocation amount > 0 and each allocation's `order_id` belongs to `p_contractor_id` in the same org. All inserts happen inside the RPC's txn — single round-trip atomicity.
  - No explicit `INSERT INTO activity_log` in the RPC body. The AFTER INSERT / AFTER DELETE triggers from 0011 fire inside the RPC's transaction, so every mutation is audited atomically with the write. Same pattern as `change_order_stage` from 0009.
- **Prisma schema** mirrors all three new tables + the `orders.contractorId` column. Views are intentionally not modelled in Prisma — `seed.ts` can insert directly via Prisma; app-path view reads go through the Supabase client, which returns hand-typed rows.

**Verified via `scripts/smoke_contractors_rls.ts`** (non-owner session).
- `v_contractor_balances` returns **0 rows, no error** for a user who isn't a member of the contractor's org. Silent zero-rows was the scary failure mode to catch; the test asserts it explicitly rather than just "didn't crash."
- `v_order_contractor_paid` — same assertion.
- Direct `INSERT INTO contractor_payments` from an authenticated non-member → rejected. This is the test that would catch a future dev who forgot either the REVOKE or the `WITH CHECK (false)`.
- Direct `INSERT INTO contractor_payment_allocations` → rejected.
- `SELECT FROM contractors` as non-member → 0 rows, no error (regression canary for the `contractors_select` policy).
- Script is idempotent: creates one throwaway user + one test contractor, cleans both up at exit, even on failure.

### Sub-step 2 — seed data (complete)

**Why.** Without demo data the contractor pages have nothing to render. Three contractors with distinct payment-terms shapes (Running tab / Net 30 / Net 60), five existing orders tagged, two payments covering the "partial across multiple jobs" and "single payment fully covers one job" cases. Dulles intentionally has one order and zero payments so the "all outstanding" state has a demo surface too.

**Numbers.** Hand-matched so sums work out without running through the RPC (Prisma seed writes as superuser and bypasses the sum-invariant enforcement — the RPC exercises that path, not seed).

| Contractor | Jobs total | Paid | Balance owed | Notes |
|---|--:|--:|--:|---|
| Ameer Construction | $13,800 | $6,000 | $7,800 | 1 check of $6,000 split $1,500 / $4,500 across 2 orders |
| Khaled Kitchens & Bath | $6,500 | $3,100 | $3,400 | 1 ACH of $3,100 fully covering 1 of 2 orders |
| Dulles Build Group | $7,850 | $0 | $7,850 | No payments yet; Net 60 slow-pay demo case |

These five-figure totals are the regression spot-check — if `pnpm db:seed` re-runs and `v_contractor_balances` doesn't produce them, something drifted in the view, the cascade behaviour, or the Prisma mapping.

**Deviation from the original brief.** Spec said "$2,500 check fully covering 1 of Khaled's 2 orders" — no seeded order was priced at $2,500, and fiddling with existing order quotes to force the match would distort unrelated demo data. Shipped as "$3,100 fully covering Nakamura wet bar" instead. Same pattern demonstrated, without touching the existing orders.

**Idempotency verified.** `pnpm db:seed` twice in a row produces identical results (existing org + user are deleted first; cascade wipes contractor tables).

### Sub-step 3 — /contractors list + create flow (complete)

**Why.** The list page is the everyday landing — Top Marble pulls up /contractors when the shop needs to know who owes what. Default sort is balance desc so the worst offenders surface at the top.

**Shape.**
- `components/app/sidebar-nav.tsx` gets a new active entry `Contractors` with the `HardHat` icon, slotted between Customers and the coming-soon stubs.
- `lib/queries/contractors.ts`: `listContractorsWithBalance` fetches `contractors`, `v_contractor_balances`, and `contractor_payments` in parallel, then stitches in memory. I started with a clever single-query `!inner` join against the view and it fought me — three small parallel queries are cheaper than the workaround.
- `lib/actions/contractors.ts`: `createContractor` / `updateContractor` / `deleteContractor`. Delete is defense-in-depth: UI gates on `job_count + payment_count = 0`, but the action also re-checks, because any future caller (a CLI, a bulk action) that forgets the gate could silently SET NULL the contractor on live orders via the FK.
- `components/app/contractors-table.tsx`: columns Name / Primary contact / Phone / Active jobs / Balance owed / Last payment. Sortable query-param columns (balance desc default). Active-only toggle (default on). Two empty states — "no contractors in org" vs "no matches for current filter".
- **Balance color treatment** factored out of the row renderer into `balanceClass()` + `formatBalance()` so sub-step 4 (header block) and future surfaces (order detail sheet) can import them directly. Positive → foreground. Zero → muted with "All settled" label in-place. Negative → `text-brand` with "Credit $X.XX" prefix.
- `components/app/new-contractor-dialog.tsx`: shadcn Dialog + RHF with zod resolver. Payment terms is a free-text input backed by a `<datalist>` of the four suggestions (Net 30 / Net 60 / Running tab / COD). On success → redirect to `/contractors/[id]`.

**Not tested in a browser this session.** I've shipped typecheck/lint/build green but haven't loaded the page in a live dev server yet. Functional spot-check happens at sub-step 4 when the detail page gets wired up and there's a reason to click through.

### Sub-step 4 — /contractors/[id] detail page (header, Jobs, Details) (complete)

**The balance owed is the money shot.** 4xl/5xl tabular-nums mono, right-aligned in the header block. Everything else on the page is subordinate. Color follows `balanceClass` from the table so the two views stay in lockstep.

**Jobs tab.** Orders with `contractor_id = this contractor` joined with `v_order_contractor_paid` for the **contractor-side** Paid / Balance columns. This is the Q5 decision from the plan — `orders.balance_due` (homeowner-side) is never shown here. Cancelled jobs live behind a "Show N cancelled jobs" toggle at the bottom; when hidden, the main list is active jobs only.

**Details tab.** One form, one Save button. Tried per-section inline edit and it was more ceremony than clarity — managers edit 2-3 fields per visit, not one at a time. Below the form is a danger zone with Deactivate/Reactivate (toggle) and a Delete button that's disabled until `job_count = 0 AND payment_count = 0`. The spec's "DOES NOT delete or unlink orders" semantics is enforced both at the UI (button disabled) and in the action (defense-in-depth re-check).

**Payments tab is a stub** in this commit — "coming in the next commit". Keeping the tab shell in place so the nav structure is final and sub-step 5 only needs to replace the stub's body.

**`balanceClass` + `formatBalance` are imported into a server component (`contractor-header.tsx`)** from a `"use client"` module (`contractors-table.tsx`). Typecheck + build both pass — Next 14 allows pure-value imports to cross the boundary, the module just ends up in both bundles. If this becomes a bundle-size regret later, factor the helpers into a shared `lib/contractors/format.ts`. Not doing it preemptively.

### Sub-step 5 — record-payment flow + Payments tab (complete)

**The feature this whole task is about.** One check comes in for $6,000; it covers three kitchens. Without the allocation table everything before this point is just list-plumbing.

**Sheet (not Dialog).** The allocation list needs room to breathe — on a contractor with five or six open jobs, a Dialog is claustrophobic. Right-side Sheet at `sm:max-w-xl`, scrolling body, sticky footer for Cancel + submit.

**Shape.**
- Top half: amount / received-on / method / reference / notes. Method is a hard enum (check / ach / cash / card / other) because we want consistent reporting later; `PAYMENT_METHOD_LABELS` decouples display from DB value.
- Bottom half: an allocation list. Each row has a checkbox, order metadata, a balance hint, and an amount input. Sorted by order number (which correlates with creation order — install-date sort fires if/when scheduled).
- **Auto-allocate oldest first** walks top-down, fills each row up to its `contractorBalance`, stops when the amount is consumed. If the total amount exceeds the sum of balances, the user gets a warning toast and edits manually.
- **Live running totals** — Applied / Remaining / Over. Green when `abs(applied - amount) < 0.005`, red when over. Submit disabled until green.
- Edit mode: seed the rows with prior allocations. An order that was allocated to but has now been fully paid by other means still shows up (defensive — shouldn't happen given cascade semantics, but if it does we fail loud, not silent).

**Payments tab.** Timeline of payments newest-first. Each card shows the amount + date + method + reference in the header line, the allocation list below (with links to `/orders?order=<id>`), and a notes line if present. Edit / Delete buttons route back into the sheet.

**Delete preview** — the `AlertDialog` body enumerates each order whose contractor-side balance will increase, and by how much. Grounded concrete: "TM-1044 — +$4,500" instead of a generic "are you sure".

**End-to-end RPC test run before commit** (throwaway script, not committed):
- Signed in as demo owner, called `record_contractor_payment` with a matched sum → returns new payment id.
- Called it again with mismatched sum → RPC raises `allocation sum (99) does not equal payment amount (100)` as expected.
- Called `delete_contractor_payment` → cleans up. All three calls hit the same code path the server action uses.

**Known gap.** Haven't loaded the flow in a live browser this session. TypeScript + lint + build + RPC-level tests all green. Sub-step 6 (order integration) and Sub-step 7 (edit/delete polish) will give reasons to click through in a dev server.

### Sub-step 6 — order integration (column, filter, dialog, detail sheet) (complete)

**Where contractors now show up on the order side:**
- **Orders table** — new Contractor column between Stage and Stone. Renders the contractor name as a link to `/contractors/[id]` (with a tiny HardHat icon) or a dimmed dash when unset. `event.stopPropagation()` on the link so clicking it doesn't also open the order detail sheet.
- **Orders filter bar** — added a Contractor multi-select dropdown next to the existing Stage one. Mirrors the same popover + checkbox pattern, backed by `listContractorsLite(false)` (all contractors incl. inactive — consistent with filtering historical orders). URL state piped through the existing `nuqs` schema as `contractor=<uuid>,<uuid>`.
- **New-order dialog Customer step** — added a Contractor combobox below the homeowner picker. "+ Add a new contractor" opens a lightweight inline mini-form with just name + payment terms. On create it calls `createContractor`, merges the new row into local state, and auto-selects it — the in-progress order form state is preserved. Full-field editing still goes through `/contractors/[id]`. Flagging in DEVLOG because the brief asked for "opens the contractor-create dialog inline"; I went with the inline mini-form instead of nested Dialog because the nested path was more code for the same effect.
- **Order detail sheet** — in the Overview tab, new Contractor row right under the Customer row. If set: contractor name is a link with a "Change" button that opens a Popover+Command picker with a "Clear contractor" action. If unset: "No contractor" with an "Add contractor" button that opens the same picker. Field role sees the row but no picker (consistent with the column lock we added in 0011).

**Validator changes.** `CreateOrderInput.contractorId: optionalString(uuid).optional()`. `UpdateOrderInput.patch.contractorId: uuid | "" | undefined` — empty string means "clear to NULL", absent means "don't touch", uuid means "set".

**Not altering the dashboard** per Q5 / brief — no new KPIs. The existing "Outstanding balance" KPI remains homeowner-side; see the **Billing side ambiguity** note below for the deferred work.

### Sub-step 7 — edit / delete payment + activity feed (complete)

**Most of this landed inline in sub-step 5.** The record-payment Sheet already handles the edit case (pre-fill + `update_contractor_payment` RPC), and the Payments tab already has an `AlertDialog` for delete with an impact preview. What was missing: the activity feed didn't know how to phrase the three new entity types, and each allocation row was firing its own audit, tripling feed noise.

**Activity feed updates (`components/app/activity-feed.tsx`):**
- New `phraseFor` branches for `contractor:created/updated/deleted`, `contractor_payment:created/updated/deleted`. Payment phrases include the amount via a local `moneyPhrase` helper (USD fixed — the feed doesn't know the org currency, and getting it here for one phrase isn't worth the plumbing).
- Icons: `HardHat` for contractor, `DollarSign` for payment + allocation rows (the latter are hidden but the mapping is ready if we ever show them).
- **Allocation-row hiding.** A user recording one $6,000 payment with two allocations was producing 3 activity rows. The payment row already tells the story; allocations are implementation detail. A `shouldHide(entity_type)` check in the component filters allocation rows out. The audit row itself still exists in the DB — the UI just doesn't surface it. If we ever need to reconstruct allocation history for a specific order, the raw rows are still there.

---

### Billing side ambiguity (deferred)

`orders.balance_due` is the **homeowner-side** figure
(`quote_amount − deposit_received`) regardless of whether a contractor
is tagged on the order. The contractor detail Jobs tab computes a
separate **contractor-side** balance (`quote_amount − sum(allocations)`),
and the two numbers are not reconciled.

**What's actually ambiguous.** In practice, for contractor-referred
jobs, the **contractor** pays, not the homeowner — so
`deposit_received` on those orders often won't match what's happening
financially. Today we don't have a way to express that. A future
design pass needs to add an explicit `bill_to enum('homeowner',
'contractor')` on orders:

- `bill_to = 'homeowner'` (default) — balance_due is authoritative,
  contractor-side balance should always be $0 (if anyone ever
  allocated a contractor payment against it, that was an error).
- `bill_to = 'contractor'` — contractor-side balance is
  authoritative, `balance_due` / `deposit_received` are either
  blanked or re-scoped to the portion the homeowner paid in
  parallel (change orders, upgrades, etc.).

At that point:
- The dashboard "Outstanding balance" KPI can choose a side (or sum
  both, separately labeled).
- The order detail sheet can collapse the confusing
  homeowner-vs-contractor split into one clear "who owes what" row.
- The contractor balance view can assert `o.bill_to = 'contractor'`
  so rogue allocations against homeowner-billed orders don't silently
  warp the totals.

**Until then:** the dashboard KPI stays strictly homeowner-side and
we do not alter it in Task 2B. Contractor balances live in
`/contractors` and `/contractors/[id]` and nowhere else. This is the
correct "don't paper over the ambiguity" move — forcing the data
model decision before it contaminates a KPI is easier than
un-contaminating one later.

### Closing — deferred (Task 2B)

- **Contractor portal** — contractor logs in and sees their own jobs +
  balances. Data shape supports it today (every write carries
  `contractor_id`, RLS boundaries are org-scoped). Design + auth for
  that audience is a separate task.
- **Commission / referral fees** — paying contractors a cut of jobs they
  send in. No data yet; probably lives on `contractors` or a new
  `contractor_commissions` table.
- **Account statements / PDFs** — "print me everything I owe you" for a
  contractor. Straightforward once the data's in place.
- **QuickBooks / accounting sync** — explicit out-of-scope from Task 2B.
- **Bill-to split** — see **Billing side ambiguity** above.

---

### Fix — `balanceClass) is not a function` runtime error (2026-04-25)

**Symptom.** Visiting `/contractors/[id]` (and the New Contractor submit redirect, which lands on the same page) threw `(0 , …contractors_table…balanceClass) is not a function` at server-render time.

**Root cause.** Sub-step 3 (commit `086b989`) defined `balanceClass` and `formatBalance` inside `components/app/contractors-table.tsx`, which has `"use client"` at the top. Sub-step 4 (commit `b954b09`) added `components/app/contractor-header.tsx` as a **server** component and imported those two functions from `contractors-table.tsx`. When a server component imports a named export from a `"use client"` module, Next.js rewrites the import to a **client reference proxy** — fine for components (React knows how to render them), broken for plain functions (calling the proxy throws). I had this exact concern in the sub-step 4 DEVLOG entry and dismissed it ("Next 14 allows pure-value imports to cross the boundary"). That dismissal was wrong.

**Fix.** Moved both helpers to `lib/contractors/balance-display.ts` — a neutral, no-`"use client"` module. Updated three importers (`contractors-table.tsx`, `contractor-header.tsx`, `contractor-jobs-tab.tsx`) to import from the new path. Dropped the dead `export { formatBalance }` re-export from `contractor-header.tsx`. Three call sites is well past the threshold where shared utilities should live alongside one consumer.

**Why typecheck and `next build` both passed with the bug present.** The `.d.ts` info for both files is correct — TypeScript has no model of the `"use client"` runtime import-rewriting and treats the imported identifier as a normal function. `next build` compiles the module graph and prerenders **static** routes, but `/contractors/[id]` is a dynamic route (`ƒ` in the build output) so it's never executed at build time. The module graph alone doesn't surface the proxy mismatch — you have to actually run the server-render. So the gate that should have caught this was a runtime smoke test, which Task 2B never had.

**The new gate: `scripts/smoke_contractor_render.ts`.** Signs in via the same `@supabase/ssr` `createServerClient` the app uses (with an in-memory cookie jar — no fs writes), then `fetch`es every contractor route through a running dev/start server with the auth cookies attached. Fails on any 5xx or known runtime-error substring. Verified the gate works:

1. With the fix in place: all 6 routes return 200, no error markers in body.
2. With the bug reintroduced (re-exported `balanceClass` through the client module): typecheck still passed, `next build` still passed, but the smoke check returned 500 on every `/contractors/[id]` route. Restored the fix and re-ran — all 6 routes back to 200.

**Operational footnote.** During the verification dance I also discovered a second false-failure mode: running `pnpm build` while `next dev` is alive clobbers `.next/`, after which dev requests 500 with a stale `MODULE_NOT_FOUND: ./vendor-chunks/<pkg>.js`. Not a code bug — a workflow gotcha. Run build after stopping dev, or wipe `.next` and restart dev when the two collide.

**What this means for the rest of Task 2B.** Almost certainly nothing else trips the same boundary — `contractor-header.tsx` was the only server component that imported a non-component value from a client module. But to be sure, a future cleanup task could add an ESLint rule that flags `import { … } from "<file with 'use client'>"` from server components. Out of scope here.

---

## Task 2A — Orders UX fixes from real-world use (2026-04-23)

Five fixes from Sriya's day using Task 1 at Top Marble. See `PLAN.md` for the sub-step breakdown.

### Sub-step 1 — rename `qc` → `ready_for_install` (complete)

**Why.** "QC" is fabrication-tool language; shop operators don't think in "quality control". The real stage between fabrication and installation is "Ready for Installation" — pieces cut, polished, wrapped, staged for pickup or loaded on the truck. Rename is about restoring shop-operator vocabulary.

**What changed.**
- `0008_rename_qc_stage.sql` — `ALTER TYPE order_stage RENAME VALUE 'qc' TO 'ready_for_install'` inside a transaction. Surgical rename on the ENUM; existing rows read as the new name automatically (no data UPDATEs). Verified via DB query: 1 `ready_for_install`, 0 `qc` rows post-seed.
- Prisma `OrderStage` enum updated; client regenerated.
- `ORDER_STAGES` (zod enum) and `STAGE_ORDER` (pipeline/board ordering) both updated. Position preserved: between `fabrication` and `installation`.
- `STAGE_LABELS` gets the full label **"Ready for Installation"**. Introduced a new `STAGE_SHORT_LABELS` map with **"Ready for Install"** for space-constrained contexts (kanban column headers, pipeline strip). Also switched the kanban column headers and pipeline strip labels to use the short map so long stage names don't wrap.
- Badge color: amber/yellow (`bg-amber-100 text-amber-900` light / `bg-amber-900 text-amber-100` dark) for `ready_for_install`. Had to move `measurement` from amber to violet (the color previously used by `qc`) to keep each stage visually distinct. The amber "waiting/staged" cue now semantically matches the "pieces ready, waiting to go out" mental model — felt right.
- `supabase/seed.ts` — the one seeded order at `stage: "qc"` became `stage: "ready_for_install"`.
- Grep verification: zero `'qc'` / `"qc"` hits in `app/`, `components/`, `lib/`, `prisma/`, or `supabase/seed.ts`. Historical migration 0001_init.sql intentionally retains the original string (it defined the enum; reading it doesn't require editing it).
- **KPI review on the dashboard:** none of the four cards enumerated `qc` by name; all used broad `NOT IN (paid, cancelled)` or specific-stage conditions. Ready-for-install orders correctly flow through "Installs this week" (if scheduled) and are not counted as "In fabrication". No KPI code changes needed.

**Not in scope.** Rename of the Postgres enum label alone — not the stage itself or its semantics. Stage transitions before/after remain the same.

### Sub-step 2 — bidirectional stage changes with reason (complete)

**Why.** Orders don't only move forward. Customers reschedule installs, slabs crack, a quote flips back to measurement. The old "Advance stage →" button only went forward, and no history captured *why* a stage changed. Every transition now requires a 3–500 character reason that's recorded in `order_stage_history.note` and shown inline in the Activity feed.

**Shape of the fix.**
- **`0009_stage_change_with_reason.sql`** introduces a new RPC `change_order_stage(p_order_id, p_to_stage, p_note)`. The RPC validates the note length, calls `set_config('app.stage_change_note', p_note, true)` (transaction-local), then runs the `UPDATE orders`. The already-existing `tg_orders_after_update` now reads that GUC via `current_setting('app.stage_change_note', true)` and writes the note into both `order_stage_history.note` and the `activity_log.metadata.note` JSON.
- **Pattern note for future triggers:** this session-GUC pattern is a clean way to pass side-channel context (who/why/from-where) from an RPC down into an AFTER trigger without duplicating the trigger's logic or changing its signature. `set_config(..., true)` keeps the value scoped to the enclosing txn — it's invisible to any other request.
- **Zod `ChangeStageInput.note`** is now strictly required (`.min(3).max(500)`). `UpdateOrderInput.patch.stage` is removed entirely — the only way to move a stage is through `changeStage`, so the audit is never bypassed. The inline FieldEditor for stage on the Overview tab was already gone; the Select-picker now replaces the old "Advance stage →" button.
- **UI:** `components/app/stage-change-dialog.tsx` is a shared Dialog with an autofocused Textarea and a live char counter. The order detail sheet swaps "Advance stage →" for a `Select` of every stage (current is the default). Picking a different stage opens the dialog; cancel resets the Select back to the current stage. On the kanban board, a drop applies the optimistic move, then opens the same dialog; cancel reverts the optimistic move so the card snaps back.
- **Activity feed** (`phraseFor` in `activity-feed.tsx`) appends `— "{note}"` to the existing `stage_changed` phrase when `metadata.note` is present.

**Verified.** End-to-end with a script that signed in as the demo user and called the RPC — forward, backward, and empty-note-blocked — all three history rows carried the correct note or were rejected by the function's check. Seed replayed cleanly.

### Sub-step 3 — image gallery + lightbox on the Files tab (complete)

**Why.** Most attachments are phone photos — slab closeups, template pickups, install-site photos. The previous Files tab was a flat list that made you download each file to see anything. Now the Files tab leads with a thumbnail grid and a lightbox for full-size browsing.

**Approach.**
- **Batch-signed URLs** — `lib/actions/attachments.ts` gets a `createSignedUrls(paths, ttl = 3600)` helper that calls `supabase.storage.from("order-files").createSignedUrls(…)` in one round-trip. Used by `app/(app)/orders/page.tsx` to pre-sign every photo path on the detail sheet; non-image attachments still use the on-demand `createSignedUrl` on click. Bucket stays private.
- **Classification** — `mime?.startsWith("image/")` → photo (covers `image/jpeg`, `image/png`, `image/heic`, `image/heif`). Everything else → document.
- **`FileGallery`** — responsive grid (`grid-cols-2 sm:grid-cols-3 md:grid-cols-4`), square tiles with `object-cover`. Each tile is an `<img>` with an `onError` fallback that renders an `ImageOff` + "Open" download tile in the same slot (this is the Chromium HEIC path — no server-side conversion this pass).
- **`FileLightbox`** — `fixed inset-0 z-50` overlay, `max-h-[90vh] max-w-[92vw]` image, arrow keys + on-screen chevrons for nav, `Esc` / backdrop click to close, filename + upload date + `n / m` counter at the bottom, Download + Delete + Close in the top-right. Sets `document.body.style.overflow = hidden` while open and restores on unmount.
- **Field-role** keeps Download; Delete is hidden (`onDelete` omitted) for read-only roles.
- **Photos with a null signed URL** (sign failure) still appear in the grid as the same HEIC-fallback tile — click opens the download flow rather than crashing the lightbox.

**Deferred.** Server-side HEIC → JPEG (would need `libheif` / `sharp-heif`); client-side decode libraries like `heic2any` (weight not justified for Task 2A). Shop owners on Safari see thumbnails immediately; Chrome users on HEIC see a download tile until we revisit.

### Sub-step 4 — surface notes on table + detail sheet (complete)

**Why.** `orders.notes` existed in the schema but was buried at the bottom of the detail sheet as a three-row Textarea. In practice it's the most valuable free-text field on an order — "slab going out Tuesday, call shop before arriving" — and needed to be readable and editable from both the table (fastest path) and the sheet (when you're already there).

**Changes.**
- **`0010_notes_activity.sql`** splits the update-audit path:
  - Notes-only change → `activity_log.action = 'notes_updated'`, metadata carries `{ order_number, length_before, length_after }` — no note text, ever.
  - Mixed edits → existing `'updated'` path with a field diff, but `notes` is excluded from that diff (so full text never leaks even when bundled).
  - Stage change → unchanged (`'stage_changed'` from 0009).
- **`lib/queries/orders.ts`** — `getOrderDetail` now returns `{ detail, lastNotesEdit }`. `lastNotesEdit` is the most recent `notes_updated` activity row (actor name + timestamp). One extra `activity_log` query in the existing parallel fetch; one lightweight `profiles` lookup for the actor.
- **`lib/queries/orders.ts` `OrderListRow`** gains `notes` so the table can render inline without a second round-trip.
- **`components/app/notes-popover.tsx`** — shared popover (Textarea, 6 rows, maxLength 4000). Save on blur or Cmd/Ctrl+Enter via `updateOrder({ patch: { notes } })`. Optimistic + toast.
- **Orders table** — new 36px column between Project and Stage, with a `NotesCell` that switches on `hasNotes`:
  - **No notes:** muted `Plus` icon → opens the Popover.
  - **Has notes:** `StickyNote` icon in `text-brand` → HoverCard (trimmed to 400 chars, `whitespace-pre-wrap`) on hover; click opens the Popover. Clicks on the cell don't bubble to the row (the row's click opens the full detail sheet, which is what we DON'T want here).
- **Detail sheet Overview tab** — removed the old bottom Notes field. Added a `NotesCard` at the top of the tab: 6-row auto-growable Textarea, Cmd/Ctrl+Enter to commit, right-aligned footer reads "Last edited by {actor} · {Nm/Nh/Nd ago}" or "Not edited yet". Uses the existing `updateOrder` → AFTER UPDATE trigger flow; the new `notes_updated` activity row drives the "last edited" footer on the next render.
- **shadcn `hover-card` added** for the table's HoverCard preview.

**Not in scope.** Structured markdown / @-mentions / attachment-from-note (Task 2B considerations at most).

### Sub-step 5 — readable install dates on kanban + table (complete)

**Why.** At the shop, the install date on a kanban card was rendered as a tiny grey `MMM d` string — unreadable from across the room, no signal for "due today" vs "overdue" vs "nothing scheduled yet". Couldn't schedule from it.

**What changed.**
- **New shared component `components/app/install-date.tsx`** — `<InstallDate value={iso|null} stage={OrderStage} size="sm"|"md" />`:
  - `null` → "— not scheduled", muted.
  - today → `text-brand` + `font-bold`.
  - past AND stage ∉ {`installation`, `invoiced`, `paid`, `cancelled`} → `text-destructive` + `font-bold`.
  - 1–7 days out → `text-foreground` + `font-semibold`.
  - further out → `text-muted-foreground`.
  - Format: `format(d, 'EEE, MMM d')`; appends `, yyyy` only if the date isn't in the current year.
  - Calendar icon prefix.
- **Kanban card** (`orders-board.tsx`) — swapped the old 11px grey span for `<InstallDate size="md" />`. Kept the balance on the right; removed the local `formatDate` helper and the `date-fns` import (now unused in that file).
- **Orders table** (`orders-table.tsx`) — Install column uses `<InstallDate size="sm" />`. Widened the column to 160px so "Thu, Apr 30" fits without wrapping. Removed the local `formatDate` helper.
- **Contrast** — tones use existing `text-brand` / `text-destructive` / `text-foreground` / `text-muted-foreground` tokens, which are already tuned for both light and dark mode.

**Post-install behaviour.** `cancelled` is included in `POST_INSTALL_STAGES` so a cancelled order with a past date doesn't glow red — cancelled jobs shouldn't broadcast "overdue" across the board.

---

## 2026-04-22 — Dashboard redirect loop (RLS policy + swallowed error)

### The bug in plain English
After logging in as the seeded demo owner, Chrome bounced between `/dashboard` and `/onboarding` about 60 times until it throttled and rendered blank. The DB was fine (profile had `active_org_id`, org existed, membership was accepted, everything) so the guard logic itself had to be disagreeing about the same data.

Root cause was two problems stacked together:

1. **An RLS policy that touched `auth.users`.** The `org_members_select` and `org_members_update` policies had an inline subquery — `(SELECT email FROM auth.users WHERE id = auth.uid())` — used to match pending invites by email. The `authenticated` role has no privilege on `auth.users`, so every query against `org_members` from an authenticated caller failed with `permission denied for table users`. Accepted members were getting bounced on the first `OR` term of the policy even though the second term (`user_id = auth.uid()`) would have matched.

2. **Guard code that swallowed `.maybeSingle()` errors.** `getCurrentUserAndOrg` destructured `const { data: member } = …` and branched on `!member`. A real "no row" and "policy exploded" looked identical — both led to `redirect("/onboarding")`. `/onboarding` saw `active_org_id` set → `redirect("/dashboard")`. Loop.

### Why the original RLS design was wrong
I wrote the policy assuming "as the authenticated user, I can read my own `auth.users.email`" — which is true of many Postgres tables but not `auth.users`. Supabase locks `auth.users` down to the service role specifically because apps should never expose raw auth rows to client queries. The correct source for JWT-scoped claims is `auth.jwt()`, which reads `request.jwt.claims` — no privilege on `auth.users` required, and it returns the same email the session was issued for.

### Fixes (migration 0007 + `lib/supabase/errors.ts`)
- Replaced both subqueries with `auth.jwt() ->> 'email'`. Same semantics for accepted members; pending-invite email matching works for signed-in invitees.
- Added `assertNoQueryError(queryName, error)` and threaded it through `getCurrentUserAndOrg` and the onboarding page guard. Any PostgREST error now throws a readable exception instead of silently becoming "no row".

### General rule going forward
> **RLS policies must never subquery `auth.users` (or anything the `authenticated` role can't `SELECT`). Use `auth.jwt()` claims or a `SECURITY DEFINER` helper function.**

Checklist for future RLS migrations:
- [ ] Does this policy touch any table the `authenticated` role can't select from?
  - If yes → rewrite using `auth.jwt()` (for claims like `email`, `sub`, `role`) or wrap the access in a `SECURITY DEFINER` SQL function.
- [ ] Does the policy have an `OR` chain where one branch might error instead of returning false? (The policy is only as safe as its noisiest branch — Postgres doesn't reliably short-circuit when evaluating for planner purposes.)
- [ ] Before merging, sign in as a non-admin test user and hit every gated query with the RLS-scoped client (`scripts/diagnose_auth.ts`).

### Audit of remaining silent-error sites
I also looked for the same `{ data } = await supabase.from(...)` pattern elsewhere. Callers in `lib/actions/**` all check `error` already. Callers in server components that affect **redirect decisions** were updated. The remaining cases are cosmetic — a query failure would leave a list empty instead of crashing — and I left them as-is pending your call on whether to harden them in this PR:

| File | Query | Effect on failure |
|---|---|---|
| `app/(app)/layout.tsx:26` | `org_members.select("organizations(...)")` for sidebar switcher | Sidebar switcher would show only the active org (we already have a fallback for that) |
| `app/(app)/settings/page.tsx:42` | `org_members.select(...)` for the Members tab | Members tab empty |
| `app/(app)/dashboard/page.tsx:124` | `profiles.in("id", actorIds)` for actor names | Activity feed shows "—" for actor initials |
| `app/(app)/orders/page.tsx:114` | Same pattern for detail sheet Activity tab | Same |
| `app/invite/[token]/page.tsx:29` | `org_members.select()` via admin client | Invite page shows "Invite not found" |
| `lib/actions/settings.ts:186` | `admin.from("profiles").select("active_org_id")` inside `acceptInvite` | Fallback "set active_org_id if missing" always fires (harmless) |

### Unrelated noise (noting for record)
Startup logs showed `AuthApiError: Invalid Refresh Token: Refresh Token Not Found` 4× on a fresh browser session. That's `@supabase/ssr` trying to refresh a missing session on the first anonymous request to the middleware + protected pages. `getUser()` returns `{ user: null, error }`, our code only reads `user` (null → redirect to `/login`, expected). Not contributing to the loop; harmless log noise.

### New debugging asset
`scripts/diagnose_auth.ts` — takes `DIAGNOSE_EMAIL` / `DIAGNOSE_PASSWORD` from env, signs in via the anon client, and runs the three queries `getCurrentUserAndOrg` runs. Surfaces errors separately from empty data. Kept in the repo, documented in the README "Debugging" section. This is the first thing to run next time someone says "I logged in but can't see anything."

---

## 2026-04-22 — Seed fix: audit trigger vs. org cascade

### Symptom
`pnpm db:seed` failed on `prisma.organization.deleteMany()` with
`Foreign key constraint violated on the constraint: activity_log_org_id_fkey`.

### False lead (worth flagging)
The user's initial theory was "activity_log.org_id is missing `ON DELETE CASCADE`." I introspected `pg_constraint` directly against the live DB and confirmed **every org-scoped child FK already has CASCADE** (the source in 0001_init.sql matches reality). So dropping and re-adding FKs would have been a no-op that masked the real bug.

### Actual root cause
The AFTER DELETE audit triggers in `0005_storage_policies.sql` on `orders`, `customers`, and `order_attachments` each `INSERT INTO activity_log (org_id, …)` using `OLD.org_id`. When an organization is cascade-deleted, those triggers fire for every child row, but by the time the trigger's INSERT runs, Postgres has marked the parent organizations row as gone. The INSERT therefore violates `activity_log_org_id_fkey`. The verb in the error message (`insert or update on table "activity_log"`) was the tell — it's an INSERT, not the cascade DELETE, that failed.

### Fix (migration `0006_cascade_audit_fix.sql`)
1. **Guard each AFTER DELETE audit trigger** with `IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN RETURN OLD`. Normal single-entity deletes still write a `'deleted'` audit row; cascade deletes skip the audit (the org and its `activity_log` are being wiped anyway).
2. **Address the polymorphic-cascade question.** `activity_log.entity_id` is a plain uuid, so it has no FK — individually deleting an order/customer/attachment would otherwise leave dangling activity rows. Added three new `BEFORE DELETE` cleanup triggers that delete matching `activity_log` rows by `(entity_type, entity_id)` before the parent row goes. Combined with the guarded AFTER DELETE, a single-order delete now leaves exactly one trailing `'deleted'` audit row; an org cascade leaves nothing.

### Verification
- `pnpm db:migrate` applies 0006 cleanly.
- `pnpm db:seed` now succeeds. Ran it twice back-to-back to confirm idempotence.
- Added `scripts/fk_audit.ts` (reusable: prints every public-schema FK with its `ON DELETE` action) for future FK sanity-checks.

---

## 2026-04-20 — Project kickoff

### Decisions
- **Supabase hosted** (not local). User creates the project and pastes env vars when migrations are ready.
- **Pattern A for data access.** All app-path reads/writes go through the `@supabase/ssr` client so RLS enforces tenancy. Prisma is used for: TypeScript types, structural schema (kept in sync via `prisma db pull` after migrations), and the seed script (running as the service role, bypassing RLS).
- **Supabase CLI is the migration source of truth.** Hand-written SQL lives in `/supabase/migrations/*.sql`. Prisma schema is regenerated from the DB, not the other way around.
- **`package.json` scripts:**
  - `db:migrate` → `supabase db push`
  - `db:generate` → `prisma db pull && prisma generate`
  - `db:seed` → `tsx supabase/seed.ts` (uses `SUPABASE_SERVICE_ROLE_KEY`)
  - `db:reset` → `supabase db reset`
- **Order numbering extended:** `organizations` gains two columns beyond the spec — `order_prefix text` (default `upper(left(slug, 2))`) and `order_seq_start int default 1000`. `generate_order_number(uuid)` uses a dedicated `org_order_seq(org_id PK, next_seq int)` row locked with `SELECT ... FOR UPDATE`, returning `greatest(next_seq, max(existing_order_seq) + 1, order_seq_start)` and writing back `next_seq + 1`. Both fields are editable in Settings → Shop.
- **Google OAuth** is wired in code but will return a provider-not-configured error until the user enables it in their Supabase dashboard. Email+password is the tested path.

### Assumptions
- Node 24 and pnpm 10 are fine for Next 14 App Router. If we hit a compatibility issue I'll flag it.
- Neutral color + New York variant for shadcn/ui. Accent color (`#4A5D7E`) applied via CSS variable override after `shadcn init`.
- Invite links are unsigned UUIDs — not cryptographically strong, but good enough for Task 1 (no email delivery yet). DEFERRED: upgrade to signed tokens or one-time codes when email is wired up.

### Sub-step 1 — scaffold (complete)
- Next 14.2.35, React 18.3.1, TS 5.9.3, Tailwind 3.4.19
- `tsconfig.json` tightened: `noUncheckedIndexedAccess`, `noImplicitOverride`, `forceConsistentCasingInFileNames`, `target: ES2022`
- `.eslintrc.json` enforces: no `any`, no `@ts-ignore`/`@ts-nocheck`, no `console.log` (warn/error allowed), type-only imports
- `lint` script uses `--max-warnings 0` so warnings fail the check
- **Note:** first commit `da920cb` was accidentally authored as "Claude <claude@example.local>" because I set a local git config before realizing the user had a global identity. Local override has been unset. `git commit --amend --reset-author --no-edit` will fix authorship if you want it.

### Sub-step 2 — deps + shadcn (complete)
- **Pinned `shadcn@2.10.0`** instead of `@latest`. The current npm `@latest` tag resolves to `shadcn@4.3.1`, which is a major rewrite that swaps Radix UI for `@base-ui/react` and uses a preset-based theming system incompatible with the spec's "neutral base color" language. v2.10 matches the design target (Radix primitives, CSS variables, new-york style, base-color neutral). Revisit only if we intentionally migrate to shadcn 4.x.
- **Tailwind / CSS var format fix.** shadcn 2.10's `init --defaults` writes CSS vars as `oklch(...)` but left the scaffolded `tailwind.config.ts` with `hsl(var(--X))` wrappers, which would render as `hsl(oklch(...))` — invalid CSS. Rewrote the Tailwind config to reference `var(--X)` directly. Also added the missing `--destructive-foreground` var that Button and Badge both reference.
- **Brand accent.** Added `--brand` / `--brand-foreground` CSS vars (stone slate blue, computed in OKLCH from #4A5D7E ≈ `oklch(0.46 0.04 252)` light / `oklch(0.72 0.04 252)` dark) and a `brand` color in Tailwind. Focus ring (`--ring`) is bound to the same color. `--primary` intentionally kept as dark neutral — Linear/Ramp feel, one accent used sparingly.
- **Fonts.** Inter + JetBrains Mono via `next/font/google` as `--font-sans` / `--font-mono`. Removed the scaffold's local Geist `.woff` files.
- **Components added** (in `components/ui/`): button, input, label, textarea, select, dialog, sheet, table, badge, tabs, command, dropdown-menu, avatar, form, skeleton, separator, checkbox, tooltip, popover, calendar, scroll-area, alert-dialog, sonner.
- **Root layout.** `ThemeProvider` (next-themes, class attr, light default) + `Toaster` (sonner wrapper, top-right, rich colors) mounted in `app/layout.tsx`. `suppressHydrationWarning` on `<html>` for the theme class swap.
- **`.gitignore`** tightened to ignore `.env` and `.env.*` with `!.env.example` exception.
- **`lucide-react@1.8.0`** — confirmed via `npm view` that lucide-react shipped 1.x in late 2025, so this is the correct modern version (not a fork or typo).
- **pnpm build** passes cleanly (5 static routes, ~96 kB first-load JS on `/`).

### Sub-step 3 — database schema (complete pending user env vars)
- **Prisma downgraded 7.7.0 → 6.19.3.** Prisma 7 removed `url` / `directUrl` from `datasource` and now requires a separate `prisma.config.ts` with adapter or accelerateUrl. That is a much larger API rewrite than makes sense to fight during Task 1; pinning to 6.19.3 (latest 6.x) keeps the familiar schema config and matches every tutorial / example. Revisit only if we deliberately migrate to Prisma 7.
- **Migrations (5 files).** Tables, enums, indexes, RLS helpers in 0001; full RLS policies + field-role column-guard trigger in 0002; `generate_order_number()` with `FOR UPDATE` + `greatest(next_seq, max existing, order_seq_start)` in 0003; `balance_due` trigger in 0004; storage bucket + RLS + all audit triggers (activity_log + order_stage_history) in 0005. Every audit trigger function is `SECURITY DEFINER` so it bypasses the otherwise-empty INSERT policies on `activity_log` and `order_stage_history`.
- **Postgres enums for stage / priority / role / attachment_kind** instead of CHECK constraints on text — Prisma and Supabase's TS codegen both surface Postgres enums as narrow union types.
- **`order_prefix` default.** A BEFORE INSERT trigger fills `order_prefix` when the caller leaves it blank, using `upper(left(regexp_replace(slug, '[^a-zA-Z]', '', 'g'), 2))`. Settings → Shop will surface the value so shops can override.
- **Field-role column enforcement** done via `BEFORE UPDATE` trigger that raises `42501` if the caller's role is `field` and any column other than `stage` / `notes` changed. Postgres RLS can't express column-level permissions.
- **`org_order_seq`** is closed behind empty RLS + the `SECURITY DEFINER` `generate_order_number` function, so app code cannot touch it directly.
- **Storage path convention** `{org_id}/{order_id}/{uuid}-{filename}` is enforced by RLS on `storage.objects` using `(storage.foldername(name))[1]::uuid` → `is_org_member()`.
- **Seed (`supabase/seed.ts`).** Idempotent: deletes the existing `top-marble-granite` org + demo user, then creates fresh. Demo login `owner@topmarble.local` / `StoneDemo!2026`. Org slug `top-marble-granite` with **explicit `order_prefix='TM'`** and `order_seq_start=1042` so the first order is `TM-1042` matching the spec example. 8 customers + 10 orders distributed across every stage, realistic stone types and edge profiles.
- **`prisma.seed` scripts.** `db:generate` (generate client only), `db:pull` (introspect from DB), `db:migrate` (`supabase db push`), `db:reset` (`supabase db reset`), `db:seed` (`tsx --env-file=.env.local supabase/seed.ts`). A `postinstall: prisma generate` keeps the client up to date on fresh clones.
- **`lib/db.ts`** is a Prisma singleton — used only by the seed and any future service-role jobs. Server actions must not import it (RLS would be bypassed).
- **Not applied yet.** Files exist but nothing has run against a real Supabase project. User action required: create project, paste env vars, install Supabase CLI, `supabase link --project-ref <ref>`, `pnpm db:migrate`, `pnpm db:seed`.

### Sub-step 4 — auth + Supabase clients + onboarding (complete)
- **Supabase client wrappers (`lib/supabase/{server,client,middleware}.ts`).** Server and middleware factories pull env vars via a small helper that throws early if missing. The server client silently swallows `cookieStore.set` exceptions so RSC renders don't crash — middleware is the canonical place for session refresh.
- **Row types (`lib/supabase/types.ts`).** Manual snake_case mirrors of each Postgres table, consumed as `.maybeSingle<ProfileRow>()` generics so the JS client returns typed rows without needing `supabase gen types`. Prisma types are kept only for enums.
- **`middleware.ts`** (project root) runs `updateSession` on every non-asset request, then: protected prefixes without a user → `/login?next=…`; signed-in user hitting `/login` or `/signup` → `/dashboard`. Matcher excludes `_next/static`, `_next/image`, `favicon.ico`, and common image extensions.
- **`lib/auth.ts`** exposes `getCurrentUserAndOrg()` as the canonical accessor for `(app)` pages — returns `{ userId, email, profile, org, role }` or redirects to `/login` / `/onboarding` as appropriate. `getCurrentUser()` is a thin non-redirecting helper.
- **`lib/rbac.ts`** wraps the role hierarchy (`owner > admin > manager > field`) and provides `canManageMembers` / `canEditOrganization` / `canManageCustomers` / `canCreateOrder` / `canDeleteOrder` etc. so UI code stays declarative.
- **Auth routes.** `/login`, `/signup` (both with email+password + Google OAuth buttons), `/callback` (OAuth return → `exchangeCodeForSession`), `/logout` (POST-only, signs out → `/`). Route-group note: `(auth)/callback/route.ts` maps to `/callback`, not `/auth/callback` — initial draft had this wrong and was corrected.
- **`/onboarding`** (outside `(app)` since it runs before an org exists). Server component verifies user + no active org, client form auto-derives slug from shop name and `order_prefix` from slug until the user types in those fields. Submits to `completeOnboarding` server action which: upserts profile, creates org (empty `order_prefix` is filled by the BEFORE INSERT trigger), inserts owner membership (bootstrap RLS path), sets `active_org_id`, and revalidates the root layout. Returns `{ ok, error, fields? }` for client-side toasting.
- **`(app)/layout.tsx`** is a gate that calls `getCurrentUserAndOrg()` so every child page inside the group can trust the context. Full shell (sidebar, top bar, cmd-K) lands in sub-step 5.
- **`(app)/dashboard/page.tsx`** — placeholder that prints org name, signed-in user, and role, plus a sign-out link. Real content in sub-step 6.
- **Google OAuth** wired but will surface a provider-not-configured toast until the Supabase project enables the provider. Email+password is the tested path.

### Sub-step 5 — app shell (complete)
- **`(app)/layout.tsx`** fetches auth, org, membership list, and the `sb_collapsed` cookie, then renders `<Sidebar>` + a scrollable main column with `<Topbar>` above `{children}`.
- **Sidebar** is a client component that persists its collapsed state via a cookie (`sb_collapsed=1|0`, max-age 1 yr) so SSR and CSR agree. Collapsing swaps the width 240→56 px and hides labels; nav items become tooltips in collapsed mode.
- **Org switcher** is a Popover + Command combobox (search + select). `switchActiveOrg` server action updates `profiles.active_org_id` after verifying membership; `router.refresh()` re-runs the server layout with the new org. "Create new shop" jumps to `/onboarding`.
- **Sidebar nav** drives active highlight via `usePathname()`. Active route gets `bg-sidebar-accent` + a tiny `bg-brand` dot on the right edge. Coming-soon items (Inventory, Schedule, Invoices, Team) are disabled buttons wrapped in a Tooltip that reads "<name> — coming soon".
- **User menu** combines an avatar dropdown (sign-out only for now) and the theme toggle in the sidebar footer. Sign-out is a POST form to `/logout` so GET prefetch doesn't accidentally kill the session.
- **Theme toggle** is a Sun/Moon icon button with a dropdown of Light / Dark / System, wired through next-themes.
- **Topbar** (sticky, backdrop-blurred) contains breadcrumbs on the left and the ⌘K search trigger + "+ New" dropdown on the right.
- **Command palette.** ⌘K / Ctrl+K toggles. Debounced 180 ms to a `globalSearch` server action that queries `orders` (by `order_number` / `project_name` / joined customer name) and `customers` (by `name` / `company`) with `ilike` patterns, capped 8+8, ordered by `updated_at` / `name`. RLS ensures cross-org isolation. Selecting an order routes to `/orders?order=<id>`; selecting a customer routes to `/customers?id=<id>` (real detail sheets in sub-steps 7–8).
- **New menu** routes `/orders?new=1` and `/customers?new=1`; the target pages will pick up the query param and auto-open their creation dialogs in sub-steps 7–8.
- **Stub pages** created for `/orders`, `/customers`, `/settings` so the nav links don't 404 while we wait for sub-steps 7–9.
- **pnpm build** still green across 11 routes.

### Sub-step 6 — dashboard (complete)
- **Single orders query, JS aggregate.** The 4 KPIs and the pipeline strip all derive from the same `SELECT id, stage, project_name, scheduled_install_date, quote_amount, balance_due FROM orders` plus the activity feed query — two round-trips total, issued in `Promise.all`. For shops with <10k orders this is faster than 4 separate aggregate queries and simpler to reason about.
- **Money values** come back as numeric strings from PostgREST; `toNumber()` helper parses defensively. Currency formatted via `Intl.NumberFormat` using the org's `currency` setting, with `maximumFractionDigits: 0` (shop owners read totals, not cents).
- **KPI definitions:**
  1. **In fabrication** — count + sum(quote_amount) where `stage = 'fabrication'`.
  2. **Installs this week** — orders with `scheduled_install_date` in `[today, today+7]` excluding paid/cancelled. Sublabel lists the first 3 project names and "+N more".
  3. **Awaiting measurement** — `stage IN ('quote','measurement')`. (Spec says "awaiting measurement"; including `quote` surfaces orders where the quote was sent but measurement hasn't happened — more useful operationally.)
  4. **Outstanding balance** — sum(balance_due) where `stage NOT IN ('paid','cancelled')`.
- **Pipeline strip** renders all 7 non-cancelled stages with count + summed quote_amount per stage. Each stage is a link to `/orders?stage=<stage>` so the full orders page (sub-step 7) can pre-filter.
- **Activity feed** reads the last 15 `activity_log` rows, batches a single `profiles.in(actor_ids)` lookup for names, and renders phrase templates keyed on `${entityType}:${action}` (created / stage_changed / updated / deleted / uploaded). Timestamps via `date-fns.formatDistanceToNow`.
- **No realtime yet.** Per deferred list — the dashboard is a static server render that needs a refresh to pick up new activity. Sub-step 6b could layer Supabase Realtime on top when wanted.

### Sub-step 7 — orders (complete)
- **Validators (`lib/validators/orders.ts`).** `CreateOrderInput`, `UpdateOrderInput` (every patch field `.optional()` so inline-edit can send single-field patches), `ChangeStageInput`, `BulkChangeStageInput`, `DeleteOrderInput`. `optionalString()` and `moneyNumber` helpers handle empty-string / null / undefined normalization so the UI can send whatever makes sense.
- **Server actions (`lib/actions/orders.ts`).** `createOrder` (resolves inline-customer insert, calls `generate_order_number` RPC, inserts the order), `updateOrder` (camelCase → snake_case patch mapping), `changeStage`, `bulkChangeStage`, `deleteOrder`. All return `{ ok: true, data } | { ok: false, error }`; triggers in the DB handle `activity_log` + `order_stage_history`.
- **Attachment actions (`lib/actions/attachments.ts`).** `registerAttachment` after direct browser upload to the `order-files` bucket; `deleteAttachment` removes both storage object and DB row; `createSignedUrl` issues 10-minute signed URLs for downloads.
- **`/orders` server component** reads searchParams (`stage`, `q`, `view`, `sort`, `dir`, `page`, `order`, `new`), fetches list + optional detail/activity/attachments in parallel, and passes everything to client pieces.
- **Filter bar** is a client component with nuqs (`stage` array, `q` debounced 250 ms, `view`, `sort`, `dir`, `page`). `shallow: false` triggers a server re-render on each change.
- **Table view** has sortable columns (sort keys: orderNumber, customer, project, stage, install, balance, updated), server-side pagination 50/page, row click opens the detail sheet. Empty-state has clear CTA. Bulk actions are NOT in this sub-step (flagged deferred).
- **Board view** uses @dnd-kit/core — 7 stage columns (excluding cancelled), drag-and-drop with optimistic local state. On drop, `changeStage` server action fires; on failure the UI reverts and a toast surfaces the error. Column capacity is limited to 500 rows so very large shops will need paging — acceptable for Task 1.
- **New Order dialog (4 steps)** — Customer (Combobox with inline "Add new" form), Project (name/stone/edge/sqft/cutouts), Money (quote + deposit with live balance preview), Schedule (dates + priority). Open state driven by `?new=1`, closes by stripping the param. Uses react-hook-form + zod resolver.
- **Order detail sheet.** Opens on `?order=<id>`. Three tabs: Overview (field-level inline edit that saves on blur; field-role gets read-only inputs with a banner), Files (dropzone uploader + list with signed-URL download), Activity (filtered `activity_log` for this order, reusing the dashboard's ActivityFeed component). "Advance stage →" button auto-targets the next non-cancelled stage. Delete gated by `canDeleteOrder(role)` and uses AlertDialog confirm.
- **File uploader.** Drag+drop or click to select; validates MIME (PDF/JPG/PNG/HEIC) and 25 MB cap; uploads to `{org_id}/{order_id}/{uuid}-{filename}` via the browser Supabase client; then calls `registerAttachment` server action. On register failure, best-effort cleans up the uploaded object.
- **Stage badge** component provides per-stage color chips used on table rows, board cards, and the detail sheet header.
- **Deferred within sub-step 7 (for follow-up, not Task 1 blockers):** bulk-change-stage UI (server action is ready), assignee picker (requires a team-members query; field kept as `uuid` text input for now — actually deferred: no assignee picker in this pass), inline edit of `customer_id` / `assigned_to` (kept read-only in the sheet; change via dialog is the workaround).
- **pnpm build** shows 11 routes; `/orders` first-load JS is ~299 kB (dnd-kit + RHF + zod + dialog surface area — acceptable for a power tool).

### Sub-step 8 — customers (complete)
- **Validators (`lib/validators/customers.ts`)** + **actions (`lib/actions/customers.ts`)**: `createCustomer`, `updateCustomer` (fully partial patch), `deleteCustomer`. RLS prevents field-role from writing.
- **Queries (`lib/queries/customers-full.ts`):** `listCustomersWithOrderCount` uses PostgREST embed `orders(id, created_at)` so a single round-trip returns each customer's order rows; JS aggregates count + last-order date. `getCustomerDetail` parallel-fetches the customer and its order rows.
- **`/customers` page** renders a table (Name / Company / Phone / Email / Order count / Last order). Row click → detail sheet with Orders (linking into `/orders?order=<id>`, closes the sheet on navigation) and Info (inline-edit fields + notes) tabs. Delete gated by `canManageCustomers(role)`.
- **New customer dialog** uses shadcn Dialog + RHF + zod. Open state driven by `?new=1`; "+ New" button in the header links there.
- **`pnpm build`** — 11 routes, `/customers` at ~186 kB first-load.

### Sub-step 9 — settings + invite (complete)
- **`lib/supabase/admin.ts`** exposes a service-role client for strictly server-only paths (accepting an invite token, reading member auth-emails for the Members tab). Marked `server-only`; importing from client code fails at build.
- **Validators + actions (`lib/validators/settings.ts`, `lib/actions/settings.ts`)** — `updateProfile`, `updateOrganization`, `inviteMember` (generates `inv_<hex>` tokens), `updateMemberRole`, `removeMember`, `acceptInvite`.
- **`/settings` page** uses shadcn Tabs with three tabs: Profile (everyone), Shop (owner/admin), Members (owner/admin). Tab is URL-driven via `?tab=`; RBAC redirects if a user tries to deep-link to a tab they can't access.
- **Profile tab** — react-hook-form, updates display name / phone / theme. Applies theme via `next-themes.setTheme` immediately so the toggle effect matches what the user picked.
- **Shop tab** — name / timezone / currency / order prefix / starting sequence. Slug intentionally read-only (migrating slugs breaks stored invite links; deferred). The trigger on `organizations` also gates bad values (slug is lowercase-only).
- **Members tab** — lists every row in `org_members`. Accepted members show their display name + auth email (fetched via the service-role admin client since RLS on profiles is self-only and auth.users is hidden). Pending invites show the email they were sent to plus a copy-link button that writes `{NEXT_PUBLIC_SITE_URL}/invite/{token}` to the clipboard. Owners can change any non-owner's role and remove them. Owner row and the current-user row can't be removed.
- **`/invite/[token]`** looks up the invite via the admin client. If no session, offers "Log in" (with `?next=/invite/<token>`) or "Create account". If signed in, shows an Accept button that calls the `acceptInvite` server action which: verifies the token, flips `user_id`/`invite_accepted_at`, clears the token, and sets `profiles.active_org_id` if the user didn't have one.
- **Token design.** Tokens are 32-hex UUIDs prefixed `inv_`. Good enough for Task 1; DEFERRED: signed/expiring tokens once email delivery is wired.
- **`pnpm build`** — 12 routes total, `/settings` at ~184 kB first-load; `/invite/[token]` at ~117 kB.

### Sub-step 10 — seed + README + final pass (complete)
- Seed was authored in sub-step 3 and remains unchanged; demo login
  `owner@topmarble.local` / `StoneDemo!2026`.
- `README.md` covers prereqs, Supabase setup, env vars, local run,
  scripts table, project structure, add-a-stage / add-a-role / debug-RLS
  how-tos, and Vercel deployment.
- **Final quality sweep.** No `any`, no `@ts-ignore`/`@ts-nocheck`, no
  `console.log` anywhere in committed code. `pnpm typecheck` / `pnpm lint`
  / `pnpm build` all green.

### Deferred
- Signed/expiring invite tokens (tracked for when email is wired)
- Automated tests (explicitly out of scope for Task 1)
- Rate limiting on auth endpoints
- CSP / security headers beyond Next defaults
- Avatar/logo image resizing (we'll accept upload and use as-is)
- Real-time subscriptions (Supabase Realtime) for kanban — optimistic updates only for now
