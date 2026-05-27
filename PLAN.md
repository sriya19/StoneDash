# PLAN — Task 3: Scheduling + crew dispatch

Status: **DRAFT — awaiting "go"**

Tasks 1, 2A, and 2B are landed. This file replaces the Task 2B body for the next task. DEVLOG entries for prior tasks remain.

This is a larger task than 2B. Ten sub-steps, four new tables, two new top-level routes (`/schedule`, `/team`), one new public route (`/j/[slug]`), one new entity tab on the order detail sheet, plus a backfill that quietly flips the source of truth for install/measurement dates. The plan calls out everything I want your sign-off on **before** I touch a migration.

---

## Decisions & questions I'd like you to weigh in on (before I start)

### Q1. Actor identity for status updates from the public /j/[slug] page

`update_event_status` is callable both from the app (logged-in user) and from the public share page (no session). The audit row needs an actor.

`activity_log.actor_id` is `uuid REFERENCES auth.users(id) ON DELETE SET NULL` — confirmed nullable (0001_init.sql:272). So we can write NULL for public-path updates and put context in `metadata`.

**Recommendation.** When called via the public page:
- `activity_log.actor_id = NULL`
- `metadata.via = 'shared_link'`
- `metadata.share_link_id = <event_share_links.id>` (NOT the slug itself; slugs are bearer tokens and shouldn't land in audit logs)

Activity feed phrase: `"Marked en route (via shared link)"`. No actor name pill, just a "shared link" badge. If you'd prefer we instead attribute these to the link's `created_by` (i.e. "owner did it via Carlos's link"), tell me — that's a stronger claim and probably wrong, but it's the natural alternative.

### Q2. Public page enumeration / timing safety

Slug is 16 base62 chars from a CSPRNG = ~95 bits of entropy. Brute force is intractable, but two smaller worries:

- **Timing attacks** distinguishing "valid slug, revoked" vs "invalid slug" vs "valid slug, event since deleted". I'll funnel all three through one identical 404 render path. Same body, same HTTP status, no leaked timing.
- **Rate limiting** — out of scope for this task. Flagging because the public endpoint is the first surface in the app that's reachable without auth and survives a leak. **Task 4 infra concern**, not Task 3.

**Recommendation.** Uniform 404 shape; no rate limit in this task; explicit DEVLOG note.

### Q3. Org timezone — display + parsing

`organizations.timezone` already exists (IANA string, e.g. `America/New_York`). `date-fns 4.1.0` is installed but no timezone helper.

The brief says "all events display and store in the org's timezone." Storage is `timestamptz` (UTC under the hood); "display in org timezone" + "interpret time-picker input as org timezone" is the right semantic.

To do that cleanly I need `@date-fns/tz` (the v4 timezone package, ~30kb gzipped). Without it, parsing `"2026-04-24 10:00"` as "10 AM in America/New_York → UTC" is awkward.

**Edge case I want you to OK explicitly.** If an owner is travelling — physically in a Chicago hotel using a browser set to America/Chicago — and edits a Falls Church (America/New_York) install for "10 AM": this will save as **10 AM Eastern**, not 10 AM Central. That's the right answer for the shop ("event happens at 10 AM local to the install"), but it's surprising the first time. The time picker will show a small "Eastern Time" label so it's not invisible.

**Recommendation.** Add `@date-fns/tz`; ship org-tz-relative pattern; label the picker.

### Q4. Same-day validation for `ends_at`

Brief: ends_at must be same calendar day as starts_at (no overnights in v1). Same calendar day **in org tz**. The `ends_at` column is a STORED generated column from `starts_at + duration_min` — so a Postgres CHECK constraint can't see org tz without a function call.

**Recommendation.** Validate in the server action (and in the RPC body — defense in depth). Don't try to express it as a CHECK. DEVLOG flag for the rare-case-but-real "shift starting at 9 PM lasting 4 hours" crossing midnight.

### Q5. The `orders.measured_at` / `orders.scheduled_install_date` deprecation seam

Brief says "DEPRECATE but don't remove" — backfill into `order_events`, future task drops the columns. The question is: from this task forward, who writes to those columns?

**Three candidates:**
- (A) New Order dialog writes BOTH the column and the new event (mirror write). Read path can use either; columns stay populated for legacy callers.
- (B) New Order dialog writes ONLY the new event. Existing rows keep their backfilled column values for history. Read path switches to events.
- (C) Backfill into events, leave columns frozen at backfill values. New orders write columns AND events. Same as (A).

**Recommendation: (B).** Cleanest seam, least drift. Existing rows keep their column values (no UPDATE in the migration except for backfill INSERTs into the new table). New orders write only to `order_events`. The orders LIST query gains a LEFT JOIN to `order_events` filtered to `kind='install'` for the install-date column. After we're confident (next task), drop the columns + the JOIN.

The risk of (B): if anything else in the code reads `orders.scheduled_install_date` after this task, it sees a frozen historical value, not the live event date. I'll grep + fix all read sites in sub-step 1 itself — the seam shouldn't be left half-migrated.

### Q6. Field-role writes on `order_events`

Field role must be able to UPDATE status only (mark "en route", "complete"). Other columns must be off-limits.

**Two implementations:**
- (i) RLS UPDATE policy WITH CHECK `(only status changed)` — not directly expressible in Postgres RLS (column-level rules aren't in `USING/WITH CHECK`).
- (ii) RLS UPDATE policy is `manager+` only; field role gets no direct UPDATE; the `update_event_status` RPC is `SECURITY DEFINER` and explicitly allows field role.

(ii) is the contractor-RPC pattern from Task 2B and is cleaner. Field can't even bypass to do a column-level update because the underlying RLS rejects them.

**Recommendation. (ii).** RPC-only path for field status updates.

### Q7. Status state machine — none in v1

I considered enforcing "can't move from `complete` back to `scheduled` without manager+ override." Decided no, for v1. Owner discretion; every transition writes activity_log with `from→to`; anomalies are visible in the feed.

**Recommendation.** Free transitions; log everything; revisit in Task 5+ if it becomes a real-world problem.

### Q8. Conflict warning shape

Brief: soft warning if a selected crew member overlaps with another active event, allow submit. Two surfaces it has to handle:

- **Create/edit dialog**: live as the user picks time + crew (debounced 200ms). Inline warning under the crew picker. Click-through to the conflicting event opens its detail.
- **Drag-to-reschedule**: drag completes → if new time creates a conflict with the assigned crew, a toast appears alongside the success: `"⚠ Carlos now overlaps TM-1042 (10 AM-1 PM)"`. Same soft posture.

In both cases, conflicts only consider live events: `status NOT IN ('cancelled', 'no_show', 'complete')` AND `event_id != self`.

**Recommendation.** Both surfaces use the same `getCrewConflicts(crewIds, starts_at, ends_at, excludeEventId?)` helper. Inline in dialog, toast on drag.

### Q9. Slug generation

16 base62 chars, ~95 bits entropy, generated server-side. No `nanoid` dep currently.

**Recommendation.** Hand-roll in `lib/share-link/slug.ts` (~15 lines): `crypto.randomBytes()` with rejection sampling so each byte maps cleanly to one base62 char (no modular bias). Avoid the nanoid dep for one function.

### Q10. Photo serving on /j/[slug]

The "order-files" bucket is private, RLS-keyed on org membership. The public page needs to show order photos to an unauthenticated browser.

**Recommendation.** The public page is a server component. It uses the service-role client (we already have `lib/supabase/admin.ts`) to fetch event + parent order + image attachments, then pre-signs URLs (1h TTL) using the existing `createSignedUrls` helper. The signed URLs are bearer tokens — same security profile as the slug itself, which is fine.

### Q11. `last_opened_at` tracking

Single `UPDATE event_share_links SET last_opened_at = now() WHERE id = $1` on every page GET. Racy under concurrent opens (multiple updates within ms) — doesn't matter; last-write-wins is the correct semantic.

The owner sees this on the Send-to-crew modal as `"Last opened 12 minutes ago"`. Doesn't say who, because we genuinely don't know.

**Recommendation.** Yes, cheap, useful.

### Q12. Backfill default time-of-day

`scheduled_install_date` is `date`, not `timestamptz`. The backfill needs to invent a time-of-day for the new event row.

**Recommendation.** Measurement → 9 AM org-local, 1h duration. Install → 10 AM org-local, 3h duration. Same as the seed defaults. DEVLOG flags that backfilled times are not authoritative — they're defaults that any user can edit afterward.

### Q13. Where does the New Order dialog write dates?

Tied to Q5. Recommendation: New Order dialog's Schedule step calls `create_order_event` (creates a kind='install' event if install date given, kind='measurement' if measurement date given). It does NOT set `orders.scheduled_install_date` or `orders.measured_at`. Forward-compat seam; the columns become legacy.

### Q14. Combining sub-steps 9 + 10

The brief proposes them as separate sub-steps: Copy Text first, Shareable Link second. They live in the same modal as two tabs and are produced from the same data assembly logic. Shipping the modal with one tab is artificial.

**Recommendation.** Combine into one sub-step. Final count: 10 sub-steps (not 11). DEVLOG note when shipping that the public-page route is the riskiest piece — extra smoke coverage there.

### Q15. Smoke gate generalization

`scripts/smoke_contractor_render.ts` is the post-Task-2B render-time gate. Rename to `scripts/smoke_pages.ts`, take a route list.

**Shape:**
- Default committed list of route templates: `/dashboard`, `/orders`, `/customers`, `/contractors`, `/contractors/:contractorId`, `/schedule`, `/team`, `/j/:slug`.
- Template variables (`:contractorId`, `:slug`) resolved at startup by querying the DB via service-role for a real row. If no row exists, skip that template with a printed warning (`-- /j/:slug → no event_share_links rows; skipping`).
- CLI override: `pnpm smoke /schedule` runs only that subset.
- Same pass criteria: HTTP 200 + no known error markers in body.
- Add `"smoke": "tsx scripts/smoke_pages.ts"` to package.json.

**Recommendation.** This is the gate. Run it at the end of every sub-step touching a page surface.

### Q16. Activity feed: new entity types + dedupe

New entity types in the feed:
- `crew_member` — created/updated/deleted (rare; visible)
- `order_event` — created/updated/deleted, plus action `rescheduled`, plus action `status_changed`
- `order_event_assignment` — **hidden in feed** (same dedupe pattern as `contractor_allocation`; an event-update is the story, assignment shuffles are noise)
- `event_share_link` — created/revoked/rotated (rare; visible)

Special activity actions on `order_event`:
- `rescheduled` — metadata `{from: iso, to: iso}`. Phrase: `"Rescheduled TM-1042 install from Thu Apr 24, 10 AM to Fri Apr 25, 10 AM"`.
- `status_changed` — metadata `{from: 'scheduled', to: 'en_route', via: 'shared_link' | undefined}`. Phrase: `"Marked TM-1042 install en route"` (or `… (via shared link)`).
- `created` includes the event datetime in the phrase.

**Recommendation.** This shape. Mirrors the contractor dedupe pattern.

---

## LOCKED — refinements from review (these supersede the recommendations above where they conflict)

**Q1 — render the `via` flag in feed text.** Storage alone is insufficient. `phraseFor` in `activity-feed.tsx` reads `metadata.via` and appends `" (via shared link)"` to the rendered phrase for `order_event:status_changed`. Verify by snapshotting one of the seeded events with a via-link status update and inspecting the dashboard activity feed shows the suffix.

**Q2 — basic IP rate limit on `/j/[slug]`.** 30 req/min per IP. Return HTTP 429 above. In-memory token bucket is fine for v1 — module-scoped `Map<ip, { count, resetAt }>` lazily cleaned. Implemented in `lib/share-link/rate-limit.ts`, called from the public route's server component. DEVLOG note that in-memory means per-instance accounting (cooperative on a single Next process, leaky across Vercel function instances). Good enough; production switch to `@upstash/ratelimit` is a deferred Task 4+ item.

**Q3 — code rule: server-side comparisons in UTC only.** All SQL queries against `order_events` use the `timestamptz` columns directly with no `AT TIME ZONE` clauses (except the same-day CHECK below). All Node-side date math uses Date objects / ISO strings (UTC). Org-timezone conversion happens **only in React render paths** via `formatInTimeZone(date, org.timezone, fmt)`. The dialog's input parsing is the one boundary: user picks "2026-04-24 10:00" → server parses with org tz → stores UTC. Once parsed, UTC everywhere. **Codified in DEVLOG (ADD-3).**

**Q4 — DB CHECK same-day in UTC (not org tz).** Added to `order_events`:
```sql
CHECK (
  date_trunc('day', starts_at AT TIME ZONE 'UTC')
  = date_trunc('day', ends_at AT TIME ZONE 'UTC')
)
```
Belt-and-suspenders alongside the server-action validation. **Practical implication to flag in DEVLOG:** any event crossing UTC midnight is rejected. For Top Marble (Eastern, UTC−5/−4) this only constrains events starting after roughly 7 PM local that run past midnight UTC — well outside install business hours. For a hypothetical Pacific shop the cutoff would be earlier (around 4 PM local); revisit when/if we onboard one.

**Q5/Q13 — pre-backfill verification + in-migration assertion.**
- `scripts/verify_event_backfill.ts` — runs against the target DB, reports: count of orders with `measured_at` vs expected event count by kind, count of orders with `scheduled_install_date` vs expected, and a date-distribution check (grouped-by-month). Prints a "would create N measurement events, M install events" preview. Run before applying 0013.
- **In the migration itself**, after the backfill INSERTs, `DO $$ BEGIN IF (SELECT count(*) FROM order_events WHERE kind='install') != (SELECT count(*) FROM orders WHERE scheduled_install_date IS NOT NULL) THEN RAISE EXCEPTION 'install backfill mismatch'; END IF; ... END $$;` — aborts the migration transaction if the counts don't match. Same for measurement.

**Q7 — minimal state machine in `update_event_status`.** Block:
- `complete → scheduled`
- `cancelled → in_progress`

Everything else free. Implemented as a `CASE WHEN OLD.status = 'complete' AND NEW.status = 'scheduled' THEN RAISE` block at the top of the RPC, before the `UPDATE`. Five lines.

**Q10/Q11 — signed URLs per-request, never cached in HTML.** `/j/[slug]` must opt out of static caching:
```ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;
```
Plus `cache: 'no-store'` on any fetch we issue. Signed URLs are generated inline in the server render and have a 1h TTL. Crew opens the link at 2 PM → URLs expire at 3 PM. Crew reloads at 3:01 PM → fresh render, fresh URLs.

### Additions

**ADD-1 — smoke matrix on /j/[slug].** `scripts/smoke_pages.ts` tests three cases against `/j/[slug]` with explicit expected shapes:
- `<valid-slug>` → HTTP 200, body contains the order number string.
- `<revoked-slug>` → HTTP 404, body contains the "no longer active" copy.
- `<fake-slug>` (any well-formed but unseeded 16-char base62 string) → HTTP 404, body contains the same "no longer active" copy.

Seed (sub-step 3) produces **one valid and one revoked** share link so both rows exist to resolve.

**ADD-2 — sub-step 1 DEVLOG must include three manual SQL tests with expected results:**
1. Field-role user can call `update_event_status` RPC successfully → returns ok; can NOT `INSERT INTO order_events (...)` directly → permission denied (42501).
2. Field-role user can NOT UPDATE non-status columns of `order_events` via direct UPDATE → permission denied.
3. `SELECT * FROM v_calendar_events` as a non-member user (different org) → 0 rows, no error.

These three are run live in psql / via the smoke-RLS script, results pasted into the DEVLOG entry verbatim.

**ADD-3 — DEVLOG header note: "Server-side timezone discipline".** One paragraph at the very top of DEVLOG.md (above the newest task entry), titled `## Server-side timezone discipline (code rule, 2026-05-25)`. States the rule: all DB comparisons and indexes operate on UTC `timestamptz`; the same-day CHECK uses `AT TIME ZONE 'UTC'`; conversion to org timezone is exclusively a React render concern. References Q3 of the Task 3 plan. Permanent — survives Task 3 in the log.

---

## Sub-step breakdown

Each sub-step: implement → typecheck → lint → build → **`pnpm smoke`** for any sub-step touching pages → update DEVLOG → commit. Sub-steps are individually shippable — interrupting between them leaves the app in a working state.

### Sub-step 1 — DB: tables, RPCs, RLS, view, backfill
**Commit:** `feat(schedule): db schema, rpcs, rls, view, backfill from orders`

- **`0013_scheduling.sql`**
  - `CREATE TABLE crew_members` per spec; `set_updated_at` BEFORE UPDATE trigger; indexes `(org_id, is_active)` and `UNIQUE (org_id, lower(name))`.
  - `CREATE TABLE order_events` per spec; `ends_at` STORED generated column; indexes `(org_id, starts_at)`, `(order_id)`, `(org_id, status)`. CHECK constraints on `kind` and `status`.
  - `CREATE TABLE order_event_assignments` per spec; `UNIQUE (event_id, crew_member_id)`.
  - `CREATE TABLE event_share_links` per spec; `UNIQUE (slug)`, `INDEX (org_id, event_id)`.
  - `CREATE VIEW v_calendar_events WITH (security_invoker = true)` — spec SQL.
  - **RLS enable + policies:**
    - `crew_members` SELECT: `is_org_member(org_id)`. INSERT/UPDATE/DELETE: `org_role(org_id) IN ('owner','admin','manager')`. Field SELECT only.
    - `order_events` SELECT: `is_org_member(org_id)`. INSERT/DELETE: manager+. UPDATE: manager+ via direct policy. Field gets no direct UPDATE — they go through `update_event_status` RPC.
    - `order_event_assignments` SELECT: EXISTS join to `order_events` for org membership (same pattern as `order_stage_history` / contractor allocations). INSERT/UPDATE/DELETE: manager+ via EXISTS join.
    - `event_share_links` SELECT: `is_org_member(org_id)`. INSERT/UPDATE/DELETE: manager+ (or owner of the link via `created_by = auth.uid()` — see "open question" below).
  - **Belt-and-suspenders write lockdown** matching contractor payments: `REVOKE INSERT, UPDATE, DELETE ON order_events FROM authenticated, anon;` — RPCs are the only write path. Same for `event_share_links` (mutations only via RPCs).
  - **Audit triggers:** `tg_crew_members_after_*`, `tg_order_events_after_*`, `tg_event_share_links_after_*`. Same shape as 0011 (with the cascade-delete guard). `order_event_assignments` triggers exist but only INSERT/DELETE (UPDATE is a no-op for a single-FK assignment).
  - **Polymorphic activity_log cleanup** BEFORE DELETE for each new entity (mirrors 0006).
  - **Backfill (Q12):** in the same migration:
    ```sql
    INSERT INTO order_events (org_id, order_id, kind, starts_at, duration_min, location_text, created_by)
    SELECT o.org_id, o.id, 'measurement',
           ((o.measured_at::text || ' 09:00:00')::timestamp AT TIME ZONE org.timezone),
           60, NULL, NULL
    FROM orders o JOIN organizations org ON org.id = o.org_id
    WHERE o.measured_at IS NOT NULL;

    INSERT INTO order_events (org_id, order_id, kind, starts_at, duration_min, location_text, created_by)
    SELECT o.org_id, o.id, 'install',
           ((o.scheduled_install_date::text || ' 10:00:00')::timestamp AT TIME ZONE org.timezone),
           180, NULL, NULL
    FROM orders o JOIN organizations org ON org.id = o.org_id
    WHERE o.scheduled_install_date IS NOT NULL;
    ```
    Backfill INSERT bypasses the upcoming write-lockdown because it runs in the migration transaction as the superuser/owner, before the REVOKE. Order matters: backfill first, then REVOKE.
  - **`enforce_field_role_columns()`** is **not** extended to events. The lockdown is RLS-based (field has no direct UPDATE policy). Cleaner than mixing patterns.

- **`0014_scheduling_rpcs.sql`**
  - `create_order_event(p_order_id, p_kind, p_starts_at, p_duration_min, p_location_text, p_notes, p_assignments jsonb) RETURNS uuid` — SECURITY DEFINER, validates `auth.uid()` non-null, `is_org_member`, `org_role IN (owner,admin,manager)`, same-calendar-day-in-org-tz (using `extract(timezone_offset)` against the org row), inserts event + assignments in one txn.
  - `update_order_event(p_event_id, p_kind, p_starts_at, p_duration_min, p_location_text, p_notes, p_assignments jsonb)` — diffs assignments (DELETE missing, INSERT new). Same validations.
  - `delete_order_event(p_event_id)` — hard delete. Activity log captures via triggers. Confirm dialog in UI; no soft-delete status here.
  - `update_event_status(p_event_id, p_status, p_via_shared_link boolean DEFAULT false)` — SECURITY DEFINER. Auth check allows **any** org member including field role. If `p_via_shared_link = true`, requires that caller is service role (the public-page server fetcher). Audit log written via the AFTER UPDATE trigger; we pass `via` through a transaction-local GUC the same way Task 2A's stage-change-with-reason did (`app.event_status_via_shared_link`).
  - `rotate_event_share_link(p_event_id) RETURNS text` — manager+ — sets `revoked_at = now()` on existing rows for the event, inserts a new row with a fresh slug, returns the new slug.
  - `create_event_share_link(p_event_id) RETURNS text` — same shape, only if no live link exists.
  - `revoke_event_share_link(p_link_id)` — manager+; sets `revoked_at = now()`.
  - All five RPCs `GRANT EXECUTE … TO authenticated`.

- **`prisma/schema.prisma`** — add `CrewMember`, `OrderEvent`, `OrderEventAssignment`, `EventShareLink` models + relations on `Order` and `Organization`. Run `pnpm prisma generate`. Views are not modelled in Prisma (consistent with Task 2B).

- **Read-site grep + fix.** Find every `orders.scheduled_install_date` and `orders.measured_at` read in the codebase. Migrate to `order_events`-derived data:
  - `lib/queries/orders.ts` LIST query — LEFT JOIN `order_events` filtered to `kind='install'`, take MIN(starts_at) per order, expose as the displayed install date.
  - Kanban board cards (`orders-board.tsx`) — same source.
  - Order detail sheet Overview tab — the install-date / measurement-date fields read from the events table; if no events, show "Not scheduled". Editing those fields will route to the new Events tab in sub-step 8 (in this sub-step, they become read-only with a "View events" link).
  - Dashboard "Installs this week" KPI — `order_events WHERE kind='install' AND starts_at IN [today, today+7]`.

- **Open question I'm flagging for you here, not deciding unilaterally:** `event_share_links` mutations via direct table write or via RPCs only? Direct write + RLS works fine (slug generated server-side in the action, manager+ role check enforced via RLS). RPCs add atomicity (rotate = revoke old + insert new + audit, all together). Brief implies RPC. Going with RPCs for symmetry. Push back if you'd prefer the simpler direct-write path.

- **Manual verification (DEVLOG):**
  - As demo-owner: `SELECT * FROM v_calendar_events LIMIT 5;` — backfilled rows show up with sensible local-time `starts_at`.
  - As non-member (via the existing smoke-RLS script, extended to cover the new tables): `SELECT FROM crew_members` → 0 rows. `SELECT FROM order_events` → 0 rows. `SELECT FROM event_share_links` → 0 rows. Direct INSERT into `order_events` → rejected.
  - Field user (we need a seeded field-role user — flag below): can `SELECT FROM order_events`, can call `update_event_status` RPC, cannot call `create_order_event` or `delete_order_event`, cannot directly UPDATE `order_events`.

- **Side requirement:** the seed needs to add a field-role user so the RLS-write tests work. Doing this in sub-step 3 (seed update).

### Sub-step 2 — Generalize smoke script → `scripts/smoke_pages.ts`
**Commit:** `chore(smoke): generalize render-time smoke check to take a route list`

- Rename `scripts/smoke_contractor_render.ts` → `scripts/smoke_pages.ts`.
- New shape:
  - Default committed list of route templates (see Q15).
  - Template variables resolved at startup via service-role queries. Map: `:contractorId` → first row of `contractors`; `:orderId` → first order; `:slug` → first live `event_share_links` row.
  - If a template has no resolution, print a warning and skip (don't fail).
  - CLI args override the list: `pnpm smoke /schedule /team`.
- `package.json` script: `"smoke": "tsx --env-file=.env.local scripts/smoke_pages.ts"`.
- Pre-run check: `pnpm smoke` runs against an already-running dev/start server on `localhost:3000`. If the server isn't up, the script prints a clear error ("start the server first: `pnpm dev`") and exits non-zero.

- **Verification.** Run `pnpm smoke` from a fresh dev server. Should pass for all currently-existing routes. (`/j/:slug` skips with a warning because no `event_share_links` rows exist yet — that's the right behavior for this sub-step.)

### Sub-step 3 — Seed data update
**Commit:** `chore(seed): crew members, event backfill, field-role user`

- 5 crew_members under the demo org per spec (Carlos Mendez, Mike Thompson, Jorge Ramirez, David Park, Ana Vasquez) with roles + phones.
- A field-role user: `field@topmarble.local` / `StoneDemo!2026`, profile, `org_members` row with role=`field`, `active_org_id` set. Used for RLS-write tests and to verify the field-can-mark-status flow when we ship the public-page status update in sub-step 9.
- Seeded events:
  - For each existing seeded order with `measured_at`: a measurement event 9–10 AM org-local that day. (Re-runs the same backfill SQL the migration runs, since `prisma.deleteMany` wipes events along with orders.)
  - For each with `scheduled_install_date`: an install event 10 AM–1 PM org-local.
  - Crew assignments: Carlos + Jorge on the next 3 upcoming installs; Mike + David on one more; leave the rest unassigned so the "no crew yet" state is testable.
- Idempotency: same as Task 2B — `deleteMany` on org cascades to all new tables.
- README update for the demo login section: add field-role user as a second login. Optional but useful for the user to actually click around as a non-manager.
- **Verification.** `pnpm db:seed` twice in a row produces identical results. `SELECT count(*) FROM order_events` matches expected (number of orders with each date populated). `pnpm smoke` now resolves `:contractorId` and (if any seeded share links exist — none yet) skips `:slug`.

### Sub-step 4 — `/team` page
**Commit:** `feat(team): crew member list, create, edit, deactivate`

- Sidebar nav: the "Team" coming-soon stub becomes an active link. Icon: `Users` from lucide (the org-members tab in /settings already uses `User`; this is fine to disambiguate).
- `lib/validators/crew.ts` — `CreateCrewMemberInput`, `UpdateCrewMemberInput`, `DeleteCrewMemberInput`.
- `lib/actions/crew.ts` — `createCrewMember`, `updateCrewMember`, `deleteCrewMember`. `deleteCrewMember` re-checks "no historical assignments" defense-in-depth (UI gates first).
- `lib/queries/crew.ts` — `listCrewMembersWithActivity({ activeOnly, search })`. Returns each crew member with their active-assignment count (`order_events WHERE starts_at >= now() AND status NOT IN cancelled,no_show`) and last-assignment timestamp. Same parallel-queries + map-merge pattern from contractors.
- `app/(app)/team/page.tsx` — server component, list + filter (active-only toggle default on, search), `?new=1` to open create.
- `components/app/crew-table.tsx` — Name / Role / Phone / Email / Active assignments / Last assignment. Row click → side sheet at `/team?id=<id>` with details + history of past events.
- `components/app/new-crew-dialog.tsx` — name (required), role (free text with datalist of suggestions per spec), phone, email, notes, is_active.
- `components/app/crew-detail-sheet.tsx` — inline-editable fields + Deactivate/Reactivate + Delete (disabled until zero historical assignments).
- Phone/email click-to-call/email links (tel:/mailto:).
- Empty state with create CTA.
- **`pnpm smoke`** with `/team` and `/team?id=<seeded-id>` after this sub-step.

### Sub-step 5 — `/schedule` WEEK view + create/edit dialog
**Commit:** `feat(schedule): week view and event create/edit dialog`

This is the biggest single sub-step. Splitting day/list/drag into their own sub-steps keeps it shippable.

- Sidebar nav: enable `/schedule` (currently stubbed). Icon: `Calendar`.
- `lib/queries/events.ts`:
  - `listCalendarEvents({ from: ISODate, to: ISODate, kindFilter?, crewFilter?, statusFilter?, search? })` — queries `v_calendar_events` with bounded date range. Returns rows shaped for the calendar component.
  - `listCrewLite()` — id + name + role for the multi-select pickers.
- `lib/validators/events.ts` — `CreateEventInput`, `UpdateEventInput`, `DeleteEventInput`, `RescheduleEventInput`. Zod refinement for same-calendar-day-in-org-tz.
- `lib/actions/events.ts` — `createOrderEvent`, `updateOrderEvent`, `deleteOrderEvent`. All call the matching RPCs; `revalidatePath('/schedule')`, `revalidatePath('/orders')`, `revalidatePath('/dashboard')`.
- `lib/tz.ts` — small helper module wrapping `@date-fns/tz` (parse org-local datetime to UTC, format UTC in org tz, "same-day in tz" check). All app code that touches event times goes through this module so we don't have parallel implementations.
- `app/(app)/schedule/page.tsx` — server component: parses search params (`view=week`, `date=YYYY-MM-DD`, `kind=`, `crew=`, `status=`, `q=`), fetches the appropriate range, renders `<ScheduleView>`.
- `components/app/schedule-view.tsx` — top-level client component that owns the three view modes. View toggle via Tabs. Date navigator (prev/today/next with current range label).
- `components/app/calendar-week.tsx` — 7-day × 14-hour (6 AM–8 PM) grid. Time labels on the left, day headers across the top. Today column highlighted (`bg-brand/5`), weekends muted. Events absolutely positioned in their slots; height = duration; color = kind. Click event → opens `?order=<id>&tab=events` (the order detail sheet's Events tab, sub-step 8). Click empty slot → opens the create dialog pre-filled with that date/time.
- `components/app/event-block.tsx` — the colored block. Order number (mono small), project name (truncated), customer name. Crew avatars/initials bottom-right. Hover state with full details. Color tokens (defined in tailwind config additions or `globals.css`):
  - measurement → `bg-purple-500/15 text-purple-900 border-purple-500/40` (light) + dark variants
  - install → `bg-emerald-500/15 text-emerald-900 border-emerald-500/40`
  - delivery → `bg-blue-500/15 text-blue-900 border-blue-500/40`
  - pickup → `bg-sky-500/15 text-sky-900 border-sky-500/40`
  - other → `bg-zinc-500/15 text-zinc-900 border-zinc-500/40`
  Cancelled/no_show events get a desaturated treatment + strikethrough on time.
- `components/app/event-dialog.tsx` — the create/edit dialog described in the brief. RHF + zod. Order combobox (existing orders, searchable). Kind segmented control. Date + time pickers (15-min increments). Duration quick-pick (1h/2h/3h/4h + custom). Location text input, auto-defaulted from customer address. Crew multi-select with inline role override. Notes textarea. Submit → create/update RPC. Conflict warning: `getCrewConflicts()` query runs on every change (debounced 200ms), warnings rendered under the crew picker.
- `+ New event` button top-right of the schedule page.
- Empty-state copy per brief.
- **`pnpm smoke`** with `/schedule` after this sub-step.

### Sub-step 6 — DAY view + LIST view + filters + URL state
**Commit:** `feat(schedule): day view, list view, filters, url state`

- `components/app/calendar-day.tsx` — single day, same hour rows but wider event blocks. Day picker at top.
- `components/app/calendar-list.tsx` — table view (Date / Time / Kind / Order # / Project / Customer / Crew / Location / Status). Sortable per column. Pagination 50/page.
- `components/app/schedule-filter-bar.tsx` — chips for kind / crew / status / search (with the existing nuqs pattern from `/orders`). Dismissible chip per active filter.
- Date navigator label changes per view: "Apr 22–28, 2026" (week), "Wed, Apr 24, 2026" (day), "All events" (list).
- All view state (date, view mode, filters, search) URL-synced.
- **`pnpm smoke`** for `/schedule?view=day` and `/schedule?view=list`.

### Sub-step 7 — Drag-to-reschedule on week and day views
**Commit:** `feat(schedule): drag to reschedule on week and day views`

- @dnd-kit/core is already in the project (used by orders kanban) — reuse the same primitives.
- Each event block becomes a `useDraggable`; each day-column-hour-slot in the week, and each hour-slot in the day view, becomes a `useDroppable`.
- Drop handler:
  - Compute new `starts_at` from the drop slot. Duration stays the same. Same-day validation per Q4.
  - Optimistic local update.
  - Call `updateOrderEvent({ id, starts_at })`.
  - On success: `toast.success("Rescheduled")` + conflict toast if any (Q8).
  - On failure: revert the optimistic update + `toast.error`.
- Activity log: AFTER UPDATE trigger on `order_events` writes a `rescheduled` action if `starts_at` or `duration_min` changed (vs `updated` for everything else). The trigger compares OLD vs NEW.
- Same drag behavior on the Day view. List view has no drag (it's a table; not a calendar).
- **`pnpm smoke`** unchanged from sub-step 6; drag is interactive — manual smoke in dev browser.

### Sub-step 8 — Order detail sheet "Events" tab
**Commit:** `feat(orders): events tab on order detail sheet`

- New tab between Overview and Files: Overview | Events | Files | Activity.
- `components/app/order-events-tab.tsx`:
  - `+ Add event` button top-right (opens `event-dialog.tsx` with the order pre-set and disabled).
  - List of events for this order sorted by `starts_at asc`, rendered as cards. Each card shows the spec layout (kind chip, date/time/duration, crew, location, status, action buttons).
  - Buttons per event: **Open** (opens schedule view filtered to this event's day), **Mark complete** (status update inline), **Edit** (opens dialog), **Delete** (AlertDialog confirm), **Send to crew** (opens the modal — sub-step 9).
  - Past events with non-`scheduled` status show colored status pill.
- The Overview tab's read-only install-date / measurement-date fields (from sub-step 1) gain a "View in Events tab →" affordance.
- **`pnpm smoke`** with `/orders?order=<id>&tab=events`.

### Sub-step 9 — "Send to crew" modal + `/j/[slug]` public route
**Commit:** `feat(schedule): send-to-crew modal + public share link page`

Combined per Q14. This is the riskier sub-step — extra smoke coverage, two integration scripts.

- **Copy Text tab:**
  - `lib/share-link/format-text.ts` — pure function that takes event + order + customer + crew, returns the formatted text block per spec. Emoji + multi-line text exactly per brief.
  - `lib/share-link/slug.ts` — base62 slug generator (Q9, hand-rolled).
  - `components/app/send-to-crew-modal.tsx` — shadcn `Dialog` with `Tabs`. Top-right of the dialog: link state — "No active link" / "Active link · Last opened 12 min ago" / "Link revoked".
  - Copy button uses `navigator.clipboard.writeText`; toast confirms. After copy, intent links: `whatsapp://send?text=<encoded>` (macOS/Windows/Linux all open the WhatsApp app if installed), `sms:?body=<encoded>` (Mac Messages / iOS), and `mailto:?body=<encoded>`. Each is a link, not an auto-open.
  
- **Shareable Link tab:**
  - If no active link exists: a single button "Generate link" → calls `create_event_share_link` RPC → renders the URL + copy button.
  - If active link exists: shows the URL, copy button, "Rotate token" button (calls `rotate_event_share_link` → new slug, old slug now returns 404), "Revoke" button (calls `revoke_event_share_link`).
  - Last-opened-at display refreshes on dialog open (single targeted query).

- **Public page `/j/[slug]`:**
  - Route at `app/j/[slug]/page.tsx` — OUTSIDE `(app)`. No auth required.
  - Server component fetches event via `lib/supabase/admin.ts` (service-role) — joins event + order + customer + contractor + crew + order's image attachments. Pre-signs photo URLs with 1h TTL.
  - Slug validation: row exists AND `revoked_at IS NULL`. Anything else → render the `<LinkUnavailable>` component (identical 404 shape — uniform 404 timing per Q2).
  - Updates `last_opened_at` after a successful render — fire-and-forget; failure doesn't block the page.
  - Page layout (mobile-first):
    - Top: kind chip + status chip
    - Title: "Install — TM-1042 — Johnson kitchen"
    - Date/time block with "Open in Maps" link (constructed as `https://maps.google.com/?q=<urlencode(location_text)>`)
    - Customer name + tel: link
    - Order details: stone, edge, cutouts
    - Notes (if any)
    - Photos gallery (re-use `<FileGallery>` from Task 2A — it's already client-safe and doesn't depend on `(app)` context)
    - Crew list
    - Action buttons (per current status): "Mark on my way" / "Mark arrived" / "Mark complete" / "Mark no-show"
    - Footer: `"Throughstone — sent by {org.name}"`
  - Status update action: server action `markEventStatusViaShareLink({ slug, status })` — re-validates the slug (defense in depth), calls `update_event_status` with `p_via_shared_link=true` using service-role. No CSRF token (the slug IS the token).
  - The page does NOT show: customer email, customer address-line-2 (apt #s feel like over-share), order monetary fields, contractor billing info. Only what's in the brief's text block plus the photo gallery.
  - `<LinkUnavailable>` page — plain neutral card: "This link is no longer active. Ask the shop for a new one."

- **`<head>` controls** on `/j/[slug]`:
  - `<meta name="robots" content="noindex, nofollow">` so the URLs never land in a search index.
  - No `next/link` prefetch from anywhere.
  - No internal links from outside this page to it.
  - `<meta name="referrer" content="no-referrer">` — so opening "Maps" doesn't leak the Throughstone URL.

- **Integration scripts** (Q-side requirement — write but don't commit, run before declaring done):
  - `scripts/test_event_create.ts` — sign in as demo owner, call `create_order_event` with a valid payload, verify the row + activity log + assignments. Edge: mismatched org, expect rejection. Edge: invalid assignment crew_id, expect rejection. Cleanup.
  - `scripts/test_event_share_link.ts` — generate a link, GET `/j/<slug>` via fetch (against the running dev server), verify 200 + content. Rotate; GET old slug, expect 404. Revoke; GET, expect 404. Cleanup.
  - `scripts/test_event_status_via_link.ts` — generate a link, POST status update from a non-authenticated session, verify event row updated + activity_log row written with `actor_id IS NULL, metadata.via = 'shared_link'`.

- **`pnpm smoke`** including `/j/:slug` (resolved at startup to the seeded slug from sub-step 3 — wait, no, seed doesn't create share links by default; the smoke script will skip the slug template since no rows exist. **Adjustment**: I'll have the seed generate one share link for one demo install event so the smoke check has a target. Add to sub-step 3 — actually, simpler: have the test_event_share_link.ts script leave one link behind for the smoke run, and let smoke check happen after the integration scripts. Final shape: seed creates one share link for one event in sub-step 3. Cleaner.)

### Sub-step 10 — README + DEVLOG wrap + final smoke
**Commit:** `docs: readme + devlog updates for scheduling`

- README — new "Scheduling" section in the feature list, paragraph on the data model (one event = one calendar block; assignments link crew to events; shareable links replace WhatsApp dispatch). Mention `/j/[slug]` public surface explicitly so future devs know it exists. Field-role demo login.
- DEVLOG — closing entries per sub-step (written inline as we go). Final "Deferred" section:
  - Two-way Google Calendar / iCal / Outlook sync (Task 5)
  - SMS / WhatsApp / Email push (Task 4)
  - Recurring events
  - Crew availability + scheduling optimization
  - Route optimization
  - Crew portal with auth
  - Pay tracking per crew
  - Multi-timezone support beyond org tz
  - Photos specific to install site (separate from order photos)
  - **`orders.scheduled_install_date` + `orders.measured_at` column drop** — flagged as the seam that becomes safe to drop after this task lands and bakes for a release.
  - ESLint rule for server→client value imports (from Task 2B deferred list, untouched per brief).
- **Final `pnpm smoke`** across every route in the default list. All green.

---

## Out of scope (restated)

- Two-way Google / iCal / Outlook sync.
- SMS / WhatsApp / Email push (Task 4 covers this).
- Recurring events.
- Crew availability / scheduling optimization.
- Route optimization across multiple installs in a day.
- Crew portal with auth.
- Pay tracking per crew.
- Multi-timezone support beyond org tz.
- Install-site-specific photos (separate from order photos).
- ESLint rule for server→client value imports — per brief, this is its own small task.

---

**Waiting for "go" — and your preferences on Q1–Q15 if any differ from the defaults above.**
