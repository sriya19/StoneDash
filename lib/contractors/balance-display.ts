// Pure formatting + Tailwind-class helpers for contractor balances.
//
// Lives here (not inside a "use client" component file) so server
// components can import the utilities safely. When a server component
// imports a function from a `"use client"` module, Next.js replaces
// each named export with a client-reference proxy object — fine for
// components, broken for functions (`not a function` at runtime).
// Keeping these in a neutral module avoids that trap.
//
// Color rule applies to every surface that shows a contractor balance:
//   positive  → text-foreground (what's owed, surfaced as default text)
//   zero      → text-muted-foreground (neutral "done")
//   negative  → text-brand with "Credit" prefix (overallocation; rare
//               but possible, and it must not hide)

export function balanceClass(value: number): string {
  if (value > 0) return "text-foreground font-medium tabular-nums";
  if (value < 0) return "text-brand font-medium tabular-nums";
  return "text-muted-foreground tabular-nums";
}

function moneyFmt(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
}

export function formatBalance(value: number, currency: string): string {
  if (value < 0) return `Credit ${moneyFmt(value, currency)}`;
  return moneyFmt(value, currency);
}
