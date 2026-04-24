# PLAN — Task 2B: Contractor tracking

Status: **DRAFT — awaiting "go"**

Task 2A (Sub-steps 1–5, commits `c2ba8fa` → `dee1b7d`) is landed. Its PLAN.md body is preserved in git history; this file replaces it for Task 2B. DEVLOG entries for 2A remain.

---

## Decisions & questions I'd like you to weigh in on (before I start)

### Q1. How to enforce "sum(allocations) == payment.amount"
Brief: "prefer server-action validation with a BEFORE COMMIT trigger as the safety net."
Postgres doesn't have a per-row `BEFORE COMMIT` trigger — the real mechanism is a `CONSTRAINT TRIGGER … INITIALLY DEFERRED` that fires once at commit. That means the client has to INSERT the payment and all allocations in one transaction and the check runs only at `COMMIT`. From a Node server action, each Supabase call is its own round-trip, so "one transaction" is only achievable via an RPC (same pattern we used for `change_order_stage` in 0009).

Two viable shapes:
- **(A) RPC does everything.** `record_contractor_payment(p_payment jsonb, p_allocations jsonb[])` — validates inputs, inserts the payment row, inserts the allocation rows, asserts `sum(alloc.amount) = payment.amount`. Single atomic call. Triggers still write `activity_log` as usual. Edit flow uses `update_contractor_payment(...)` which re-writes allocations inside the same txn.
- **(B) Deferred constraint trigger on `contractor_payment_allocations`.** Insert each allocation from Node in sequence (not really one txn across round-trips); rely on the deferred trigger at COMMIT. But because round-trips aren't inside one Postgres transaction, this doesn't actually buy us atomicity — a crash between INSERTs leaves half-written state. So (B) is not viable on its own.

**Recommendation:** (A). We already proved the RPC pattern in 0009; this is the same shape and keeps the sum-invariant inside a single txn. I'll still add a `CHECK`-level safety net on allocations (`amount > 0`, `(payment_id, order_id)` unique) but skip the deferred constraint trigger — the RPC is the single entry point.

### Q2. Views: RLS enforcement
Postgres 15+ views default to `security_invoker = false`, which bypasses RLS on the underlying tables and runs queries as the view owner. That would leak cross-org data. Both views in the spec (`v_order_contractor_paid`, `v_contractor_balances`) must be created with `WITH (security_invoker = true)` so RLS on `orders`, `contractors`, `contractor_payment_allocations` applies to view queries.

I'll also add a manual verification step: run a `SELECT * FROM v_contractor_balances` as a non-owner user in another org and confirm zero rows.

**Recommendation:** `security_invoker = true` on both views; test path documented in DEVLOG.

### Q3. Field-role column lock on `orders.contractor_id`
Existing trigger `enforce_field_role_columns` (0002) blocks field users from touching anything except `stage` and `notes`. Adding `contractor_id` to that list is consistent — field staff shouldn't re-tag jobs. I'll extend the DISTINCT-FROM check in 0011.

**Recommendation:** field cannot change `contractor_id`. If you'd prefer field read-only on contractor but with an escape hatch, tell me now.

### Q4. Audit triggers for new tables
Every mutation must write `activity_log`. I'll add INSERT/UPDATE/DELETE triggers on `contractors`, `contractor_payments`, and `contractor_payment_allocations` matching the shape of the existing `tg_customers_after_*` functions. Entity types: `"contractor"`, `"contractor_payment"`, `"contractor_allocation"`. A `record_contractor_payment` RPC call will produce three activity rows (payment created + one per allocation); I'll pass a `skip_allocation_audit` GUC if that's too noisy — TBD once I see the feed. Default: don't suppress.

### Q5. Jobs-tab balance column semantics
`orders.balance_due` is **homeowner-side** (`quote_amount - deposit_received`) and is enforced by the 0004 balance trigger. On the contractor detail Jobs tab, the "Paid" / "Balance" columns must show **contractor-side** numbers:

- Paid-by-contractor = `sum(contractor_payment_allocations.amount) for this order`
- Balance (contractor) = `quote_amount - paid-by-contractor`

I'll surface these by joining `v_order_contractor_paid` into the jobs-by-contractor query. The existing `orders.balance_due` column stays untouched — we explicitly are not double-accounting.

This distinction goes in DEVLOG as your "homeowner-vs-contractor billing split is a later design pass" note.

### Q6. Zero-balance contractors after delete
`contractors.ON DELETE` triggers `orders.contractor_id` → NULL (SET NULL, per spec) **and** `contractor_payments` → cascade-delete (which cascades to allocations). That's an odd asymmetry: deleting a contractor silently wipes their payment history but keeps the jobs. The UI gate ("Delete only when job_count=0 and payment_count=0") makes this safe in practice — the FK is the last line of defense, not the first. Flagging so there's no surprise.

