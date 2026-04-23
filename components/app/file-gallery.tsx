"use client";

import { useState } from "react";
import { Download, ImageOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FileLightbox, type LightboxItem } from "./file-lightbox";

export type GalleryPhoto = {
  id: string;
  path: string;
  url: string | null;
  originalName: string | null;
  mime: string | null;
  createdAt: string;
};

type Props = {
  photos: GalleryPhoto[];
  onDownload: (path: string) => void;
  onDelete?: (id: string, path: string) => void;
};

function Thumb({
  photo,
  onOpen,
  onDownload,
}: {
  photo: GalleryPhoto;
  onOpen: () => void;
  onDownload: (path: string) => void;
}) {
  const [broken, setBroken] = useState(false);

  if (!photo.url || broken) {
    // Fallback tile — HEIC in Chromium, or a signing failure.
    return (
      <div className="group relative flex aspect-square flex-col items-center justify-center gap-1 rounded-md border bg-muted/40 p-2 text-center">
        <ImageOff className="h-5 w-5 text-muted-foreground" />
        <span className="truncate text-[10px] text-muted-foreground">
          {photo.originalName ?? "Photo"}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1 px-2 text-[11px]"
          onClick={(event) => {
            event.stopPropagation();
            onDownload(photo.path);
          }}
        >
          <Download className="h-3 w-3" /> Open
        </Button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group relative aspect-square overflow-hidden rounded-md border bg-muted/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      aria-label={photo.originalName ?? "Photo"}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.url}
        alt={photo.originalName ?? ""}
        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
        onError={() => setBroken(true)}
        loading="lazy"
      />
    </button>
  );
}

export function FileGallery({ photos, onDownload, onDelete }: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (photos.length === 0) return null;

  const lightboxItems: LightboxItem[] = photos
    .filter((p): p is GalleryPhoto & { url: string } => typeof p.url === "string")
    .map((p) => ({
      id: p.id,
      path: p.path,
      url: p.url,
      originalName: p.originalName,
      createdAt: p.createdAt,
    }));

  function open(index: number) {
    // Snap to the matching lightbox index (filtered list skips broken tiles).
    const photo = photos[index];
    if (!photo || !photo.url) {
      onDownload(photo?.path ?? "");
      return;
    }
    const lightboxIndex = lightboxItems.findIndex((item) => item.id === photo.id);
    setOpenIndex(lightboxIndex < 0 ? null : lightboxIndex);
  }

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Photos · {photos.length}
        </h3>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {photos.map((photo, index) => (
          <Thumb
            key={photo.id}
            photo={photo}
            onOpen={() => open(index)}
            onDownload={onDownload}
          />
        ))}
      </div>
      {openIndex !== null && lightboxItems[openIndex] ? (
        <FileLightbox
          items={lightboxItems}
          index={openIndex}
          onClose={() => setOpenIndex(null)}
          onPrev={() =>
            setOpenIndex((prev) => {
              if (prev === null) return null;
              return (prev - 1 + lightboxItems.length) % lightboxItems.length;
            })
          }
          onNext={() =>
            setOpenIndex((prev) => {
              if (prev === null) return null;
              return (prev + 1) % lightboxItems.length;
            })
          }
          onDownload={onDownload}
          onDelete={onDelete}
        />
      ) : null}
    </section>
  );
}
