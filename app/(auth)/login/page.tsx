import { AuthLayout } from "@/components/app/auth-layout";
import { LoginForm } from "@/components/app/login-form";

type SearchParams = { next?: string; error?: string };

export const metadata = { title: "Log in" };

export default function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <AuthLayout
      title="Log in to your shop"
      subtitle="Welcome back."
      switcher={{
        text: "Don't have an account?",
        linkText: "Sign up",
        href: "/signup",
      }}
    >
      {searchParams.error === "callback" ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          We couldn&apos;t finish that sign-in. Try again.
        </p>
      ) : null}
      <LoginForm next={searchParams.next} />
    </AuthLayout>
  );
}
