# Follow-ups

Tickets deliberately deferred out of a PR to keep it reviewable. Pick up when there's a lull.

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
