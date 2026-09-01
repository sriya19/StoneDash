# PLAN — Task 9: Stage-triggered customer notifications + AI note taker

Status: **DRAFT — awaiting "go"**

Task 8 (commits `971cba2` → `3178916`) is landed and pushed. This file replaces the Task 8 body for Task 9. DEVLOG entries for prior tasks remain.

The brief says both features "leverage existing infrastructure" and "neither is a new subsystem." That is true of Feature B. **It is not true of Feature A**, and the difference is the main thing I need a decision on before starting.

---

## Scope acknowledgment — what I found grounding the brief

### 1. There is no notify-customer modal. There is no customer messaging UI at all. — BLOCKER

The brief says the prompt "opens the existing notify-customer modal pre-configured with the right template, recipient, and message body." No such modal exists. Neither does anything else that sends a customer a message.

**Task 7 shipped sub-steps 1–4 of 10 and stopped.** Its DEVLOG records exactly four completed sub-steps — migration 0025, system templates + renderer, context builder, ETA backend — and its six commits end at `d9e58cd`. Sub-steps 5 through 10 were the UI: the template picker, the editable message block, the recipient wiring, the send-log write, crew favorites, the notify surface. None of them exist.

What that leaves in the tree today:

| Module | Built in Task 7 | Consumers outside its own tests |
|---|---|---|
| `lib/messaging/render-template.ts` | ✅ 13 unit tests | **none** |
| `lib/messaging/build-context.ts` | ✅ 8 integration tests | **none** |
| `lib/messaging/system-templates.ts` | ✅ 6 templates | **none** |
| `lib/messaging/phone.ts` (`wa.me`, `sms:`, `mailto:` with recipients) | ✅ | **none** |
| `message_templates`, `message_send_log` tables | ✅ | **no writes from anywhere** |

And the modal that does exist has not moved since Task 3. `components/app/send-to-crew-modal.tsx:164-167`:

```ts
const waLink   = `whatsapp://send?text=${encoded}`;
const smsLink  = `sms:?body=${encoded}`;
const mailLink = `mailto:?body=${encoded}`;
```

No recipient in any of the three — which is *verbatim the problem Task 7's own plan opened with* ("that's why nothing routes to them from the modal: there is literally no recipient in the URL"). `lib/messaging/phone.ts` was written to fix precisely this and was never wired in. It still uses the `whatsapp://` scheme that Task 7 Q7 decided to replace with `wa.me`.

**So Feature A as written cannot be built.** Its interaction model — "prompt appears → user clicks Notify customer → existing modal opens pre-populated" — has no modal to open. Building it means building customer messaging: template selection, recipient resolution from the order's customer, an editable rendered body, the three deep links, and the `message_send_log` write. That is most of Task 7's unshipped half, and it is a bigger piece of work than the prompt itself.

See **Q1**. This is the decision that sets the size of the task.

### 2. Whisper fits neither the existing OpenAI client nor the existing cost model

`lib/extraction/openai.ts` exposes exactly one function, `callChatCompletions`, which POSTs JSON to `https://api.openai.com/v1/chat/completions`. Whisper is a different endpoint (`/v1/audio/transcriptions`) taking **multipart/form-data with a file part**. There is no shared path; it is a new client function, not a parameter.

`lib/extraction/cost.ts` is harder. Its entire shape is token-based:

```ts
const PRICING = { "gpt-4o-mini": {input, output}, "gpt-4o": {input, output} };
export function costCents(model, inputTokens, outputTokens): number
```

Whisper is priced **per minute of audio** ($0.006/min), not per token. `costCents` cannot express it. This needs either a second function or a discriminated pricing union. The brief's "log Whisper + GPT-4o-mini + GPT-4o costs per note in cost_cents" quietly assumes one number covers all three — it can, but only after the cost module learns a second unit. See **Q4**.

### 3. The good news: three pieces genuinely are reusable

