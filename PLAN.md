# PLAN — Task 3.1: Scheduling UX fixes from real shop-floor use

Status: **DRAFT — awaiting "go"**

Task 3 (Sub-steps 1–10, commits `3125ecd` → `1577e07`) is landed. This file replaces the Task 3 body for Task 3.1. DEVLOG entries for prior tasks remain.

This is a scoped fix-pack. Four feature gaps + one discoverability bug surfaced during shop-floor use. **Not a refactor** — I'll keep the surface area tight and avoid revisiting decisions that aren't directly implicated.

---

## Decisions & questions I'd like you to weigh in on (before I start)

### Q1. The same-UTC-day CHECK conflicts with the proposed all-day shape

The brief says all-day events keep `duration_min = 1440` and starts_at normalized to 00:00 org-local, and that "the existing same-day CHECK constraint stays satisfied."

That doesn't hold. The CHECK is:
```sql
date_trunc('day', starts_at AT TIME ZONE 'UTC')
  = date_trunc('day', ends_at AT TIME ZONE 'UTC')
```

For an all-day event in Eastern Time (UTC−4/−5):
- `starts_at` = 00:00 ET = 04:00 UTC
- `ends_at` = `starts_at + 1440 min` = 04:00 UTC next day
- → different UTC days → CHECK fails

This holds for any non-UTC org tz.

**Recommendation:** relax the CHECK to exempt all-day events.
```sql
ALTER TABLE order_events
  DROP CONSTRAINT order_events_same_utc_day;
ALTER TABLE order_events
  ADD CONSTRAINT order_events_same_utc_day CHECK (
    is_all_day
    OR date_trunc('day', starts_at AT TIME ZONE 'UTC')
       = date_trunc('day', (starts_at AT TIME ZONE 'UTC' + make_interval(mins => duration_min)) AT TIME ZONE 'UTC')
  );
```
All-day events bypass the rule; everything else is unchanged. Action-layer validation gets the same `OR is_all_day` short-circuit.

The alternative — store all-day events with `duration_min = 0` or `1439` — pollutes the data model with "is this 1439 a real duration or an all-day marker?" ambiguity. Cleaner to keep 1440 and exempt.

### Q2. Existing constraint name disagreement

The brief's migration sketch refers to `order_events_kind_check`. The actual name from 0013 is `order_events_kind_valid`. I'll use the real name. No behavior change — just naming clarity.

### Q3. Event "type" (order-tied vs standalone) is fixed at create time

The brief lists a segmented control "Type: [For an order | Standalone]" at the top of the dialog. Two interpretations:
- **(A)** Type is a creation-time choice and can be changed in edit mode (would let an order-tied event be detached, or a standalone event be re-attached to an order).
- **(B)** Type is fixed at create time. Edit mode shows the type as a read-only label.

**Recommendation: (B).** Converting order→standalone would orphan the relationship to (potentially) customer-derived location and the order detail's Events tab membership. Converting standalone→order is awkward because the order picker has different behavior than the type toggle. Forcing delete-and-recreate is the same posture we took for the order picker in EventDialog (sub-step 5) — consistent.

### Q4. The 'task' kind needs a color distinct from 'other'

Both 'other' and 'task' are "miscellaneous" semantically. Brief says 'task' = gray; 'other' is already zinc (a gray). Need them visually distinct.

**Recommendation:** 'task' = slate (cooler, slightly darker), 'other' = zinc (warmer, slightly lighter). Both still read as "neutral/grayscale" but distinguishable side-by-side. Color palette additions to `event-block.tsx` and the chip color maps in `crew-detail-sheet.tsx`, `order-events-tab.tsx`, and the new public page.

### Q5. Standalone events surface only on /schedule

By construction, standalone events have no order, so they don't appear in:
- Contractor detail Jobs tab (no order → no contractor)
- Customer detail orders tab (no order → no customer)
- Order detail Events tab (no order — nothing to attach to)

