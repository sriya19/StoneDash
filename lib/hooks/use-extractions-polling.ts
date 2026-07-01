"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  ExtractionDocumentType,
  ExtractionStatus,
} from "@/lib/supabase/types";

export type ExtractionSummary = {
  id: string;
  fileId: string;
  documentType: ExtractionDocumentType;
  status: ExtractionStatus;
};

type StatusRow = {
  id: string;
  file_id: string;
  document_type: ExtractionDocumentType;
  status: ExtractionStatus;
};

// Poll POST /api/extractions/status every 2s ONLY while at least
// one tracked file is still `processing`. Once every tracked file
// has moved out of `processing`, the timer stops. Focus / visibility
// listeners retrigger a one-shot refresh in case the user swapped
// tabs during the poll window.
//
// Callers pass the initial map (from SSR); the hook returns the
// live-updating map. Bind it to file_id for O(1) lookup by the file
// card component.
export function useExtractionsPolling(
  fileIds: string[],
  initial: Record<string, ExtractionSummary | undefined>,
): Record<string, ExtractionSummary | undefined> {
  const [byFile, setByFile] = useState(initial);

  // Sync when initial changes (e.g. new files added after SSR).
  useEffect(() => {
    setByFile((prev) => {
      const next = { ...initial };
      for (const [fid, summary] of Object.entries(prev)) {
        // Preserve any client-side updates for files still in the
        // initial map (server may lag by one polling cycle).
        if (next[fid] && summary && summary.status !== next[fid]?.status) {
          next[fid] = summary;
        }
      }
      return next;
    });
    // Deliberately only re-run when the list of fileIds changes,
    // not on every initial mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileIds.join(",")]);

  const hasProcessing = useMemo(
    () =>
      Object.values(byFile).some(
        (s): s is ExtractionSummary => s?.status === "processing",
      ),
    [byFile],
  );

  const refresh = useCallback(async () => {
    if (fileIds.length === 0) return;
    try {
      const res = await fetch("/api/extractions/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_ids: fileIds }),
        cache: "no-store",
      });
      if (!res.ok) return;
      const body = (await res.json()) as { ok: boolean; rows: StatusRow[] };
      if (!body.ok) return;
      setByFile((prev) => {
        const next = { ...prev };
        for (const row of body.rows) {
          next[row.file_id] = {
            id: row.id,
            fileId: row.file_id,
            documentType: row.document_type,
            status: row.status,
          };
        }
        return next;
      });
    } catch {
      // Transient — next tick will retry.
    }
  }, [fileIds]);

  useEffect(() => {
    if (!hasProcessing) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer !== null) return;
      timer = setInterval(refresh, 2000);
    };
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        void refresh();
        start();
      }
    };
    const onFocus = () => {
      void refresh();
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [hasProcessing, refresh]);

  return byFile;
}
