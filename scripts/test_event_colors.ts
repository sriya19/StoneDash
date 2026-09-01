// Unit gate for the event color palette (Task 8 sub-step 6).
//
// Makes the brief's four "Verify" bullets for Fix 2 executable instead of
// asserted, plus the two structural checks that would have caught the bugs
// this task actually found:
//
//   * Check 4 (every key defines every variant) is what would have caught
//     `calendar-list.tsx`'s private KIND_DOT map missing `repair` — a live
//     bug since Task 6B, where repair events rendered a zinc dot for a kind
//     whose default is amber.
//   * Check 6 (contrast) pins the WCAG AA floor the brief asks for, so a
//     future palette tweak that pushes a tint past readable fails here
//     rather than in someone's eyes.
//
// Pure — no DB, no network, no running server. Runs in milliseconds.
//
// Usage: pnpm smoke:events   (chained into `pnpm smoke`)

import {
  ALL_COLOR_KEYS,
  EVENT_COLOR_CLASSES,
  KIND_DEFAULT_COLOR,
  getEventColor,
} from "@/lib/events/color";
import { EVENT_KINDS, EVENT_COLOR_KEYS } from "@/lib/validators/events";

let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    process.stdout.write(`[OK     ] ${label}\n`);
  } else {
    failed += 1;
    process.stdout.write(`[FAIL   ] ${label}${detail ? ` — ${detail}` : ""}\n`);
  }
}

// --- 1. color IS NULL resolves to the kind default, for every kind -------
{
  const wrong: string[] = [];
  for (const kind of EVENT_KINDS) {
    const expected = KIND_DEFAULT_COLOR[kind];
    const actual = getEventColor({ kind, color: null });
    if (!expected) {
      wrong.push(`${kind} has no KIND_DEFAULT_COLOR entry`);
    } else if (actual !== expected) {
      wrong.push(`${kind}: got ${actual}, want ${expected}`);
    }
  }
  check(
    `1. color IS NULL resolves to the kind default for all ${EVENT_KINDS.length} kinds`,
    wrong.length === 0,
    wrong.join("; "),
  );
}

// --- 2. a user-picked color overrides the kind default -------------------
{
  const wrong: string[] = [];
  for (const kind of EVENT_KINDS) {
    for (const key of EVENT_COLOR_KEYS) {
      const actual = getEventColor({ kind, color: key });
      if (actual !== key) wrong.push(`${kind}+${key} -> ${actual}`);
    }
  }
  check(
    `2. a user-picked color overrides the kind default (${EVENT_KINDS.length}×${EVENT_COLOR_KEYS.length} combinations)`,
    wrong.length === 0,
    wrong.slice(0, 3).join("; "),
  );
}

// --- 3. an unknown stored color falls back, it does not crash ------------
{
  const junk = ["", "  ", "chartreuse", "BLUE", "blue;", "../../etc"];
  const wrong: string[] = [];
  for (const bad of junk) {
    const actual = getEventColor({ kind: "install", color: bad });
    if (actual !== KIND_DEFAULT_COLOR.install) wrong.push(`${JSON.stringify(bad)} -> ${actual}`);
  }
  const unknownKind = getEventColor({ kind: "not_a_kind", color: null });
  if (unknownKind !== "slate") wrong.push(`unknown kind -> ${unknownKind}`);
  check(
    "3. an invalid stored color (and an unknown kind) falls back without throwing",
    wrong.length === 0,
    wrong.join("; "),
  );
}

// --- 4. every palette key defines every variant --------------------------
{
  const VARIANTS = ["bg", "chip", "dot", "ring", "stripe", "pillBg", "hex"] as const;
  const wrong: string[] = [];
  for (const key of ALL_COLOR_KEYS) {
    const entry = EVENT_COLOR_CLASSES[key];
    for (const v of VARIANTS) {
      const value = entry[v];
      if (typeof value !== "string" || value.trim() === "") wrong.push(`${key}.${v}`);
    }
  }
  const missingKeys = EVENT_COLOR_KEYS.filter((k) => !(k in EVENT_COLOR_CLASSES));
  for (const k of missingKeys) wrong.push(`${k} absent from EVENT_COLOR_CLASSES`);
  check(
    `4. all ${ALL_COLOR_KEYS.length} palette keys define all ${VARIANTS.length} variants`,
    wrong.length === 0,
    wrong.join(", "),
  );
}