### Q7. Ordering / oldest-first auto-allocate
Brief says sort unpaid orders by "oldest install date first" in the record-payment allocation list. Some jobs don't have a scheduled install date (still in quote/measurement). I'll sort by `COALESCE(scheduled_install_date, created_at::date)` so quote-stage jobs don't all pile up at the bottom. Still oldest-first. Flagging in case you want strict install-date-only (and hide the rest).

### Q8. "Record payment" entry points
Spec lists two: Payments tab button, and the header when balance > 0. I'll add a third — the URL param `?payment=new` on `/contractors/[id]` — so the same dialog is linkable (useful for deep-links from dashboard alerts later). Consistent with how `/orders?new=1` and `?order=<id>` already work. Ping me if you'd rather keep the surface minimal.

### Q9. Prisma schema updates
`prisma/schema.prisma` is the type source for `seed.ts` and for TS imports. I'll mirror the new tables there. Views are intentionally **not** added to Prisma (Prisma's view support is preview-flag territory and our app reads views via the Supabase client, which returns typed-by-hand rows). DEVLOG will note this.

---

## Sub-step breakdown

Each sub-step: implement → typecheck → lint → build → update DEVLOG → commit. The ordering below matches your proposal; I've made the sub-steps individually shippable so an interrupt between them leaves the app in a working state.

### Sub-step 1 — DB: tables, FKs, views, RLS, RPC
**Commit:** `feat(contractors): db schema, views, rls, payment rpc`

- `supabase/migrations/0011_contractors.sql`
  - `CREATE TABLE contractors` with columns per spec; `created_at`/`updated_at` + `contractors_set_updated_at` BEFORE UPDATE trigger (same pattern as customers).
  - `CREATE INDEX contractors_org_idx ON contractors(org_id)`
  - `CREATE INDEX contractors_org_name_idx ON contractors(org_id, lower(name))`
  - `ALTER TABLE orders ADD COLUMN contractor_id uuid NULL REFERENCES contractors(id) ON DELETE SET NULL;`
  - `CREATE INDEX orders_contractor_id_idx ON orders(contractor_id) WHERE contractor_id IS NOT NULL;`
  - `CREATE TABLE contractor_payments` with the spec's columns and CHECK; indexes `(org_id, contractor_id, received_on DESC)`.
  - `CREATE TABLE contractor_payment_allocations` with spec's columns, CHECK `amount > 0`, `UNIQUE(payment_id, order_id)`, indexes `(payment_id)` and `(order_id)`.
  - Extend `enforce_field_role_columns()` to add `contractor_id` to the blocked-for-field list (see Q3).
  - **Views, both with `WITH (security_invoker = true)`:**
    - `CREATE VIEW v_order_contractor_paid AS SELECT order_id, SUM(amount) AS paid_by_contractor FROM contractor_payment_allocations GROUP BY order_id;`
    - `CREATE VIEW v_contractor_balances AS …` (spec SQL, LEFT JOIN `orders` filtered by `stage <> 'cancelled'`, LEFT JOIN `v_order_contractor_paid`).
  - **RLS enable + policies** on `contractors`, `contractor_payments`, `contractor_payment_allocations`:
    - `SELECT` — `is_org_member(org_id)` on the two top tables; for allocations, EXISTS join to payments (same pattern as `order_stage_history`).
    - `INSERT/UPDATE/DELETE` — `org_role(org_id) IN ('owner', 'admin', 'manager')`. Field users: no write.
  - **Audit triggers** (Q4): `tg_contractors_after_insert/update/delete`, same for payments and allocations. Entity types `"contractor"`, `"contractor_payment"`, `"contractor_allocation"`. Guarded with `IF NOT EXISTS (SELECT 1 FROM organizations …)` against cascade-delete of the org (same pattern as 0006).
  - Polymorphic `BEFORE DELETE` activity_log cleanup for each new entity (mirrors 0006).
