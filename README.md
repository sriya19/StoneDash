# Stone & Design Board

Operations dashboard for stone, marble, granite, and quartz fabrication
shops. Multi-tenant SaaS built with Next.js 14 (App Router), Supabase
(Auth + Postgres + Storage + RLS), Prisma for types, shadcn/ui, Zod,
react-hook-form, @dnd-kit, and nuqs.

---

## Prerequisites

- **Node.js 20+** (tested on 24.10)
- **pnpm 10+** (`npm install -g pnpm`)
- **Git**
- **Supabase CLI** — for applying migrations to the hosted project:
  ```sh
  brew install supabase/tap/supabase    # macOS
  # or: npm install -g supabase           # any OS
  ```
- A **hosted Supabase project** at <https://supabase.com/dashboard>.
  Free tier is fine.

---

## Getting started

### 1. Install dependencies

```sh
pnpm install
```

`postinstall` runs `prisma generate`, so the Prisma client is ready
before the first `pnpm dev`.

### 2. Create a Supabase project

1. Visit <https://supabase.com/dashboard> → **New project**.
2. Pick a region close to your shop. Note the database password.
3. Wait ~2 minutes for provisioning.

### 3. Configure env vars

```sh
cp .env.example .env.local
```

Fill `.env.local` using values from the Supabase dashboard:

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API → `anon` public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` (keep secret) |
| `DATABASE_URL` | Project Settings → Database → Connection string → **URI** (port 5432 direct) |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` in dev; your Vercel URL in prod |
| `SUPABASE_PROJECT_REF` | The subdomain of your project URL, e.g. `abcdefg` |

> **Never commit `.env.local`.** `.gitignore` already excludes it.

### 4. Apply migrations + seed

Link the Supabase CLI to your project once:

```sh
supabase link --project-ref "$SUPABASE_PROJECT_REF"
```

Then:

```sh
pnpm db:migrate   # applies /supabase/migrations/*.sql in order
pnpm db:seed      # creates demo org + 10 orders (idempotent)
```

The seed creates:

- Two demo logins:
  - Owner: `owner@topmarble.local` / `StoneDemo!2026`
  - Field tech: `field@topmarble.local` / `StoneDemo!2026` (use this to try
    the app as an installer — read-only on most surfaces, can mark event
    status only)
- Shop: `Top Marble & Granite` (slug `top-marble-granite`,
  order prefix `TM`, starting at `TM-1042`)
- 8 customers, 10 orders across every stage
- 3 contractors with distinct payment-terms shapes (Running tab / Net 30 /
  Net 60), 5 of the 10 orders tagged, 2 payments split across allocations
  so the contractor detail page has real balances to render
- 5 crew members across the four shop roles (lead installer, helper,
  fabricator, measurement tech); next 3 upcoming installs assigned to
  Carlos + Jorge, one more to Mike + David, rest unassigned
- 2 event share links (one live, one revoked) so the smoke matrix at
  `/j/[slug]` has both resolution cases available

### 5. Enable Google OAuth (optional)

The app's login/signup screens include a **Continue with Google** button
but it will 500 until you enable the provider:

1. Create OAuth credentials at <https://console.cloud.google.com/apis/credentials>.
   Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
2. In Supabase: **Authentication → Providers → Google** → paste client ID
   + secret → Save.

Email+password works out of the box.

### 6. Run

```sh
pnpm dev
```

Open <http://localhost:3000>. Sign in with the demo credentials, or
sign up a fresh account and run through `/onboarding`.

---

## Scripts

| Script | Purpose |
|---|---|
| `pnpm dev` | Next dev server. |
| `pnpm build` | Production build. Same bundler Vercel uses. |
| `pnpm start` | Runs the production build. |
| `pnpm lint` | Next lint with `--max-warnings 0` (ESLint runs in CI mode). |
| `pnpm typecheck` | `tsc --noEmit`. Strict mode + `noUncheckedIndexedAccess`. |
| `pnpm db:migrate` | `supabase db push` — pushes `/supabase/migrations/*.sql` to the linked project. |
| `pnpm db:pull` | `prisma db pull` — regenerates `prisma/schema.prisma` from the current DB. Use to check drift. |
| `pnpm db:generate` | `prisma generate` — regenerates the Prisma client. |
| `pnpm db:reset` | `supabase db reset` — DROPs everything and re-runs migrations. Destructive. |
| `pnpm db:seed` | `tsx --env-file=.env.local supabase/seed.ts`. Idempotent. |

