# DEVLOG — Stone&DesignBoard

Running log of decisions, assumptions, and deferred items. Newest first.

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

### Deferred
- Signed/expiring invite tokens (tracked for Task when email is wired)
- Automated tests (explicitly out of scope for Task 1)
- Rate limiting on auth endpoints
- CSP / security headers beyond Next defaults
- Avatar/logo image resizing (we'll accept upload and use as-is)
- Real-time subscriptions (Supabase Realtime) for kanban — using optimistic updates only for now
