"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format, parseISO } from "date-fns";
import type { OrderPriority, OrderStage } from "@prisma/client";
import { toast } from "sonner";
import { AlertTriangle, Download, FileText, HardHat, Trash2 } from "lucide-react";
import Link from "next/link";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { MemberRole } from "@prisma/client";

import { changeStage, deleteOrder, updateOrder } from "@/lib/actions/orders";
import { canDeleteOrder } from "@/lib/rbac";
import { createSignedUrl, deleteAttachment } from "@/lib/actions/attachments";
import { STAGE_LABELS, STAGE_ORDER } from "./pipeline-strip";
import { OrderStageBadge } from "./order-stage-badge";
import { FileUploader } from "./file-uploader";
import { ActivityFeed, type ActivityRow } from "./activity-feed";
import { StageChangeDialog } from "./stage-change-dialog";
import { FileGallery, type GalleryPhoto } from "./file-gallery";
import type { OrderDetailRow } from "@/lib/queries/orders";
import type { ContractorLite } from "@/lib/queries/contractors";

export type AttachmentRow = {
  id: string;
  storage_path: string;
  original_name: string | null;
  mime: string | null;
  size_bytes: number | null;
  kind: string;
  created_at: string;
};

type Props = {
  order: OrderDetailRow | null;
  attachments: AttachmentRow[];
  photoUrls: Record<string, string>;
  activity: ActivityRow[];
  lastNotesEdit: { actorName: string | null; at: string } | null;
  orgId: string;
  role: MemberRole;
  currency: string;
  contractors: ContractorLite[];
};

const ALL_PICKABLE_STAGES: OrderStage[] = [...STAGE_ORDER, "cancelled"];