---

## Project structure

```
/app
  layout.tsx                       root shell (theme, fonts, nuqs, toaster)
  (marketing)/page.tsx             public landing
  (auth)/login/page.tsx            email+password + Google
  (auth)/signup/page.tsx           creates profile, routes to /onboarding
  (auth)/callback/route.ts         OAuth / magic-link return → /dashboard
  (auth)/logout/route.ts           POST → /
  onboarding/page.tsx              org + owner membership bootstrap
  invite/[token]/page.tsx          accept invite
  (app)/layout.tsx                 sidebar + topbar shell (gated)
  (app)/dashboard/page.tsx         KPIs + pipeline + activity feed
  (app)/orders/page.tsx            table + board + detail sheet + new dialog
  (app)/customers/page.tsx         table + detail sheet + new dialog
  (app)/contractors/page.tsx       list + create + balance view
  (app)/contractors/[id]/page.tsx  header + Jobs / Payments / Details tabs
  (app)/team/page.tsx              crew member list + assignment history
  (app)/schedule/page.tsx          week / day / list views + event dialog
  (app)/settings/page.tsx          Profile / Shop / Members tabs
  j/[slug]/page.tsx                public crew share page (no auth)
/components
  theme-provider.tsx
  ui/                              shadcn primitives
  app/                             app-specific components
/lib
  supabase/server.ts               server (RLS respected)
  supabase/client.ts               browser (RLS respected)
  supabase/middleware.ts           session refresh pipeline
  supabase/admin.ts                service-role (RLS bypassed — server only)
  supabase/types.ts                row types
  auth.ts                          getCurrentUserAndOrg
  rbac.ts                          role hierarchy helpers
  db.ts                            Prisma singleton (service-role only)
  actions/                         server actions
  queries/                         server query helpers
  validators/                      zod schemas
/prisma
  schema.prisma                    TS type mirror of the DB
/supabase
  migrations/0001..0015.sql        DDL + RLS + functions + storage + contractors + scheduling
  seed.ts                          demo data (idempotent)
/middleware.ts                     protects /(app)/**, rate-limits /j/[slug]
```

---

## How-to

### Add a new order stage

1. **Postgres enum** — create a new SQL migration that runs:

   ```sql
   ALTER TYPE order_stage ADD VALUE 'hold' BEFORE 'cancelled';
   ```

   Postgres enum values are append/before/after only — you cannot reorder
   retroactively.

2. **Prisma enum** — add the value to `prisma/schema.prisma`:

   ```prisma
   enum OrderStage {
     quote
     ...
     hold
     cancelled
   }
   ```

   Run `pnpm db:generate`.

3. **UI labels + colors** — extend `components/app/pipeline-strip.tsx`
   (`STAGE_ORDER`, `STAGE_LABELS`) and `components/app/order-stage-badge.tsx`
   (`STAGE_STYLES`).

4. **Board view** — add the stage to `BOARD_STAGES` in
   `components/app/orders-board.tsx` if it should be draggable-to.

### Add a new role

1. **Postgres enum** — `ALTER TYPE member_role ADD VALUE 'accounting' ...`.
2. **RLS policies** — decide what the role can do. The pattern in
   `supabase/migrations/0002_rls.sql` uses `org_role(org_id) IN (...)`
   checks; add the new role to the appropriate policies.
3. **Column-level gates on orders** — if the new role needs narrow write
   permissions (like `field`), extend
   `enforce_field_role_columns()` with a branch.
4. **`lib/rbac.ts`** — add the new role to `LEVEL` and any `can*` helpers
   you want to permit it.
5. **Members UI** — add the role to `ASSIGNABLE_ROLES` in
   `components/app/settings-members.tsx` and the `role` select in the
   invite form.

### Understand the contractor data model

Some customers come in through a general contractor, kitchen-and-bath
dealer, or builder. The shop ends up talking to **both** the homeowner
(measurement, install) and the contractor (billing, referral). Two
relationships, one order.

Three tables + two views make this work:

```
contractors                      one row per GC / dealer / builder
orders.contractor_id             nullable FK, ON DELETE SET NULL
contractor_payments              one row per check / ACH / etc.
contractor_payment_allocations   payment ↔ order, N:M with amount
v_order_contractor_paid          per-order: sum(allocations.amount)
v_contractor_balances            per-contractor: jobs_total, paid, balance
```

The allocation table exists because one $10k check can cover three
kitchens — $4k on A, $3.5k on B, $2.5k on C. Without it you can't tell a
contractor "here's what you still owe on the Springfield kitchen
specifically," and you can't reconcile partial payments.

