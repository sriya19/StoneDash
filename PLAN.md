# PLAN — Task 6: Three fixes from real shop use

Status: **DRAFT — awaiting "go"**

Three fixes surfaced now that Top Marble's real data is flowing through StoneDash. Two are small friction removers (6A + 6B); one is a flagship "AI screenshot intake" agent (6C). Shipping order: 6A → 6B → 6C. The small fixes unblock daily use immediately while the big one builds.

## Scope acknowledgment

- **6A** — the New Order flow already has an inline-customer path in the validator (`InlineCustomer` in `lib/validators/orders.ts`), and the current dialog toggles a mini-form via `inlineCustomer` state. What's missing: (a) the combobox itself doesn't offer "+ Create '<typed>' as new" as a persistent option, (b) collision detection against `(lower(name), phone)`, (c) the same treatment on `<QuickAddOrderSheet>`, (d) atomicity — `createOrder` today does two separate INSERTs (customer, then order), so a mid-flight order failure leaves an orphan customer.
- **6B** — event colors are today mapped from `event.kind` via three separate hardcoded lookup tables (`KIND_BG` in `event-block.tsx`, `KIND_CHIP` in `order-events-tab.tsx`, `EVENT_KIND_COLOR` in `crew-detail-sheet.tsx`, `kindBadge` in `app/j/[slug]/page.tsx`). All four need to consolidate into one `getEventColor(event)` helper. New column: `order_events.color text NULL`. New palette: 10 curated keys.
- **6C** — the flagship. Screenshot-in → structured proposal → single-transaction apply. Reuses Task 5's shape (HMAC-signed internal route, mock-mode via `NEXT_PUBLIC_MOCK_AI`, fire-and-forget kickoff, `applied_actions` JSONB shape, three-step pipeline) with three material differences: (1) matching is a real local-DB step, not just LLM output; (2) the proposal is a deterministic dispatcher, not free-form; (3) confirm can write to *four* different tables in dependency order.

---

## Decisions & questions I'd like you to weigh in on (before I start)

### Q1. `createOrder` transactionality with inline customer

Today: `createOrder` INSERTs the customer, then INSERTs the order, then optionally creates events via RPCs. Each INSERT is its own txn. If the order INSERT fails after the customer INSERT succeeds, we have an orphan customer.

Two paths to fix:

- **(A)** Wrap the whole thing in a `SECURITY DEFINER` RPC (`create_order_with_customer`) that runs both INSERTs in one Postgres txn. Clean atomicity, but adds another RPC to maintain and duplicates validation logic already in Zod.
- **(B)** Compensating delete: catch the error path and DELETE the just-created customer. Simpler code, but if the DELETE fails (RLS regression, connection blip) we're back to an orphan — worse: a silent one, because we've already returned the error to the caller.
- **(C)** Best-effort: keep the two-INSERT shape, use a savepoint-style pattern via a bulk RPC that both writes accept.

**Recommendation: (A).** The RPC pattern is what we already do for `record_contractor_payment` (`0012_contractor_payment_rpc.sql`) — atomicity + RBAC in one place. Cost: one new RPC (~30 lines of PL/pgSQL). Benefit: no orphan customers ever, ever. The RPC also becomes the single place where `(lower(name), phone)` collision detection runs — catches the race where two managers create the same customer inline within a second of each other. **Locked pending your go.**

The `createOrder` server action becomes: single `supabase.rpc('create_order_with_customer', { p_customer, p_order })` call. The event-scheduling follow-ups (`create_order_event` for measurement / install dates) stay outside the RPC — they're already atomic per-event and a failure there should NOT roll back the order (Task 4 pattern: warn but keep the order). Sub-step 1 DEVLOG entry notes this asymmetry.

### Q2. Collision detection: what counts as "same customer"?

The brief specifies `(lower(name), phone)`. That's the right primary key for a de-dupe. Edge cases:

