import Link from "next/link";
import type { ReactNode } from "react";

// Two-column shell used by /login, /signup, /onboarding. Form left,
// terracotta-tinted quote right at lg+. Collapses to single-column on
// mobile (the quote drops below `lg`).
//
// onboarding can opt out of the quote by passing `quote={null}`; the
// right column then collapses entirely so the form gets the full width.

type Props = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  // Switcher link at the bottom of the form column ("Don't have an
  // account? Sign up" / "Already have an account? Log in"). Omit on
  // onboarding (the user is already authenticated).
  switcher?: { text: string; linkText: string; href: string };
  // Right column. Pass `null` to drop it entirely (onboarding uses this).
  // Default = the marketing pull-quote.
  quote?: { text: string; attribution: string } | null;
  // Top-right action on the form column. /onboarding uses this for a
  // "Sign out" button; /login + /signup leave it undefined.
  topRight?: ReactNode;
};

const DEFAULT_QUOTE = {
  // TODO: confirm with customer before launch. Placeholder per PLAN Q10.
  text: "I haven't lost track of an install in three weeks.",
  attribution: "Owner, Top Marble & Granite — Sterling, VA",
};

export function AuthLayout({
  title,
  subtitle,
  children,
  switcher,
  quote,
  topRight,
}: Props) {
  // Default quote when undefined; explicit null skips the right column.
  const rightQuote = quote === null ? null : quote ?? DEFAULT_QUOTE;

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-2">
      {/* Form column */}
      <div className="flex min-h-screen flex-col lg:min-h-0">
        <header className="flex items-center justify-between px-6 py-5 lg:px-10">
          <Link
            href="/"
            className="font-geist text-lg font-semibold tracking-tight text-foreground"
          >
            StoneDash
          </Link>
          {topRight ?? <div />}
        </header>

        <main className="flex flex-1 items-center justify-center px-6 py-8 lg:px-10 lg:py-12">
          <div className="w-full max-w-sm space-y-6">
            <div className="space-y-1.5">
              <h1 className="font-geist text-2xl font-semibold tracking-tight">
                {title}
              </h1>
              {subtitle ? (
                <p className="text-sm text-muted-foreground">{subtitle}</p>
              ) : null}
            </div>

            {children}

            {switcher ? (
              <p className="text-center text-sm text-muted-foreground">
                {switcher.text}{" "}
                <Link
                  href={switcher.href}
                  className="font-medium text-brand hover:text-brand-hover hover:underline"
                >
                  {switcher.linkText}
                </Link>
              </p>
            ) : null}
          </div>
        </main>
      </div>

      {/* Quote column — lg+ only */}
      {rightQuote ? (
        <aside className="relative hidden overflow-hidden bg-gradient-to-br from-brand-muted/60 via-brand-muted/30 to-accent lg:flex lg:items-center lg:justify-center lg:px-12">
          <div className="relative max-w-md">
            <span
              aria-hidden
              className="absolute -left-6 -top-10 font-geist text-[180px] leading-none text-brand/15"
            >
              &ldquo;
            </span>
            <blockquote className="relative space-y-6">
              <p className="font-geist text-2xl font-medium leading-snug tracking-tight text-foreground">
                {rightQuote.text}
              </p>
              <footer className="text-sm text-muted-foreground">
                — {rightQuote.attribution}
              </footer>
            </blockquote>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
