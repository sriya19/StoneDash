# PLAN — Task 5: AI document extraction

Status: **DRAFT — awaiting "go"**

Turn StoneDash from a data tracker into a smart assistant. Every file uploaded to an order runs through a classification + extraction pipeline; the user sees a proposal, confirms or edits, and the confirmed extraction becomes real state (order fields filled in, expiry reminders scheduled). The AI never writes without a human in the loop.

This task builds ahead of real-data validation of Task 4's CSV import. The Task 5 DEVLOG opening entry will carry: **"Built before real-data validation of Task 4 CSV import. Prioritize revalidating Task 4 flows once real data is imported."**

## Scope acknowledgment

I understand:
- Every uploaded file gets a `file_extractions` row. Status flows `processing → review → confirmed | declined | failed`.
- Six document types: `template`, `contract`, `invoice`, `license`, `insurance`, `other`. Each type has a defined field set + downstream effects.
- The `Files` tab in the order-detail Sheet gets a status chip per card plus a "Review extraction" pill that opens a two-column review sheet.
- A brand-new `reminders` surface: bell icon + badge in the top bar (with client polling), a `/reminders` full-page view, dismiss / complete actions. This is the first "notifications-adjacent" surface in the app.
- Settings gets a new `AI & extraction` tab (org-scoped toggles + spend readout).
- Dashboard gets a fifth KPI card (`AI extractions this month`) and the activity feed learns new `file_extraction:*` verbs.
- OpenAI is used directly (no abstraction layer yet). `gpt-4o-mini` for classification (~15× cheaper), `gpt-4o` for extraction of supported types. Never send org / user identifiers to the model — only file contents and generic instructions.
- `NEXT_PUBLIC_MOCK_AI=1` short-circuits the OpenAI call with canned responses. Smoke uses this; real dev use flips it off to test the real path.
- New `pnpm smoke:extraction` stage: `/reminders` + `/settings?tab=ai` renders + DOM assertion that a review chip appears when the mocked kickoff completes.

---

## Decisions & questions I'd like you to weigh in on (before I start)

### Q1. Fire-and-forget vs. queue for kickOffExtraction

The brief calls out two options for background execution:
- **(A) fire-and-forget internal fetch** — `kickOffExtraction()` calls `POST /api/extract/[fileId]` via `fetch` with `keepalive`, doesn't await. Works in dev + Vercel Node runtime without extra infra.
- **(B) Vercel Cron / Supabase Edge Function** — cleaner semantics, but adds infra + differs between dev and prod.

**Recommendation: (A) for v1.** Same tradeoff already accepted for other async patterns in the codebase (the send-to-crew "SMS" is a copy-paste modal, not a real dispatch job). The DEVLOG entry for sub-step 3 will note the fire-and-forget caveat: if the Node runtime is torn down between the response returning and the fetch completing, the extraction can silently drop. In practice on Vercel that window is `~50ms` and `keepalive` covers it; on long-running Node dev servers it's a non-issue. Follow-up task if it ever matters: a `stuck_processing` reaper that finds `status='processing'` rows older than 5 minutes and re-kicks.

The `/api/extract/[fileId]` route uses a **signed internal token** in the `Authorization` header (HMAC of `fileId + timestamp` with a server-only secret) so the route accepts the fire-and-forget call without a user session. That token is verified alongside the "user is a member of the org that owns the file" check on the *originating* server action — so authorization ends up as: (server action verifies user + org) → (server action mints HMAC + fires fetch) → (route verifies HMAC + reloads org context from `file_id`). Prevents cross-org kicking via URL guessing.

### Q2. Where extraction runs during dev without OPENAI_API_KEY

`OPENAI_API_KEY` is required for real extractions. Dev workflow without it:
- **Missing key** — dev-server prints one-time `console.warn` on the first `kickOffExtraction()` call. The extraction row is written with `status='failed'`, `error_message='OpenAI key missing'`. UI still renders the failed-chip state so you can develop UI without the key.
- **Mock mode (`NEXT_PUBLIC_MOCK_AI=1`)** — the route handler returns canned per-document-type extractions immediately. Cost logged as `0` cents. The mocked payloads live in `lib/extraction/mock.ts` alongside the real prompts so the two stay shape-compatible.

