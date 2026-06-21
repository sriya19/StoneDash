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
import { GoogleIcon } from "./google-icon";

type Props = { next?: string };

export function LoginForm({ next }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, startTransition] = useTransition();
  const [oauthPending, setOauthPending] = useState(false);

  function onEmailLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast.error("Couldn't sign in", { description: error.message });
        return;
      }
      toast.success("Welcome back");
      router.replace(next && next.startsWith("/") ? next : "/dashboard");
      router.refresh();
    });
  }

  async function onGoogleLogin() {
    setOauthPending(true);
    const supabase = createSupabaseBrowserClient();
    const redirect = new URL("/callback", window.location.origin);
    if (next) redirect.searchParams.set("next", next);
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
    <div className="space-y-5">
      {/* Google OAuth at the top — fast path for repeat visitors. */}
      <Button
        type="button"
        variant="outline"
        className="w-full gap-2"
        onClick={onGoogleLogin}
        disabled={oauthPending || pending}
      >
        {oauthPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <GoogleIcon className="h-4 w-4" />
        )}
        Continue with Google
      </Button>

      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          or continue with email
        </span>
        <Separator className="flex-1" />
      </div>

      <form onSubmit={onEmailLogin} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-[13px] font-medium">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@yourshop.com"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-[13px] font-medium">
              Password
            </Label>
            <Link
              href="/login?reset=1"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Forgot?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Log in
        </Button>
      </form>
    </div>
  );
}