// --- 5. every kind default points at a real palette key ------------------
{
  const wrong = Object.entries(KIND_DEFAULT_COLOR)
    .filter(([, key]) => !(key in EVENT_COLOR_CLASSES))
    .map(([kind, key]) => `${kind} -> ${key}`);
  check(
    "5. every KIND_DEFAULT_COLOR value is a real palette key",
    wrong.length === 0,
    wrong.join(", "),
  );
}

// --- 6. WCAG AA contrast for the block tint and the all-day pill ---------
//
// The tint classes are alpha, so the readable question is the event text
// against the tint *blended over the surface it sits on* — the card in
// light, the elevated card in dark. Anything else measures a color that is
// never actually on screen.
{
  const TW: Record<string, string> = {
    "orange-500": "#F97316", "orange-950": "#431407", "orange-50": "#FFF7ED",
    "emerald-500": "#10B981", "emerald-950": "#022C22", "emerald-50": "#ECFDF5",
    "blue-500": "#3B82F6", "blue-950": "#172554", "blue-50": "#EFF6FF",
    "purple-500": "#A855F7", "purple-950": "#3B0764", "purple-50": "#FAF5FF",
    "amber-500": "#F59E0B", "amber-950": "#451A03", "amber-50": "#FFFBEB",
    "rose-500": "#F43F5E", "rose-950": "#4C0519", "rose-50": "#FFF1F2",
    "teal-500": "#14B8A6", "teal-950": "#042F2E", "teal-50": "#F0FDFA",
    "indigo-500": "#6366F1", "indigo-950": "#1E1B4B", "indigo-50": "#EEF2FF",
    "slate-500": "#64748B", "slate-950": "#020617", "slate-50": "#F8FAFC",
    "amber-700": "#B45309",
  };
  const LIGHT_SURFACE = "#FFFFFF";
  const DARK_SURFACE = "#1F1F23";
  const AA = 4.5;

  const rgb = (h: string): number[] =>
    [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  const blend = (fg: string, bg: string, a: number): number[] =>
    rgb(fg).map((v, i) => v * a + (rgb(bg)[i] ?? 0) * (1 - a));
  const lum = (c: number[]): number => {
    const l = c
      .map((v) => v / 255)
      .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * (l[0] ?? 0) + 0.7152 * (l[1] ?? 0) + 0.0722 * (l[2] ?? 0);
  };
  const ratio = (a: number[], b: number[]): number => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };

  // Read the tint + text families straight out of the palette strings so the
  // test cannot drift from the values it is checking.
  function parse(cls: string) {
    const light = cls.split(" ").filter((c) => !c.startsWith("dark:"));
    const dark = cls.split(" ").filter((c) => c.startsWith("dark:")).map((c) => c.slice(5));
    const bgOf = (xs: string[]) => xs.find((c) => c.startsWith("bg-"))?.slice(3) ?? "";
    const textOf = (xs: string[]) => xs.find((c) => c.startsWith("text-"))?.slice(5) ?? "";
    const split = (v: string): [string, number] => {
      const [name, alpha] = v.split("/");
      return [name ?? "", alpha ? Number(alpha) / 100 : 1];
    };
    return {
      light: { bg: split(bgOf(light)), text: textOf(light) },
      dark: { bg: split(bgOf(dark)), text: textOf(dark) },
    };
  }

  const failures: string[] = [];
  let worst = Number.POSITIVE_INFINITY;
  let worstName = "";
  for (const key of ALL_COLOR_KEYS) {
    for (const variant of ["bg", "pillBg"] as const) {
      const p = parse(EVENT_COLOR_CLASSES[key][variant]);
      for (const [theme, surface] of [
        ["light", LIGHT_SURFACE],
        ["dark", DARK_SURFACE],
      ] as const) {
        const { bg, text } = p[theme];
        const [tint, alpha] = bg;
        const tintHex = TW[tint];
        const textHex = TW[text];
        if (!tintHex || !textHex) {
          failures.push(`${key}.${variant}.${theme}: unmapped ${tint || "?"} / ${text || "?"}`);
          continue;
        }
        const r = ratio(rgb(textHex), blend(tintHex, surface, alpha));
        if (r < worst) {
          worst = r;
          worstName = `${key}.${variant}.${theme}`;
        }
        if (r < AA) failures.push(`${key}.${variant}.${theme} = ${r.toFixed(2)}:1`);
      }
    }
  }
  check(
    `6. event text clears WCAG AA on every tint (worst ${worstName} at ${worst.toFixed(2)}:1)`,
    failures.length === 0,
    failures.join(", "),
  );
}

const total = 6;
process.stdout.write(`\n${total} check(s): ${total - failed} OK, ${failed} FAIL\n`);
process.exit(failed > 0 ? 1 : 0);