**Write-path lockdown.** Direct writes to `contractor_payments` and
`contractor_payment_allocations` are blocked three ways: `REVOKE INSERT,
UPDATE, DELETE … FROM authenticated`, RLS `WITH CHECK (false)`, and no
app code that targets them. Everything goes through three RPCs defined
in `0012_contractor_payment_rpc.sql`:

- `record_contractor_payment(...)` — insert payment + allocations atomically.
- `update_contractor_payment(...)` — edit (re-writes allocations in place).
- `delete_contractor_payment(...)` — cascade-delete the allocations.

All three are `SECURITY DEFINER` (to bypass RLS + the REVOKE), do their
own `is_org_member + org_role >= manager` check, and enforce
`sum(alloc.amount) = payment.amount` to 2dp. The audit triggers from
`0011_contractors.sql` fire inside the RPC transaction, so every row is
audited atomically with the mutation.

**Homeowner vs. contractor balances.** `orders.balance_due` is the
homeowner-side figure (`quote_amount - deposit_received`) and is
untouched by this feature. The contractor detail page computes a
**separate** contractor-side balance (`quote_amount - sum(allocations)`).
The two are intentionally not reconciled in Task 2B — a later design pass
needs to add a `bill_to` enum on orders. See the "Billing side
ambiguity" note in `DEVLOG.md` for the deferred work.

**Non-owner RLS check.** `scripts/smoke_contractors_rls.ts` signs in as
a non-member user and asserts (a) the views return zero rows with no
error and (b) direct INSERT into payment tables is rejected. Run it any
time you edit the RLS / REVOKE in `0011_contractors.sql`:

```sh
pnpm tsx --env-file=.env.local scripts/smoke_contractors_rls.ts
```

### Understand the scheduling model

The unit being scheduled is the **JOB EVENT**, not the crew. An order
typically has 1–3 events (a measurement, an install, sometimes a
delivery). Each event has its own date, time, duration, location, and
assigned crew. Crew members are **not** Throughstone users — they're
people you assign work to. Most never log into the app.

```
crew_members                     people you dispatch (not app accounts)
order_events                     measurement / install / delivery / pickup / other
order_event_assignments          event ↔ crew, N:M with per-assignment role
event_share_links                public slugs for /j/[slug]
v_calendar_events                joined read-model used by the calendar UI
v_orders_with_event_dates        orders + next install/measurement (derived)
```

**Why a forwarding trigger?** The action layer (`createOrder`) calls
`create_order_event` directly — the new orders flow doesn't touch
`orders.measured_at` / `orders.scheduled_install_date` anymore. But the
seed still writes those columns via Prisma. Migration
`0015_orders_sync_legacy_dates.sql` adds an AFTER INSERT trigger that
mirrors legacy-column-writes into matching events at the org-local
default time (9 AM measurement, 10 AM install) so any non-app caller
(the seed, ad-hoc DB writes) still produces calendar events. Drops
alongside the legacy columns in a future migration once the read paths
are baked.

**Write-path lockdown matches contractor payments.** `order_events` and
`event_share_links` are RPC-only — `REVOKE INSERT/UPDATE/DELETE` plus
RLS `WITH CHECK (false)`. Seven `SECURITY DEFINER` RPCs live in
`0014_scheduling_rpcs.sql`:

- `create_order_event(...)`, `update_order_event(...)`,
  `delete_order_event(...)` — manager+.