They appear on `/schedule` (all three views) and via direct deep-link to the edit dialog from there. Click-through opens the EventDialog in edit mode directly — no order detail sheet to bounce through. Flagging because it means the "Send to crew" surfaces (Q6) for standalone events are calendar-only.

### Q6. Send-to-crew on the EventDialog — pattern for swap

When the user opens an event for edit, the dialog should expose Send-to-crew without forcing them to close and re-find the event. Options:

- **(A)** Send button inside the dialog footer. Click → navigates to `?send=<eventId>` (without `?event`). The edit dialog auto-closes (no `?event` in URL); the send modal mounts.
- **(B)** Both modals open simultaneously (stacked). Risky — overlapping Radix portals.

**Recommendation: (A).** URL is the source of truth for which modal is open; swap is one navigation. The send modal opens with full event context (it server-side-fetches the SendModalContext anyway), so no state needs to transfer.

### Q7. Smoke testing for Send-to-crew presence

The brief asks for a test asserting every event-display component renders a button with `data-testid="send-to-crew"`. Constraint: shadcn Dialog + Sheet use Radix portals, which fill on client hydration — their content is **not in the SSR body**. So a body-grep smoke can verify:

- Week view event blocks → YES (in body)
- Day view event blocks → YES (in body)
- List view rows → YES (in body)
- Order detail Events tab rows → NO (in a Sheet portal)
- EventDialog Send button → NO (in a Dialog portal)

