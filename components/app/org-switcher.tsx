"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { switchActiveOrg } from "@/lib/actions/session";

export type OrgSummary = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
};

type Props = {
  activeOrgId: string;
  orgs: OrgSummary[];
  collapsed?: boolean;
};

export function OrgSwitcher({ activeOrgId, orgs, collapsed }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const active = orgs.find((o) => o.id === activeOrgId);

  function onSelect(orgId: string) {
    if (orgId === activeOrgId) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const res = await switchActiveOrg(orgId);
      if (!res.ok) {
        toast.error("Couldn't switch shop", { description: res.error });
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          aria-label="Switch shop"
          disabled={pending}
          className="w-full justify-between px-2 font-normal"
        >
          <span className="flex items-center gap-2 truncate">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-brand text-[11px] font-semibold uppercase text-brand-foreground">
              {active?.name.slice(0, 1) ?? "?"}
            </span>
            {!collapsed ? (
              <span className="truncate text-sm">{active?.name ?? "Select shop"}</span>
            ) : null}
          </span>
          {!collapsed ? <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" /> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search shops…" />
          <CommandList>
            <CommandEmpty>No matching shops.</CommandEmpty>
            <CommandGroup heading="Your shops">
              {orgs.map((org) => (
                <CommandItem
                  key={org.id}
                  value={`${org.name} ${org.slug}`}
                  onSelect={() => onSelect(org.id)}
                  className="gap-2"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted text-[11px] font-semibold uppercase">
                    {org.name.slice(0, 1)}
                  </span>
                  <span className="flex-1 truncate">{org.name}</span>
                  {org.id === activeOrgId ? <Check className="h-4 w-4" /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem asChild>
                <Link href="/onboarding" className="gap-2">
                  <Plus className="h-4 w-4" /> Create new shop
                </Link>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
