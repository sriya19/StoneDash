# DEVLOG — Stone&DesignBoard

Running log of decisions, assumptions, and deferred items. Newest first.

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