**Recommendation:** Add `expectBody: "send-to-crew"` to the three SSR-visible /schedule routes in `smoke_pages.ts`. Document in DEVLOG that the two portal-mounted surfaces are covered by visual inspection only (and by the Q6 swap behavior — if the modal opens from a portal'd button, the same code path that mounts the modal from /orders mounts it from /schedule). A separate Playwright-style test would be the proper fix; explicitly out-of-scope for this task.

### Q8. Google Places — element choice, country restriction, session billing

- **Element:** `google.maps.places.PlaceAutocompleteElement` (the new web component, GA in early 2025). Brief explicitly rules out the legacy `Autocomplete`.
- **Country restriction:** default to `componentRestrictions: { country: 'us' }`. Top Marble is US-based; restricting reduces noise and cost. Configurable later if we onboard non-US shops.
- **Session billing:** the new element handles session tokens automatically. One "session" = a series of autocomplete keystrokes + at most one place-details lookup. Charged once per session.
- **Cost (post-March-2025 pricing):** Autocomplete (without place details) is **free**. Place Details (which we'd hit if we wanted lat/lng/etc.) is paid. Since we only store the formatted_address string, **we can skip the place-details call entirely** and pay $0 for autocomplete. I'll note this in DEVLOG.
- **Dynamic loading:** the Maps JS SDK is large (~200KB). Load it lazily on first event-dialog open via a `<script>` injection inside the LocationAutocomplete component — don't ship it in the main bundle.
- **Graceful fallback:** if `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is unset OR the script fails to load (offline dev, ad-blocker), render a plain `<Input>`. Print a one-time `console.warn` from the component for dev visibility (not server startup — the env check is client-side because the API key is `NEXT_PUBLIC_*`).

**Recommendation:** ship as described. Env var name: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (must be NEXT_PUBLIC_ so it reaches the browser; restrict in Google Cloud Console by HTTP referrer to your domains).

### Q9. Open-in-Maps button UA detection

Brief: "On mobile, also render the Apple Maps link as the primary one on iOS." Two ways:

- **(A)** UA-sniff at render time (server-side, from request headers). Renders consistently per request.
- **(B)** Always render both links side-by-side, no primary/secondary distinction. User picks.

**Recommendation: (B).** UA sniffing in 2026 is fragile (Safari sends "Apple Maps" implicitly on iOS, but Chromium-on-iOS is also Safari-flavored; Android tablets sometimes mis-identify). Showing both is one extra button — trivial cost, zero detection risk. I'll order them: Google first, Apple second on desktop; reverse on `?mobile=1` if you ever want to test the mobile ordering, but defaulting to Google-first is fine.

If you want UA detection regardless, say so and I'll add it (15 lines).

### Q10. is_all_day starts_at storage convention

Brief: "starts_at is interpreted as the start of that day in the org timezone (00:00:00 local)."

Concrete: the RPC normalizes the input. Server action receives `date: 'YYYY-MM-DD'` + `isAllDay: true`. Computes `starts_at = parseLocalDateTime(date, '00:00', orgTz).toISOString()`. For ET, "2026-05-30" → "2026-05-30T04:00:00Z".

Activity log + view + display all read this UTC value and format via org-tz. The semantic "all day in org tz" is preserved by the formatter (any non-all-day event at that exact `starts_at` would render "12:00 AM" — but for all-day events the formatter prints "All day" by short-circuiting on `is_all_day`).

**Recommendation:** this is the convention; formatters check `is_all_day` first.

### Q11. Sub-step 7 pause-for-acknowledgment

The brief explicitly: "AUDIT first … Report the audit before making changes. Wait for my acknowledgment."

I'll split sub-step 7 into **7a (audit-only, no code changes)** and **7b (implement)**. After 7a I'll surface the table of findings and pause; on your ack I commit 7b.

---

## LOCKED — refinements from review

**Q1 — simpler CHECK + action-layer assertion.** Going with the simpler CHECK plus a duration lock and a server-action assertion. Rationale: a truly-rigorous CHECK ("starts_at = midnight org-local") needs per-row org tz, which is STABLE not IMMUTABLE and won't fit in a constraint. The duration lock catches the most likely accidental bug (someone passes is_all_day=true with a stray duration), and the action assertion catches the rest.

```sql
-- on order_events:
DROP CONSTRAINT order_events_same_utc_day;
ADD CONSTRAINT order_events_same_utc_day CHECK (
  (is_all_day = true AND duration_min = 1440)
  OR (is_all_day = false
      AND date_trunc('day', starts_at AT TIME ZONE 'UTC')
          = date_trunc('day', (starts_at AT TIME ZONE 'UTC' + make_interval(mins => duration_min)) AT TIME ZONE 'UTC'))
);
```

Plus in `lib/actions/events.ts`, when `isAllDay=true`:
- Compute `expectedStarts = parseLocalDateTime(date, '00:00', orgTz)`
- Assert the action's computed starts_at === expectedStarts. Throws "all-day events must start at midnight org-local" if not.
- Force `durationMin = 1440` regardless of caller input (silently override; the dialog hides the duration controls anyway).

DEVLOG documents the choice + rationale.

**Q7 — Playwright one-off for portal-mounted surfaces.** SSR-body grep can't see Sheet/Dialog content (Radix portals to document.body, which doesn't exist server-side). Cheerio doesn't help — same body. JSDOM + RTL is heavier setup than what we want.

Adding **`playwright` as a devDependency** (auto-downloads chromium on first run, ~150MB one-time disk cost) and **`scripts/smoke_send_to_crew_dom.ts`**:
- Launches headless chromium
- Authenticates by signing in via the anon Supabase client, then setting the resulting cookies on the browser context (same auth pattern as `smoke_pages.ts`)
- Visits each portal-mounted surface, waits for hydration via `waitForSelector`
- Asserts `data-testid="send-to-crew"` count > 0
- Surfaces covered: order detail Events tab (Sheet), EventDialog footer (Dialog)
- Surfaces still covered by SSR smoke: week / day / list event blocks

Wired into `pnpm smoke` as a two-stage chain: SSR smoke first (fast, no browser), then DOM smoke (slower, browser). DOM smoke skips with a warning if `playwright` chromium isn't installed (so devs without it can still run the SSR portion). DEVLOG documents the dep weight + tradeoff. Sub-step 7b does not ship until both stages pass.

**Q8 — API key security explicitly documented.**
- `.env.example` entry includes a multi-line comment warning that the key is browser-visible and **referrer restrictions are mandatory** (without them, anyone can scrape from the bundle and run up your bill).
- README adds a "Google Maps key setup" subsection under the scheduling how-to: enable Places API in Google Cloud Console, create a key, **restrict by HTTP referrer to `localhost:*` for dev and your production domain for prod**, optionally restrict API to Places API only.
- The fallback path (missing key) renders a plain `<Input>` — no functionality break, just no autocomplete.

---

## Sub-step breakdown

Each sub-step: implement → typecheck → lint → build → `pnpm smoke` (against running `pnpm dev`) → update DEVLOG → commit. Same protocol as Task 3.

### Sub-step 1 — Migration 0016: data model
**Commit:** `feat(schedule): standalone events, all-day flag, task kind`

- **`0016_scheduling_v2.sql`**:
  - `ALTER TABLE order_events ALTER COLUMN order_id DROP NOT NULL`
  - `ADD COLUMN title text NULL`
  - `ADD COLUMN is_all_day boolean NOT NULL DEFAULT false`
  - `ADD CONSTRAINT order_events_title_or_order CHECK (order_id IS NOT NULL OR (title IS NOT NULL AND length(trim(title)) > 0))`
  - `DROP CONSTRAINT order_events_kind_valid` + re-add with `'task'` included (Q2 — using the actual constraint name)
  - `DROP CONSTRAINT order_events_same_utc_day` + re-add with `is_all_day OR ...` (Q1)
  - `DROP VIEW v_calendar_events` + `CREATE VIEW v_calendar_events` with:
    - `LEFT JOIN orders` (was INNER) so standalone events return rows
    - `COALESCE(o.project_name, e.title) AS title` — the unified display label
    - Surface `e.is_all_day`
    - Derived `(e.order_id IS NULL) AS is_standalone`
    - All order-derived fields (`order_number`, `stone_type`, `stage`, `contractor_*`, `customer_*`) become NULL for standalone rows — that falls out naturally from the LEFT JOIN.
- `prisma/schema.prisma`: mark `order_id` nullable, add `title`, `isAllDay` to `OrderEvent`. Regenerate client (`pnpm db:generate`).
- **Verification:** apply 0016, re-run `scripts/verify_event_backfill.ts` (should still report counts match — backfill data is unchanged). Re-run `scripts/smoke_scheduling_rls.ts` (RLS unchanged, should still pass). Insert one standalone event manually via SQL editor; verify it appears in `v_calendar_events` with `is_standalone=true`. Delete it.

### Sub-step 2 — RPCs + validators
**Commit:** `feat(schedule): rpc + validator support for standalone + all-day events`

- **`0017_scheduling_v2_rpcs.sql`**: rewrite `create_order_event` and `update_order_event` to accept:
  - `p_order_id uuid` (nullable now)
  - `p_title text` (nullable)
  - `p_is_all_day boolean DEFAULT false`
  - The same-day validation in `_validate_event_same_utc_day` skips when `p_is_all_day = true`.
  - For standalone events (`p_order_id IS NULL`), the org_id is read from `auth.uid()`'s active org via `(SELECT active_org_id FROM profiles WHERE id = auth.uid())` rather than from the order. **Edge case:** this requires the caller to have an active_org_id — which `getCurrentUserAndOrg()` enforces, so the app path is always fine. RPC raises if the active org can't be resolved.
- **`lib/validators/events.ts`**:
  - `orderId` becomes `optionalUuid`
  - `title` becomes `optionalString` (max 200)
  - `isAllDay` defaults false
  - Add `kind: 'task'` to `EVENT_KINDS`, label "Task", default duration 60 min
  - Refinement: `orderId OR title` must be set
  - When `isAllDay=true`, `startTime` is ignored (server normalizes to 00:00 org-local)
- **`lib/actions/events.ts`**: thread the new fields through `createOrderEvent` / `updateOrderEvent` / `rescheduleOrderEvent`. The reschedule path needs to preserve `is_all_day` and `title` through the update (same preserve-fields gotcha as Task 3 sub-step 7).
- **Verification:** extend `scripts/test_event_reschedule.ts` to assert `is_all_day` survives the reschedule. Add a one-shot `scripts/test_standalone_event.ts` that creates a standalone event via the RPC, verifies it has `order_id IS NULL` and `title` set, then deletes it.

### Sub-step 3 — New Event dialog UX
**Commit:** `feat(schedule): type segmented control + title + all-day in dialog`

- `components/app/event-dialog.tsx`:
  - Top of form: **Type** segmented control (For an order | Standalone). Disabled in edit mode.
  - **Standalone state:**
    - Order combobox hidden
    - Title `<Input>` appears at top, required (RHF validation)
    - "Use customer address" hint hidden (no customer)
    - Default kind = 'task'
  - **Order-tied state:** unchanged from sub-step 5.
  - **All-day checkbox** between date and time. When checked:
    - Time picker hidden
    - Duration controls hidden
    - Tz abbreviation label hidden
  - Submit composes the payload per state.
- `components/app/event-block.tsx`: render `event.title` (from view) instead of `orderNumber` when `is_standalone`. The mono-font order-number line replaced with a slimmer "Task" / "Pickup" / etc. label, or hidden — to be decided in the implementation (depends on visual).
- **Verification:** typecheck/lint/build, smoke against /schedule + /orders unchanged.

### Sub-step 4 — Calendar rendering for all-day + standalone
**Commit:** `feat(schedule): all-day row above grid, standalone titles in views`

- `components/app/calendar-grid.tsx`:
  - Split events into `allDayEvents` and `timedEvents`.
  - Render an all-day strip directly under the day-header row, above the hour grid:
    - For week view: one row spanning all 7 day columns. Each all-day event is a horizontal pill anchored to its day column (or columns, if multi-day — out of scope; v1 assumes single-day all-day).
    - For day view: one row spanning the single column.
  - Grid height shrinks to fit the all-day strip (or stays the same and the strip absolutely positions — TBD by layout).
  - Drag-to-reschedule on the all-day strip: vertical drag does nothing (no time slots); horizontal drag changes the day. Sub-step 7 of Task 3 supports this via the same handler — minor extension.
- `components/app/calendar-list.tsx`:
  - Time column shows "All day" instead of `h:mm a` when `is_all_day`.
  - Sort still works (all-day events sort with starts_at = midnight org-local).
- `components/app/event-block.tsx`: support a `compact` variant for the all-day pill (one-line, no crew avatars).
- Empty-state copy in /schedule: no change needed.
- **Verification:** smoke. Inspect rendered body for the "All day" string when seeded data includes one (sub-step 8 will seed one for demo).

### Sub-step 5 — Google Places autocomplete
**Commit:** `feat(schedule): google places autocomplete for location with graceful fallback`

- `components/app/location-autocomplete.tsx` — new client component, drop-in replacement for the location `<Input>` in event-dialog:
  - On mount, check `process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
  - If unset: render plain `<Input>` + one-time `console.warn`. Done.
  - If set: dynamically inject the Google Maps JS SDK with `&libraries=places`. Mount `<gmp-place-autocomplete>` web component inside a styled wrapper that visually matches shadcn `<Input>` (same border, padding, focus ring via Tailwind class on the wrapper).
  - Listen for `gmp-select` (new element) event. On selection, write `place.formattedAddress` to the form field.
  - User can still type freely after a selection — the underlying input is editable.
  - Country restriction: `'us'` by default (configurable later).
  - Session token: handled automatically by the element.
- `lib/actions/events.ts`: no change — `locationText` is still a string.
- `.env.example`: add `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=` with a comment block (5 lines) explaining setup: enable Places API in Google Cloud Console, create an API key, restrict by HTTP referrer to localhost + production domain.
- DEVLOG note: post-March-2025 pricing — autocomplete alone is **free** because we don't call PlaceDetails. We pay $0/mo for the autocomplete UX. Documented inline.

### Sub-step 6 — Open-in-Maps link buttons
**Commit:** `feat(schedule): open-in-maps link buttons across event surfaces`

- `components/app/maps-links.tsx` — small shared component:
  - Props: `location: string | null`
  - Renders nothing if location is empty.
  - Else: two small `<a>` buttons side-by-side (Google + Apple), `target="_blank"`, `rel="noopener noreferrer"`.
  - Constructs URLs from string templates (no API calls).
- Mount points:
  - `components/app/order-events-tab.tsx` — under the location line of each event row
  - `components/app/calendar-list.tsx` — in the Location cell
  - `components/app/event-dialog.tsx` — in the location field group when editing (read-only quick links)
  - `app/j/[slug]/page.tsx` — alongside the existing "Open in Maps" (replacing the single Google-only link with both options)
- **Verification:** smoke. Visit /schedule?view=list and confirm the body contains both `maps.google.com` and `maps.apple.com` substrings.

### Sub-step 7a — Send-to-crew discoverability AUDIT (commit nothing)

Open every event-display surface (5 listed in the brief), report each as a row in DEVLOG. **No code changes.** Pause for ack.

The report will be a markdown table inserted into DEVLOG sub-step 7a placeholder, surfaced in the chat. After your ack: proceed to 7b.

### Sub-step 7b — Add Send-to-crew to all event surfaces
**Commit:** `feat(schedule): send-to-crew button on every event-display surface`

Whichever surfaces the audit found missing:
- Add a small button with `data-testid="send-to-crew"` and the `Share2` lucide icon.
- Where space allows: icon + "Send to crew" label.
- Where space is tight (calendar event blocks): icon-only with `<Tooltip>` "Send to crew". Click stops propagation so the event click-through still works for the rest of the block.
- The button navigates to `?send=<eventId>` (preserving any other URL state).
- **Required mount addition:** if /schedule doesn't already mount `<SendToCrewModal>` when `?send=<id>` is present, add it (server-component fetch of `getSendModalContext` + render — same shape as /orders sub-step 9).
- EventDialog gets a footer button: `Send to crew` next to Cancel/Save (Q6 swap pattern — close the dialog by stripping `?event` and add `?send`).

**Smoke updates:**
- `expectBody: "send-to-crew"` on `/schedule`, `/schedule?view=day`, `/schedule?view=list`.
- New route entry `/schedule?send=:eventId` to verify the modal mounts there too (was previously /orders-only).
- DEVLOG note: dialog/sheet portal-mounted Send buttons aren't smoke-verifiable; the swap behavior is covered by the modal mount route + the audit.

### Sub-step 8 — README + DEVLOG wrap + seed update
**Commit:** `docs: readme + devlog wrap + seed one standalone + one all-day event`

- `supabase/seed.ts`: add two new events to the demo data so the calendar always has examples:
  - One standalone event of kind 'task' titled "Pick up checks from Ameer", scheduled today + 1 day at 2 PM, no crew.
  - One all-day event of kind 'install' for one of the seeded orders (the Whitfield one, since it's already invoiced), `is_all_day=true`. Or, to demonstrate the standalone-all-day combo, a standalone 'task' for "Trade show" all-day.
  - I'll pick the most demo-friendly combo when implementing.
- README — add a paragraph to the scheduling section about standalone + all-day events. Update the project structure if anything changed.
- DEVLOG — closing entry per sub-step (written inline as we go), final "Deferred (Task 3.1)" list:
  - Multi-day all-day events
  - Address structured fields (lat/lng/place_id)
  - WhatsApp / SMS push from the Send-to-crew modal (Task 4)
  - Calendar sync (still deferred from Task 3)
  - Custom event kinds beyond the six current
  - UA-driven primary-Maps-link selection (we render both side-by-side; revisit if user feedback says otherwise)
  - Notifications / reminders
  - Playwright/jsdom test for portal-mounted Send buttons
- Final `pnpm smoke` across the updated default list.

---

## Out of scope (restated)

- Recurring events.
- Address structured fields (lat/lng/place_id columns).
- WhatsApp / SMS push (Task 4).
- Google / iCal / Outlook calendar sync.
- Custom event kinds beyond the six.
- Notifications / reminders.
- Multi-day all-day events (single-day is the v1 shape).

---

**Waiting for "go" — and your preferences on Q1–Q11 if any differ from the defaults above.**