Note: the env var is named `NEXT_PUBLIC_MOCK_AI` per the brief, but the flag is only read on the server (route handler). Naming it `NEXT_PUBLIC_*` is unusual for a server-only signal — recommendation is to keep the brief's name (it's easier to remember which env you're in when the flag shows up in the client bundle even if unused). DEVLOG entry for sub-step 3 will note this.

### Q3. PDF-to-image conversion library

Three candidates:
- **`pdfjs-dist`** — Mozilla's canonical PDF parser. Heavy (~1.5 MB), but works in Node; render-to-canvas requires `node-canvas` which is native-code + can't ship to Vercel serverless functions without extra work.
- **`pdf-lib`** — pure JS, small, but only creates/manipulates PDFs; doesn't render to raster images.
- **Send PDFs directly** — GPT-4o accepts PDFs via the `input_file` content-part type in the newer Chat Completions API. No conversion needed.

**Recommendation: send PDFs directly.** Skip conversion entirely for v1. GPT-4o handles PDF input natively via the file-input content part. If the model can't read a scanned PDF it returns low confidence and we surface a `failed` state — the OCR-fallback that the brief already declared out-of-scope. The 5-page cap becomes "first 5 pages of any input" enforced by uploading the file trimmed if we need to (but we don't need to for the v1 sizes we'll see: shop CSVs are typically 1-3 page PDFs).

If Model API rejects the direct-PDF pattern for some file, fallback: mark `status='failed'` with `error_message` noting the format. Real-world PDFs from shop owners will overwhelmingly be one of: (a) scanned image inside a PDF wrapper (GPT-4o handles), (b) directly-generated invoice/contract PDFs (GPT-4o handles better than scans). Both work.

### Q4. Where org-scoped extraction settings live

Two options for the toggles (`auto-extract on/off`, `email-on-review on/off`):
- **(A) new columns on `organizations`** — clean, RLS is free, but scatters small settings across the table.
- **(B) new `org_settings` key-value table** — one row per (org, key). Extensible for the next batch of toggles (Task 6+ SMS opt-in, etc.).

**Recommendation: (A) two columns on `organizations`** (`ai_auto_extract boolean`, `ai_email_on_review boolean`). The whole surface has 2 toggles; a KV table is over-engineering. If we hit 10 toggles later, migrate to `org_settings` then. Simplest thing that works.

### Q5. Reminders as a separate table vs. reuse activity_log

The brief specs a `reminders` table. But `activity_log` already has the `entity_type`/`entity_id`/`metadata` polymorphic shape.

**Recommendation: separate table.** Reminders have a fundamentally different lifecycle (future-dated, dismissed_at, completed_at, user-targeted) that `activity_log` doesn't model. Also: RLS on `activity_log` is org-wide READ; reminders need user-scoped read (only show *me* the reminders assigned to me). Trying to overload activity_log would either weaken its policies or duplicate the metadata.

Reminders live in a new `reminders` table with the exact shape the brief specifies, plus one addition: a `link_url text` column so `create_reminder` can encode the "click me to jump to the source file" link at write time (rather than reconstructing it at render time from `source_type` + `source_id`).

### Q6. Bell-icon polling interval + backoff

`/reminders` count needs to feel fresh but not hammer the server. Options:
- **(A) SWR-style 30s poll** — always live, small load.
- **(B) On-focus + on-visibility change only** — no timer at all, refreshes when the tab regains focus.
- **(C) Both: focus + 60s timer as backstop.**

**Recommendation: (C).** The visible timer is 60s (not 30s) because reminders are minute-scale, not second-scale — an owner won't miss anything from a 60s delay, and the bandwidth savings compound across users. Focus-listener catches the "come back from another tab" case immediately. Cancelled when tab is hidden (`document.hidden`). Same interval as the file-card polling (sub-step 5).

### Q7. Extraction status chip while polling — is the row visible immediately?

The upload flow today: file lands in Supabase Storage → `registerAttachment()` inserts the `order_attachments` row → server action returns → UI does `router.refresh()` and the file card appears with its metadata.

For extraction: we want the chip to render *at the same time* the file card renders (no second beat where the chip appears half a second later). Which means the `file_extractions` row needs to be `INSERT`-ed synchronously in `registerAttachment()` (with `status='processing'`), and only then fire-and-forget the extraction.

