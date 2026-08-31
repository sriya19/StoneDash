# PLAN — Task 8: Bright blue as secondary accent + calendar contrast bump

Status: **DRAFT — awaiting "go"**

Task 7 (commits `2950922` → `d9e58cd`) is landed. This file replaces the Task 7 body for Task 8. DEVLOG entries for prior tasks remain.

Two changes, both purely visual. Fix 1 introduces a second semantic color and enforces a split rule across the app. Fix 2 makes calendar events scannable. No new features, no layout work, no schema.

---

## Scope acknowledgment — what I found grounding the brief

Five findings that change what the sub-steps actually do.

**1. There are no hardcoded terracotta hexes in component files. The quality bar is already met.**

`grep -rniE "#C2410C|#EA580C|#9A3412|#F97316|#FED7AA|#FB923C|#FFF7ED|#7C2D12"` over `app/ components/ lib/ public/` returns exactly four kinds of hit:

| Location | What it is | Disposition |
|---|---|---|
| `app/globals.css` (31 hits) | The token definitions themselves | **Stays** — this is the one file where hexes belong |
| `lib/events/color.ts:47` | `terracotta.hex` swatch value for the Task 6B color picker | **Stays** — this is palette *data*, not styling; the picker paints the circle the user is choosing |
| `public/icon.svg`, `public/favicon.svg` | The logo | **Stays** — brief: wordmark and logo keep terracotta |
| `app/(marketing)/_components/cta-band.tsx:6` | A code comment mentioning `#FED7AA` | **Stays** — comment, not a class |

So sub-step 2's audit deliverable is not "a list of hexes to convert." Task 4 already consolidated everything behind semantic tokens. The real audit is **a list of every *semantic* terracotta usage** (`text-brand`, `bg-brand`, `border-brand`, `brand-muted`, `text-primary`, `--ring`, `--sidebar-*`) classified do-things / tell-things. That's the list I'll bring you for review, and it's the one that actually decides the diff. 45 call sites across 30 files.

**2. Focus rings are already centralized.** Every focus ring in the app resolves through `ring-ring` → `--ring`. 13 call sites (`button`, `input`, `textarea`, `select`, `checkbox`, `tabs`, `dialog`, `sheet`, `badge`, `calendar`, `file-gallery`) and not one hardcodes a color. Changing `--ring` and `--sidebar-ring` in two blocks of `globals.css` swaps every focus ring in the product. The brief's "focus rings on all inputs/buttons" is a two-line change, not a sweep.

**3. `calendar-list.tsx` has its own kind→color map, and it has drifted.** `components/app/calendar-list.tsx:24-31` defines a local `KIND_DOT` that bypasses `getEventColor` entirely. It is wrong in three ways: `pickup` is `bg-sky-500` where the palette says teal, `other` is `bg-zinc-500` where the palette says slate, and `repair` (added in Task 6B) is **missing** — so repair events currently render `KIND_DOT.other`, a zinc dot, for a kind whose default is amber. It also ignores `order_events.color` completely, so a user-picked color never reaches the list view. This is exactly the class of drift the Task 6B comment in `lib/events/color.ts` says the helper exists to prevent. Fix 2's list-view work is therefore *deleting* a map, not adding a dot — the dot is already `h-2 w-2` (8px).

**4. `EventBlock` renders under SSR, so "currently in-progress" needs care.** `CalendarEvent` carries both `startsAt` and `endsAt`, so the in-progress test is a pure comparison — but evaluating `Date.now()` during server render and again during hydration yields two different stripe widths and a React hydration mismatch. Handled with a mounted-gate (see sub-step 5); the server always paints the 4px stripe and the client widens it after mount. Flagged because "optional polish, ship if easy" is only easy if you notice this.

**5. The chip family is a mirrored pair, and the brief only names one half.** `IntakeStatusChip` carries the comment *"Mirrors `<ExtractionChip>` from Task 5: same five-state pattern"* and the two are byte-for-byte identical in styling across all five states. The brief names ExtractionChip's confirmed state ("AI extracted", green → blue) and IntakeStatusChip's review state ("Ready for review", terracotta → blue), but not the other two. Applying the brief literally desynchronizes a deliberately synchronized pair. See Q4.

---

## Decisions I'd like you to weigh in on

