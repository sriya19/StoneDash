"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Loader2, Plus, X, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { createOrder } from "@/lib/actions/orders";
import type { CustomerListRow } from "@/lib/queries/customers";

type Props = {
  customers: CustomerListRow[];
};

type Mode = "pick" | "create";

// Quick Add is the "10 orders in 5 minutes" surface that PLAN Q5 spec'd.
// Unlike NewOrderDialog (a 4-step wizard for one rich order at a time),
// this is a single lean form that resets on submit so the user can keep
// punching in orders without re-opening the sheet. A tiny counter at the
// top tracks how many they've created this session — turns repetitive
// data entry into a small game.
//
// Fields are the minimal viable order: customer, project, stone type,
// quote, install date. Everything else (priority, edge profile, deposit,
// crew assignment, etc.) lives in the full dialog or order-detail edit.
export function QuickAddOrderSheet({ customers: initialCustomers }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const open = searchParams.get("quick") === "1";

  const [customers, setCustomers] = useState<CustomerListRow[]>(initialCustomers);
  const [mode, setMode] = useState<Mode>("pick");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [projectName, setProjectName] = useState("");
  const [stoneType, setStoneType] = useState("");
  const [quoteAmount, setQuoteAmount] = useState("");
  const [installDate, setInstallDate] = useState("");
  const [createdCount, setCreatedCount] = useState(0);
  const [pending, startTransition] = useTransition();

  // Sync the SSR-supplied customer list to local state when it changes
  // (the parent page re-fetches via router.refresh() after each create).
  useEffect(() => {
    setCustomers(initialCustomers);
  }, [initialCustomers]);

  const projectRef = useRef<HTMLInputElement>(null);

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("quick");
    router.replace(params.size > 0 ? `/orders?${params.toString()}` : "/orders");
  }

  function resetForNext() {
    setMode("pick");
    setCustomerId(null);
    setNewName("");
    setNewPhone("");
    setProjectName("");
    setStoneType("");
    setQuoteAmount("");
    setInstallDate("");
    // Focus the project field once the form has cleared — the customer
    // picker auto-keeps the last selected customer in the dropdown so
    // returning users see their recent picks first.
    setTimeout(() => projectRef.current?.focus(), 0);
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (mode === "pick" && !customerId) {
      toast.error("Pick a customer or add a new one");
      return;
    }
    if (mode === "create" && newName.trim().length === 0) {
      toast.error("Customer name is required");
      return;
    }
    if (mode === "create" && newPhone.trim().length < 4) {
      toast.error("Customer phone is required");
      return;
    }
    if (projectName.trim().length === 0) {
      toast.error("Project name is required");
      return;
    }

    const quoteNum = quoteAmount.trim() === "" ? undefined : Number(quoteAmount);
    if (quoteNum !== undefined && !Number.isFinite(quoteNum)) {
      toast.error("Quote amount must be a number");
      return;
    }

    startTransition(async () => {
      const result = await createOrder({
        customer:
          mode === "pick"
            ? { existingCustomerId: customerId!, newCustomer: undefined }
            : {
                existingCustomerId: undefined,
                newCustomer: {
                  name: newName.trim(),
                  phone: newPhone.trim(),
                  company: undefined,
                  email: undefined,
                  city: undefined,
                  state: undefined,
                },
              },
        contractorId: undefined,
        projectName: projectName.trim(),
        stoneType: stoneType.trim() || undefined,
        edgeProfile: undefined,
        sinkCutouts: 0,
        cooktopCutouts: 0,
        estimatedSqft: undefined,
        quoteAmount: quoteNum,
        depositReceived: undefined,
        measuredAt: undefined,
        fabricationStartDate: undefined,
        scheduledInstallDate: installDate || undefined,
        priority: "normal",
        assignedTo: undefined,
        notes: undefined,
      });

      if (!result.ok) {
        toast.error("Couldn't create order", { description: result.error });
        return;
      }

      toast.success(`${result.data.orderNumber} created`);
      setCreatedCount((n) => n + 1);
      resetForNext();
      // Pull the fresh customer list (in case we just inlined a new one)
      // and rehydrate the underlying table.
      router.refresh();
    });
  }

  const selectedCustomer = customers.find((c) => c.id === customerId);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-muted/40 text-brand">
              <Zap className="h-3.5 w-3.5" />
            </span>
            Quick Add
          </SheetTitle>
          <SheetDescription>
            Punch in orders fast. Each submit resets the form so you can keep
            going.
          </SheetDescription>
        </SheetHeader>

        {createdCount > 0 ? (
          <div className="mt-4 flex items-center justify-between rounded-md border bg-brand-muted/20 px-3 py-2 text-xs">
            <span className="text-brand">
              <strong className="font-semibold tabular-nums">{createdCount}</strong>{" "}
              order{createdCount === 1 ? "" : "s"} added this session
            </span>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setCreatedCount(0)}
              aria-label="Reset counter"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          {/* Customer picker */}
          <div className="space-y-1.5">
            <Label className="text-[13px] font-medium">Customer</Label>
            {mode === "pick" ? (
              <div className="flex items-center gap-2">
                <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      aria-expanded={popoverOpen}
                      className="h-9 flex-1 justify-between font-normal"
                    >
                      <span className="truncate">
                        {selectedCustomer ? selectedCustomer.name : "Pick a customer…"}
                      </span>
                      <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search customers…" />
                      <CommandList>
                        <CommandEmpty>No matches.</CommandEmpty>
                        <CommandGroup>
                          {customers.map((c) => (
                            <CommandItem
                              key={c.id}
                              value={`${c.name} ${c.company ?? ""} ${c.phone ?? ""}`}
                              onSelect={() => {
                                setCustomerId(c.id);
                                setPopoverOpen(false);
                              }}
                              className="gap-2"
                            >
                              <Check
                                className={cn(
                                  "h-4 w-4",
                                  customerId === c.id ? "opacity-100" : "opacity-0",
                                )}
                              />
                              <div className="flex flex-col">
                                <span className="text-sm">{c.name}</span>
                                {c.company ? (
                                  <span className="text-xs text-muted-foreground">
                                    {c.company}
                                  </span>
                                ) : null}
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 gap-1 px-2 text-xs"
                  onClick={() => {
                    setMode("create");
                    setCustomerId(null);
                  }}
                >
                  <Plus className="h-3.5 w-3.5" /> New
                </Button>
              </div>
            ) : (
              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    New customer
                  </span>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setMode("pick");
                      setNewName("");
                      setNewPhone("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
                <Input
                  placeholder="Customer name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="h-9"
                />
                <Input
                  placeholder="Phone"
                  type="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="h-9"
                />
              </div>
            )}
          </div>

          {/* Project name */}
          <div className="space-y-1.5">
            <Label htmlFor="qa-project" className="text-[13px] font-medium">
              Project name
            </Label>
            <Input
              id="qa-project"
              ref={projectRef}
              placeholder="e.g. Smith kitchen island"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="h-9"
              autoComplete="off"
            />
          </div>

          {/* Stone type */}
          <div className="space-y-1.5">
            <Label htmlFor="qa-stone" className="text-[13px] font-medium">
              Stone type <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="qa-stone"
              placeholder="e.g. Calacatta Gold quartz"
              value={stoneType}
              onChange={(e) => setStoneType(e.target.value)}
              className="h-9"
              autoComplete="off"
            />
          </div>

          {/* Quote + install date side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="qa-quote" className="text-[13px] font-medium">
                Quote <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="qa-quote"
                placeholder="0"
                value={quoteAmount}
                onChange={(e) => setQuoteAmount(e.target.value)}
                inputMode="decimal"
                className="h-9 tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qa-install" className="text-[13px] font-medium">
                Install date <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="qa-install"
                type="date"
                value={installDate}
                onChange={(e) => setInstallDate(e.target.value)}
                className="h-9 tabular-nums"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t pt-4">
            <Button type="button" variant="ghost" onClick={close} disabled={pending}>
              Done
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create order
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
