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

## TASK8-FOLLOWUP-01 — `pnpm build` silently breaks the running dev server the smoke needs

**Symptom:** `pnpm smoke:dom` reports `0 testid` on the two `/orders` order-detail-Sheet targets while `/schedule` still passes. Reproducible, not flaky, and it reproduces with the working tree stashed — so it looks like a pre-existing failure or a data problem. It is neither.

**Cause:** `next dev` and `next build` both write to `.next`. The documented per-commit gate is *typecheck → lint → build → smoke* with `pnpm dev` running in another terminal, so following it exactly has `build` overwrite the chunks out from under the live dev server. The Radix-portalled surfaces are what break first, which is why `/schedule` (server-rendered event blocks) keeps passing and the two portal targets go to zero — the failure looks targeted enough to send you hunting in the wrong place. Found during Task 8 sub-step 3; cost ~15 minutes of bisecting a CSS-only diff.

**Workaround in use:** stop dev → build → restart dev → smoke. `rm -rf .next` before restarting if the server was up during a build.

**Real fix, deferred:** give build its own output directory so the two can never collide — read `distDir` from an env var in `next.config.mjs` and set it in the `build` script. Deliberately *not* done inside Task 8: `distDir` is exactly the kind of setting the parallel Vercel deployment track depends on, and changing where build output lands from a UI-color task is how you break someone else's week. Coordinate with that track, then do it.

**Cheaper interim option:** have `smoke_send_to_crew_dom.ts` fail with "0 of N expected — is your dev server stale after a build?" instead of a bare `0 testid`. The script knows how many events the order has; it could say so.

---

## TASK8-FOLLOWUP-02 — blue-on-blue: `delivery` events sit close to the new nav blue

`delivery` defaults to the `blue` palette key, and Task 8 made nav/links/focus blue. Measured, the two are close enough to note:

| | light | dark |
|---|---|---|
| Nav active row tint vs. a delivery block's tint | `#EFF6FF` vs `#E2ECFE` — **16.6** RGB units apart | `#172554` vs `#263858` — 24.3 apart |
| Nav strip (blue-600) vs. event stripe (blue-500) | `#2563EB` vs `#3B82F6` — 39.6 apart | — |

**Not observed in practice, and that is the point of this ticket.** The demo org has only `measurement`, `install` and `task` events — no `delivery`, `pickup` or `repair` — so no screenshot in this task shows a blue event next to the blue nav. The numbers say "close"; whether it actually reads as confusing needs an org with delivery events on the calendar.

Mitigating factors, for whoever picks this up: the two live in different regions (sidebar vs. grid), a delivery block carries a full-strength stripe, a 40%-alpha border and near-black blue text that a nav row does not, and the calendar's "today" highlight and drag affordances were deliberately kept terracotta in Task 8 partly to stop the grid drifting entirely blue.

If it does read badly, the fix is **not** to re-tune `--info` — that would unpick the whole split rule. Change `KIND_DEFAULT_COLOR.delivery` to `indigo` or `teal`, which is a one-line change in `lib/events/color.ts` and gated by `pnpm smoke:events`. Task 8 explicitly ruled the default kind→color mapping out of scope, which is why this is a ticket rather than a commit.

## TASK8-FOLLOWUP-03 — no mobile layout at 375px (pre-existing)

At 375px the sidebar renders expanded at ~240px, leaving ~135px of content, and the schedule week grid (`64px repeat(7, minmax(0,1fr))`) collapses to unreadable slivers. Every authenticated route is affected, not just the calendar.

**Predates Task 8** — verified against the pre-task commit `d9e58cd` in a scratch worktree, where `/dashboard` at 375px shows the identical overflow. Task 8 changed colors and 4px of padding on event blocks; it did not touch a grid template or a breakpoint. Recorded because the task's quality bar asked for verification at 375 / 768 / 1280 and 768 is fine while 375 is not, so "verified at three widths" would be a misleading thing to write down without this.

Real fix is a mobile layout pass: collapse the sidebar to icons or a sheet below `md`, and give the week grid a horizontal scroll container or a day-at-a-time fallback on small screens. That is a layout task, explicitly out of Task 8's scope.

---

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