- `supabase/migrations/0012_contractor_payment_rpc.sql`
  - `CREATE OR REPLACE FUNCTION record_contractor_payment(p_contractor_id uuid, p_amount numeric, p_received_on date, p_method text, p_reference text, p_notes text, p_allocations jsonb) RETURNS uuid` — SECURITY INVOKER, runs under caller's RLS. Validates: `amount > 0`; `p_allocations` is a non-empty array of `{order_id, amount}` objects; `sum(alloc.amount) = p_amount` (tolerance 0.005); each `order_id` has `contractor_id = p_contractor_id` AND same `org_id`. Inserts the payment row, inserts all allocations. Returns the new `payment_id`.
  - `CREATE OR REPLACE FUNCTION update_contractor_payment(p_payment_id uuid, p_amount numeric, p_received_on date, p_method text, p_reference text, p_notes text, p_allocations jsonb) RETURNS void` — same validations; `UPDATE contractor_payments SET …`, `DELETE FROM contractor_payment_allocations WHERE payment_id = p_payment_id`, reinsert from jsonb.
  - `GRANT EXECUTE … TO authenticated;`
- `prisma/schema.prisma` — add `Contractor`, `ContractorPayment`, `ContractorPaymentAllocation` models; add `contractorId` + `contractor` relation on `Order`. Run `pnpm prisma generate`.
- **Manual verification (goes in DEVLOG):**
  - As demo-owner: select from both views, confirm numbers match hand-computed totals.
  - Sign in as a fresh non-member user (or run `set local role authenticated; set local request.jwt.claim.sub = <uuid>;` on psql); confirm `v_contractor_balances` returns zero rows.
  - Try `INSERT INTO contractor_payment_allocations VALUES (…)` directly bypassing the RPC with allocations that don't sum to the payment → should succeed at insert time (we chose server-action validation via RPC, not a deferred trigger). Calling `record_contractor_payment` with a mismatched sum → raises.

### Sub-step 2 — Seed + verify demo balances
**Commit:** `chore(seed): add contractors, payments, allocations to demo org`

