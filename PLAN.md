# PLAN — Task 2A: Orders UX fixes from real-world use

Status: **DRAFT — awaiting "go"**

5 fixes, 5 sub-steps, one commit each. Typecheck + lint + build green at every commit. Task 1's PLAN content is preserved in the git history (`da920cb` and friends) and in `DEVLOG.md`.

---

## Decisions & questions I'd like you to weigh in on (before I start)

### Q1. Enum rename approach (Fix 1)
Our stages are a Postgres ENUM (`order_stage`), not a CHECK constraint on text — your brief described CHECK-constraint behaviour. The surgical fix for an ENUM is:

```sql
ALTER TYPE order_stage RENAME VALUE 'qc' TO 'ready_for_install';
```

Supported since PG 10, works inside a transaction, keeps existing `orders.stage` / `order_stage_history` rows in place (no UPDATE needed — they now read as `'ready_for_install'` automatically). **This replaces** the `UPDATE orders SET stage = 'ready_for_install' WHERE stage = 'qc'` you described — those UPDATEs would be no-ops after the rename or fail before it because the new value doesn't exist yet. Flagging so there's no surprise about the migration body.

**Default:** proceed with `ALTER TYPE ... RENAME VALUE`.

### Q2. Is a reason required on *every* stage change, or just backward moves? (Fix 2)
Your brief says "when the user picks a DIFFERENT stage, open a small dialog" with a required reason. Taken literally, that's every change — forward and back. That's what I'll implement.

A note on friction: advancing through 3 stages in a day means 3 reason dialogs. If that's too much, I'd relax to "required on backward moves, optional on forward." But I won't assume — default is your spec, you can relax later.

### Q3. How to carry the reason from app → DB trigger (Fix 2)
The audit trigger `tg_orders_after_update` auto-writes `order_stage_history` when stage changes. If the action *also* writes history with the note, we'd get duplicate rows. Options:

- **(A) session GUC.** Before `UPDATE orders SET stage = …`, set `SET LOCAL app.stage_change_note = 'reason text'`. The trigger reads it via `current_setting('app.stage_change_note', true)` and writes it into the single history row. GUC is txn-local — no leak across requests.
- **(B) dedicated RPC `change_order_stage(id, to_stage, note)`** that internally does (A). App calls the RPC; RPC sets the GUC then `UPDATE`s. Clean function boundary.
- **(C) strip the trigger's stage-history insert, move it entirely to the action.** Simpler conceptually but any direct `UPDATE orders SET stage = …` (including future admin tooling or manual fixes) silently skips history. Footgun.

**Recommendation:** (B). Clean API, single atomic call from the app, trigger logic stays authoritative.

### Q4. "Last edited by" on notes (Fix 4)
Two implementation paths:
- **Add columns** `orders.notes_updated_by` + `orders.notes_updated_at`. Trigger populates when `notes` changes. Cheap query.
- **Query `activity_log`** for the latest `notes_updated` event for this order. No schema change; one extra query on detail-sheet render.

**Recommendation:** activity_log query. No schema churn, and it folds into the existing parallel fetch in `app/(app)/orders/page.tsx`.

### Q5. Thumbnail signed URLs (Fix 3)
Bucket is private; we already have a `createSignedUrl` action. For the gallery I'll add a batch variant `createSignedUrls(paths: string[], ttlSeconds?: number)` that calls `supabase.storage.from(...).createSignedUrls(paths, ttl)` (single round-trip). **Default TTL: 1 hour.** URLs regenerate on every page render.

### Q6. HEIC handling (Fix 3)
Safari decodes HEIC natively; Chrome/Firefox don't. I won't do server-side conversion (would need libheif / sharp-heif, not worth the weight for Task 2A). The image tile uses `<img>` with an `onError` fallback: if decoding fails, render a "HEIC — click to download" tile in the same grid slot. HEIC mimes are still classified as photos so they sit in the grid; they just can't show a thumbnail in Chromium-family browsers.

### Q7. Notes column position in the orders table (Fix 4)
I'll put a narrow (~32px) icon-only column between **Project** and **Stage**. Keeps the money columns on the right intact and puts the note next to the content it annotates.

---

## Sub-step breakdown

Each sub-step: implement → typecheck → lint → build → update DEVLOG → commit.

