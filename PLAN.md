# PLAN — Task 7: Messaging polish + customer notify + templates + crew favorites

Status: **LOCKED — "go" given 2026-08-23**

Task 6 (6A/6B/6C, commits `27ef42f` → `de93b95`) is landed. This file replaces the Task 6 body for Task 7. DEVLOG entries for prior tasks remain.

The through-line: the Send-to-crew modal shipped in Task 3 looks like it sends messages and doesn't. Everything here either stops that lie, removes the retyping around it, or captures the evidence that justifies real messaging in Task 8.

## Scope acknowledgment

- **The modal's deep links carry no recipient today.** `components/app/send-to-crew-modal.tsx:165-167` builds `whatsapp://send?text=…`, `sms:?body=…`, `mailto:?body=…` — no phone, no email in any of the three. That's why "nothing routes to them from the modal": there is literally no recipient in the URL. `crew_members.phone` and `.email` exist and are unused by the modal.
- **The text block is read-only.** The modal renders `formatShareText()` output (`lib/share-link/format-text.ts`) into a non-editable block, inside a two-tab shell (`text` / `link`). Templates require making that block editable and swapping its source — the tab shell and the entire share-link tab stay as-is.
- **Settings already has a Shop tab.** `app/(app)/settings/page.tsx:154` renders it, backed by `components/app/settings-shop-form.tsx` (name, slug, timezone, currency, order prefix, sequence start), gated on `canShop`. This is an extension, not a new section — see Q3.
- **Most template placeholders already have columns.** `orders` carries `stone_type`, `edge_profile`, `sink_cutouts`, `cooktop_cutouts`, `balance_due`, `project_name`, `order_number`. `customers` carries structured `address_line1/2, city, state, postal_code`. `order_events` carries `location_text`, `kind`, `starts_at`, `duration_min`, `is_all_day`. Two placeholders have **no** source: `{{shop_phone}}` (Q1) and `{{next_openings}}` (Q10).
- **RLS conventions are settled.** `is_org_member(org_id)` for org-wide reads; `org_role(org_id) IN ('owner','admin','manager')` for manager+ writes (the `contractors` shape from 0011); `WITH CHECK (false)` + `REVOKE` for append-only tables (the `contractor_payments` shape). Task 7's two tables use the first and third.

---

## Decisions & questions I'd like you to weigh in on (before I start)

Fifteen. **Q1, Q2, Q5, Q11 are blockers** — the brief as written cannot ship without a decision on each. The rest have defaults I'll take silently unless you object.

### Q1. `{{shop_phone}}` has no source column — BLOCKER

Four of the six templates interpolate `{{shop_phone}}`. There is no phone anywhere on `organizations` — the model is `id, name, slug, logoUrl, timezone, currency, orderPrefix, orderSeqStart, ownerId, timestamps`. The brief's `ALTER TABLE organizations` adds four address columns and no phone.

`profiles.phone` exists but is the individual user's — rendering "call 555-…" with whichever manager clicked Send is wrong, and the number would change per sender.

**Recommendation:** add `organizations.phone text` in sub-step 1 alongside the address columns, surfaced in the existing Shop form. When unset, `{{shop_phone}}` renders empty and the sentence degrades to "Any last questions call ." — so the renderer also needs the empty-placeholder tidy described in Q5.

### Q2. Server-side travel time cannot reuse the browser key — BLOCKER

The brief says `computeTravelTime` "uses the existing `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`". That key cannot work from the server.

`.env.example` mandates HTTP-referrer restrictions on it ("!! REFERRER RESTRICTIONS ARE MANDATORY !!", Task 3.1 Q8). Referrer restrictions are enforced against the `Referer` header a *browser* sends. A `fetch()` inside a server action sends none, so Google returns `REQUEST_DENIED`. Relaxing the restriction to make it pass would leave an unrestricted key sitting in the client bundle — precisely the bill-running scenario that warning exists to prevent.