- `supabase/seed.ts`:
  - Create 3 contractors under the demo org per spec: Ameer Construction (Running tab), Khaled Kitchens & Bath (Net 30), Dulles Build Group (Net 60).
  - Tag 4 existing orders:
    - 2 orders → Ameer (pick varied stages incl. one still active — e.g. Rodriguez bath + Park kitchen).
    - 2 orders → Khaled (e.g. Thompson laundry + Osei kitchen).
    - Dulles: tag 1 more order (e.g. Whitfield) so balance = full quote.
  - (Wait — spec says "4 of 10" tagged; 2+2+1 = 5. I'll re-read: spec says 4 total tagged, 2 under Ameer, 2 under Khaled, *Dulles has no payments* but no mention of orders. I'll give Dulles **1 order** so the page isn't empty — balance will be the full quote. That's 5 tagged. Flagging; happy to drop to 4 if you'd rather Dulles show zero jobs.)
  - Payments:
    - Ameer: $6,000 check, split $3,500 + $2,500 across his two orders (leaves a non-zero balance).
    - Khaled: $2,500 check, fully covering one of his two orders (leaves the other's full quote owed).
    - Dulles: no payments.
  - Call the new RPC from the seed (service-role key bypasses RLS anyway; RPC still validates the sum).
  - Seed idempotency is already guaranteed by the `deleteMany` on the org (cascades to new tables via `org_id` FK).
- Verify in psql / Supabase studio: `SELECT * FROM v_contractor_balances;` returns 3 rows with the expected totals. Snapshot the numbers into DEVLOG for later regression spot-checks.

### Sub-step 3 — `/contractors` list page + New Contractor flow
**Commit:** `feat(contractors): list page and create flow`

- `components/app/sidebar-nav.tsx` — replace the `coming_soon` stub for what-is-currently "Team"? No — we don't have a contractors stub yet. Add a new `active` entry `{ label: "Contractors", href: "/contractors", icon: HardHat }` between Customers and the `coming_soon` group. Icon: `HardHat` from lucide (fitting for general contractors/builders).
- `lib/validators/contractors.ts` — `CreateContractorInput`, `UpdateContractorInput`, `DeleteContractorInput`. Payment-terms is a free string (max 100); suggestion list lives in the UI only.
- `lib/actions/contractors.ts` — `createContractor`, `updateContractor`, `deleteContractor` (checks job+payment count pre-delete for defense in depth even though the UI gates it). Each calls `revalidatePath("/contractors")`, `"/orders"`, `"/dashboard"`.
- `lib/queries/contractors.ts` — `listContractorsWithBalance({ activeOnly, search })`:
  - Joins `contractors` with `v_contractor_balances` via `contractor_id`, plus a `MAX(contractor_payments.received_on)` for "Last payment". Single Supabase call using `select(`*, balance:v_contractor_balances!inner(balance_owed, active_job_count)`)` — but Supabase `!inner` joins don't work on views reliably; if it fights me I'll fall back to two parallel queries + Map merge.
- `app/(app)/contractors/page.tsx` — server component: fetch rows, render `<ContractorsTable>`, mount `<NewContractorDialog>` when `?new=1`. No detail sheet here — detail lives at `/contractors/[id]`.
- `components/app/contractors-table.tsx` — columns Name / Primary contact / Phone / Active jobs / Balance owed / Last payment / actions, sortable via query params (reuse the orders-table pattern). Row click → `/contractors/[id]`. Filters: Active-only toggle (default on), search box. Default sort: balance_owed desc.
- `components/app/new-contractor-dialog.tsx` — shadcn `Dialog`, RHF + zod resolver. Payment-terms `Input` + a `datalist` with Net 30 / Net 60 / Running tab / COD. Submit → `createContractor` → router.push(`/contractors/${id}`).
- Empty state: card with the spec copy + New Contractor CTA.

### Sub-step 4 — `/contractors/[id]` detail: header, Jobs tab, Details tab
**Commit:** `feat(contractors): detail page — header, jobs, details`

- `lib/queries/contractors.ts` — add `getContractorDetail(id)`:
  - Fetches the contractor row, the `v_contractor_balances` row, jobs (orders where `contractor_id = id`, joined with `customers` for homeowner name and `v_order_contractor_paid` for the contractor-side paid amount), and payment count.
  - Returns `{ contractor, balance, jobs, paymentCount }`.
- `app/(app)/contractors/[id]/page.tsx`:
  - Tabs via searchParam `?tab=jobs|payments|details` (default jobs), same pattern as the orders detail sheet.
  - Layout: `<ContractorHeader>` full width, then tab content.
- `components/app/contractor-header.tsx`:
  - Left block: name (text-2xl font-semibold), primary contact • phone (tel:) • email (mailto:), payment-terms `Badge`.
  - Right block: BALANCE OWED label (text-xs uppercase tracking-wide muted) + the number at `text-4xl md:text-5xl font-semibold tabular-nums font-mono`. Helper line: "across X active jobs · Y total this year".
  - Color rules:
    - `balance > 0` → `text-foreground`.
    - `balance == 0` → `text-muted-foreground` + small "All settled" `Badge`.
    - `balance < 0` → `text-brand`, displayed as `Credit: $X.XX`.
  - If `balance > 0`, render "Record payment" button inline with the balance.
- `components/app/contractor-jobs-tab.tsx`:
  - Columns per spec; contractor-side Paid / Balance (Q5). Row click opens the existing order detail sheet (we can navigate to `/orders?order=<id>` — that already renders the sheet). Cancelled jobs muted at the bottom behind a "Show cancelled" toggle.
- `components/app/contractor-details-tab.tsx`:
  - Inline-editable form (same fields as the create dialog). Save via `updateContractor`.
  - Danger zone at the bottom:
    - Deactivate button → calls `updateContractor({ patch: { isActive: false } })`. Toast + stay on page.
    - Delete button — disabled unless `jobs.length === 0 && paymentCount === 0`. Double-confirm via shadcn `AlertDialog`.

### Sub-step 5 — Record-payment flow with allocations + Payments tab
**Commit:** `feat(contractors): record payment flow with allocations`

- `lib/validators/contractors.ts` — add `RecordPaymentInput`:
  - `contractorId: uuid`
  - `amount: positive number`, `receivedOn: YYYY-MM-DD`, `method: enum(check, ach, cash, card, other)`, `reference?`, `notes?`
  - `allocations: array of { orderId: uuid, amount: positive number }` min 1
  - `.refine` sum of `allocations.amount` equals `amount` (epsilon 0.005).
  - `UpdatePaymentInput` with same shape + `paymentId`.
- `lib/actions/contractors.ts` — `recordContractorPayment`, `updateContractorPayment`, `deleteContractorPayment`. First two call the RPCs from 0012; delete does `supabase.from("contractor_payments").delete().eq("id", …)` (allocations cascade; trigger audit-logs). All three `revalidatePath`.
- `components/app/record-payment-dialog.tsx`:
  - Sheet (not Dialog — needs room for the allocation list).
  - Top half: amount / date / method / reference / notes.
  - Bottom half: allocation list. Server-fetched list of contractor's orders with `quote_amount > paid-so-far` (contractor-side), sorted by `COALESCE(scheduled_install_date, created_at::date)` ASC. Each row: checkbox, order #, project, contractor-side balance, amount input.
  - "Auto-allocate oldest first" button fills amounts greedy top-down.
  - Live footer: Applied / Remaining / Over. Green / red / muted. Submit disabled unless `Applied === amount`.
  - On submit → `recordContractorPayment({...})`. On success: `toast.success`, close sheet, `router.refresh()` so the header + tabs reflect the new balance.
- `components/app/contractor-payments-tab.tsx`:
  - List ordered newest-first. Each row: amount + date + method + reference in the header line; indented "Applied to: TM-1038 ($1,500), TM-1041 ($2,500)"; notes in italic; Edit / Delete buttons.
  - "Record payment" button top-right → opens the same sheet via `?payment=new`.
- URL wiring: `?payment=new` opens the create sheet; `?payment=<id>` opens edit pre-filled. Both routed through `app/(app)/contractors/[id]/page.tsx`.

### Sub-step 6 — Order integration: table column, filter, new-order dialog, detail sheet
**Commit:** `feat(orders): contractor field, filter, and order-detail integration`

- `lib/queries/orders.ts`:
  - `OrderListRow` grows `contractor_id` + `contractors: { id, name } | null` (Supabase nested select).
  - `OrderListFilters` grows `contractorIds?: string[]`; apply via `.in("contractor_id", …)`.
  - `OrderDetailRow` grows the same fields.
- `app/(app)/orders/page.tsx`:
  - Parse `?contractor=<id>,<id>` into `contractorIds`.
  - Pass the selected contractor name map to `<OrdersFilterBar>` for the multi-select labels.
- `components/app/orders-filter-bar.tsx`:
  - Add a multi-select dropdown fed by `listContractorsLite()` (name+id, active only by default). Mirrors the existing stage multi-select pattern.
- `components/app/orders-table.tsx`:
  - New "Contractor" column. Value = contractor name with a `HardHat` icon or blank. Column is togglable via the existing "columns" control if present; otherwise always on.
- `components/app/new-order-dialog.tsx`:
  - On the Customer step, below the homeowner picker, add an optional Contractor combobox. Uses the same `Command` + `Popover` pattern as the existing customer picker.
  - "+ Add new contractor" item opens `<NewContractorDialog>` in a nested modal (stacked). On create, auto-select the new contractor and return to the order flow with state preserved.
- `components/app/order-detail-sheet.tsx`:
  - Overview tab, near the Customer block, add a Contractor row. If set → link to `/contractors/[id]` with a small "Change" button that opens a contractor picker popover. If unset → "No contractor" with an "Add contractor" button that opens the same popover.
  - Picker uses `updateOrder({ patch: { contractorId } })` — we'll extend `UpdateOrderInput.patch` to include `contractorId?: uuid | null`.
- `lib/validators/orders.ts` and `lib/actions/orders.ts`:
  - Add `contractorId` to `CreateOrderInput` and `UpdateOrderInput.patch` (nullable). Wire into `createOrder`'s insert body.

### Sub-step 7 — Edit / delete payment flows
**Commit:** `feat(contractors): edit and delete payments`

Most of this is wired in Sub-step 5, but tidy:
- Edit: clicking Edit on a payments-tab row opens the Record-payment sheet pre-filled. On save → `updateContractorPayment` RPC (which deletes old allocations + re-inserts, atomically).
- Delete: `AlertDialog` confirm. Dialog body enumerates which orders will have their contractor-side balance change and by how much (we have this data on the row already — it's the list of allocations). On confirm → `deleteContractorPayment`. Toast with undo? Skip — explicit double-confirm is enough.
- Activity feed: confirm the three entity types render sensibly in the global activity list. Add `phraseFor` branches in `activity-feed.tsx` for `contractor:created/updated/deleted`, `contractor_payment:created/updated/deleted`, `contractor_allocation:created/deleted`. (Allocation rows will be noisy — add a dedupe that hides allocation rows if the same payment row is adjacent.)

### Sub-step 8 — README + DEVLOG wrap
**Commit:** `docs: readme + devlog updates for contractor tracking`

- `README.md` — new "Contractors" section in the feature list, one-paragraph summary of the data model (two entities: contractors, payments; allocations table joins payments to orders). Screenshot optional.
- `DEVLOG.md` — per-sub-step entries already written inline; add a closing "Deferred" section:
  - Contractor portal (separate auth surface).
  - Commission / referral fees.
  - Account statements / PDF.
  - Resolving the **homeowner-vs-contractor billing split** for the "Outstanding balance" KPI on the dashboard.

---

## Out of scope (restated)

- Contractor portal / auth.
- Pricing engine, discount percentages, commission tracking.
- QuickBooks / accounting sync.
- Automated payment reminders.
- Per-line-item invoicing.
- PDF statements.
- Dashboard KPIs for contractors (leave space; do not build).

---

**Waiting for "go" — and your preferences on Q1–Q9 if any differ from the defaults above.**