Eight. **Q1, Q2, Q4 and Q6 change what ships** — I'd like a call on each. The rest have defaults I'll take silently unless you object.

### Q1. Token name: `info`, not `accent-info` — and it isn't just naming

The brief suggests `accent-info` or `accent-navigational`. Both collide with something real: **`--accent` is already a taken shadcn token** in this codebase (`globals.css:63`), and it means "the warm hover tint" — `#FFF7ED` orange-50 in light, `#2A1E16` in dark. It's what paints dropdown-item hover, ghost-button hover, table-row hover. Nesting under `accent` in Tailwind gives you `bg-accent-info` sitting one keystroke from `bg-accent`, which means the opposite thing (warm, not cool; hover, not semantic).

The brief's own CSS-variable spec already answers this — it asks for `--info`, `--info-foreground`, `--info-muted`, `--info-border`, not `--accent-info-*`. I'll match it.

**Recommendation:** Tailwind key `info`, giving `bg-info`, `text-info`, `border-info-border`, `bg-info-muted`, `text-info-foreground`. It sits beside the existing `success` and `destructive` status tokens, which is precisely the family it belongs to — `success` / `destructive` / `info` is a complete, conventional triple, and the codebase already reads `text-success` and `bg-success/10` in the chips this task is editing.

The rule I'll document in DEVLOG: **`brand`/`primary` is a verb, `info` is a noun.** If clicking it does something to the user's data, it's terracotta. If it tells the user where they are, what something is, or what just happened, it's blue. Neutral chrome is zinc.

### Q2. The nav active state can't go half-blue — BLOCKER-ish

The brief says "swap the terracotta strip on the left edge to blue." But the active nav item is a four-part treatment, not a strip (`sidebar-nav.tsx:63-76`):

```
border-l-brand                    ← the 2px strip     (terracotta)
bg-sidebar-accent                 ← the row tint      (#FFF7ED orange-50)
text-sidebar-accent-foreground    ← the label         (#9A3412 orange-800)
text-brand on the icon            ← the icon          (terracotta)
```

Swapping only the strip gives you a blue bar against an orange-tinted row with orange text and an orange icon. That reads as a rendering bug, not a design.

