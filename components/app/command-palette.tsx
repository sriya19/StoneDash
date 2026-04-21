"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, User, Wrench } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { globalSearch, type SearchHit } from "@/lib/actions/search";

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [pending, startTransition] = useTransition();

  // ⌘K / Ctrl+K to toggle
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setHits([]);
      return;
    }
    const handle = window.setTimeout(() => {
      startTransition(async () => {
        const results = await globalSearch(trimmed);
        setHits(results);
      });
    }, 180);
    return () => window.clearTimeout(handle);
  }, [value, open]);

  function jumpTo(path: string) {
    setOpen(false);
    router.push(path);
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-2 text-muted-foreground"
      >
        <Search className="h-4 w-4" />
        <span>Search…</span>
        <kbd className="pointer-events-none ml-2 inline-flex h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search orders, customers…"
          value={value}
          onValueChange={setValue}
        />
        <CommandList>
          {pending ? (
            <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Searching…
            </div>
          ) : null}
          {!pending && value.trim().length < 2 ? (
            <CommandEmpty>Type at least two characters to search.</CommandEmpty>
          ) : null}
          {!pending && value.trim().length >= 2 && hits.length === 0 ? (
            <CommandEmpty>No matches.</CommandEmpty>
          ) : null}
          {hits.some((h) => h.kind === "order") ? (
            <CommandGroup heading="Orders">
              {hits
                .filter((h): h is Extract<SearchHit, { kind: "order" }> => h.kind === "order")
                .map((hit) => (
                  <CommandItem
                    key={`order-${hit.id}`}
                    value={`order ${hit.orderNumber} ${hit.projectName ?? ""} ${hit.customerName ?? ""}`}
                    onSelect={() => jumpTo(`/orders?order=${hit.id}`)}
                    className="gap-2"
                  >
                    <Wrench className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono text-xs">{hit.orderNumber}</span>
                    <span className="flex-1 truncate">{hit.projectName ?? "Untitled"}</span>
                    {hit.customerName ? (
                      <span className="text-xs text-muted-foreground">{hit.customerName}</span>
                    ) : null}
                  </CommandItem>
                ))}
            </CommandGroup>
          ) : null}
          {hits.some((h) => h.kind === "customer") ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Customers">
                {hits
                  .filter((h): h is Extract<SearchHit, { kind: "customer" }> => h.kind === "customer")
                  .map((hit) => (
                    <CommandItem
                      key={`customer-${hit.id}`}
                      value={`customer ${hit.name} ${hit.company ?? ""}`}
                      onSelect={() => jumpTo(`/customers?id=${hit.id}`)}
                      className="gap-2"
                    >
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1 truncate">{hit.name}</span>
                      {hit.company ? (
                        <span className="text-xs text-muted-foreground">{hit.company}</span>
                      ) : null}
                    </CommandItem>
                  ))}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </CommandDialog>
    </>
  );
}