- `update_event_status(...)` — any org member, including field role.
  Plus a `p_via_shared_link=true` branch that requires the caller be
  `service_role` (the `/j/[slug]` page's path). Enforces a minimal
  state machine: blocks `complete → scheduled` and `cancelled →
  in_progress`; everything else free.
- `create/rotate/revoke_event_share_link(...)` — manager+.

**Server-side timezone discipline.** All DB comparisons + indexes
operate on UTC `timestamptz`. The same-day CHECK on `order_events`
evaluates the day in UTC, not org tz, because Postgres can't see per-
row org tz at constraint-evaluation time (it's IMMUTABLE-only there).
Conversion to the org's IANA tz happens exclusively in React render
paths via `lib/tz.ts`. See the **"Server-side timezone discipline"**
header note at the top of `DEVLOG.md`.

### The /j/[slug] public surface

Each `event_share_links` row has a 16-char base62 slug (~95 bits
entropy from a CSPRNG). The `/j/[slug]` route is the **only** public
page in the app — no session required. It renders the event details +
the order's photos + a few status buttons the crew can tap to mark
"On my way" / "Arrived" / "Complete" without logging in.

**How the trust works.**
1. `middleware.ts` rate-limits `/j/*` at 30 req/min per IP (in-memory
   bucket; in-process only — see `lib/share-link/rate-limit.ts`).
2. The page uses `lib/supabase/admin.ts` (service-role) to look up the
   slug, bypassing RLS.
3. Missing / revoked / fake slugs all render `not-found.tsx`
   ("This link is no longer active") with HTTP 404 — uniform shape
   across the three paths so timing differences can't distinguish them.
4. Status updates from the public buttons call
   `markEventStatusViaShareLink({slug, status})`, which re-validates
   the slug and calls `update_event_status` with
   `p_via_shared_link=true`. The RPC asserts the caller is
   `service_role` AND sets a transaction-local GUC so the AFTER
   UPDATE trigger writes `activity_log.metadata.via = 'shared_link'`
   with `actor_id = NULL`. The activity feed renders these as
   `"install marked en route (via shared link)"`.
5. `force-dynamic` + `revalidate=0` means signed photo URLs are
   regenerated per request (1h TTL each, never cached in HTML).
   `noindex` + `no-referrer` meta keeps the URLs out of search and
   prevents referrer leaks when the crew opens "Open in Maps".

**Send-to-crew flow.** From the order detail Events tab, the **Send**
button on an event opens a modal with two tabs:
- **Copy text** — pre-formatted block (📍/🕐/📌/👤/🪨/📝/🔗) ready to
  paste into WhatsApp / Messages / Email. Three intent links prefill
  each app with the encoded text.
- **Shareable link** — Generate / Rotate / Revoke. "Last opened X ago"
  shows when the crew last viewed the page. Rotate is atomic: revoke
  the old slug + insert a new one in one txn.

**Integration test.** `scripts/test_share_link_status.ts` asserts the
end-to-end via-shared-link path: pick a live share link from the seed,
call the RPC with `p_via_shared_link=true`, verify the resulting
audit row has `actor_id=NULL` and `metadata.via='shared_link'`.

### Render-time smoke gate

`scripts/smoke_pages.ts` (run as `pnpm smoke`) hits every app route +
the `/j/[slug]` matrix (valid / revoked / fake) against a running
`pnpm dev` server, with an authenticated session. Catches the class of
bugs `pnpm typecheck` + `next build` miss — server components that
import non-component values from `"use client"` modules render-fail
only at call time, and dynamic routes aren't prerendered. First
demonstrated by the Task 2B `balanceClass` bug.

```sh
pnpm dev        # in another terminal
pnpm smoke
pnpm smoke /j   # subset by path prefix
```

Each route has an `expectStatus` (default 200), optional `expectBody`
substring, optional `pending` flag (= "expected 404 until the
implementing sub-step lands; remove me once it does"), and optional
`resolver` for dynamic templates like `:contractorId` / `:slug` that
need a live DB row.

### Debugging RLS

If a query returns empty data where it shouldn't:

1. Run `select * from orders where ...` in the SQL Editor as the
   postgres role — confirms the row is there.
2. Check `select * from pg_policies where tablename = 'orders';` — see
   which policies apply.
3. Temporarily set `SET request.jwt.claims = '{"sub":"<user-id>"}';` in
   a SQL Editor session and re-run the query to see what the
   authenticated user sees.

---

## Debugging

### Auth / RLS / redirect loops

If a user reports redirect loops or blank pages after login, run:

```sh
DIAGNOSE_EMAIL=user@example.com \
DIAGNOSE_PASSWORD='their-password' \
pnpm tsx --env-file=.env.local scripts/diagnose_auth.ts
```

This signs in as that user via `@supabase/supabase-js` and runs the same
three queries that `getCurrentUserAndOrg` (`lib/auth.ts`) runs — with
their JWT attached. The script prints each query's `error` and `data`
separately, so you can tell in ten seconds whether the gate is breaking
on **session** (sign-in fails), **data** (query returns no row), or
**RLS** (query returns an error).

Real-world example: an RLS policy on `org_members` used to subquery
`auth.users`, which the `authenticated` role has no privilege on.
`.maybeSingle()` returned `{ data: null, error: 'permission denied …' }`
and our guard code only read `data` — the error was invisible and the
dashboard looped. See `supabase/migrations/0007_fix_member_policies.sql`
for the fix.

### RLS design rule

Never write an RLS policy that subqueries `auth.users` (or anything else
the `authenticated` role can't `SELECT`). Use `auth.jwt()` claims (e.g.
`auth.jwt() ->> 'email'`) or a `SECURITY DEFINER` helper function
instead.

### FK / constraint sanity check

`pnpm tsx --env-file=.env.local scripts/fk_audit.ts` prints every public
schema foreign key with its `ON DELETE` action, straight from
`pg_constraint`. Useful when a cascade doesn't behave as expected.

---

## Deploying to Vercel

1. Push to GitHub.
2. Import the repo at <https://vercel.com/new>. Framework preset Next.js.
3. Set the same env vars from `.env.local` in **Project Settings →
   Environment Variables**. Mark `SUPABASE_SERVICE_ROLE_KEY` sensitive.
4. Set `NEXT_PUBLIC_SITE_URL` to your Vercel domain (e.g.
   `https://stone-design-board.vercel.app`).
5. Add that URL to **Supabase → Authentication → URL Configuration →
   Site URL** and **Additional Redirect URLs**, and to the Google OAuth
   credentials if you enabled Google sign-in.
6. Deploy.

Migrations don't run on deploy — apply them from your machine
(`pnpm db:migrate`) before promoting a branch that needs new schema.

---

## Design language

- Neutral grayscale base, single accent **stone slate blue (`#4A5D7E`)**
  bound to `--brand` and used for focus rings + active indicators.
- Inter (sans) + JetBrains Mono (monospace for order numbers and
  amounts).
- Desktop-first, dense, operational — think Linear or Ramp, not a
  consumer app.
- shadcn/ui **pinned to 2.10.0** (npm `@latest` is 4.x, which swaps
  Radix UI for `@base-ui/react` — not compatible with this codebase).

---

## What's intentionally deferred

Out of scope for the work currently shipped — see
[`DEVLOG.md`](./DEVLOG.md) for the per-task running deferred list.

**From Task 3 (scheduling + crew dispatch):**

- Two-way Google / iCal / Outlook calendar sync. The `/j/[slug]` pages
  are a one-way push; we don't read external calendars.
- SMS / WhatsApp / Email auto-send. The copy-text + intent-link modal
  is the v1 stand-in; auto-push is Task 4.
- Recurring events. Every event is a one-off.
- Crew availability / scheduling optimization / route optimization.
  The owner picks; we don't suggest.
- Crew portal with auth. `/j/[slug]` is intentionally login-free; a
  dedicated crew app surface is separate.
- Pay tracking per crew (hours, piecework, commissions).
- Multi-timezone support beyond the org's single tz setting.
- Install-site-specific photos (today the share page surfaces the
  parent order's photos).
- Distributed rate limit (`@upstash/ratelimit` etc.). In-memory
  bucket in `middleware.ts` is per-instance; a Vercel deployment with
  N warm instances has an effective limit of N × 30/min for /j/[slug].
- Drop of the legacy `orders.measured_at` + `orders.scheduled_install_date`
  columns + the 0015 bridge trigger. Defer until the events read
  paths have baked for a release.

**From Task 2B (contractor tracking):**

- `bill_to enum('homeowner', 'contractor')` on orders to disambiguate
  the homeowner-vs-contractor balance split (see the "Billing side
  ambiguity" note in DEVLOG).
- Contractor portal, account statements / PDFs, commission tracking,
  QuickBooks sync.

**From Task 2A (orders UX):**

- Server-side HEIC → JPEG conversion for the file gallery (current
  Chromium-on-HEIC path falls back to a download tile).
- Bulk-stage-change UI (server action is ready; UI deferred).

**From Task 1 (base app):**

- Slab inventory, invoices.
- Signed/expiring invite tokens (current tokens are random UUIDs
  prefixed `inv_`).
- Realtime (Supabase Realtime on the orders table for a live kanban).
- Automated test suite. The integration scripts in `/scripts/test_*.ts`
  cover the highest-risk paths; a dedicated test framework is a
  separate task.

**Cross-cutting:**

- ESLint rule that flags `import { value } from "<'use client' file>"`
  from server components — would have caught the Task 2B `balanceClass`
  bug at lint time instead of runtime smoke. Tracked since Task 2B
  shipped; its own small task.

See [`DEVLOG.md`](./DEVLOG.md) for the full running log of decisions and
deferred items, and [`PLAN.md`](./PLAN.md) for the sub-step breakdown.