Two further wrinkles: calling from the server is the *right* design (keeps the cached write and the key off the client), and **Distance Matrix API is legacy** — Google's current product is the Routes API (`computeRouteMatrix`).

**Recommendation:** add a server-only `GOOGLE_MAPS_SERVER_KEY`, IP-restricted, documented in `.env.example` beside `OPENAI_API_KEY`. Use Routes API `computeRouteMatrix` with `routingPreference: TRAFFIC_AWARE`. When the key is unset, `computeTravelTime` returns `null` and the UI falls back to manual ETA entry — same graceful degradation as the Places autocomplete fallback.

If you'd rather not manage a second key: we drop `lib/eta/` entirely and ETA becomes manual-only. That removes sub-step 4's backend half. Tell me which.

### Q3. Settings → Shop tab already exists

The brief says "Add a 'Shop' section to /settings > organization (or the equivalent existing settings page)". The equivalent exists (see Scope acknowledgment).

**Recommendation:** extend `SettingsShopForm` and `UpdateOrganizationInput` rather than adding a section or route. Address fields go in a visually separated group below the existing ones. The "shop address unset but install events exist" banner renders at the top of the Shop tab, not the whole settings page — a field user who can't see the Shop tab can't act on it anyway.

### Q4. `message_send_log` immutability — which existing pattern

The brief says "INSERT via server action only." A Next.js server action runs as the signed-in user, so that isn't expressible in RLS without routing through a `SECURITY DEFINER` RPC (the `contractor_payments` shape).

**Recommendation:** the lighter option. `SELECT` on `is_org_member(org_id)`; `INSERT` on `is_org_member(org_id) AND sender_id = auth.uid()`; **no UPDATE or DELETE policies at all**, plus `REVOKE UPDATE, DELETE ON message_send_log FROM authenticated`. Real immutability without an RPC for what is a plain append, and the `sender_id` check stops a member forging entries as a colleague.

### Q5. "HTML injection (should be escaped)" is the wrong test — BLOCKER

The quality bar asks the renderer to escape HTML injection. For this renderer that is actively harmful.

Rendered output goes to three places: a `<textarea>` value, the clipboard, and a URL-encoded deep link. React escapes at render; `encodeURIComponent` handles the URL. HTML-escaping inside the renderer would corrupt real message text — a customer named `Ben & Jerry's` becomes `Ben &amp; Jerry&#39;s` in an SMS, and `crew_dispatch`'s 📍🕐📌👤🪨📝 must pass through byte-exact.

There *is* a real injection risk, and it's a different one — **template injection**. If `customer_name` is the literal string `{{shop_phone}}`, a naive multi-pass renderer would expand it.

**Recommendation:** drop HTML escaping. Replace that test with:
- Single-pass substitution — a context value containing `{{…}}` is inserted literally, never re-expanded.
- `< > & ' "` survive byte-exact.
- Emoji and multi-byte characters survive byte-exact.

And per Q1: when a placeholder resolves empty, collapse the orphaned punctuation/whitespace rather than emitting `call .` — a small tidy pass, unit-tested.

### Q6. `{{site_address}}` resolution order

`orders` has no address column. Candidates: `order_events.location_text` (free text, Places-backed, Task 3.1), `customers.*` (structured), and the new `orders.site_contact_*` (a contact, not an address).

**Recommendation:** `event.location_text` → composed `customer` address → empty. The event location is most specific and most recently touched; the customer address covers orders whose events predate the location field. `computeTravelTime`'s destination resolves identically, so the ETA and the message always describe the same place.

### Q7. WhatsApp deep link — scheme and phone format

The brief specifies `whatsapp://send?phone={E.164}&text=`. Two problems. The `whatsapp://` custom scheme resolves only if the desktop app is installed — otherwise a dead link with no web fallback. And `phone=` must be digits-only: no `+`, spaces, parens, or dashes, which is exactly how phones are stored today (`"+1 (555) 123-4567"`).

