"use client";

import { useEffect } from "react";
import { format, parseISO } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";

export type LightboxItem = {
  id: string;
  path: string;
  url: string;
  originalName: string | null;
  createdAt: string;
};

type Props = {
  items: LightboxItem[];
  index: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onDownload: (path: string) => void;
  onDelete?: (id: string, path: string) => void;
};

export function FileLightbox({
  items,
  index,
  onClose,
  onPrev,
  onNext,
  onDownload,
  onDelete,
}: Props) {
  const active = items[index];

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft") onPrev();
      else if (event.key === "ArrowRight") onNext();
    }
    window.addEventListener("keydown", onKey);
    // Prevent background scroll while the lightbox is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, onPrev, onNext]);

  if (!active) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={active.originalName ?? "Photo"}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="absolute right-4 top-4 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="secondary"
          size="icon"
          onClick={() => onDownload(active.path)}
          aria-label="Download"
          className="bg-white/10 text-white hover:bg-white/20"
        >
          <Download className="h-4 w-4" />
        </Button>
        {onDelete ? (
          <Button
            variant="secondary"
            size="icon"
            onClick={() => onDelete(active.id, active.path)}
            aria-label="Delete"
            className="bg-white/10 text-white hover:bg-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="icon"
          onClick={onClose}
          aria-label="Close"
          className="bg-white/10 text-white hover:bg-white/20"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {items.length > 1 ? (
        <>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onPrev();
            }}
            aria-label="Previous"
            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onNext();
            }}
            aria-label="Next"
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        </>
      ) : null}

      <div
        className="max-h-[90vh] max-w-[92vw]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={active.url}
          alt={active.originalName ?? "Photo"}
          className="max-h-[90vh] max-w-[92vw] object-contain"
        />
      </div>

      <div className="pointer-events-none absolute bottom-6 left-0 right-0 flex justify-center">
        <div className="pointer-events-auto max-w-[90vw] rounded-md bg-black/60 px-3 py-1.5 text-center text-xs text-white">
          <span className="font-medium">
            {active.originalName ?? active.path.split("/").slice(-1)[0]}
          </span>
          <span className="mx-2 text-white/50">·</span>
          <span className="text-white/70">
            {format(parseISO(active.createdAt), "MMM d, yyyy · HH:mm")}
          </span>
          {items.length > 1 ? (
            <>
              <span className="mx-2 text-white/50">·</span>
              <span className="text-white/70 tabular-nums">
                {index + 1} / {items.length}
              </span>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