**Locked:** `registerAttachment()` inserts the file row + a matching `file_extractions` row with `status='processing'` in a single transaction. Then it calls `kickOffExtraction()` which is fire-and-forget. UI polls until `status !== 'processing'`.

### Q8. Confidence tier — does the model self-assess reliably?

The brief specs a `confidence` field (`high` | `medium` | `low`) as model-self-assessed. LLM self-confidence is notoriously wobbly: models will happily say "high confidence" on hallucinated fields.

**Recommendation: keep the field but treat it as advisory.** Prompt the model for a confidence tier in the extraction JSON schema, store what comes back. Do NOT use it to gate downstream actions. UI shows it as a small muted badge next to the document-type badge. If we find `confidence: high` extractions being wrong at rates that make the badge misleading, we swap it for a per-field "model was certain / model was guessing" heuristic derived from `response_format` output shape. Defer for v1.

### Q9. Two-model call (mini + full) vs. one call

Brief spec: `gpt-4o-mini` classifies, then `gpt-4o` extracts if the class is supported. Cost math for a typical measurement sheet at (1000 input tokens + 200 output tokens):
- Mini classification: `1000 * $0.00015 / 1000 + 200 * $0.0006 / 1000 = $0.00015 + $0.00012 = $0.00027` → ~0 cents.
- 4o extraction: `1000 * $0.005 / 1000 + 200 * $0.015 / 1000 = $0.005 + $0.003 = $0.008` → 1 cent.
- Total: ~1 cent per document. Adds up to $0.10 for 10 documents/day, $3/month for a small shop.

Alternative: single `gpt-4o` call that returns `{classification, fields}`. Cost same for supported types; slightly more expensive for `other` (still paying full-4o for a "this is not a supported type" answer).

**Recommendation: keep the two-call flow.** The 15× cost savings on unsupported types matters when a shop owner uploads 50 random photos of a slab. The extra ~200ms round-trip on supported types is fine (the UX is async anyway). Log both cost lines separately in `cost_cents` (sum, but note the breakdown in `raw_response` so we can attribute).

### Q10. What "confirm and apply" does when the order already has values

For `template` / `contract` extractions, we might extract `stone_type = "Calacatta Gold"` when the order already has `stone_type = "Quartz Gray"`. Three options:
- **(A) Always overwrite** — simpler code, but risky. User might have manually corrected the field and re-extracting the file overwrites their edit.
- **(B) Never overwrite** — safer, but frustrating when the extraction is right.
- **(C) Per-field toggle in the review sheet** — the user chooses which fields to apply per confirm. Fields that are non-null on the order default to *unchecked*; empty fields default to *checked*.

**Recommendation: (C).** Matches "the AI never writes without user confirmation" — the user sees "will overwrite: stone_type = Calacatta Gold (was: Quartz Gray)" and can uncheck it. The proposed-actions checkboxes the brief already spec'd cover this exact case.

### Q11. Field role permissions for extractions

Brief locks it in: `field` role can SELECT extractions but NOT `confirm/decline/re-extract` (manager+). RLS mirrors this — a `field_no_write` policy or an `org_role() >= manager` gate on the server action.

**Locked:** all mutation server actions (`confirmExtraction`, `declineExtraction`, `reExtractFile`) explicit-check `hasAtLeast(role, 'manager')` and return `{ ok: false, error }` if not. RLS also blocks the UPDATE at the policy level as belt-and-suspenders. The chip renders for field users but the "Review extraction" pill is muted+disabled with a small "manager+ can review" tooltip.

### Q12. Sub-step boundaries and natural pause points

12 sub-steps, three natural pause points:

- **After sub-step 4** (backend + server actions complete, no UI yet). The extraction pipeline is round-trippable via the smoke script but the app's Files tab still looks like today. Worth a pause to confirm the backend behaves before the UI depends on it.
- **After sub-step 7** (backend + Files-tab UI + downstream actions all wired). This is the first moment where a user can upload a file, watch it flip to `review`, click through, and see downstream state change. Full feature-loop, minus dashboard + settings + reminders polish. Worth a customer demo.
- **After sub-step 11** (smoke additions land). Full feature-complete + tested. Sub-step 12 is docs only.