**Recommendation:** move the whole sidebar active/hover family to the info palette — `--sidebar-primary`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--sidebar-ring`, and the two `brand` classNames in the component. This is a bigger *visible* change than "one strip" and I want you to have said yes to it before you see the screenshot. It is still strictly a color-token change: no markup, no spacing, no structure.

Note this also turns the **hover** tint on inactive nav items blue, since `--sidebar-accent` serves both. I think that's correct — the whole sidebar is navigational — but it's a consequence worth naming.

The alternative, if you want the change smaller: strip + icon go blue, row tint goes neutral (`bg-secondary`) instead of blue. Less committed, doesn't look broken. Say the word.

### Q3. `--accent` (the global warm hover tint) stays terracotta

Distinct from Q2's `--sidebar-accent`. The global `--accent` paints hover on dropdown items, ghost buttons, table rows, command-palette entries, and `hover:bg-accent` appears ~40 times. The brief doesn't mention it, and hover-on-a-row is neither "I do things" nor "I tell you things" — it's chrome.

**Recommendation:** leave it. Turning every hover in the product blue is a redesign, and the brief puts component redesigns out of scope. Recording the decision so the split rule doesn't get read as "everything warm becomes blue."

### Q4. The chip pair — swap both confirmed states, or neither

Per finding 5. The brief says ExtractionChip's "AI extracted" (green) → blue. Its mirror is IntakeStatusChip's "Confirmed" (also green, same classes). Three options:

- **(a) Swap both.** Both chips are the machine reporting on itself; green is freed to mean only "a user action succeeded." The mirror survives. *This is my recommendation.*
- **(b) Swap only "AI extracted".** Defensible in isolation — "AI extracted" is a machine fact, "Confirmed" is a human's decision — but it silently breaks a pair the code comments call a mirror, and the next person to touch either will have to rediscover why.
- **(c) Swap neither**, treating green-means-done as load-bearing and taking only the terracotta→blue half of the brief.

I'll also apply blue to both chips' **`processing`** state ("Reading…"), which is terracotta today and is unambiguously the machine telling you something. The brief doesn't name it, but leaving a terracotta "Reading…" next to a blue "Ready for review" in the same chip family would be the same half-blue problem as Q2.

One tension I want to name rather than hide: the `review` chip is a **`<button>`** that opens a sheet, so by the letter of the split rule it's a CTA. The brief names it for blue explicitly, and I agree with the brief — it's an *invitation to look*, not an action on data — but it is the one place where the rule and the instruction rub, and I'd rather log that than pretend it's clean.

### Q5. Which links go blue — prose yes, table cells no

The brief says "body text links (currently muted or terracotta — swap to blue, with hover underline)." There are two populations, and I don't think they should be treated the same.

**Prose / navigational links → blue** (8 sites): `button` variant `link` (`text-primary`), auth-layout's "Sign up / Log in", `pipeline-strip`'s "View all", `reminder-bell`'s "See all", `maps-links`' Google/Apple Maps, the `/j/[slug]` share page's directions link, `invite/[token]`'s two footer links, and `customer-detail-sheet`'s `tel:` / `mailto:`.

**Entity-name links inside table cells → stay foreground** (9 sites): the customer/contractor/order/crew names in `contractors-table`, `crew-table`, `orders-table`, `orders-board`, `contractor-jobs-tab`, `contractor-payments-tab`, `crew-detail-sheet`, `order-detail-sheet`. These already carry `hover:underline` and inherit `text-foreground`.

**Recommendation:** prose only. A table row's name *is* the row's content, not a link in a sentence — every dense table in the product would go blue-striped, which is both a big unasked-for visual change and squarely inside the brief's own "body text stays zinc" rule. Tell me if you want them blue and I'll do it in the same sub-step; it's a one-line change per file, I just don't think it's right.

### Q6. Info banner vs. warning banner — only one of the four is "info"

The brief says "Info banner components (Settings warnings about missing shop address, etc.) — light blue tint background, blue border." There are four amber banners in the app:

| Banner | Says | Verdict |
|---|---|---|
| `settings-eta-banner.tsx` | "ETA is manual for your N scheduled installs" | **→ blue.** Named by the brief. It reports a state of the system; nothing is at risk |
| `csv-import-sheet.tsx:413` | rows will be skipped on import | **stays amber** |
| `new-order-dialog.tsx:376` | possible duplicate customer detected | **stays amber** |
| `quick-add-order-sheet.tsx:340` | possible duplicate customer detected | **stays amber** |

**Recommendation:** convert only the ETA banner. The other three warn about a mistake the user is *about to make* — a skipped row, a duplicate customer. If amber and blue both mean "notice," amber stops meaning anything, and the duplicate-customer warning is the exact surface Task 6A built to prevent real data corruption. Keeping the ETA banner's `AlertTriangle` icon or swapping it to `Info` is a detail I'll take as `Info` unless you'd rather keep the triangle.

### Q7. Calendar tint: rebuild the `bg` variant, don't layer on top of it

Today `EVENT_COLOR_CLASSES[k].bg` is `bg-<c>-100/80 border-<c>-400/60 text-<c>-950` + dark equivalents. The brief asks for ~15% light / ~25% dark. Those aren't compatible — `<c>-100/80` is a pale wash of a near-white swatch, which is why the calendar is hard to scan; `<c>-500/15` is a true 15% of the *full-strength* hue and reads as a tint of the actual color.

**Recommendation:** rewrite `bg` to `bg-<c>-500/15 border-<c>-500/40 text-<c>-950 dark:bg-<c>-500/25 dark:border-<c>-500/50 dark:text-<c>-50`, and add two new variants to `ColorVariants`: `stripe` (`bg-<c>-500` full strength, for the left edge) and `pillBg` (`/30` per the brief's all-day spec). Adding variants to the existing table is not new lookup logic — every caller still goes `EVENT_COLOR_CLASSES[getEventColor(ev)][variant]`, which is the invariant the brief asks me to preserve.

The `brown` key is special-cased today (it uses `amber-200/700/800` because Tailwind has no brown) and stays special-cased.

### Q8. Screenshots — how many PNGs do you want committed?

The bar asks for before/after at 375 / 768 / 1280 in light *and* dark. Done exhaustively across every changed surface that's ~60 images. `scripts/capture_docs_screenshots.ts` currently shoots 5 surfaces at 1280 light only; `next-themes` uses `attribute="class"` with a `theme` localStorage key, so an `addInitScript` seeding that key is all dark mode needs.

**Recommendation:** I'll extend the existing capture script with `--width` / `--theme` flags (reusable, not throwaway), capture the full matrix locally for my own verification, and **commit a curated 12** to `docs/screenshots/task8/`: sidebar+dashboard, schedule week view, and settings, each before/after at 1280, in both themes. 375 and 768 get verified and described in DEVLOG without committing the PNGs. Plus refresh the canonical five in `docs/screenshots/` and `public/landing/dashboard-hero.png` at the end.

If you'd rather keep the repo lean, say "narrative only" and I'll commit zero task-8 PNGs and only refresh the canonical set.

---

## Sub-steps

Seven, adjusted from your six: your step 1 splits (tokens, then a proof-of-wiring), and calendar splits into helper-then-surfaces so the palette change is reviewable on its own. One commit each. Typecheck + lint + build + `pnpm smoke` green before every commit — I'll run `pnpm dev` in the background myself since the SSR and DOM smokes need a live server.

### Sub-step 1 — `info` token, wired end to end

`app/globals.css`: add `--info`, `--info-foreground`, `--info-muted`, `--info-border` to `:root` and `.dark`.

```
light   --info: #2563EB   blue-600
        --info-foreground: #FAFAF7
        --info-muted: #EFF6FF   blue-50    (banner / chip backgrounds)
        --info-border: #BFDBFE  blue-200