**Recommendation:** `https://wa.me/{digits}?text={encoded}` — resolves to the desktop app when installed, WhatsApp Web otherwise, so the button is never dead. For digits: migration 0019 already ships `digits_only(text)` in SQL for the collision index; I'll write the TypeScript twin in `lib/messaging/phone.ts` and test both against the same inputs so they can't drift.

A limitation worth putting in the microcopy: `wa.me` works only if that number has WhatsApp. We cannot detect that.

### Q8. `sms:` separator is platform-dependent

The brief specifies `sms:{phone}&body=`. RFC 5724 says `?body=`. iOS historically accepted `&body=` and rejected `?body=`; Android and RFC-compliant handlers want `?body=`. No single string works everywhere.

**Recommendation:** `sms:{digits}?body={encoded}` — spec-compliant, works on Android and modern iOS. Not worth UA-sniffing; Task 3.1 Q9 set the precedent of refusing UA detection for this exact class of problem. If shop-floor use surfaces iOS failures, we revisit with evidence rather than pre-emptively.

### Q9. Max-5 favorites has a write race

"Soft limit via server validation" means check-then-update. Two tabs toggling at once both read 4 and both write, yielding 6 — the same check-then-insert window Task 6A hit with customer collisions, where the fix was a unique index backstopping the RPC.

**Recommendation:** accept the race here. The blast radius is a 6th chip in a picker's Favorites section — cosmetic and self-correcting. A partial unique index cannot express "at most 5 rows per org" (that needs a trigger or exclusion constraint, disproportionate for this). I'll do the count check inside a single `UPDATE … WHERE (SELECT count(*) …) < 5` so it's atomic per-statement, and note it in DEVLOG. Flagging because Task 6A chose the opposite tradeoff and I want the inconsistency to be deliberate rather than accidental.

### Q10. `{{next_openings}}` — defer

Marked "bonus if easy, skip if hard". It is not easy: "next 3 available install dates" requires a definition of availability — crew capacity, working hours, event density, timezone boundaries — that exists nowhere in the schema.

**Recommendation:** ship `ready_for_install` with the placeholder removed ("…your counters are fabricated and ready. When would you like us to install?") and put `next_openings` on the deferred list. Half-building an availability engine inside a template renderer is how the renderer stops being a pure function.

### Q11. ETA staleness needs a timestamp column — BLOCKER

`ETA_STALE_HOURS = 72` and the "subtle Refresh affordance" require knowing when the ETA was computed. The brief adds only `orders.estimated_travel_min integer`. `orders.updated_at` won't serve — it moves on every unrelated order edit, so a stage change makes a stale ETA look fresh and an untouched order never goes stale.

**Recommendation:** add `orders.estimated_travel_computed_at timestamptz NULL` in the same migration; staleness is `now() - computed_at > 72h`. Also add `orders.estimated_travel_meters integer` — `computeTravelTime` already returns `distanceMeters` and `message_send_log.metadata` is specified to record it, so not persisting it means a second paid call to recover a number we just had.

### Q12. Dashboard charts would add a charting dependency

There is no charting library in `package.json`. Adding `recharts` is ~500KB installed, landing on the dashboard's client bundle — currently 2.26 kB / 108 kB first-load, the leanest page in the app.

**Recommendation:** no new dependency. Ship the "Messages sent this week" KPI with its trend indicator (pure numbers, matching the existing KPI row), plus a channel breakdown as CSS bar rows — a flex row per channel with a percentage-width fill, which is what the KPI cards already do visually. Drop the pie chart; template-usage distribution reads better as a sorted list with counts than as six near-equal slices. If you want real charts, that's a `recharts` decision I'd rather make in the open than smuggle into a messaging task.

### Q13. Per-message `activity_log` writes will drown the feed

