import Link from "next/link";

import { LoginForm } from "@/components/app/login-form";

type SearchParams = { next?: string; error?: string };

export const metadata = { title: "Log in · Stone & Design Board" };

export default function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="flex items-center justify-between px-6 py-5">
        <Link href="/" className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
          Stone &amp; Design Board
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm space-y-6 rounded-xl border bg-background p-8 shadow-sm">
          <div className="space-y-1 text-center">
            <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
            <p className="text-sm text-muted-foreground">
              Sign in to your shop&apos;s dashboard.
            </p>
          </div>
          {searchParams.error === "callback" ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              We couldn&apos;t finish that sign-in. Try again.
            </p>
          ) : null}
          <LoginForm next={searchParams.next} />
        </div>
      </main>
    </div>
  );
}