You can override with "go straight through" or "stop now" at any point.

---

## Sub-step ordering

1. **Migration `0018_extractions.sql`** — `file_extractions` + `reminders` tables + CHECK constraints + RLS policies + indexes + `set_updated_at` triggers + audit triggers writing to `activity_log`. `organizations` gets two boolean columns (`ai_auto_extract`, `ai_email_on_review`) with `DEFAULT true` / `DEFAULT false`. `prisma db pull` + `pnpm db:generate` to update the generated types.

2. **Reminders foundation UI** — server queries in `lib/queries/reminders.ts`, server actions `dismissReminder` / `completeReminder`, `<ReminderBell>` client component wired into the topbar (60s + focus poll, badge count), `/reminders` full-page view with tabs (Active / All / Dismissed). No reminder-creation code yet — those come from extractions in sub-step 7.

3. **Extraction pipeline backend** — `app/api/extract/[fileId]/route.ts`, `lib/extraction/openai.ts` (thin OpenAI wrapper), `lib/extraction/prompts.ts` (per-doc-type system prompts + JSON schemas), `lib/extraction/mock.ts` (canned responses), `lib/extraction/cost.ts` (token → cents math). HMAC-signed internal call: `lib/extraction/internal-token.ts`. Warns on `console` at server startup if `OPENAI_API_KEY` is missing (like the Maps key note in the existing README). `NEXT_PUBLIC_MOCK_AI=1` short-circuits.

4. **Server actions** — `lib/actions/extractions.ts`: `kickOffExtraction(fileId)` (fire-and-forget POST to the internal route with signed token), `confirmExtraction(extractionId, editedFields, actionOpts)`, `declineExtraction(extractionId, reason)`, `reExtractFile(fileId)`. RBAC gates on all three mutations. `registerAttachment()` extended to insert a matching `file_extractions` row + call `kickOffExtraction()` in the same request. All mutations write `activity_log` via the audit trigger from sub-step 1.

5. **File-card status chip + polling** — new `<ExtractionChip>` component. Sits below the filename on each file card in the order-detail Files tab. Renders one of five states per the brief. `useExtractionsPolling(fileIds)` client hook that polls only files whose current status is `'processing'` and stops when they move. 2s interval per the brief. Chip on `'review'` is clickable and opens the review sheet (built in sub-step 6).