dark    --info: #3B82F6   blue-500   ← per the brief's note; blue-600 on #18181B
                                        measures 3.7:1 against body text and
                                        sits too heavy. blue-500 clears AA.
        --info-foreground: #18181B
        --info-muted: #1E3A5F   a desaturated blue-950, matched to how
                                --brand-muted is handled in dark
        --info-border: #1D4ED8  blue-700
```

`tailwind.config.ts`: `info: { DEFAULT, foreground, muted, border }` under `theme.extend.colors`, beside `success`.

Also in this commit, because they're the same edit and the brief groups them: `--ring` and `--sidebar-ring` → `var(--info)` in both themes. That's the entire "focus rings on all inputs/buttons" item (finding 2).

Proof of wiring: the ETA banner from Q6 is converted here rather than in a later step — it exercises all four variables (`bg-info-muted`, `border-info-border`, `text-info`, and `text-info-foreground` on the icon) on a real surface, so the token is verified in the product instead of in a scratch component that then has to be deleted.

**Verify:** contrast-check all four values against `--background` / `--card` in both themes and record the ratios in DEVLOG. Tab through a form and a dialog in both themes; confirm every focus ring is blue.

### Sub-step 2 — audit report (**no code changes — I stop here for your review**)

Per finding 1, this is the semantic-usage list, not a hex list. I'll produce a table of all 45 terracotta call sites: file:line, what it paints, do-things vs. tell-things, and proposed disposition. You review, I proceed on your marks. Committed as a DEVLOG section so the reasoning is durable, not as a throwaway message.

Expected shape: ~11 swap to blue (nav ×2, chips ×6, links per Q5, ETA banner already done in 1), ~34 stay terracotta (every CTA button, `+ New`, KPI urgent accents, the `new-order-dialog` and `event-dialog` selected-step states, uploader drag states, avatars, wordmark, toast, tooltip).

### Sub-step 3 — apply blue: nav + links

The Q2 sidebar family and the Q5 prose links. Two visually distinct areas but one conceptual change ("where am I / where can I go"), and both are pure className swaps.

**Verify:** every route's active nav item in both themes; hover on inactive items; collapsed sidebar (the tooltip variant); all 8 link sites clicked.

### Sub-step 4 — apply blue: chips

Q4's chip pair across `processing` and `confirmed` + the `review` states the brief names. Both files, kept identical.

**Verify:** all five states of both chips rendered in both themes. `ExtractionChip` states are reachable via the demo org's `file_extractions` rows; `IntakeStatusChip` via `/intake`. **Not** by confirming a mock intake through the UI — per FOLLOWUP-03 that writes real customer rows into the demo org, which is how Task 7 broke two smokes.

### Sub-step 5 — calendar: palette + event blocks

`lib/events/color.ts`: the Q7 rewrite of `bg`, plus `stripe` and `pillBg`.

`components/app/event-block.tsx`:
- `block` variant — absolutely-positioned 4px full-height stripe (`absolute inset-y-0 left-0 w-1`), content padding bumped `px-1.5` → `pl-2.5 pr-1.5` so text clears it. That padding bump is the one dimension this task changes, and it's forced by the stripe; noting it against the "no layout changes" bar rather than sneaking it through.
- `pill` variant — `pillBg` at 30%, 3px stripe (`w-[3px]`), `pl-2` for clearance.
- In-progress widening to 6px, guarded per finding 4: `useState(false)` + `useEffect(() => setMounted(true))`, so SSR and first client render agree on 4px and the widening happens post-hydration. `startsAt <= now <= endsAt`, both already on `CalendarEvent`.

The `terminal` opacity-60 treatment and the `SendCorner` link are untouched — the stripe lives at `left-0`, the send icon at `right-0.5`, no collision.

**Verify:** all 10 palette keys at both tint levels in both themes; text contrast measured on the two worst cases (`slate` and `brown` — the darkest tints, where `text-<c>-950` on `bg-<c>-500/15` is tightest). Long events, 15-minute events (the stripe must survive a 14px-tall block), all-day pills, drag-and-drop still working.

### Sub-step 6 — calendar: list view + in-progress polish

Delete `KIND_DOT` from `calendar-list.tsx`; route the dot through `EVENT_COLOR_CLASSES[getEventColor(ev)].dot`. Per finding 3 this fixes three live drifts and makes user-picked colors reach the list view for the first time.

New `scripts/test_event_colors.ts`, chained into `pnpm smoke` as `smoke:events`. Four assertions, which are exactly the brief's four "Verify" bullets made executable:
1. `color IS NULL` → kind default, for all 7 kinds including `repair`.
2. A user-picked key overrides the kind default, for all 10 keys.
3. An unknown/invalid stored color falls back to the kind default rather than crashing.
4. Every palette key defines every variant (`bg`, `chip`, `dot`, `ring`, `stripe`, `pillBg`, `hex`) — the check that would have caught `KIND_DOT` missing `repair` two tasks ago.

Pure unit test, no DB, no network. Runs in milliseconds and is the standing gate against the next drift.

### Sub-step 7 — verification pass + docs

The Q8 screenshot matrix, capture-script flags, README color-token section, DEVLOG wrap, canonical screenshot refresh, `landing-hero.png` refresh (the dashboard's sidebar changes materially under Q2, so this one is required, not optional).

---

## Out of scope — confirming your list, plus two of mine

Yours, unchanged: layout/typography/structure, new features, component redesigns, the kind→color defaults (`measurement=purple` etc. stay), user-picked-color render bugs (→ Task 8.5), deployment.

Two additions I want on the record:
- **`--accent` global hover tint stays warm** (Q3).
- **Table-cell entity links stay foreground** (Q5) — pending your call.

And one thing I'd normally defer but am pulling in, because it's three lines and the fix is indistinguishable from the work: the `calendar-list` `KIND_DOT` drift (finding 3). It's a live bug — repair events show the wrong dot color today — but rebuilding that dot on `getEventColor` is *the* sub-step 6 task, so fixing it costs nothing and leaving it would mean shipping a dot I'd just touched that I know is wrong.

---

## Risks

**Blue-on-blue in the calendar.** `delivery` defaults to the `blue` palette key, and the nav/focus/link blue is `#2563EB` — the same family. A blue event block beside a blue nav strip could read as related when they aren't. Mitigation: the calendar's blue is `blue-500` at 15–30% opacity inside a bordered block; the accent blue is full-strength on text and 2px edges. I'll look hard at this in sub-step 7 and report honestly if it's muddy. Changing the `delivery` default is explicitly out of scope, so if it *is* muddy the finding goes to you as a Task 8.5 note rather than a unilateral fix.

**`--ring` is load-bearing in 13 components.** Swapping it is one line but touches every interactive surface. Covered by tabbing both themes in sub-step 1, before anything else lands on top of it.

**Dark-mode `--info-muted`.** `#EFF6FF` blue-50 works in light; there is no equivalent in dark and the value above is hand-mixed, matched to how `--brand-muted` handles the same problem (`#7C2D12`). Most likely thing to need a second pass after seeing it on screen.