### Sub-step 1 — Fix 1: rename `qc` → `ready_for_install`
**Commit:** `refactor(stage): rename qc → ready_for_install (shop-operator language)`

- `supabase/migrations/0008_rename_qc_stage.sql`
  - `ALTER TYPE order_stage RENAME VALUE 'qc' TO 'ready_for_install';`
  - Wrapped in a transaction. No data UPDATEs needed — enum rename keeps rows in place.
- `prisma/schema.prisma` — rename `qc` to `ready_for_install` in `OrderStage`. Run `pnpm prisma generate`.
- `lib/validators/orders.ts` — update `ORDER_STAGES` array.
- `components/app/pipeline-strip.tsx` — update `STAGE_ORDER` + `STAGE_LABELS` (full label "Ready for Installation"; add a `STAGE_SHORT_LABELS` map with "Ready for Install" used by the kanban column header).
- `components/app/order-stage-badge.tsx` — update `STAGE_STYLES`. New color: amber/yellow (`bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100`).
- `components/app/orders-board.tsx` — update `BOARD_STAGES` (same slot between `fabrication` and `installation`) and switch its column header to `STAGE_SHORT_LABELS`.
- `supabase/seed.ts` — the one seeded order with `stage: "qc"` → `stage: "ready_for_install"`.
- **Grep verify:** `grep -rn "'qc'\|\"qc\"" app components lib prisma supabase/seed.ts` → zero hits. Historical migrations (0001 etc.) retain `'qc'` by design.
- **KPI review:** no dashboard card enumerated `qc` specifically; all used broad `NOT IN (paid, cancelled)` or specific stage lookups. No changes needed.
- DEVLOG: brief note on the rename rationale (shop-operator language vs fabrication-tool jargon).

### Sub-step 2 — Fix 2: bidirectional stage changes with reason
**Commit:** `feat(stage): bidirectional moves with required reason + dialog`

- `supabase/migrations/0009_stage_change_with_reason.sql`
  - Update `tg_orders_after_update` to read `current_setting('app.stage_change_note', true)` when stage changes and write it into both `order_stage_history.note` and the `activity_log.metadata` JSON as `note`.
  - Create RPC `change_order_stage(p_order_id uuid, p_to_stage order_stage, p_note text)`:
    - `SECURITY INVOKER` (RLS-scoped UPDATE).
    - Body: `perform set_config('app.stage_change_note', p_note, true); update orders set stage = p_to_stage where id = p_order_id;`
    - `set_config(…, true)` makes the setting transaction-local.
- `lib/validators/orders.ts` — `ChangeStageInput.note` becomes **required**, `z.string().trim().min(3, …).max(500, …)`. Remove `stage` from `UpdateOrderInput` patch schema (force stage moves through the dedicated path).
- `lib/actions/orders.ts` — `changeStage` calls `supabase.rpc("change_order_stage", …)`. Returns `{ ok, data }` as before.
- `components/app/stage-change-dialog.tsx` (new) — shadcn `Dialog` that accepts `{ orderNumber, fromStage, toStage, onConfirm(note), onCancel, pending }`, renders the prompt and a reason `Textarea`, enforces 3–500 chars, shows loading on submit.
- `components/app/order-detail-sheet.tsx`:
  - Remove `advance()` / "Advance stage →" button.
  - Add `<StagePicker>` — a shadcn `Select` of every stage, current is the default. Changing opens `<StageChangeDialog>`. On cancel, reset the Select to the current stage.
- `components/app/orders-board.tsx`:
  - Drag-end: apply optimistic local state + open `<StageChangeDialog>` pre-filled with `targetStage`. On confirm, persist via `changeStage`; on cancel, revert optimistic (already wired for server error reverts).
- `components/app/activity-feed.tsx` — `phraseFor` for `order:stage_changed`: if `metadata.note` is set, append ` — "{note}"`.
- DEVLOG: GUC-based note-threading pattern, noted as reusable for future triggers.

### Sub-step 3 — Fix 3: image gallery on Files tab
**Commit:** `feat(orders): image gallery + lightbox on the Files tab`

