"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { OrderStage } from "@prisma/client";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

import { cn } from "@/lib/utils";
import { changeStage } from "@/lib/actions/orders";
import type { OrderListRow } from "@/lib/queries/orders";
import { STAGE_LABELS, STAGE_SHORT_LABELS } from "./pipeline-strip";
import { StageChangeDialog } from "./stage-change-dialog";

const BOARD_STAGES: OrderStage[] = [
  "quote",
  "measurement",
  "fabrication",
  "ready_for_install",
  "installation",
  "invoiced",
  "paid",
];

function formatMoney(value: string | null, currency: string): string {
  const n = value ? Number(value) : 0;
  if (!Number.isFinite(n) || n === 0) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  try {
    return format(parseISO(value), "MMM d");
  } catch {
    return value;
  }
}

type Props = {
  rows: OrderListRow[];
  currency: string;
};

type DraggableCardProps = {
  row: OrderListRow;
  currency: string;
  onOpen: (id: string) => void;
};

function DraggableCard({ row, currency, onOpen }: DraggableCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: row.id,
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group rounded-md border bg-card p-3 shadow-sm cursor-grab active:cursor-grabbing select-none",
        isDragging && "opacity-70 shadow-lg ring-2 ring-brand",
      )}
      {...attributes}
      {...listeners}
      onDoubleClick={() => onOpen(row.id)}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-muted-foreground">
          {row.order_number}
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(row.id);
          }}
          className="text-[11px] text-muted-foreground opacity-0 underline underline-offset-2 group-hover:opacity-100"
        >
          Open
        </button>
      </div>
      <p className="mt-1 text-sm font-medium leading-snug line-clamp-2">
        {row.project_name ?? "Untitled"}
      </p>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {row.customers?.name ?? "—"}
      </p>
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
        <span>{formatDate(row.scheduled_install_date)}</span>
        <span className={cn(Number(row.balance_due) > 0 && "text-foreground")}>
          {formatMoney(row.balance_due, currency)}
        </span>
      </div>
    </div>
  );
}

type ColumnProps = {
  stage: OrderStage;
  rows: OrderListRow[];
  currency: string;
  onOpen: (id: string) => void;
};

function BoardColumn({ stage, rows, currency, onOpen }: ColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id: stage });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-64 shrink-0 flex-col rounded-xl border bg-muted/30",
        isOver && "ring-2 ring-brand",
      )}
    >
      <div className="flex items-center justify-between border-b px-3 py-2 text-xs">
        <span className="font-medium uppercase tracking-wider">
          {STAGE_SHORT_LABELS[stage]}
        </span>
        <span className="rounded bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
          {rows.length}
        </span>
      </div>
      <div className="flex min-h-[120px] flex-col gap-2 overflow-y-auto px-2 py-2">
        {rows.length === 0 ? (
          <div className="flex-1 rounded-md border border-dashed py-6 text-center text-[11px] text-muted-foreground">
            Drop orders here
          </div>
        ) : (
          rows.map((row) => (
            <DraggableCard key={row.id} row={row} currency={currency} onOpen={onOpen} />
          ))
        )}
      </div>
    </div>
  );
}

type PendingMove = {
  orderId: string;
  orderNumber: string;
  fromStage: OrderStage;
  toStage: OrderStage;
};

export function OrdersBoard({ rows, currency }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [localRows, setLocalRows] = useState(rows);
  const [, startTransition] = useTransition();
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // Sync back to server data whenever props change
  useMemo(() => {
    setLocalRows(rows);
  }, [rows]);

  const byStage = useMemo(() => {
    const map = new Map<OrderStage, OrderListRow[]>();
    for (const stage of BOARD_STAGES) map.set(stage, []);
    for (const row of localRows) {
      const bucket = map.get(row.stage);
      if (bucket) bucket.push(row);
    }
    return map;
  }, [localRows]);

  function openDetail(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("order", id);
    router.push(`/orders?${params.toString()}`);
  }

  function onDragEnd(event: DragEndEvent) {
    const orderId = String(event.active.id);
    const target = event.over?.id;
    if (!target) return;
    const nextStage = target as OrderStage;

    const current = localRows.find((r) => r.id === orderId);
    if (!current || current.stage === nextStage) return;

    // Apply the optimistic move immediately (so the card stays in the
    // destination column while the dialog is open) and queue the reason
    // prompt. If the user cancels or the server rejects, we revert below.
    setLocalRows((prev) =>
      prev.map((r) => (r.id === orderId ? { ...r, stage: nextStage } : r)),
    );
    setPendingMove({
      orderId,
      orderNumber: current.order_number,
      fromStage: current.stage,
      toStage: nextStage,
    });
  }

  function revertPendingMove() {
    if (!pendingMove) return;
    const { orderId, fromStage } = pendingMove;
    setLocalRows((prev) =>
      prev.map((r) => (r.id === orderId ? { ...r, stage: fromStage } : r)),
    );
    setPendingMove(null);
  }

  async function onConfirmMove(note: string) {
    if (!pendingMove) return;
    setDialogBusy(true);
    const { orderId, orderNumber, toStage } = pendingMove;
    const result = await changeStage({ id: orderId, toStage, note });
    setDialogBusy(false);
    if (!result.ok) {
      toast.error("Couldn't move order", { description: result.error });
      revertPendingMove();
      return;
    }
    toast.success(`Moved ${orderNumber} → ${STAGE_LABELS[toStage]}`);
    setPendingMove(null);
    startTransition(() => router.refresh());
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {BOARD_STAGES.map((stage) => (
          <BoardColumn
            key={stage}
            stage={stage}
            rows={byStage.get(stage) ?? []}
            currency={currency}
            onOpen={openDetail}
          />
        ))}
      </div>
      {pendingMove ? (
        <StageChangeDialog
          open
          orderNumber={pendingMove.orderNumber}
          fromStage={pendingMove.fromStage}
          toStage={pendingMove.toStage}
          pending={dialogBusy}
          onConfirm={onConfirmMove}
          onCancel={revertPendingMove}
        />
      ) : null}
    </DndContext>
  );
}
