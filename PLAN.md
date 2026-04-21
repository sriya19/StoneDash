# PLAN — Stone&DesignBoard Task 1

Status: **APPROVED — in progress**

## Resolved decisions (2026-04-20)
- **Q1 — Supabase hosted.** User will create the project and paste env vars when prompted.
- **Q2 — Pattern A.** Supabase client (`@supabase/ssr`) in server actions for RLS-enforced reads/writes. Prisma for types, migrations (structural only, with hand-written SQL for RLS/triggers/functions/storage), and service-role seed.
- **Q3 — Google OAuth wired but not verified.** User enables provider in Supabase dashboard later. Email+password works out of the box.
- **Q4 — Supabase CLI** as source of truth for migrations. `prisma db pull` keeps Prisma schema in sync.
- **Q5 — Option (c) + extension.** Add two columns to `organizations`:
  - `order_prefix text` — defaults to `upper(left(slug, 2))` at insert. Editable in Settings → Shop.
  - `order_seq_start int default 1000` — editable at onboarding and in Settings → Shop. Lets shops continue from their existing paper/Excel numbering.
  - `generate_order_number(uuid)` returns `{order_prefix}-{seq}` where `seq = greatest(org_order_seq.next_seq, max(existing_order_seq) + 1, order_seq_start)`. Writes back `next_seq + 1`.
- **Q6** — long-running processes: background for compile verification, hand off to user for UI testing.

## Prereqs (verified)
- Node v24.10.0 ✅
- pnpm 10.33.0 ✅
- Git 2.51.1 ✅
- Repo already `git init`'d on `main`, working dir `/Users/sriyapothula/stone-design-board`

---

## Open questions to resolve BEFORE I start coding

These will shape several sub-steps. I'd like a quick answer on each, or I'll pick the default listed and note it in DEVLOG.