6. **`<ExtractionReviewSheet>`** — right-side Sheet, 60/40 split. Left: source preview (`<img>` for images, `<embed>` for PDF, zoom buttons). Right: header + `document_type` + `confidence` badge, form fields specific to the type (rendered by a small dispatcher on `document_type`), proposed-actions section with checkboxes (initially derived from a "what would this do" preview endpoint that runs the same code path as the confirm action but doesn't commit — pure calculation), footer buttons `[Decline] [Re-extract] [Confirm and apply]`. Uses a controlled form (no react-hook-form for this one — the field set is dynamic and rhf resolver would add complexity).

7. **Downstream action application** — implements the "confirm and apply" logic. `lib/extraction/apply.ts` with `applyExtraction({extraction, edits, selectedActions, auth, supabase}): Promise<AppliedAction[]>`. Types: `update_order_field`, `create_reminder`. Per Q10, per-field toggle: fields already populated on the order default to unchecked. Reminder creation for `license` / `insurance` (30d + 7d) and `invoice` (due_date). Writes `applied_actions` JSONB list on the extraction row for audit. Each action also fires a targeted `activity_log` entry.

8. **Settings → AI & extraction tab** — new `TabsTrigger`/`TabsContent` on `/settings`. Two toggles bound to the `organizations` columns (server action `updateAiSettings`), read-only monthly spend (SUM(cost_cents) WHERE `date_trunc('month', created_at) = current_month`), read-only per-user pending reviews count. Email toggle carries a small "email delivery lands in a follow-up task" note per the brief.

9. **Dashboard KPI + activity feed** — new KPI card `AI extractions this month` (X confirmed · Y pending review, cost readout below). Activity feed learns new phrases: `file_extraction:created` → "AI extracted a {type} from {file_name} · needs review", `file_extraction:confirmed` → "{who} confirmed a {type} extraction — applied {N} actions", `file_extraction:declined` → "{who} declined a {type} extraction". Clicking a `needs review` row routes to `/orders?order={oid}&tab=files&extraction={id}`.

10. **Seed data** — `supabase/seed.ts` extended to write 3-4 canned `file_extractions` rows onto existing seeded orders + attachments. One `review` template, one `confirmed` license (with associated `reminder` rows for 30d + 7d), one `failed`. `raw_response` on seeded rows is a minimal `{ seeded: true }` marker so it's obvious those didn't come from the real pipeline. Seed does NOT call OpenAI — DEVLOG notes.

11. **Smoke additions** — `pnpm smoke:extraction`:
    - SSR: add `/reminders` and `/settings?tab=ai` to the pages matrix.
    - DOM: `scripts/smoke_extraction_flow.ts` — sign in, kick a mocked extraction on a seeded attachment (via test helper endpoint `/api/extract/[fileId]?mode=mock` that skips the OpenAI call), poll the file card, assert the chip flips from `processing` → `review` in DOM.
    - Wired into `pnpm smoke` via `pnpm smoke:extraction`.

12. **README + DEVLOG wrap** — new **AI document extraction** section in README (data model summary, the fire-and-forget architecture note, the `NEXT_PUBLIC_MOCK_AI` toggle, the "no org/user ids in prompts" data-minimization rule). DEVLOG close-out summarizing the 12 sub-steps + a **What's intentionally deferred → From Task 5** section: bulk re-extract of Task-4-imported files, email delivery, WhatsApp/SMS reminder dispatch, model-agnostic abstraction, custom document types, streaming progress, per-user cost caps. **Prominent one-liner: "Built before real-data validation of Task 4 CSV import. Prioritize revalidating Task 4 flows once real data is imported."**

---

## Risks I'm holding

- **`registerAttachment` is a hot path.** Sub-step 4 changes it to also insert a `file_extractions` row + kickoff a fetch. Bug in the kickoff should NOT fail the upload — wrap in try/catch, log, continue. Storage upload + `order_attachments` insert stay authoritative.
- **The Sheet component's portal + zoom preview together.** Radix Sheet portals to document.body; heavy image preview on the left column can cause layout thrash on first paint. Plan is to render preview inside a fixed-aspect container so the sheet's layout is stable while the image loads.
- **PDF preview in the browser.** `<embed>` works for direct-PDF but is styled differently per browser; if it's ugly, fall back to converting the first page to a signed PNG URL via a server endpoint. Deferred to see if `<embed>` is good enough.
- **Cost surprises.** GPT-4o pricing has changed twice in six months. `cost_cents` computation should be a lookup table keyed by model name + date — if we hard-code the current rates and OpenAI changes them, our telemetry drifts silently. Fine for v1 (~$3/mo for a small shop); revisit if the number matters.
- **Activity feed noise.** Extraction verbs join contractor, order, event verbs in one feed. If a busy shop generates 50 extractions in a day and each is a separate row, the feed drowns. Consider the dedupe/collapse pattern we already use for contractor allocations (sub-step 8-14 of Task 2B). Defer unless the customer flags it.
- **Fire-and-forget can drop.** Documented in Q1. Follow-up: a `stuck_processing` reaper cron.
- **Task 4 real-data drift.** This task modifies `registerAttachment()`. If Task 4's CSV import somehow uses the same code path at import time (it doesn't today), a bug here could regress Task 4. It doesn't and won't, but call it out.

## Written but out of scope for this task

- Retroactive extraction on files uploaded before this task landed. Handled in a follow-up (`Re-extract all files` batch action, RBAC-gated).
- Email + SMS reminder dispatch. Toggle exists but is UI-only.
- Streaming extraction progress. Client polls; server writes when done.
- Custom document types. The six types are hard-coded per the brief.
- Model-agnostic abstraction (Claude / Gemini / hybrid). OpenAI direct for v1.
- OCR fallback for handwritten measurement sheets. If GPT-4o can't read it, we say so honestly (`failed` status).
- Per-user or per-org cost caps / rate limits. Nothing stops a shop from uploading 10,000 PDFs and running up a bill; only production concern if the beta grows.

---

**Waiting for `go` before starting sub-step 1.**
