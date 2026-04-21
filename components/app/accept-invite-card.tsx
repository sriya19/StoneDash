"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { acceptInvite } from "@/lib/actions/settings";

type Props = {
  token: string;
  orgName: string;
  role: string;
  email: string;
};

export function AcceptInviteCard({ token, orgName, role, email }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onAccept() {
    setPending(true);
    const res = await acceptInvite({ token });
    setPending(false);
    if (!res.ok) {
      toast.error("Couldn't accept invite", { description: res.error });
      return;
    }
    toast.success(`Welcome to ${orgName}`);
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <div className="space-y-3 text-center">
      <h1 className="text-lg font-semibold">Join {orgName}</h1>
      <p className="text-sm text-muted-foreground">
        You&apos;ll join as <strong>{role}</strong> using {email}.
      </p>
      <Button
        type="button"
        onClick={onAccept}
        disabled={pending}
        className="w-full gap-1"
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        Accept invite
      </Button>
    </div>
  );
}
