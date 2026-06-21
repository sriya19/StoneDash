import { AuthLayout } from "@/components/app/auth-layout";
import { SignupForm } from "@/components/app/signup-form";

export const metadata = { title: "Sign up" };

export default function SignupPage() {
  return (
    <AuthLayout
      title="Start your StoneDash account"
      subtitle="Free during open beta. Set up takes under five minutes."
      switcher={{
        text: "Already have an account?",
        linkText: "Log in",
        href: "/login",
      }}
    >
      <SignupForm />
    </AuthLayout>
  );
}
