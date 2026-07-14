"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { insertIntakeRow, kickOffIntake } from "@/lib/actions/intake";

const ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file per brief
const MAX_FILES_PER_DROP = 10;

type Props = { orgId: string };

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

export function IntakeUploader({ orgId }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files).slice(0, MAX_FILES_PER_DROP);
    if (list.length === 0) return;
    setPending(true);
    const supabase = createSupabaseBrowserClient();

    for (const file of list) {
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name} is larger than 10 MB`);
        continue;
      }
      if (file.type && !ALLOWED_MIME.includes(file.type)) {
        toast.error(`${file.name} — only images (PNG / JPG / HEIC / WebP)`);
        continue;
      }

      const safeName = sanitizeFilename(file.name);
      const key = crypto.randomUUID();
      // Bucket convention from migration 0022's header comment:
      //   {org_id}/intake/{key}-{filename}
      const path = `${orgId}/intake/${key}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("order-files")
        .upload(path, file, { contentType: file.type || undefined });
      if (uploadError) {
        toast.error(`Couldn't upload ${file.name}`, {
          description: uploadError.message,
        });
        continue;
      }

      const inserted = await insertIntakeRow({ storagePath: path });
      if (!inserted.ok) {
        toast.error(`Couldn't queue ${file.name}`, {
          description: inserted.error,
        });
        // Best-effort cleanup of the orphan storage object.
        await supabase.storage.from("order-files").remove([path]);
        continue;
      }

      // Fire-and-forget — the pipeline updates the row's status
      // when it finishes. The /intake list polls to reflect.
      await kickOffIntake(inserted.data.id);
      toast.success(`${file.name} queued for AI review`);
    }

    setPending(false);
    router.refresh();
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        if (event.dataTransfer.files.length > 0) {
          void handleFiles(event.dataTransfer.files);
        }
      }}
      className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
        dragOver ? "border-brand bg-brand/5" : "border-muted-foreground/30"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        multiple
        accept=".png,.jpg,.jpeg,.heic,.heif,.webp"
        onChange={(event) => {
          if (event.target.files) {
            void handleFiles(event.target.files);
            event.target.value = "";
          }
        }}
      />
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand/10 text-brand">
          <Upload className="h-5 w-5" />
        </div>
        <p className="text-sm font-medium">Drop screenshots here</p>
        <p className="max-w-md text-xs text-muted-foreground">
          WhatsApp, email, SMS — any image of a conversation. Up to 10 MB
          each, 10 files at a time. The AI reads them, matches to existing
          customers, and proposes actions you can confirm.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={pending}
          className="gap-1"
        >
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Choose screenshots
        </Button>
      </div>
    </div>
  );
}