- `lib/actions/attachments.ts` — add `createSignedUrls(paths, ttlSeconds = 3600)` that calls `supabase.storage.from("order-files").createSignedUrls(paths, ttlSeconds)`, returns `Record<path, signedUrl | null>`.
- `app/(app)/orders/page.tsx` — after fetching `attachments`, split into `photos` (mime starts with `image/`) and `documents`; batch-sign photo paths; pass `photos` + `documents` + `photoUrls` to `<OrderDetailSheet>`.
- `components/app/file-gallery.tsx` (new) — responsive grid (`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4`), square aspect (`aspect-square`), `object-cover`, `<img>` with `onError` → HEIC-fallback tile (filename + Download CTA).
- `components/app/file-lightbox.tsx` (new) — `fixed inset-0 z-50` overlay, dark backdrop, centered image, keyboard handlers (`Esc` close, `←`/`→` navigate), on-screen arrow buttons, filename + upload date footer, Download + Delete buttons top-right. Reuses `createSignedUrl` + `deleteAttachment`.
- `components/app/order-detail-sheet.tsx` — Files tab now renders:
  1. `<FileUploader>` (unchanged).
  2. `<FileGallery>` with Photos (if any).
  3. Documents list (existing list UI, filtered to non-image mimes).
- DEVLOG note on private-bucket + signed-URL pattern.

### Sub-step 4 — Fix 4: surface notes
**Commit:** `feat(orders): surface notes on table + detail sheet`

- `supabase/migrations/0010_notes_activity.sql` — update `tg_orders_after_update` so that:
  - If **only** `notes` changed → write `activity_log` with `action = 'notes_updated'` and `metadata = { order_number, length_before, length_after }` (no full text).
  - If a mix of fields changed → existing generic `'updated'` path, but exclude `notes` from the diff.
  - Stage-change path unchanged from 0009.
- `lib/queries/orders.ts` — `getOrderDetail` additionally fetches the latest `activity_log` row where `entity_id = id AND action = 'notes_updated'`, plus the actor's display name. Returns `{ detail, lastNotesEdit: { actorName, at } | null }`.
- `components/app/notes-popover.tsx` (new) — `Popover` containing a `Textarea`. Saves on blur or Cmd/Ctrl+Enter via `updateOrder({ patch: { notes } })`. Optimistic + toast.
- `components/app/orders-table.tsx`:
  - New narrow "Notes" column between Project and Stage.
  - Empty → muted `Plus` icon (opens `<NotesPopover>`).
  - Non-empty → `StickyNote` icon + first ~20 chars, wrapped in shadcn `HoverCard` showing the full note (truncated at 400 chars with "…"). Click opens `<NotesPopover>`.
- `components/app/order-detail-sheet.tsx`:
  - Overview tab: new full-width Notes card near the top (above the structured-fields grid), `Textarea` with `min-h-[8rem]`, inline edit, same optimistic pattern. Footer: `"Last edited by {actor} · {relativeTime}"` or "Not edited yet".
  - Remove the bottom Notes field from the grid (now redundant).
- DEVLOG.

### Sub-step 5 — Fix 5: readable install dates
**Commit:** `feat(orders): bigger, color-coded install dates on kanban + table`

- `components/app/install-date.tsx` (new) — `<InstallDate value={string|null} stage={OrderStage} size="sm"|"md" />`:
  - `null` → `— not scheduled`, muted
  - today → brand accent, bold
  - past AND stage ∉ {`installation`, `invoiced`, `paid`} → destructive, bold
  - ≤7 days out → foreground, semibold
  - further out → muted
  - Format `format(d, 'EEE, MMM d')`; append `, yyyy` if not current year.
  - Small `Calendar` lucide icon prefix.
- `components/app/orders-board.tsx` — swap card's current install-date span for `<InstallDate size="md" />`.
- `components/app/orders-table.tsx` — swap install column cell for `<InstallDate size="sm" />`.
- Contrast verification: I'll use existing `text-brand`, `text-destructive`, `text-foreground`, `text-muted-foreground` tokens — already contrast-tuned in both modes.
- DEVLOG.

---

## Out of scope (restated)

- Fix 3 from your original list (contractor tracking) — **Task 2B**.
- Slab inventory, invoices, AI, WhatsApp, scheduling.
- Anything not on the 5-item list.

---

**Waiting for "go" — and your preferences on Q1-Q7 if any differ from the defaults above.**