- **Fuzzy matching.** Migration 0023 ships `intake_match_customer_by_name`, `intake_match_order_by_project` and `intake_match_contractor_by_name` as pg_trgm RPCs, wrapped by `lib/intake/match.ts` with a `tierFor(score)` confidence banding. Feature B's Step 2 is close to a re-call, not a rebuild.
- **Storage provisioning is in migrations.** `0005_storage_policies.sql` does `INSERT INTO storage.buckets` plus four RLS policies, and `0022` extends them. The `ai-notes` bucket follows that shape exactly — no manual dashboard step, no deployment surprise.
- **Mock mode already exists.** `MOCK_AI` is the established convention across `lib/extraction/mock.ts`, `lib/intake/mock.ts` and both API routes. The brief's mock requirement needs no new mechanism.

### 4. `changeStage` is a single chokepoint — but `bulkChangeStage` is a third path

Both integration points the brief names route through one server action: the order sheet's stage picker and `orders-board.tsx:233`'s drag handler both call `changeStage()` from `lib/actions/orders.ts:296`, which calls the `change_order_stage` RPC.

That is better than the brief assumes — the prompt does not need two separate integrations, it needs one enriched return value from `changeStage`.

But `bulkChangeStage` (`lib/actions/orders.ts:320`) is a third caller, and it does **not** use the RPC — it writes `.update({ stage })` directly. So it bypasses whatever `change_order_stage` does for stage history, and it would bypass the prompt. See **Q3**; there may be a pre-existing bug hiding there.

### 5. Two smaller things

- **The dashboard KPI row is exactly full.** `app/(app)/dashboard/page.tsx:302` is `grid ... lg:grid-cols-5` containing exactly five `<KpiCard>`s. A sixth ("Notes taken this week") wraps one card onto its own row. See **Q6**.
- **`{{fabrication_days}}` will be a constant.** The brief sources it from an org-level `default_fabrication_days`, so every customer gets "typical fabrication is 10 days" regardless of their order. That is a defensible v1 and the word "typical" carries it, but it is worth naming out loud rather than discovering later.

---

## Decisions I'd like you to weigh in on

Ten. **Q1 is a true blocker** — the task's size depends on it. Q3, Q4 and Q7 change what ships. The rest have defaults I'll take silently unless you object.

### Q1. Feature A has no modal to open — how much do we build? — BLOCKER

Per finding 1. Three options:

- **(a) Build the customer notify modal as part of Task 9.** *This is my recommendation.* It is the feature the brief actually describes, it finally connects `lib/messaging/` to a user, and it fixes the recipient-less deep links that have been broken since Task 3. Cost: roughly +3 sub-steps (modal shell + template picker + recipient/body wiring + send-log write). Task 9 grows from ~12 sub-steps to ~15 and from ~1 week to ~1.5.
- **(b) Descope Feature A to prompt-plus-deep-link.** The prompt card appears and its "Notify customer" button opens the customer's WhatsApp/SMS directly with the rendered template body — no modal, no editing, no send log. Much smaller, ships in the original estimate, but the user cannot review or edit before the message leaves, which for a customer-facing message is a real risk.
- **(c) Split: Task 9 does Feature B only; Feature A becomes Task 10** after a proper "finish Task 7's UI" task.

I recommend **(a)**. The shop is deploying and this is one of the two features the boss most needs; shipping the prompt without a way to actually send is the same half-built shape Task 7 left behind, and doing it twice is how `lib/messaging/` ends up with three consumers and no owner. But (a) is a real scope increase and you should say yes to it explicitly.

**Whichever you pick, I want to name the underlying risk once:** Task 7's engine has been sitting unused for two tasks, and Task 8 found a *different* two-task-old dead-code bug (the Tailwind content glob). Code with no consumer is not verified by its unit tests. The 21 messaging tests prove the renderer renders; they prove nothing about whether a real customer message can leave the building.

### Q2. The prompt hangs off `changeStage`'s return value

Per finding 4. Rather than the frontend calling a separate `get_stage_notification_prompt` RPC after each stage change (two round-trips, and two call sites to keep in sync), `changeStage` returns the prompt payload alongside its existing result. The RPC still exists and does the work; the action calls it server-side.

