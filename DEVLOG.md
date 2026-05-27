# DEVLOG — Stone&DesignBoard

Running log of decisions, assumptions, and deferred items. Newest first.

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
