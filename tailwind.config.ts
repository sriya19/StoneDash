import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    // Task 8: `lib/` was missing, and `lib/events/color.ts` is where every
    // event color class lives. Since Task 6B those strings have never been
    // compiled — the calendar's per-kind colors have been absent, not
    // subtle. The handful that did render (5 of 10 `dot` keys) came from
    // unrelated components that happen to declare the same class, which is
    // also why deleting calendar-list's private KIND_DOT map would have
    // silently broken crew-detail-sheet's dots. Any module that builds
    // class strings belongs in this list.
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        // Geist is reserved for headings + the wordmark. Body stays Inter
        // (--font-sans). Falls back through the sans stack if Geist hasn't
        // hydrated yet.
        geist: ["var(--font-geist-sans)", "var(--font-sans)", "system-ui", "sans-serif"],
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        brand: {
          DEFAULT: "var(--brand)",
          foreground: "var(--brand-foreground)",
          hover: "var(--brand-hover)",
          muted: "var(--brand-muted)",
        },
        success: {
          DEFAULT: "var(--success)",
          foreground: "var(--success-foreground)",
        },
        // Task 8 — secondary accent. `bg-info`, `text-info`,
        // `bg-info-muted`, `border-info-border`, `text-info-foreground`.
        // Sits beside success/destructive because that is the family it
        // belongs to; see the split rule in globals.css.
        info: {
          DEFAULT: "var(--info)",
          foreground: "var(--info-foreground)",
          muted: "var(--info-muted)",
          border: "var(--info-border)",
          // Scale steps. Theme-independent by design — reach for these
          // only when you want that exact blue in both themes (a swatch,
          // a stripe, a chart series). `bg-info` / `text-info` remain the
          // default, and flip per theme.
          500: "var(--info-500)",
          600: "var(--info-600)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        chart: {
          "1": "var(--chart-1)",
          "2": "var(--chart-2)",
          "3": "var(--chart-3)",
          "4": "var(--chart-4)",
          "5": "var(--chart-5)",
        },
        sidebar: {
          DEFAULT: "var(--sidebar)",
          foreground: "var(--sidebar-foreground)",
          primary: "var(--sidebar-primary)",
          "primary-foreground": "var(--sidebar-primary-foreground)",
          accent: "var(--sidebar-accent)",
          "accent-foreground": "var(--sidebar-accent-foreground)",
          border: "var(--sidebar-border)",
          ring: "var(--sidebar-ring)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
