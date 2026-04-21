"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  UserPlus,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { createOrder } from "@/lib/actions/orders";
import { CreateOrderInput, type CreateOrderInputT } from "@/lib/validators/orders";
import type { CustomerListRow } from "@/lib/queries/customers";

type Props = {
  customers: CustomerListRow[];
  currency: string;
};

const STEPS = ["Customer", "Project", "Money", "Schedule"] as const;
type StepIndex = 0 | 1 | 2 | 3;

function moneyFmt(value: number | undefined, currency: string): string {
  if (!value || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function NewOrderDialog({ customers, currency }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const open = searchParams.get("new") === "1";
  const [step, setStep] = useState<StepIndex>(0);
  const [pending, startTransition] = useTransition();
  const [inlineCustomer, setInlineCustomer] = useState(false);
  const [customerPopoverOpen, setCustomerPopoverOpen] = useState(false);

  const form = useForm<CreateOrderInputT>({
    resolver: zodResolver(CreateOrderInput),
    defaultValues: {
      customer: { existingCustomerId: undefined, newCustomer: undefined },
      projectName: "",
      stoneType: "",
      edgeProfile: "",
      sinkCutouts: 0,
      cooktopCutouts: 0,
      estimatedSqft: undefined,
      quoteAmount: undefined,
      depositReceived: 0,
      measuredAt: undefined,
      fabricationStartDate: undefined,
      scheduledInstallDate: undefined,
      priority: "normal",
      assignedTo: undefined,
      notes: "",
    },
    mode: "onBlur",
  });

  const selectedCustomerId = form.watch("customer.existingCustomerId");
  const newCustomer = form.watch("customer.newCustomer");
  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId],
  );

  const quote = form.watch("quoteAmount");
  const deposit = form.watch("depositReceived");
  const balance = useMemo(() => {
    const q = typeof quote === "number" ? quote : Number(quote ?? 0);
    const d = typeof deposit === "number" ? deposit : Number(deposit ?? 0);
    return (Number.isFinite(q) ? q : 0) - (Number.isFinite(d) ? d : 0);
  }, [quote, deposit]);

  function closeDialog() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("new");
    router.push(`/orders?${params.toString()}`);
    setStep(0);
    setInlineCustomer(false);
    form.reset();
  }

  function onSelectExisting(id: string) {
    form.setValue("customer.existingCustomerId", id, { shouldValidate: true });
    form.setValue("customer.newCustomer", undefined);
    setInlineCustomer(false);
    setCustomerPopoverOpen(false);
  }

  function switchToInline() {
    form.setValue("customer.existingCustomerId", undefined);
    form.setValue("customer.newCustomer", {
      name: "",
      phone: "",
    } as CreateOrderInputT["customer"]["newCustomer"]);
    setInlineCustomer(true);
    setCustomerPopoverOpen(false);
  }

  async function submit(values: CreateOrderInputT) {
    startTransition(async () => {
      const result = await createOrder(values);
      if (!result.ok) {
        toast.error("Couldn't create order", { description: result.error });
        return;
      }
      toast.success(`Created ${result.data.orderNumber}`);
      closeDialog();
      router.refresh();
    });
  }

  function stepValid(index: StepIndex): boolean {
    if (index === 0) {
      if (selectedCustomerId) return true;
      if (newCustomer?.name && newCustomer.phone) return true;
      return false;
    }
    if (index === 1) {
      const project = form.watch("projectName");
      return typeof project === "string" && project.trim().length > 0;
    }
    return true;
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? closeDialog() : null)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New order</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
          {STEPS.map((label, index) => (
            <button
              key={label}
              type="button"
              onClick={() => (index <= step || stepValid(step) ? setStep(index as StepIndex) : null)}
              className={cn(
                "flex flex-1 items-center gap-2 rounded-md border px-2 py-1 text-xs",
                index === step
                  ? "border-foreground/40 bg-muted font-medium"
                  : index < step
                    ? "border-transparent text-muted-foreground"
                    : "border-transparent text-muted-foreground/60",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full border text-[10px]",
                  index < step
                    ? "border-brand bg-brand text-brand-foreground"
                    : index === step
                      ? "border-foreground"
                      : "border-muted-foreground/30",
                )}
              >
                {index < step ? <Check className="h-3 w-3" /> : index + 1}
              </span>
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>

        <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
          {step === 0 ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Customer</Label>
                <Popover open={customerPopoverOpen} onOpenChange={setCustomerPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                      {selectedCustomer
                        ? selectedCustomer.name +
                          (selectedCustomer.company ? ` · ${selectedCustomer.company}` : "")
                        : inlineCustomer
                          ? "Adding new customer…"
                          : "Pick a customer"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[320px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search customers…" />
                      <CommandList>
                        <CommandEmpty>No matches.</CommandEmpty>
                        <CommandGroup heading="Existing">
                          {customers.map((c) => (
                            <CommandItem
                              key={c.id}
                              value={`${c.name} ${c.company ?? ""} ${c.phone ?? ""}`}
                              onSelect={() => onSelectExisting(c.id)}
                            >
                              <span className="flex-1 truncate">{c.name}</span>
                              {c.company ? (
                                <span className="text-xs text-muted-foreground">
                                  {c.company}
                                </span>
                              ) : null}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                        <CommandGroup>
                          <CommandItem onSelect={switchToInline} className="gap-2">
                            <UserPlus className="h-4 w-4" /> Add a new customer
                          </CommandItem>
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {inlineCustomer ? (
                <div className="space-y-3 rounded-md border bg-muted/20 p-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="nc-name">Customer name</Label>
                    <Input
                      id="nc-name"
                      {...form.register("customer.newCustomer.name")}
                      placeholder="Sarah Chen"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="nc-phone">Phone</Label>
                      <Input
                        id="nc-phone"
                        {...form.register("customer.newCustomer.phone")}
                        placeholder="(555) 201-3344"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="nc-email">Email</Label>
                      <Input
                        id="nc-email"
                        type="email"
                        {...form.register("customer.newCustomer.email")}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="nc-company">Company (optional)</Label>
                    <Input
                      id="nc-company"
                      {...form.register("customer.newCustomer.company")}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="projectName">Project name</Label>
                <Input
                  id="projectName"
                  {...form.register("projectName")}
                  placeholder="Chen kitchen — island + perimeter"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="stoneType">Stone</Label>
                  <Input
                    id="stoneType"
                    {...form.register("stoneType")}
                    placeholder="Calacatta Gold (marble)"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edgeProfile">Edge profile</Label>
                  <Input
                    id="edgeProfile"
                    {...form.register("edgeProfile")}
                    placeholder="Eased"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="estimatedSqft">Sq ft (est.)</Label>
                  <Input
                    id="estimatedSqft"
                    type="number"
                    step="0.5"
                    {...form.register("estimatedSqft", { valueAsNumber: true })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sinkCutouts">Sink cutouts</Label>
                  <Input
                    id="sinkCutouts"
                    type="number"
                    min={0}
                    {...form.register("sinkCutouts", { valueAsNumber: true })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cooktopCutouts">Cooktop cutouts</Label>
                  <Input
                    id="cooktopCutouts"
                    type="number"
                    min={0}
                    {...form.register("cooktopCutouts", { valueAsNumber: true })}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="quoteAmount">Quote amount</Label>
                  <Input
                    id="quoteAmount"
                    type="number"
                    step="0.01"
                    {...form.register("quoteAmount", { valueAsNumber: true })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="depositReceived">Deposit received</Label>
                  <Input
                    id="depositReceived"
                    type="number"
                    step="0.01"
                    {...form.register("depositReceived", { valueAsNumber: true })}
                  />
                </div>
              </div>
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Balance due</p>
                <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
                  {moneyFmt(balance, currency)}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  rows={3}
                  {...form.register("notes")}
                  placeholder="Anything the shop floor should know."
                />
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="measuredAt">Measured</Label>
                  <Input id="measuredAt" type="date" {...form.register("measuredAt")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fabricationStartDate">Fab start</Label>
                  <Input
                    id="fabricationStartDate"
                    type="date"
                    {...form.register("fabricationStartDate")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="scheduledInstallDate">Install</Label>
                  <Input
                    id="scheduledInstallDate"
                    type="date"
                    {...form.register("scheduledInstallDate")}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="priority">Priority</Label>
                <Select
                  value={form.watch("priority") ?? "normal"}
                  onValueChange={(value) =>
                    form.setValue("priority", value as CreateOrderInputT["priority"], {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger id="priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="rush">Rush</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={() => (step === 0 ? closeDialog() : setStep((step - 1) as StepIndex))}
              disabled={pending}
              className="gap-1"
            >
              {step === 0 ? "Cancel" : <>
                <ArrowLeft className="h-4 w-4" /> Back
              </>}
            </Button>
            {step < 3 ? (
              <Button
                type="button"
                onClick={() => stepValid(step) && setStep((step + 1) as StepIndex)}
                disabled={!stepValid(step)}
                className="gap-1"
              >
                Next <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button type="submit" disabled={pending} className="gap-1">
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                Create order
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