- **Different phone formats** — `(555) 123-4567` vs. `5551234567`. Normalize both sides to digits-only before comparing.
- **Same phone, slight name typo** — `Sarah Johnson` vs. `Sara Jonson`. We do NOT catch this as a collision (name isn't exact). Acceptable — the trigram-based fuzzy match in 6C's Step B will still surface these as suggestions when the user re-visits.
- **Same name, different phone (father/son)** — NOT a collision. Different real people.
- **NULL phone on either side** — the brief says phone is required on the inline form (already the case in the `InlineCustomer` validator: `phone: z.string().trim().min(4)`). So both sides always have a phone in the collision check.

**Locked:** normalize phones to `[^0-9]` stripped, lowercase name via SQL `lower(name)`, exact match on both. The RPC returns `409 Conflict` (via a Postgres exception with a sentinel error code) that the client renders as `"This looks like [existing customer] — use them instead?"` with a one-click switch to the matched `existingCustomerId`.

### Q3. 6B: palette storage — text keys vs. hex

Two options:

- **(A) Store palette keys** (`terracotta`, `green`, `blue`, ...) as text in `order_events.color`, look up hex via a client-side map. Migration-safe: if we later swap a palette color from `#16A34A` to `#22C55E`, all existing rows shift with it.
- **(B) Store hex directly** (`#C2410C`). Portable, no lookup needed, but a palette change means either a migration or accepting drift.

**Recommendation: (A).** Palette drift is a design decision, not a data one. Also constrains the CHECK constraint to a fixed set of ~10 values — the DB rejects anything else, so a rogue client can't inject arbitrary hex. Locked.

CHECK constraint: `color IS NULL OR color IN ('terracotta','green','blue','purple','amber','rose','teal','indigo','slate','brown')`.

### Q4. 6B: what happens to existing events on migration

Every existing `order_events` row today has an implicit color derived from its kind via `KIND_BG`. After the migration, `color IS NULL` and the same lookup happens client-side via `getEventColor`. No data change needed — the new default logic reproduces the old rendered output for every existing event. Migration is additive-only, zero risk. **Locked.**

### Q5. 6B: replace vs. augment `KIND_BG`

Four files currently hold hardcoded kind→color maps. Post-6B, all four should call `getEventColor(event)`. But `getEventColor` needs to know the visual context — full background for `EventBlock`, small chip for `KIND_CHIP`, marker dot for `crew-detail-sheet`, badge on `/j/[slug]`.

**Recommendation:** `getEventColor(event)` returns a palette KEY (`"green"`, `"purple"`, etc.). A companion `EVENT_COLOR_CLASSES[key]` has per-variant class maps: `{ bg, chip, dot, badge }`. Each caller pulls the variant it needs. Central palette + per-variant Tailwind = one place to change colors, one place to add variants.

### Q6. 6B: color picker UX inside the event dialog

- **10 circles in a row.** Compact — fits below the Kind selector without pushing the fold.
- **Ring around the current selection.** When `color IS NULL`, ring on the kind's default with a subtle `(default)` label.
- **Dirty flag.** Once the user clicks any circle, the ring is "explicit" and does NOT follow when they later change the Kind. If they want to go back to kind-default they click a small "reset" affordance next to the picker. Tracked via a `colorDirty` boolean in local form state.

Locked.

### Q7. 6C: HMAC + fire-and-forget vs. synchronous

Task 5 pattern is HMAC-signed internal token + fire-and-forget POST + client polling for status. Should intake use the same shape or run synchronously?

**Recommendation: same shape.** The intake pipeline is *slower* than Task 5's extraction (Step A alone is a 2-4s vision call; Step B is 100ms; Step C is 1ms). Making the user wait synchronously on the upload response would tie up the browser for 3+ seconds per screenshot. Fire-and-forget + polling matches the ergonomic pattern already in place, and reuses `mintInternalToken` / the internal-token verifier. The intake row lands with `status='processing'` synchronously (same Q7 lock as Task 5); the `/api/intake/[intakeId]` route runs the pipeline; the `/intake` page polls via `/api/intake/status` for state transitions.

### Q8. 6C: what runs during the internal route

The brief lays out three steps. Only Step A is expensive (vision LLM). Steps B and C are local logic — pg_trgm queries and pure JS.

**Locked ordering inside the route:**
1. Load intake row + download screenshot from Storage.
2. **Step A** — vision LLM (or mock).
3. **Step B** — pg_trgm queries against the org's customers/orders/contractors.
4. **Step C** — deterministic proposal dispatcher (pure function).
5. Write all three JSON payloads (`extraction`, `matches`, `proposal`) to the row, flip to `status='review'`.

Step B and C are always run — even in mock mode — because they're the interesting local logic that we want to test *without* burning credits. Step A short-circuits when `NEXT_PUBLIC_MOCK_AI=1` OR `?mode=mock` OR one of three fixture keys (`?fixture=whatsapp_new_job` / `?fixture=scheduling_matches` / `?fixture=unclear`) is set. Sub-step 5 wires this.

### Q9. 6C: date resolution against org timezone

The brief calls out relative-date resolution: "Monday" resolves against today's date in the org timezone. Two choices for where this happens:

- **(A) Inside Step A's prompt.** Give the LLM today's ISO date in the system prompt and let it resolve the date. Nice — LLM already handles the natural-language.
- **(B) After Step A.** LLM returns both a raw string ("Monday") AND the resolved date. Server-side post-processing sanity-checks the resolution and re-parses if it looks wrong.

**Recommendation: hybrid.** Prompt tells the LLM "today is 2026-07-07, org timezone is America/New_York; resolve any relative dates against this and return both raw + resolved". Return schema requires both keys. The server accepts the LLM's resolution when it parses as `yyyy-MM-dd` AND is within 60 days of today AND is not in the past by more than 3 days (allowing for "yesterday" etc). If validation fails, drop the resolved value and keep only the raw string — the review sheet then lets the user pick a date manually.

### Q10. 6C: pg_trgm indexes

We're going to fuzzy-match customer names, order project names, and contractor names. Without indexes, `similarity(name, 'sarah johnson') > 0.4` scans the whole customer table per intake.

**Locked:** add GIN trigram indexes in sub-step 2's migration (alongside enabling the extension):
- `CREATE INDEX customers_name_trgm_idx ON customers USING gin (lower(name) gin_trgm_ops);`
- `CREATE INDEX orders_project_trgm_idx ON orders USING gin (lower(project_name) gin_trgm_ops) WHERE project_name IS NOT NULL;`
- `CREATE INDEX contractors_name_trgm_idx ON contractors USING gin (lower(name) gin_trgm_ops);`

Bundling the extension enable in 6B's migration per the brief. Also bundle the new `repair` kind + amber default color for it.

### Q11. 6C: dependency order on confirm

The proposal can trigger up to four writes: (create customer) → (create order) → (create event) → (append note to order). Confirm runs them in a single server action. If any fails, the whole transaction rolls back — no partial state.

**Locked:** implement as ONE SECURITY DEFINER RPC `apply_intake` that:
1. Validates each proposed action against a whitelist (belt-and-suspenders — the client can't smuggle a novel action key).
2. Runs in dependency order inside one Postgres txn.
3. Copies the screenshot from `intake/` folder to the target order's attachment folder (as a bucket-level copy, not download+re-upload).
4. Writes ONE `activity_log` row with `metadata.via = 'ai_intake'` AND `metadata.summary` — a rendered human-readable sentence naming every entity created. The `activity_feed` `phraseFor` branch for `activity_log.action='ai_intake:applied'` reads that string directly rather than reconstructing it from the metadata bag. Format lock (from user refinement): `"AI intake created customer Sarah Johnson + order TM-1055 (Kitchen remodel) + event Meas Mon Jun 8 — from WhatsApp screenshot."`
5. Updates the intake row: `status='confirmed'`, `applied_actions=<list>`, `reviewed_by`, `reviewed_at`.

Same RBAC gate as everywhere else — manager+ only.

### Q12. 6C: screenshot storage separation

Brief says: on confirm, COPY (not move) to the order's folder; the intake keeps its own copy for audit. Two files: one in `{org}/intake/{intake_id}-{filename}`, one at the standard attachment path `{org}/{order_id}/{uuid}-{filename}`. Both are 1× storage cost; deletion of the intake row leaves the attachment; deletion of the attachment leaves the intake. Explicit — no cross-referencing FK.

### Q13. 6C: real-API smoke — three synthetic fixtures (user refinement)

Brief: "REAL API test: after mock-mode tests pass, run [three] real GPT-4o call[s] against [three] real screenshot fixture[s]" — expanded per user refinement to cover the three primary request_type paths:
- **(a) `whatsapp-new-job.png`** — a customer requesting a new kitchen job. Assert: `extraction.request_type='new_job'`, `matches.matched_customer=null`, proposal has `create_customer` + `create_order` actions.
- **(b) `email-scheduling-matches-seed.png`** — a scheduling request that matches a seeded order by customer name + project. Assert: `request_type='scheduling'`, `matched_order.id` = the seeded id, proposal has a `create_event` action with the resolved date.
- **(c) `sms-ambiguous.png`** — a vague message that shouldn't drive any writes ("Hey, quick question about my counters"). Assert: `request_type='question'` or `'unclear'`, proposal is empty or `no_op`.

All three fixtures generated once via `scripts/build_intake_fixture.ts` (Playwright rendering canned HTML → PNG), committed to `test/fixtures/`. The real-API smoke stage runs all three real GPT-4o calls, asserts the per-fixture shapes, and logs cumulative `cost_cents` in DEVLOG. Budget: ~15¢ total. If `OPENAI_API_KEY` is missing, the stage skips gracefully.

**Explicit caveat retained:** synthetic HTML-rendered PNGs are NOT phone screenshots of real WhatsApp threads. This smoke verifies the pipeline's happy paths, not real-world accuracy. Real accuracy = shop usage.

### Q14. Pause points

12 sub-steps, three planned pauses:

- **After sub-step 3** (6A + 6B complete). All the small-fix daily-use blockers cleared. Real shop can use it. Worth a beat before starting 6C.
- **After sub-step 7** (6C matching + proposal logic land). The interesting local intelligence is proven end-to-end via unit-style test cases; only UI and apply remain. Worth a check-in on the matching test cases before wrapping the sheet UX around them.
- **After sub-step 10** (feature-complete except docs). Ready for real screenshots.

You can override with "go straight through" or "stop now" at any point.

---

## Sub-step ordering

1. **6A — Inline customer creation.** Migration: new SECURITY DEFINER RPC `create_customer_and_order(p_customer jsonb, p_order jsonb)` with `(lower(name), digits_only(phone))` collision detection returning a distinctive error code (`CUSTOMER_COLLIDES`) with the matched id in the message. Server: `createOrder` refactored to call the RPC when `newCustomer` is present; existing-customer path unchanged. UI: `<NewOrderDialog>` combobox gets a persistent "+ Create '<typed>' as new customer" item when the search text has no exact match; clicking it toggles the inline mini-form with `name` pre-filled. Same treatment applied to `<QuickAddOrderSheet>`. Collision UX: on `CUSTOMER_COLLIDES`, render an inline banner "This looks like [matched customer] — use them instead?" with a "Use existing" button that flips `existingCustomerId` and drops `newCustomer`. Activity log picks up `metadata.new_customer` on order creation.

2. **6B migration** at `0019_events_color_and_intake_extension.sql` — one bundled migration:
   - Enable `pg_trgm` extension (needed for 6C).
   - `ALTER TABLE order_events ADD COLUMN color text NULL`.
   - CHECK constraint on the palette keys.
   - Extend the `kind` CHECK to include `'repair'`.
   - Update `create_order_event` + `update_order_event` RPCs to accept `p_color text DEFAULT NULL` and validate the palette; also update the kind check inside the RPCs.
   - Three GIN trigram indexes (customers name, orders project_name, contractors name).
   - Prisma pull + generate.

3. **6B UI.** New shared module `lib/events/color.ts` exports `getEventColor(event) → PaletteKey`, `EVENT_COLOR_CLASSES: Record<PaletteKey, { bg, chip, dot, badge, ring }>`, `KIND_DEFAULT_COLOR: Record<EventKind, PaletteKey>`. Rewrite `event-block.tsx`, `order-events-tab.tsx`, `crew-detail-sheet.tsx`, `app/j/[slug]/page.tsx` to consume `getEventColor` + the class map — no more scattered lookups. `<EventDialog>` gets a `<ColorPickerRow>` component below the Kind selector: 10 circles, ringed on active, "(default)" label when `color IS NULL`. `colorDirty` state prevents the picker from following kind changes once the user has explicitly picked. `add 'repair' to the KIND_LABEL / KIND_STRIP_LABELS maps and its default (amber) in `KIND_DEFAULT_COLOR`. Client-side event validator (`lib/validators/events.ts`) accepts the new `color` field. Server actions pass it through to the RPCs.

4. **6C migration** at `0020_ai_intake.sql` — `ai_intake_events` table per the brief (org_id, uploaded_by, storage_path, status CHECK, extraction jsonb, matches jsonb, proposal jsonb, applied_actions jsonb, error_message, cost_cents, reviewed_by, reviewed_at, timestamps). Two indexes: `(org_id, status)` and `(org_id, created_at desc)`. RLS: `SELECT` is `is_org_member`; `UPDATE` (confirm / discard) is `manager+`; `INSERT` is `manager+` (only manager+ can trigger intakes). Audit triggers write `activity_log` on CREATE + status_changed. Bucket convention documented (`{org}/intake/`). Also: SECURITY DEFINER `apply_intake` RPC scaffolded (empty body — real implementation lands in sub-step 10).

5. **6C pipeline (Step A).** `lib/intake/prompts.ts` — the vision system prompt with the six fields the brief lists, the request_type enum, urgency enum, and the today-date-injection pattern from Q9. `lib/intake/types.ts` — the `IntakeExtraction` shape + zod validator. `lib/intake/pipeline.ts` — orchestrator that calls Task 5's `callChatCompletions` with the intake schema. `lib/intake/mock.ts` — three fixtures: `whatsapp_new_job`, `scheduling_matches`, `unclear`. `app/api/intake/[intakeId]/route.ts` — HMAC-verified, service-role storage download, mock-mode short-circuit, cost logging via Task 5's `costCents`. Fire-and-forget kick-off via `kickOffIntake(intakeId)` (mirrors Task 5's `kickOffExtraction`). `insertIntakeRow` in an intake actions module.

6. **6C matching (Step B).** `lib/intake/match.ts` — pure functions consuming an `IntakeExtraction` + a Supabase client, returning `{ matched_customer, matched_order, matched_contractor }` each with `{ id, confidence, method }`. Uses:
   - `similarity(lower(name), lower(:name))` from `pg_trgm` for name matching.
   - Digits-only phone exact match on customers.
   - Email exact match on customers.
   - `similarity(lower(project_name), lower(:project))` for order matching.
   - Confidence tiers: >0.85 high, 0.5–0.85 medium, <0.5 none.
   - Best-of-methods score aggregation.
   `scripts/test_ai_intake_match.ts` — 6+ unit-style cases per the brief: exact phone, fuzzy name (Sara Jonson → Sarah Johnson), no match, ambiguous multi-match (two Sarahs), contractor match, address-only match. Wired into `smoke:extraction`? No — it's a match-only test, cheap, always green. New `smoke:intake` chain lands in sub-step 12.

7. **6C proposal (Step C).** `lib/intake/propose.ts` — pure dispatcher: `propose(extraction, matches, orgTz): ProposedIntake`. Implements the seven request_type × match cases from the brief. Output shape is a list of `ProposedAction`s: `create_customer`, `create_order`, `create_event`, `append_note`, `no_op`. Each carries its own payload + a stable `key` (like Task 5). Also emits `alternates: ProposedAction[][]` — the brief hints at alternates but doesn't require them; v1 renders only the primary. Unit tests via `scripts/test_ai_intake_propose.ts` cover the seven mappings + edge cases (repair with no phone, scheduling with a resolved date in the past, etc.).

8. **6C UI: `/intake` page.** `app/(app)/intake/page.tsx` — Dropzone at top (drag-drop or click, PNG/JPG/HEIC, 10MB cap per file, up to 10 files at once). Below: list of intake events, newest first. Each row shows status chip (mirrors Task 5's chip semantics — processing pulse dots, review pill, confirmed check, discarded muted, failed AlertCircle), timestamp, thumbnail (signed URL from bucket), and a truncated summary from `extraction.requested_action` when present. Click a `review` row → routes to `?intake={id}` which opens the sheet from sub-step 9. `<AiIntakeButton>` in the topbar (new component, positioned next to the existing `ReminderBell` — Sparkles icon + label). Both routes gated on manager+ via server-side redirect.

9. **6C UI: `<IntakeReviewSheet>`.** Two-column pattern mirroring `<ExtractionReviewSheet>` but wider (`sm:max-w-5xl`). LEFT: screenshot preview, click to zoom (opens in a full-screen overlay). RIGHT, stacked:
   - **"What I understood"** — a plain-English summary generated from the `extraction` JSON via a small `describeIntake(extraction)` function in `lib/intake/describe.ts`.
   - **"Matched to"** — the matched entity card when present (customer name + phone, or order number + project). Confidence label. Small "Not them? Search…" combobox that lets the user override (writes to a local `manualOverrides` map that the confirm passes through).
   - **"Proposed actions"** — one editable card per action. `create_event` cards have inline pickers for date, time (defaults 9:00 org-local per brief), location, and order-link combobox. `append_note` shows the target order + a text preview. `create_customer` shows the extracted fields as editable inputs. Each card has a `defaultChecked` boolean + a header checkbox to skip.
   - Footer: `[Discard] [Confirm and apply]`.

10. **6C apply.** `confirmIntake(intakeId, edits, selectedActionKeys)` server action calls the SECURITY DEFINER `apply_intake` RPC scaffolded in sub-step 4. RPC body implements the dependency-ordered writes (customer → order → event → notes → activity_log), the bucket-level screenshot COPY (via `admin.storage.from('order-files').copy(fromPath, toPath)` — Supabase supports server-side copy), and the intake status transition. `discardIntake(intakeId)` sets `status='discarded'` + records reason. `applied_actions` on the intake row records every write with entity IDs so the /intake list can render "Created customer + order for Sarah Johnson · TM-1042" back-links.

11. **6C dashboard KPI + seed + real-API smoke.** Dashboard's "AI extractions this month" KPI card renamed to "AI activity this month" and sums both `file_extractions.cost_cents` + `ai_intake_events.cost_cents`. Sublabel breaks out both counts: `N extractions + M intakes · $X`. Activity feed learns `ai_intake:created` / `ai_intake:confirmed` / `ai_intake:discarded` verbs (Sparkles icon). Seed: 2 canned `ai_intake_events` rows — one `review` (references a seeded new-job screenshot fixture in storage), one `confirmed` (with `applied_actions` referencing seeded order + created customer). `scripts/build_intake_fixture.ts` — one-shot Playwright-driven synthetic WhatsApp screenshot generator (canned HTML → PNG at 400×800 → committed to `test/fixtures/whatsapp-new-job.png`). `scripts/smoke_intake_real.ts` — one real GPT-4o call against the fixture, asserts the extraction shape parses, logs the actual `cost_cents`. Skips gracefully when `OPENAI_API_KEY` is missing.

12. **6C smoke additions + README + DEVLOG wrap.** New `pnpm smoke:intake` chain: `scripts/test_ai_intake_match.ts` + `scripts/test_ai_intake_propose.ts` + `scripts/smoke_intake_pipeline.ts` (mock-mode end-to-end: upload → kickoff mock → poll status → apply → verify writes + screenshot attached). Chained into `pnpm smoke` alongside the existing four stages. README picks up an "AI Intake" section covering the pipeline, the fixture-based real-API test story, and the mock-mode toggle. DEVLOG close-out summarizes 6A + 6B + 6C, records the actual dev-time OpenAI spend, and reiterates the Task 4 real-data validation follow-up flag.

---

## Risks I'm holding

- **6A collision detection races.** Two managers create the "Sarah Johnson · 555-0101" customer within the same second. The RPC's `(lower(name), digits_only(phone))` collision check is inside the txn but Postgres isolation is READ COMMITTED — so both txns can pass the check and both INSERTs succeed. Fix: add a unique partial index on `(org_id, lower(name), regexp_replace(phone, '[^0-9]', '', 'g'))` where phone is not null. The second txn's INSERT then fails on the unique constraint and we surface the same `CUSTOMER_COLLIDES` error to the client with the collided row's id. Sub-step 1 DEVLOG entry will call this out.
- **6B color migration on existing events.** All zero-color rows render identically before + after because `getEventColor` falls through to kind defaults. Verified in the plan but worth an eye-check on `/schedule` before merging.
- **6C storage cost doubles per confirmed intake.** Each confirmed intake stores the screenshot twice (intake copy + attachment copy). For a shop doing 10 intakes/day: 300 extra screenshots/month × 500KB = ~150MB/mo per shop. Acceptable for v1. If it grows: swap to a symlink pattern (attachment row references the intake path).
- **6C: intake pipeline drops under fire-and-forget.** Same risk as Task 5's kickoff. Same accepted tradeoff — the reaper cron is a follow-up.
- **6C: matching false positives on high-confidence.** Trigram similarity of 0.85+ on "Sarah Johnson" vs. "Sarah Johnson (2)" for two different real people. The confidence label + the "Not them? Search…" override are the human-in-the-loop safety net. Discard rate becomes a proxy metric.
- **6C: fixture-based real-API test doesn't cover the model's real behavior on real screenshots.** A synthetic WhatsApp-style PNG rendered from HTML is *very* different from a phone screenshot of an actual WhatsApp thread — different fonts, different anti-aliasing, different UI clutter. The real-API test verifies the shape parses, not the model's accuracy. The shop's usage IS the real accuracy test. DEVLOG will call this out explicitly.
- **6C: manager+ RBAC on `/intake`.** Field users can SELECT (see the intake list) but can't INSERT (upload) or UPDATE (confirm/discard). This is a change from Task 5's `file_extractions` where field could SELECT the chip on files they had access to. Verified against the brief spec.
- **Real-data drift on Task 4.** Task 6 modifies `createOrder` (sub-step 1). If Task 4's CSV order-import path uses `createOrder` (it doesn't — it uses `runImportCommit` + direct INSERTs), a bug here could regress the import. Not a concern in practice; noted for the "when in doubt, re-smoke import" reflex.

## Written but out of scope for this task

- Email forwarding intake (forward to `intake@yourshop.com`). Needs SMTP + a webhook — a real infra lift.
- Auto-confirm for high-confidence intakes. Everything requires human review in v1. Non-negotiable per brief.
- Multi-screenshot stitching. Each PNG processed independently; a 3-image WhatsApp thread becomes 3 intakes today.
- WhatsApp Business API (receiving messages directly).
- Retroactive re-matching (adding a customer later doesn't back-fill matches on old `review` intakes).
- PDF and voice-note intake.

---

**Waiting for `go` before starting sub-step 1.**
