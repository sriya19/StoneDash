"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Sparkles } from "lucide-react";

import type { AiIntakeEventRow, AiIntakeStatus } from "@/lib/supabase/types";
import { EmptyState } from "./empty-state";
import { IntakeStatusChip } from "./intake-status-chip";

type Props = {
  rows: AiIntakeEventRow[];
  thumbs: Record<string, string | null>;
};

// 2s poll while any row is processing (same cadence as Task 5's
// extraction chip). Stops the moment they've all settled.
const POLL_MS = 2_000;

export function IntakeList({ rows, thumbs }: Props) {
  const router = useRouter();
  const [statuses, setStatuses] = useState<Record<string, AiIntakeStatus>>(() => {
    const out: Record<string, AiIntakeStatus> = {};
    for (const r of rows) out[r.id] = r.status;
    return out;
  });

  // Sync when SSR sends a new list.
  useEffect(() => {
    setStatuses((prev) => {
      const next: Record<string, AiIntakeStatus> = {};
      for (const r of rows) next[r.id] = prev[r.id] ?? r.status;
      return next;
    });
  }, [rows]);

  const hasProcessing = useMemo(
    () => Object.values(statuses).some((s) => s === "processing"),
    [statuses],
  );

  const refresh = useCallback(async () => {
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return;
    try {
      const res = await fetch("/api/intake/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intake_ids: ids }),
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = (await res.json()) as {
        ok: boolean;
        rows: { id: string; status: AiIntakeStatus }[];
      };
      if (!body.ok) return;
      let anyMoved = false;
      setStatuses((prev) => {
        const next = { ...prev };
        for (const row of body.rows) {
          if (next[row.id] !== row.status) anyMoved = true;
          next[row.id] = row.status;
        }
        return next;
      });
      if (anyMoved) router.refresh();
    } catch {
      // network hiccup — next tick retries
    }
  }, [rows, router]);

  useEffect(() => {
    if (!hasProcessing) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer !== null) return;
      timer = setInterval(refresh, POLL_MS);
    };
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        void refresh();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hasProcessing, refresh]);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No screenshots yet."
        description="Drop a WhatsApp / email / SMS screenshot up top and the AI will read it, match to existing customers, and propose actions you can confirm."
      />
    );
  }

  function openReview(id: string) {
    router.push(`/intake?intake=${id}`);
  }

  return (
    <ul className="divide-y rounded-xl border bg-card">
      {rows.map((row) => {
        const status = statuses[row.id] ?? row.status;
        const thumb = thumbs[row.id] ?? null;
        const ext = extractionSummary(row);
        return (
          <li
            key={row.id}
            className="flex items-start gap-4 px-4 py-3.5"
          >
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-muted">
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumb}
                  alt="Screenshot thumbnail"
                  className="h-full w-full object-cover"
                />
              ) : null}
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <IntakeStatusChip
                  status={status}
                  onReview={status === "review" ? () => openReview(row.id) : undefined}
                />
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {formatDistanceToNow(parseISO(row.created_at), {
                    addSuffix: true,
                  })}
                </span>
              </div>
              {ext ? (
                <p className="line-clamp-2 text-sm leading-snug">{ext}</p>
              ) : status === "processing" ? (
                <p className="text-xs text-muted-foreground">
                  Extracting fields…
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Nothing extracted.
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// Pull a plain-text summary from the extraction JSONB.
function extractionSummary(row: AiIntakeEventRow): string | null {
  const ex = row.extraction as { requested_action?: string | null } | null;
  if (ex?.requested_action) return ex.requested_action;
  return null;
}