The standing quality bar says "every mutation writes activity_log". Taken literally, every Copy click writes an activity row. The dashboard feed is the primary "what happened today" surface; a shop sending 30 messages a day buries stage changes, payments, and intake confirmations under message noise.

**Recommendation:** `message_send_log` *is* the audit record for sends — that's its whole purpose, and it carries more structure than `activity_log` could.
- **No** `activity_log` row per message send.
- **Yes** `activity_log` for configuration changes: template override created/updated/reset, favorite toggled, shop address changed, site contact changed.

A deliberate, explicit deviation from the standing rule rather than a quiet one.

### Q14. Sub-step count: brief says 6–8, list has 13

Thirteen commits of this size is closer to two weeks than one.

**Recommendation:** consolidate to **10** (below). The merges are natural — the favorites toggle rides with the recipient picker that consumes it; the shop-address form rides with the ETA backend that needs it; README and DEVLOG wrap is one commit as always. A strict 8 would mean folding sub-steps 8 and 9 into their consumers, but 10 keeps each commit independently reviewable and each one green.

### Q15. Smoke must not spend money

`pnpm smoke` runs at every sub-step. The only new cost surface is the Routes API (~$0.005/call); templates and logging are free.

**Recommendation:** `scripts/test_message_templates.ts` is pure-function, no network. `scripts/test_message_context.ts` hits the seeded DB only. Neither calls Google. `computeTravelTime` gets a `MOCK_ETA=1` short-circuit mirroring the existing `NEXT_PUBLIC_MOCK_AI=1` pattern, set by the smoke. Real ETA calls stay manual, like `smoke:intake:real`.

---

## LOCKED — decisions from review (2026-08-23)

All four blockers approved with the recommended fixes; three deviation flags approved; one refinement added.

**Q1 — LOCKED.** `organizations.phone` nullable text. Extended into the existing `SettingsShopForm` alongside shop name and the address fields. `{{shop_phone}}` reads from it.

**Q2 — LOCKED.** `GOOGLE_MAPS_SERVER_KEY` is a **separate** server-only env var, used solely for ETA via Routes API `computeRouteMatrix`. `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` stays browser-side for Places autocomplete only.

`.env.example` must state explicitly that these are **two different keys** — reusing one key with two restriction levels defeats the purpose, because the browser key ships in the client bundle and a key permissive enough for server calls is a key anyone can lift and spend.

Degradation when `GOOGLE_MAPS_SERVER_KEY` is unset: ETA falls back to manual entry, the modal keeps working, the user types the number. No hard failure anywhere.

**Q5 — LOCKED.** Single-pass substitution, no HTML escaping. Explicit added case: `customer_name = "{{shop_phone}}"` must render literally and must not recursively expand. Emoji, whitespace, and multiline preservation tests stay as drafted.

**Q11 — LOCKED.** `orders.estimated_travel_computed_at timestamptz` + `orders.estimated_travel_meters integer NULL`. `ETA_STALE_HOURS = 72` compares against `computed_at`. The subtle "Refresh" affordance shows when stale **or** when the site address has changed since computation.

**Q3 — LOCKED (deviation approved).** Extend `SettingsShopForm` at `settings/page.tsx:154`. Shop name, phone, and address all in one form. No new section, no new route.

**Q13 — LOCKED (deviation approved).** `message_send_log` is the send record; no `activity_log` row per send. `activity_log` **is** written for config-level changes: template edit, template reset, favorite toggle, shop address change, shop phone change.

**Q14 — LOCKED.** Ten sub-steps, pairing at my discretion.

**Banner gating — added in review.** The Settings → Shop warning banner fires only when **both** conditions hold: the relevant config is missing **and** at least one install event exists. A brand-new empty account gets no nag. Two banners share this gating:
- shop address unset + install events exist → "Set your shop address to enable automatic ETA computation."
- `GOOGLE_MAPS_SERVER_KEY` unset + install events exist → ETA is manual-only.

The install-event count is queried once and cached in the settings layout rather than re-counted per banner.

