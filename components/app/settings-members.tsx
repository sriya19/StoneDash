"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { MemberRole } from "@prisma/client";
import { toast } from "sonner";
import {
  Check,
  Copy,
  Loader2,
  MailPlus,
  Trash2,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  inviteMember,
  removeMember,
  updateMemberRole,
} from "@/lib/actions/settings";
import {
  InviteMemberInput,
  type InviteMemberInputT,
} from "@/lib/validators/settings";

export type MemberListRow = {
  id: string;
  user_id: string | null;
  role: MemberRole;
  invited_email: string | null;
  invite_token: string | null;
  invite_accepted_at: string | null;
  created_at: string;
  fullName: string | null;
  authEmail: string | null;
};

type Props = {
  members: MemberListRow[];
  currentUserId: string;
  siteUrl: string;
};

const ASSIGNABLE_ROLES: MemberRole[] = ["admin", "manager", "field"];

export function SettingsMembers({ members, currentUserId, siteUrl }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const form = useForm<InviteMemberInputT>({
    resolver: zodResolver(InviteMemberInput),
    defaultValues: { email: "", role: "manager" },
  });

  function onInvite(values: InviteMemberInputT) {
    startTransition(async () => {
      const res = await inviteMember(values);
      if (!res.ok) {
        toast.error("Couldn't send invite", { description: res.error });
        return;
      }
      toast.success("Invite created", {
        description: "Copy the link and share it directly for now.",
      });
      form.reset({ email: "", role: "manager" });
      router.refresh();
    });
  }

  function onRoleChange(memberId: string, role: MemberRole) {
    if (!ASSIGNABLE_ROLES.includes(role)) return;
    startTransition(async () => {
      const res = await updateMemberRole({ memberId, role });
      if (!res.ok) {
        toast.error("Couldn't change role", { description: res.error });
        return;
      }
      toast.success("Role updated");
      router.refresh();
    });
  }

  async function onRemove(memberId: string) {
    const res = await removeMember({ memberId });
    if (!res.ok) {
      toast.error("Couldn't remove member", { description: res.error });
      return;
    }
    toast.success("Member removed");
    router.refresh();
  }

  async function copyInvite(memberId: string, token: string | null) {
    if (!token) return;
    const url = `${siteUrl}/invite/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(memberId);
      window.setTimeout(() => setCopiedId(null), 1800);
      toast.success("Invite link copied");
    } catch (err) {
      toast.error("Clipboard blocked", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <form onSubmit={form.handleSubmit(onInvite)} className="rounded-xl border bg-card p-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="invite-email">Invite teammate</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="name@example.com"
              {...form.register("email")}
            />
          </div>
          <div className="w-40 space-y-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <Select
              value={form.watch("role")}
              onValueChange={(value) =>
                form.setValue("role", value as InviteMemberInputT["role"])
              }
            >
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="manager">Manager</SelectItem>
                <SelectItem value="field">Field</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={pending} className="gap-1">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MailPlus className="h-4 w-4" />}
            Invite
          </Button>
        </div>
        {form.formState.errors.email ? (
          <p className="mt-2 text-xs text-destructive">
            {form.formState.errors.email.message}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-muted-foreground">
          Email delivery is coming later — for now, copy the invite link from the list below and send it yourself.
        </p>
      </form>

      <div className="divide-y rounded-xl border bg-card">
        {members.map((member) => {
          const pendingInvite = !member.invite_accepted_at;
          const isOwner = member.role === "owner";
          const isSelf = member.user_id === currentUserId;
          const displayName = pendingInvite
            ? member.invited_email ?? "(pending invite)"
            : member.fullName ?? member.authEmail ?? "Unknown";
          return (
            <div key={member.id} className="flex items-center gap-3 px-4 py-3">
              <UserRound className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{displayName}</p>
                <p className="text-xs text-muted-foreground">
                  {pendingInvite ? "Pending invite" : member.authEmail ?? ""}
                </p>
              </div>
              {isOwner ? (
                <Badge variant="outline">Owner</Badge>
              ) : (
                <Select
                  value={member.role}
                  onValueChange={(value) => onRoleChange(member.id, value as MemberRole)}
                  disabled={pending}
                >
                  <SelectTrigger className="h-8 w-28 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="field">Field</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {pendingInvite && member.invite_token ? (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => copyInvite(member.id, member.invite_token)}
                  aria-label="Copy invite link"
                >
                  {copiedId === member.id ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              ) : null}
              {!isOwner && !isSelf ? (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => onRemove(member.id)}
                  aria-label="Remove member"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