**Recommendation:** one hook, both call sites inherit it. The brief's "called by the frontend after a stage change succeeds" becomes "returned by the action that the frontend already awaits." Same RPC, same semantics, one fewer network hop and no chance of the kanban and the sheet drifting.

### Q3. `bulkChangeStage` — no prompt, and it may already be buggy

It writes `.update({ stage: toStage })` directly instead of calling `change_order_stage`. I have not yet confirmed what the RPC does beyond setting a GUC for the note and writing `order_stage_history` — but if it writes history, bulk stage changes have been silently skipping it.

**Recommendation:** bulk changes do **not** prompt (five prompts from one action is hostile). Separately, I'll confirm during sub-step 1 whether the history skip is real, and if it is, file it rather than silently fixing it inside a notifications task — unless you'd rather I fix it inline.

### Q4. Whisper needs a second cost unit — extend `cost.ts` or keep it separate?

Per finding 2.

**Recommendation:** extend `lib/extraction/cost.ts` with an explicit second entry point (`audioCostCents(seconds)`) beside the existing token-based `costCents`, sharing the same "hard-code the price so a change surfaces in review" comment and the same round-up-to-the-cent rule. One module owns "what did OpenAI cost us", which is what makes the dashboard spend number trustworthy. The alternative — a `lib/notes/cost.ts` — splits that ownership on day one.

I'll also confirm empirically that `OPENAI_API_KEY` authenticates against `/v1/audio/transcriptions`, per the quality bar, rather than assuming it.

### Q5. `stage_notification_prefs`: store overrides only, don't seed 5 rows per org

The brief says seed 5 rows per org, all enabled. That means every new org needs seeding — a trigger, or a line in onboarding — and an org created before the trigger silently gets no prompts.

**Recommendation:** invert it. **Row absent = enabled** (which is what "default all on" means), and the table stores only deviations. A new org works correctly with zero rows and no seeding path. `UNIQUE (org_id, from_stage, to_stage)` still holds; "Don't ask for this" inserts a row with `is_enabled=false`; the Settings toggle upserts. The transition list itself lives in TypeScript beside `ORDER_STAGES`, which is where the other stage knowledge already lives.

This is strictly less machinery and strictly fewer ways to be wrong. It does mean the Settings table renders from the code-side list joined to whatever rows exist, rather than straight from the table — a small amount of UI code in exchange for deleting a seeding concern.

### Q6. The sixth KPI card breaks the dashboard row

**Recommendation:** put "Notes this week" into the existing five rather than adding a sixth — the weakest current card is "AI activity this month", which the note taker's spend naturally subsumes. Merging them keeps `lg:grid-cols-5` intact and avoids a lone card on row two. If you'd rather keep all five and add a sixth, the grid goes to `lg:grid-cols-3` two-up, which is a layout change I'd want you to okay first.

### Q7. Voice: what happens when transcription fails

The brief specifies the fallback ("audio recorded but not transcribed — please type what was said"). Worth pinning the state machine, because there are four distinct failures and they are not the same: no `MediaRecorder` (hide the button entirely), permission denied (recoverable, re-prompt), upload failed (retry), Whisper failed or key missing (**note still saved**, `status='failed'`, audio retained, user types the text and re-processes).

**Recommendation:** the last one keeps the audio and the row. Losing a recording the shop owner just made because a third-party API 500'd is the worst outcome in this feature.

### Q8. `ai_notes` RLS — field role creates, manager+ applies

Per the brief. The wrinkle: "field can create notes but not apply changes" means `INSERT` is `is_org_member`, but the apply path must be manager+ **and** enforced server-side, not just hidden in the UI.

**Recommendation:** the apply path is a `SECURITY DEFINER` RPC (`apply_note`) that re-checks `org_role(org_id) IN ('owner','admin','manager')` internally — the `apply_intake` shape from 0024. UI hiding is a convenience, not the control.

### Q9. Proposed-action scope for v1

The brief gives two worked examples: a scalar field update (`edge_profile`) and an event reschedule with natural-language date resolution ("next Wednesday").