---

## Sub-step ordering

Each sub-step: implement → typecheck → lint → build → `pnpm smoke` → update DEVLOG → commit. Same protocol as Tasks 3 through 6.

**Migration-drift guard:** sub-step 1 is the only one carrying SQL. Its commit names the migration and its diff contains `supabase/migrations/0025_messaging.sql` — the `commit-msg` hook from `22579e9` enforces this. No later sub-step mentions "migration" in its subject line.

1. **Migration 0025 + Prisma.** `message_templates` (brief columns, `UNIQUE (org_id, slug)`, `INDEX (org_id, audience)`, `updated_at` trigger; RLS: SELECT `is_org_member`, writes `org_role IN ('owner','admin','manager')`). `message_send_log` (brief columns + three indexes; RLS per Q4 — SELECT `is_org_member`, INSERT `is_org_member AND sender_id = auth.uid()`, no UPDATE/DELETE policies, `REVOKE UPDATE, DELETE`). `orders` += `site_contact_name/phone/email`, `estimated_travel_min`, **`estimated_travel_computed_at`**, **`estimated_travel_meters`** (Q11). `crew_members` += `is_favorite` + partial index `(org_id) WHERE is_favorite`. `organizations` += four address columns + **`phone`** (Q1). Audit triggers on `message_templates` only — `message_send_log` is itself a log (Q13). Prisma pull + generate. Verify: `supabase migration list` shows 0025 both sides; `git status` confirms the `.sql` staged before commit.

2. **Seed templates + renderer.** Six system defaults at `is_system_default=true`, org-scoped, with `ready_for_install` rewritten to drop `{{next_openings}}` (Q10). `lib/messaging/render-template.ts` — pure, single-pass, empty-placeholder tidy. `lib/messaging/phone.ts` — `digitsOnly()`, twin of the 0019 SQL function. `scripts/test_message_templates.ts`, 10 tests: happy path; every placeholder across all six bodies; missing → empty + tidy; nested `{{…}}` not re-expanded; `< > & ' "` byte-exact; emoji byte-exact; whitespace/newlines preserved; unknown placeholder handling; `digitsOnly` parity against the SQL function's known outputs.

3. **Context builder.** `lib/messaging/build-context.ts` — every placeholder except `next_openings`. `site_address` per Q6; `cutout_summary` composed from `sink_cutouts` + `cooktop_cutouts`; `balance_due` formatted via the org's `currency`; `assertNoQueryError` on the order/event reads. `scripts/test_message_context.ts`, 5 tests: customer only; `site_contact_*` override wins; order with contractor; standalone event (order-derived keys empty, no throw); all-day event (`event_time` renders "All day", matching the Task 3.1 formatter convention).

4. **ETA backend + shop address.** `lib/eta/google-distance-matrix.ts` — Routes API `computeRouteMatrix`, `GOOGLE_MAPS_SERVER_KEY`, `MOCK_ETA=1` short-circuit, `null` on any failure. `refreshOrderEta(orderId)` writes all three cached columns. `ETA_STALE_HOURS = 72`. `SettingsShopForm` + `UpdateOrganizationInput` extended with address + phone (Q1/Q3), Places autocomplete reused from Task 3.1, warning banner when address unset and install events exist. `.env.example` documents the new key. Batch recompute of future install events on address save.

5. **Modal revamp.** The big one. Template chips filtered by audience; editable textarea; deep links now carrying recipient (Q7/Q8); disabled buttons with "No phone on file" tooltips; crew picker with Favorites section; customer picker auto-selecting site contact; contractor picker; the explanatory microcopy that is the actual point of the task; `logMessageSend` on every Copy/WhatsApp/Messages/Email writing `recipient_snapshot` + `metadata`; inline ETA input with "Compute from address" when `install_eta` is picked and no cached value. Share-link tab untouched.

