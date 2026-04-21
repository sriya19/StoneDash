"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function SignupForm() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, startTransition] = useTransition();
  const [oauthPending, setOauthPending] = useState(false);

  function onSignup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const supabase = createSupabaseBrowserClient();
      const emailRedirectTo = new URL("/callback", window.location.origin).toString();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName }, emailRedirectTo },
      });
      if (error) {
        toast.error("Couldn't create your account", { description: error.message });
        return;
      }

      // If email confirmation is disabled, a session is returned immediately.
      if (data.session) {
        toast.success("Account created");
        router.replace("/onboarding");
        router.refresh();
        return;
      }

      toast.success("Check your email", {
        description: "We sent a confirmation link. Open it to finish setting up.",
      });
    });
  }

  async function onGoogleSignup() {
    setOauthPending(true);
    const supabase = createSupabaseBrowserClient();
    const redirect = new URL("/callback", window.location.origin);
    redirect.searchParams.set("next", "/onboarding");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirect.toString() },
    });
    if (error) {
      toast.error("Google sign-in is not available", { description: error.message });
      setOauthPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSignup} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="fullName">Full name</Label>
          <Input
            id="fullName"
            autoComplete="name"
            required
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Work email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">At least 8 characters.</p>
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Create account
        </Button>
      </form>

      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs uppercase tracking-wide text-muted-foreground">or</span>
        <Separator className="flex-1" />
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={onGoogleSignup}
        disabled={oauthPending}
      >
        {oauthPending && <Loader2 className="h-4 w-4 animate-spin" />}
        Continue with Google
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="underline underline-offset-4">
          Log in
        </Link>
      </p>
    </div>
  );
}
