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

- Demo auth user: `owner@topmarble.local` / `StoneDemo!2026`
- Shop: `Top Marble & Granite` (slug `top-marble-granite`,
  order prefix `TM`, starting at `TM-1042`)
- 8 customers, 10 orders across every stage

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
  (app)/settings/page.tsx          Profile / Shop / Members tabs
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
  migrations/0001..0005.sql        DDL + RLS + functions + storage
  seed.ts                          demo data (idempotent)
/middleware.ts                     protects /(app)/**
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

## What's intentionally not in Task 1

- Slab inventory, crew scheduling, invoices, WhatsApp/SMS, AI extraction,
  Stripe, customer-facing order tracking, mobile app.
- Automated tests (dedicated task later).
- Realtime (Supabase Realtime on the orders table for a live kanban).
- Bulk actions on the orders table (server action is ready; UI deferred).
- Signed/expiring invite tokens (current tokens are random UUIDs prefixed
  `inv_`).

See [`DEVLOG.md`](./DEVLOG.md) for the full running log of decisions and
deferred items, and [`PLAN.md`](./PLAN.md) for the sub-step breakdown.