**Recommendation:** v1 proposes exactly three action kinds — `update_order_field` (whitelisted scalar columns only), `reschedule_event`, and `append_order_note`. Anything else stays a bullet in the summary with no proposal, which the brief already asks for. A whitelist rather than "any column" is the difference between a feature and an arbitrary-write primitive; `balance_due` and `stage` in particular must not be settable by a sentence spoken into a phone.

### Q10. Sub-step count

The brief estimates 8–10 and then proposes 12. With Q1(a) it is 15. I'd rather show you 15 honest ones than compress into 10 that each hide a surprise. See the ordering below.

---

## Sub-steps

Assumes Q1(a). Each is one commit. Typecheck + lint + build + `pnpm smoke` green before each; dev server stopped during `build` and restarted before `smoke`, per TASK8-FOLLOWUP-01. Migration commits carry real SQL, per the `commit-msg` hook.

**Feature A — notifications**

1. **Migration 0026** — `stage_notification_prefs` (overrides-only per Q5), `organizations.default_fabrication_days`, RLS, audit trigger. Confirm the `bulkChangeStage` history question from Q3 and report.
2. **Two system templates** — `in_fabrication`, `invoice_sent` — plus `fabrication_days` in the context builder. Extends the existing `smoke:messaging` stage.
3. **RPC `get_stage_notification_prompt`** + integration test.
4. **Customer notify modal** (Q1a) — shell, template picker, recipient from the order's customer, editable rendered body. This is Task 7 sub-steps 5–7, finally.
5. **Send path** — the three deep links via `lib/messaging/phone.ts` (with recipients, `wa.me`), the `message_send_log` write, activity log with `metadata.trigger`.
6. **The prompt card** — `changeStage` returns the payload (Q2); card renders in the order sheet and on the kanban; the three actions wired.
7. **Settings → Notifications tab** — transition table, per-row toggle, template override, `default_fabrication_days`.

**Feature B — note taker**

8. **Migration 0027** — `ai_notes`, the `ai-notes` storage bucket + policies (0005 shape), RLS, audit trigger.
9. **Text note capture** — dashboard entry point, Sheet with textarea, `processing` row created.
10. **Pipeline: CLEAN + MATCH** — GPT-4o-mini summarize, then the existing `intake_match_*` RPCs. Mock-mode path first, real second.
11. **Pipeline: PROPOSE** — the three whitelisted action kinds from Q9, including timezone-aware "next Wednesday" resolution.
12. **Review sheet** — the `IntakeReviewSheet` pattern: original left, summary/points/proposals right, per-action checkboxes, three footer actions.
13. **Apply** — `apply_note` SECURITY DEFINER RPC (Q8), activity log per applied action.
14. **Voice** — `MediaRecorder` with capability detection, upload, `/api/notes/transcribe/[noteId]` with the existing HMAC pattern, Whisper client + `audioCostCents` (Q4), the four-way failure handling from Q7.
15. **`/notes` list + dashboard KPI + activity feed + `smoke:notes` + README/DEVLOG wrap.**

`smoke:notes` covers the brief's three scenarios (proposes an order update; proposes an event reschedule; matches nothing and stores summary only) plus two I want: an unmatched *entity* with a confident-sounding sentence, and a proposal targeting a non-whitelisted column, which must be refused.

---

## Risks

**The messaging engine has never run in production.** Two tasks of unit tests prove the parts work in isolation. Sub-step 5 is the first time a rendered template reaches a real phone, and that is where template/context/recipient bugs will surface — not in sub-step 2. I'll treat it as integration work, not wiring.

**"Next Wednesday" is a trap.** Resolving relative dates against the org timezone, at a 9am default, inheriting the existing event duration, near a DST boundary, is genuinely fiddly. `lib/tz.ts` exists and Task 6 already fought this. Unit-tested in isolation before it goes anywhere near a proposal.

**Whisper cost is per-minute and users control the minutes.** A 5-minute note is 3 cents; that is fine. But the soft limit needs to actually stop the recorder, not just warn, or the cost line is unbounded.

**Scope.** With Q1(a) this is two features plus the unshipped half of a third. If it needs to be smaller, the honest cut is Q1(c) — Feature B alone this week, Feature A next — not compressing Feature A into something that prompts but cannot send.