6. **Notify customer + site contact.** `[Notify customer]` beside `[Send to crew]` on install-kind events across all four surfaces (EventBlock, calendar-list rows, EventDialog footer, order-events-tab rows), opening the modal pre-set to customer audience + `install_eta`. Site contact card on order detail Overview with "Copy from customer"; same collapsed group in the new-order dialog.

7. **Crew favorites.** Star toggle on `/team`, `★ Favorites` divider, atomic count-checked update (Q9), toast on limit.

8. **Template management UI.** New `messaging` tab beside `shop`/`members`/`ai`. Override-on-edit per the brief's insert-don't-mutate rule; reset deletes the org row so the system default reappears. Edit modal with read-only title, body textarea, placeholder reference sidebar with example values, and live preview against a sample context.

9. **Send history surfaces.** Messages tab on the order detail sheet (50 most recent, expandable rows, newest first); send-count badges on schedule day-view events.

10. **Dashboard KPI + README + DEVLOG wrap.** "Messages sent this week" KPI + trend + CSS channel breakdown (Q12). Smoke additions: `/settings?tab=messaging`, order detail Messages tab, `/team` favorites section. README: messaging section, `GOOGLE_MAPS_SERVER_KEY` setup, placeholder reference table. DEVLOG close-out + deferred list.

---

## Risks I'm holding

- **The microcopy is the deliverable, and it's the easiest thing to under-invest in.** Everything else here is schema and UI; the actual reported problem is that users think the buttons send. If the copy is wrong or buried, the task fails even with all ten sub-steps green. I'll put it directly under the button row, not in a tooltip or a collapsed hint.
- **`wa.me` still can't confirm delivery, and now it looks more official.** Adding a real recipient makes the flow feel more automated than it is, which could *deepen* the "why didn't it send?" confusion rather than resolve it. Mitigation is entirely in the copy. Worth re-checking against shop use after a week.
- **Editable body + template override is two features that look like one.** A user edits the textarea for one message; a user edits the *template* for all future messages. If those are visually adjacent and similarly styled, people will click the wrong one. The "Edit template for future messages" affordance needs to read as clearly heavier than typing in the box.
- **`recipient_snapshot` is the only defence against a useless log.** If crew or customers get renamed or deleted, `recipient_id` dangles. The snapshot must be written at send time from the same object the deep link used — not re-fetched — or the log will disagree with what was actually sent.
- **Distance Matrix → Routes API migration is a small unknown.** I've specified `computeRouteMatrix` but haven't called it in this codebase. Response shape and error semantics differ from the legacy API. If it fights back, the fallback is manual-ETA-only (Q2) and I'll flag it before burning time.
- **Six templates is a guess at the real vocabulary.** The shop will want a seventh within a week, and this task ships no create-template UI (out of scope per brief). Expect a follow-up; the `slug` + override design at least makes adding one a seed change rather than a schema change.
- **Sub-step 5 is disproportionately large.** Template picker, editable body, three recipient pickers, four deep links, logging, and ETA input in one commit. If it starts sprawling I'll split the recipient picker out rather than let it become unreviewable — flagging now so a mid-task split isn't a surprise.

## Written but out of scope for this task

From the brief: real WhatsApp Business API; Twilio SMS; two-way messaging; server-side email delivery (Resend/SendGrid); user-created custom templates; message scheduling; group WhatsApp; delivery receipts; reply notifications back into StoneDash; a dedicated contractor messaging flow.

Added by the Q-locks above:
- `{{next_openings}}` and any scheduling-availability engine (Q10)
- Charting library and the pie chart (Q12)
- Per-message `activity_log` rows (Q13)
- DB-level enforcement of the 5-favorite cap (Q9)
- UA-driven `sms:` separator selection (Q8)
- Detecting whether a number is WhatsApp-registered (Q7)

---

**Waiting for "go" — and decisions on Q1, Q2, Q5, Q11 specifically. The other eleven have defaults I'll take as written unless you say otherwise.**
