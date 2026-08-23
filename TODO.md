# Follow-ups

Tickets deliberately deferred out of a PR to keep it reviewable. Pick up when there's a lull.

---

## ~~TASK7-FOLLOWUP-01~~ — CLOSED: ai_intake match test phone collision

**Addressed via per-run persona.** `scripts/test_ai_intake_match.ts` now builds its exact-phone fixture from the reserved 999 exchange plus the run stamp's last four digits, so no fixed number exists to collide with.

Originally filed against commit `46cdf60`, which switched to a fixed `(555) 999-8823`. That removed the immediate collision but left another fixed number in place. The per-run form is the durable fix — note the originally-proposed remedy ("scope the assertion to `__MATCH__%` rows") would not actually have worked: `runMatches` searches all customers, so the test cannot restrict what the matcher sees.

## ~~TASK7-FOLLOWUP-02~~ — CLOSED: `smoke_intake_pipeline` assertion was state-dependent

**Addressed via per-run persona.** `scripts/smoke_intake_pipeline.ts` asserted that a fresh mock intake proposes `create_customer`. That held only while no customer matched the fixture persona in `lib/intake/mock.ts` (Amelia Ross, `(555) 411-8823`). Once that intake was confirmed through `/intake` on 2026-08-22, `apply_intake` created a real Amelia Ross, Step B correctly matched her, and the proposal legitimately contained no `create_customer`.

The matcher was right; the assertion was wrong — it encoded "this persona has never been onboarded", which is not an invariant of a database people actually use.

Fixed by giving the smoke a unique identity per run (`__SMOKE__Amelia_${stamp}` / `(555) 999-${stamp4}`), passed to the mock route via `persona_name` / `persona_phone` query params honoured in mock mode only. `mockIntakeExtraction()` gained an optional persona override to support it. Cleanup also deletes `__SMOKE__%` customers defensively, in case the smoke ever grows an apply step.

## TASK7-FOLLOWUP-03 — Mock-intake personas exist as real customers in the demo org

The seeded demo org's `customers` table now contains mock-intake personas as real rows, because they were confirmed through `/intake` during first-use testing on 2026-08-22: **Amelia Ross** `(555) 411-8823`, **Dee Mourateedes**, **Maria Gocso**. All three were created by the Demo Owner account via `apply_intake`, alongside four `confirmed` `ai_intake_events` (the seed ships one).

Before onboarding Top Marble's real production data, clean these out with a targeted `DELETE`, or clear-and-re-seed the demo org.

Not urgent, and not a correctness problem — the tests no longer depend on their absence (FOLLOWUP-01, -02). It is a tidiness issue that becomes a data-quality one the moment the demo org stops being purely demo.

---

## Thread `assertNoQueryError` through remaining silent-error sites

**Context:** `lib/auth.ts` and `app/onboarding/page.tsx` now throw a readable exception when a Supabase read returns an error (rather than treating it as "no row" and silently redirecting). Six more read sites still destructure only `{ data }` and swallow any error. None can produce a redirect loop — they're all read-only display queries — but making them consistent means the next RLS misconfiguration is a stack trace, not an empty list.

**Scope (6 sites):**

| File | Query | Effect of silent failure |
|---|---|---|
| `app/(app)/layout.tsx:26` | `org_members.select("organizations(...)")` for sidebar org switcher | Sidebar shows only the active org (there's already a fallback for that) |
| `app/(app)/settings/page.tsx:42` | `org_members.select(...)` for the Members tab | Members tab renders empty |
| `app/(app)/dashboard/page.tsx:124` | `profiles.in("id", actorIds)` for activity-feed actor names | Feed shows "—" avatar initials |
| `app/(app)/orders/page.tsx:114` | Same pattern for the detail sheet's Activity tab | Same |
| `app/invite/[token]/page.tsx:29` | `org_members.select(...)` via admin client | Invite page shows "Invite not found" |
| `lib/actions/settings.ts:186` | `admin.from("profiles").select("active_org_id")` inside `acceptInvite` | Fallback "set active_org_id if missing" always fires (harmless) |

**How:** Import `assertNoQueryError` from `lib/supabase/errors.ts`, capture the full `{ data, error }` from each call, call `assertNoQueryError("<caller>:<query>", error)` before reading `data`. Same pattern as `lib/auth.ts`.

**Not in scope:** Graceful "show a toast, keep the page alive" handling. For Task 1-era code the throw is the correct behavior (dev sees the error, prod sees the Next.js error boundary). If we later add a per-page error UI, revisit.