function formatMoney(value: string | number | null | undefined, currency: string): string {
  const n = value === null || value === undefined ? 0 : Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

function bytesHuman(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function OrderDetailSheet({
  order,
  attachments,
  photoUrls,
  activity,
  lastNotesEdit,
  orgId,
  role,
  currency,
  contractors,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const open = Boolean(order) && Boolean(searchParams.get("order"));
  const [, startTransition] = useTransition();
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [pendingStage, setPendingStage] = useState<OrderStage | null>(null);
  const [stageDialogBusy, setStageDialogBusy] = useState(false);
  const [contractorPickerOpen, setContractorPickerOpen] = useState(false);

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("order");
    router.push(`/orders?${params.toString()}`);
  }

  function saveField(patch: Parameters<typeof updateOrder>[0]["patch"]) {
    if (!order) return;
    startTransition(async () => {
      const result = await updateOrder({ id: order.id, patch });
      if (!result.ok) {
        toast.error("Save failed", { description: result.error });
        return;
      }
      toast.success("Saved");
      router.refresh();
    });
  }

  function onStagePicked(next: OrderStage) {
    if (!order || next === order.stage) return;
    setPendingStage(next);
  }

  async function onConfirmStageChange(note: string) {
    if (!order || !pendingStage) return;
    setStageDialogBusy(true);
    const result = await changeStage({
      id: order.id,
      toStage: pendingStage,
      note,
    });
    setStageDialogBusy(false);
    if (!result.ok) {
      toast.error("Couldn't move stage", { description: result.error });
      return;
    }
    toast.success(`Moved to ${STAGE_LABELS[pendingStage]}`);
    setPendingStage(null);
    router.refresh();
  }

  async function onDownload(path: string) {
    const signed = await createSignedUrl(path);
    if (!signed.ok) {
      toast.error("Couldn't open file", { description: signed.error });
      return;
    }
    window.open(signed.url, "_blank", "noopener,noreferrer");
  }

  async function onDelete(attachmentId: string, path: string) {
    const res = await deleteAttachment({ id: attachmentId, storagePath: path });
    if (!res.ok) {
      toast.error("Couldn't delete", { description: res.error });
      return;
    }
    toast.success("File removed");
    router.refresh();
  }

  async function onDeleteOrder() {
    if (!order) return;
    setDeleteBusy(true);
    const res = await deleteOrder({ id: order.id });
    setDeleteBusy(false);
    if (!res.ok) {
      toast.error("Couldn't delete order", { description: res.error });
      return;
    }
    toast.success(`${order.order_number} deleted`);
    close();
    router.refresh();
  }

  if (!order) {
    return (
      <Sheet open={open} onOpenChange={(next) => (!next ? close() : null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Order not found</SheetTitle>
          </SheetHeader>
          <p className="mt-4 text-sm text-muted-foreground">
            The order may have been deleted. Close this panel and refresh.
          </p>
        </SheetContent>
      </Sheet>
    );
  }

  const isFieldRole = role === "field";
  const canDelete = canDeleteOrder(role);

  return (
    <Sheet open={open} onOpenChange={(next) => (!next ? close() : null)}>
      <SheetContent className="flex w-full max-w-xl flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="space-y-3 border-b px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-muted-foreground">
              {order.order_number}
            </span>
            <OrderStageBadge stage={order.stage} />
            <span className="ml-auto text-xs uppercase tracking-wide text-muted-foreground">
              {order.priority}
            </span>
          </div>
          <SheetTitle className="text-lg">
            {order.project_name ?? "Untitled project"}
          </SheetTitle>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <Label
                htmlFor="stage-picker"
                className="text-xs uppercase tracking-wide text-muted-foreground"
              >
                Stage
              </Label>
              <Select
                value={pendingStage ?? order.stage}
                onValueChange={(next) => onStagePicked(next as OrderStage)}
              >
                <SelectTrigger id="stage-picker" className="h-8 w-[180px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_PICKABLE_STAGES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STAGE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {canDelete ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline" className="ml-auto gap-1 text-destructive">
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Delete {order.order_number}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This also removes its activity log and uploaded files.
                      This can&apos;t be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={onDeleteOrder} disabled={deleteBusy}>
                      {deleteBusy ? "Deleting…" : "Delete order"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
          </div>
        </SheetHeader>

        <Tabs defaultValue="overview" className="flex-1 overflow-hidden">
          <TabsList className="mx-6 mt-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="files">Files · {attachments.length}</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <NotesCard
              value={order.notes ?? ""}
              lastEdit={lastNotesEdit}
              disabled={false}
              onSave={(v) => saveField({ notes: v === "" ? undefined : v })}
            />

            <section className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Customer
              </p>
              <p className="text-sm font-medium">
                {order.customers?.name ?? "—"}
                {order.customers?.company ? (
                  <span className="ml-2 text-muted-foreground">
                    {order.customers.company}
                  </span>
                ) : null}
              </p>
            </section>

            <section className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Contractor
              </p>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1 text-sm">
                  {order.contractors ? (
                    <Link
                      href={`/contractors/${order.contractors.id}`}
                      className="inline-flex items-center gap-1.5 font-medium hover:underline"
                    >
                      <HardHat className="h-3.5 w-3.5 text-muted-foreground" />
                      {order.contractors.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">No contractor</span>
                  )}
                </div>
                {!isFieldRole ? (
                  <Popover
                    open={contractorPickerOpen}
                    onOpenChange={setContractorPickerOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button type="button" variant="ghost" size="sm">
                        {order.contractors ? "Change" : "Add contractor"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[280px] p-0" align="end">
                      <Command>
                        <CommandInput placeholder="Search contractors…" />
                        <CommandList>
                          <CommandEmpty>No matches.</CommandEmpty>
                          {order.contractors ? (
                            <CommandGroup>
                              <CommandItem
                                value="__clear__ no contractor"
                                onSelect={() => {
                                  setContractorPickerOpen(false);
                                  saveField({ contractorId: "" });
                                }}
                              >
                                <span className="text-muted-foreground">
                                  Clear contractor
                                </span>
                              </CommandItem>
                            </CommandGroup>
                          ) : null}
                          <CommandGroup>
                            {contractors.map((c) => (
                              <CommandItem
                                key={c.id}
                                value={c.name}
                                onSelect={() => {
                                  setContractorPickerOpen(false);
                                  saveField({ contractorId: c.id });
                                }}
                              >
                                <span className="flex-1 truncate">{c.name}</span>
                                {c.id === order.contractor_id ? (
                                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                    current
                                  </span>
                                ) : !c.isActive ? (
                                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                    inactive
                                  </span>
                                ) : null}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                ) : null}
              </div>
            </section>

            <FieldEditor
              label="Project name"
              value={order.project_name ?? ""}
              disabled={isFieldRole}
              onSave={(v) => saveField({ projectName: v })}
            />

            <div className="grid grid-cols-2 gap-4">
              <FieldEditor
                label="Stone"
                value={order.stone_type ?? ""}
                disabled={isFieldRole}
                onSave={(v) => saveField({ stoneType: v })}
              />
              <FieldEditor
                label="Edge profile"
                value={order.edge_profile ?? ""}
                disabled={isFieldRole}
                onSave={(v) => saveField({ edgeProfile: v })}
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <FieldEditor
                label="Sq ft"
                value={order.estimated_sqft ?? ""}
                type="number"
                disabled={isFieldRole}
                onSave={(v) => saveField({ estimatedSqft: v === "" ? undefined : Number(v) })}
              />
              <FieldEditor
                label="Sink cutouts"
                value={String(order.sink_cutouts)}
                type="number"
                disabled={isFieldRole}
                onSave={(v) => saveField({ sinkCutouts: Math.max(0, Number(v || 0)) })}
              />
              <FieldEditor
                label="Cooktop cutouts"
                value={String(order.cooktop_cutouts)}
                type="number"
                disabled={isFieldRole}
                onSave={(v) => saveField({ cooktopCutouts: Math.max(0, Number(v || 0)) })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FieldEditor
                label="Quote amount"
                value={order.quote_amount ?? ""}
                type="number"
                disabled={isFieldRole}
                onSave={(v) => saveField({ quoteAmount: v === "" ? undefined : Number(v) })}
              />
              <FieldEditor
                label="Deposit received"
                value={order.deposit_received ?? "0"}
                type="number"
                disabled={isFieldRole}
                onSave={(v) => saveField({ depositReceived: Math.max(0, Number(v || 0)) })}
              />
            </div>

            <section className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Balance due</p>
              <p className="font-mono text-lg tabular-nums">
                {formatMoney(order.balance_due, currency)}
              </p>
            </section>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Measured</p>
                <p className="text-sm">{order.measured_at ?? "—"}</p>
              </div>
              <FieldEditor
                label="Fab start"
                value={order.fabrication_start_date ?? ""}
                type="date"
                disabled={isFieldRole}
                onSave={(v) => saveField({ fabricationStartDate: v === "" ? undefined : v })}
              />
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Install</p>
                <p className="text-sm">{order.scheduled_install_date ?? "—"}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Measurement and install dates are scheduled events. Edit via /schedule.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <PrioritySelector
                value={order.priority as OrderPriority}
                disabled={isFieldRole}
                onChange={(v) => saveField({ priority: v })}
              />
            </div>

            {isFieldRole ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="h-3 w-3" />
                Field role can only change stage and update notes.
              </p>
            ) : null}
          </TabsContent>

          <TabsContent value="files" className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <FileUploader orgId={orgId} orderId={order.id} />
            {(() => {
              const photos = attachments.filter((a) => a.mime?.startsWith("image/"));
              const documents = attachments.filter(
                (a) => !a.mime?.startsWith("image/"),
              );
              if (attachments.length === 0) {
                return (
                  <p className="text-center text-sm text-muted-foreground">
                    No files yet.
                  </p>
                );
              }
              const galleryPhotos: GalleryPhoto[] = photos.map((att) => ({
                id: att.id,
                path: att.storage_path,
                url: photoUrls[att.storage_path] ?? null,
                originalName: att.original_name,
                mime: att.mime,
                createdAt: att.created_at,
              }));
              return (
                <>
                  <FileGallery
                    photos={galleryPhotos}
                    onDownload={onDownload}
                    onDelete={isFieldRole ? undefined : onDelete}
                  />
                  {documents.length > 0 ? (
                    <section className="space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Documents · {documents.length}
                      </h3>
                      <ul className="divide-y rounded-md border bg-card">
                        {documents.map((att) => (
                          <li key={att.id} className="flex items-center gap-3 px-4 py-3">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {att.original_name ?? att.storage_path.split("/").slice(-1)[0]}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {att.kind} · {bytesHuman(att.size_bytes)} ·{" "}
                                {format(parseISO(att.created_at), "MMM d, HH:mm")}
                              </p>
                            </div>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => onDownload(att.storage_path)}
                              aria-label="Download"
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                            {!isFieldRole ? (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => onDelete(att.id, att.storage_path)}
                                aria-label="Delete"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </>
              );
            })()}
          </TabsContent>

          <TabsContent value="activity" className="flex-1 overflow-y-auto px-6 py-5">
            <ActivityFeed items={activity} />
          </TabsContent>
        </Tabs>

        <StageChangeDialog
          open={pendingStage !== null}
          orderNumber={order.order_number}
          fromStage={order.stage}
          toStage={pendingStage ?? order.stage}
          pending={stageDialogBusy}
          onConfirm={onConfirmStageChange}
          onCancel={() => setPendingStage(null)}
        />
      </SheetContent>
    </Sheet>
  );
}

type FieldEditorProps = {
  label: string;
  value: string;
  type?: "text" | "number" | "date";
  disabled?: boolean;
  onSave: (value: string) => void;
};

function FieldEditor({ label, value, type = "text", disabled, onSave }: FieldEditorProps) {
  const [local, setLocal] = useState(value);

  function commit() {
    if (local === value) return;
    onSave(local);
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <Input
        value={local}
        type={type}
        disabled={disabled}
        onChange={(event) => setLocal(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            (event.target as HTMLInputElement).blur();
          }
        }}
        className="h-8 text-sm"
      />
    </div>
  );
}

function NotesCard({
  value,
  lastEdit,
  disabled,
  onSave,
}: {
  value: string;
  lastEdit: { actorName: string | null; at: string } | null;
  disabled?: boolean;
  onSave: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);

  function commit() {
    if (local === value) return;
    onSave(local);
  }

  return (
    <section className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Notes
        </Label>
        {lastEdit ? (
          <span className="text-[11px] text-muted-foreground">
            Last edited by {lastEdit.actorName ?? "someone"} ·{" "}
            {formatDistanceToNowStrict(lastEdit.at)}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">Not edited yet</span>
        )}
      </div>
      <Textarea
        value={local}
        rows={6}
        disabled={disabled}
        onChange={(event) => setLocal(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            (event.target as HTMLTextAreaElement).blur();
          }
        }}
        placeholder="Shop-floor notes, scheduling quirks, customer preferences…"
        className="min-h-[8rem] resize-y text-sm"
      />
    </section>
  );
}

function formatDistanceToNowStrict(iso: string): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diffMs / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return format(parseISO(iso), "MMM d");
  } catch {
    return "recently";
  }
}

function PrioritySelector({
  value,
  disabled,
  onChange,
}: {
  value: OrderPriority;
  disabled?: boolean;
  onChange: (v: OrderPriority) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        Priority
      </Label>
      <Select
        value={value}
        onValueChange={(next) => onChange(next as OrderPriority)}
        disabled={disabled}
      >
        <SelectTrigger className="h-8">
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
  );
}