### Q1. Supabase: hosted project or local?
- **Option A (default I'll pick):** hosted Supabase project. You create it at supabase.com, paste the URL + anon key + service role key + DATABASE_URL into `.env`. Fastest to test Auth + OAuth + Storage end-to-end.
- **Option B:** local via `supabase start` (Docker). No external dependency, but Google OAuth + email auth flows are awkward locally.
- **Mix:** use hosted for dev + `supabase db push` to sync migrations.

### Q2. Prisma vs Supabase client — how do we actually read/write? (IMPORTANT)
The spec says "Prisma ORM against the Supabase Postgres" AND "RLS enforces..." — those don't compose automatically. Prisma connects as the DB owner and **bypasses RLS**. Three viable patterns:

- **Pattern A (recommended):** Use `@supabase/ssr` client inside server actions / server components for all reads + writes. RLS is enforced naturally via the user's JWT. Prisma is used only for:
  - `prisma generate` → TypeScript types shared across the app
  - `prisma migrate` for the **structural** tables (everything that can be expressed in Prisma schema)
  - Hand-written SQL migrations in `/supabase/migrations/*.sql` for RLS policies, triggers, the `generate_order_number` function, storage policies, and the order-seq table
  - `pnpm db:seed` uses the service role key to bypass RLS and load demo data

- **Pattern B:** Use Prisma for everything. Bypass RLS at the DB and enforce tenancy in every server action via `getCurrentUserAndOrg() + where: { org_id }`. RLS becomes a defense-in-depth backstop only (not actually enforced on the app path). Downside: easy to forget the `org_id` filter and leak data.

- **Pattern C:** Prisma with per-request `SET LOCAL role authenticated` and `SET LOCAL request.jwt.claims = ...`. Prisma through Supabase's pooler. Fiddly, but RLS is enforced. Few projects do this in prod.

**My default:** Pattern A. It's the one the spec is describing when it talks about RLS enforcing tenancy.

### Q3. Google OAuth
- Requires creating a Google OAuth client and pasting credentials into Supabase dashboard → Auth → Providers. **I cannot automate this.** OK if I ship the code wired up and you enable it in your Supabase project later? Email+password will work out of the box; Google button will 500 gracefully until you add the creds.

### Q4. Migrations — Prisma or Supabase CLI?
Given `/supabase/migrations/0001_init.sql … 0005_storage_policies.sql` is explicitly in the spec, I'll use the **Supabase CLI** for migrations (`supabase migration new`, `supabase db push`). Prisma schema stays in sync via `prisma db pull` so we get types. `db:migrate` in package.json = `supabase db push`.

### Q5. Order # prefix
Spec says `PREFIX = upper(left(slug, 2))`. For `top-marble-granite` the prefix would be `TO`. The example in the spec is `TM-1042`. I'll use `upper(left(slug, 2))` as written; if you want "TM" specifically, the slug should be `tm` or we change the function. Flagging so there's no surprise.

### Q6. `pnpm dev` — I won't run it long-running
Per your rule #4: I'll start the dev server in the background when you tell me to, or I'll give you the command to run in a second terminal. I won't hang a tool call on it.

---

## Sub-step breakdown (ordered)

Each sub-step ends with: typecheck + lint clean, short status to you, move on. DEVLOG gets updated at every step.

### 1. Scaffold
- `pnpm create next-app` with TS strict, App Router, Tailwind, ESLint, src dir = no, import alias `@/*`
- Overwrite default files; ensure `tsconfig.json` has `strict: true`, `noUncheckedIndexedAccess: true`
- Commit

### 2. Deps
- shadcn/ui init (neutral base, New York variant)
- Install: @supabase/ssr, @supabase/supabase-js, @prisma/client, prisma, zod, react-hook-form, @hookform/resolvers, @dnd-kit/core, @dnd-kit/sortable, nuqs, sonner, lucide-react, date-fns, next-themes
- Install shadcn components we'll use: button, input, label, textarea, select, dialog, sheet, table, badge, tabs, command, dropdown-menu, avatar, form, toast (via sonner wrapper), skeleton, separator, checkbox, combobox, tooltip, popover, calendar
- Fonts: Inter + JetBrains Mono via next/font
- `.env.example` with every var documented
- Commit

### 3. Database schema
- Prisma schema covering every table in the spec (including `organizations.order_prefix` and `organizations.order_seq_start`)
- `/supabase/migrations/0001_init.sql` — tables (with order_prefix + order_seq_start), indexes, uniques
- `0002_rls.sql` — RLS policies per role (owner/admin/manager/field)
- `0003_order_number_fn.sql` — `org_order_seq` table + `generate_order_number(uuid)` function using `SELECT...FOR UPDATE`, implementing `greatest(next_seq, max(existing) + 1, order_seq_start)`
- `0004_balance_trigger.sql` — trigger setting `balance_due = quote_amount - deposit_received`
- `0005_storage_policies.sql` — `order-files` bucket + policies keyed on first path segment = org_id
- `seed.sql` (or `seed.ts`) — demo org (Top Marble & Granite), demo user linkage note, 10 realistic orders
- `db:generate`, `db:migrate`, `db:seed`, `db:reset` scripts
- At this point I'll **stop and ask you to create the Supabase project and paste env vars** so I can apply migrations and verify

### 4. Auth + Supabase clients
- `/lib/supabase/server.ts`, `client.ts`, `middleware.ts` (using `@supabase/ssr`)
- `/middleware.ts` at project root protecting `/(app)/**`
- `/lib/auth.ts` with `getCurrentUserAndOrg()` — returns `{ user, profile, org, role }` or redirects
- `/lib/rbac.ts` — `canEdit(entity, role)` type helpers, typed enums
- `/app/(auth)/login/page.tsx` + `/signup/page.tsx` + `/(auth)/callback/route.ts`
- `/app/onboarding/page.tsx` — creates org + org_member + sets active_org_id

### 5. App shell
- `/app/(app)/layout.tsx` with sidebar (collapsible, cookie-persisted), top bar with ⌘K, "+ New" dropdown
- `org-switcher.tsx` (switches active_org_id)
- Theme toggle via next-themes
- Nav stubs for Inventory / Schedule / Invoices / Team with "Coming soon" tooltips

### 6. Dashboard
- 4 KPI cards (server components, parallel queries)
- Pipeline strip (horizontal, clickable → /orders?stage=…)
- Activity feed (latest 15 rows rendered as human sentences)

### 7. Orders — the big one
- Zod validators in `/lib/validators/orders.ts`
- Server actions in `/lib/actions/orders.ts`: `createOrder`, `updateOrder`, `changeStage`, `bulkUpdateStage`, `deleteOrder` — all return `{ ok: true, data } | { ok: false, error }` and write `activity_log` in the same transaction
- `/orders` page with Table view (default) + Board view toggle
- Table: sortable columns, filter bar, nuqs URL sync, server-side pagination, row click → detail sheet, bulk actions
- Board: @dnd-kit columns per stage, optimistic stage change writing `order_stage_history`
- New Order dialog: 4 steps, customer combobox with inline-create
- Order detail sheet: Overview (inline-edit) / Files (dropzone → Supabase Storage) / Activity (filtered log)

### 8. Customers
- Table with order count + last order (server-side joins)
- Customer sheet: order history + edit form

### 9. Settings
- Profile tab (name, avatar, phone, theme)
- Shop tab (name, slug, logo, timezone, currency, **order_prefix, order_seq_start**) — owner/admin only
- Members tab: list + invite (creates pending org_member + copyable `/invite/{token}` link)
- `/invite/[token]/page.tsx` accepts invite (sets user_id + invite_accepted_at)

### 10. Seed + README + DEVLOG finalize
- Seed: 1 org (Top Marble & Granite), a demo user note (manual: create a Supabase auth user then run seed), 10 orders across all stages with realistic stone types, edge profiles, install dates
- README: prereqs, Supabase project setup, env vars, local run, how to add a stage, how to add a role, Vercel notes
- DEVLOG: final pass on deferred items

---

## What I'll verify at each sub-step
- `pnpm typecheck` passes
- `pnpm lint` passes (no warnings)
- No `any`, no `@ts-ignore`, no `console.log`, no `TODO` without a DEVLOG entry
- Commit with a short conventional-commit-style message

## What I will NOT do this task
(Per "OUT OF SCOPE" — keeping you honest to your own list.)
Slab inventory · crew scheduling · invoices/payments · WhatsApp/SMS/email · AI extraction · Stripe · public tracking page · mobile · automated tests · reporting beyond 4 KPIs.

---

**Please answer Q1–Q3 (Q4–Q6 have sensible defaults) and say "go" when you're ready.**
