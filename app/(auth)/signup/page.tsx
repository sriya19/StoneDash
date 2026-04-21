import Link from "next/link";

import { SignupForm } from "@/components/app/signup-form";

export const metadata = { title: "Sign up · Stone & Design Board" };

export default function SignupPage() {
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
            <h1 className="text-xl font-semibold tracking-tight">Get started</h1>
            <p className="text-sm text-muted-foreground">
              Create your account and set up your shop.
            </p>
          </div>
          <SignupForm />
        </div>
      </main>
    </div>
  );
}
