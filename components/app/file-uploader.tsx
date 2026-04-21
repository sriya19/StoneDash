"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { registerAttachment } from "@/lib/actions/attachments";

const ALLOWED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
];
const MAX_BYTES = 25 * 1024 * 1024;

type Props = {
  orgId: string;
  orderId: string;
};

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

export function FileUploader({ orgId, orderId }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setPending(true);
    const supabase = createSupabaseBrowserClient();

    for (const file of list) {
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name} is larger than 25 MB`);
        continue;
      }
      if (file.type && !ALLOWED_MIME.includes(file.type)) {
        toast.error(`${file.name} — unsupported file type`);
        continue;
      }

      const safeName = sanitizeFilename(file.name);
      const key = crypto.randomUUID();
      const path = `${orgId}/${orderId}/${key}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("order-files")
        .upload(path, file, { contentType: file.type || undefined });

      if (uploadError) {
        toast.error(`Couldn't upload ${file.name}`, { description: uploadError.message });
        continue;
      }

      const register = await registerAttachment({
        orderId,
        storagePath: path,
        originalName: file.name,
        mime: file.type || undefined,
        sizeBytes: file.size,
        kind: file.type.startsWith("image/") ? "photo" : "other",
      });

      if (!register.ok) {
        toast.error(`Couldn't save ${file.name}`, { description: register.error });
        // Best-effort cleanup; ignore secondary errors.
        await supabase.storage.from("order-files").remove([path]);
        continue;
      }

      toast.success(`Uploaded ${file.name}`);
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
      className={`rounded-lg border border-dashed p-6 text-center transition-colors ${
        dragOver ? "border-brand bg-brand/5" : "border-muted-foreground/30"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        multiple
        accept=".pdf,.jpg,.jpeg,.png,.heic"
        onChange={(event) => {
          if (event.target.files) {
            void handleFiles(event.target.files);
            event.target.value = "";
          }
        }}
      />
      <div className="flex flex-col items-center gap-2">
        <Upload className="h-5 w-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Drop files here or click to browse
        </p>
        <p className="text-xs text-muted-foreground">
          PDF, JPG, PNG, HEIC · up to 25 MB each
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
          Choose files
        </Button>
      </div>
    </div>
  );
}
