"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, FileUp, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { autoMapHeaders } from "@/lib/import/helpers";

// ---------------------------------------------------------------------------
// Config shape — each entity importer (customers / contractors / orders)
// passes one of these to the shared <CsvImportSheet>. Sub-step 9 builds
// the shell; sub-steps 10-12 instantiate it per entity.
// ---------------------------------------------------------------------------

export type ImportFieldConfig<TField extends string> = {
  field: TField;
  label: string;
  required?: boolean;
  // Aliases the auto-mapper uses to guess which CSV column maps to
  // this field. Already in `normalizeHeader` shape (lowercase + _).
  aliases: readonly string[];
};

export type CsvImportConfig<TField extends string> = {
  // Shown in the sheet title + the commit success copy ("123 customers
  // imported").
  entity: { singular: string; plural: string };
  // Subtitle text under the sheet title.
  description: string;
  fields: ImportFieldConfig<TField>[];
  // Where the client posts the file + mapping for commit. Each entity
  // importer in sub-steps 10-12 stands up its own route handler
  // (`/api/import/customers`, etc.) so commit logic stays close to the
  // schema it writes.
  commitEndpoint: string;
};

export type ParsePreview = {
  headers: string[];
  rows: Record<string, string>[];
  totalRows: number;
  sanitizedCells: number;
};

export type CommitResult =
  | { ok: true; inserted: number; skipped: number; warnings: string[] }
  | { ok: false; error: string };

type Props<TField extends string> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: CsvImportConfig<TField>;
};

type Step = "pick" | "preview" | "committing" | "done";

// One-stop import dialog. Three stages:
//   1. Pick a file → POST to /api/import/parse for headers + preview rows.
//   2. Preview + map → show first 10 rows, let user fix the column→field
//      mapping (auto-guessed via header aliases), validate that every
//      required field is mapped, then submit.
//   3. Commit → POST the same File blob to the entity-specific commit
//      endpoint with the mapping JSON. Show inserted/skipped + warnings.
//
// The sheet keeps the file in a ref across stages so the commit POST
// re-uploads the exact bytes the parse route already saw — no JSON
// serialization of potentially-large row arrays.
export function CsvImportSheet<TField extends string>({
  open,
  onOpenChange,
  config,
}: Props<TField>) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<File | null>(null);

  const [step, setStep] = useState<Step>("pick");
  const [preview, setPreview] = useState<ParsePreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, TField | "">>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);

  const requiredFields = useMemo(
    () => config.fields.filter((f) => f.required).map((f) => f.field),
    [config.fields],
  );

  const unmappedRequired = useMemo(() => {
    const mapped = new Set(Object.values(mapping).filter((v) => v !== ""));
    return requiredFields.filter((f) => !mapped.has(f));
  }, [mapping, requiredFields]);

  const reset = useCallback(() => {
    fileRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
    setStep("pick");
    setPreview(null);
    setMapping({});
    setParseError(null);
    setCommitResult(null);
  }, []);

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function onFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const f = event.target.files?.[0];
    if (!f) return;
    fileRef.current = f;
    setParseError(null);

    const fd = new FormData();
    fd.append("file", f);

    const res = await fetch("/api/import/parse", { method: "POST", body: fd });
    const body = (await res.json()) as
      | (ParsePreview & { ok: true })
      | { ok: false; error: string };

    if (!body.ok) {
      setParseError(body.error);
      return;
    }

    setPreview({
      headers: body.headers,
      rows: body.rows,
      totalRows: body.totalRows,
      sanitizedCells: body.sanitizedCells,
    });

    const aliasMap = Object.fromEntries(
      config.fields.map((f) => [f.field, f.aliases]),
    ) as Record<TField, readonly string[]>;
    const guess = autoMapHeaders(body.headers, aliasMap);
    const initial: Record<string, TField | ""> = {};
    for (const h of body.headers) initial[h] = (guess[h] ?? "") as TField | "";
    setMapping(initial);

    setStep("preview");
  }

  async function onCommit() {
    if (!fileRef.current) return;
    if (unmappedRequired.length > 0) {
      toast.error("Map every required column before importing");
      return;
    }

    setStep("committing");
    setCommitResult(null);

    const fd = new FormData();
    fd.append("file", fileRef.current);
    fd.append("mapping", JSON.stringify(mapping));

    const res = await fetch(config.commitEndpoint, {
      method: "POST",
      body: fd,
    });
    const body = (await res.json()) as CommitResult;

    setCommitResult(body);
    setStep("done");

    if (body.ok) {
      toast.success(
        `${body.inserted} ${body.inserted === 1 ? config.entity.singular : config.entity.plural} imported`,
      );
      router.refresh();
    } else {
      toast.error("Import failed", { description: body.error });
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Import {config.entity.plural}</SheetTitle>
          <SheetDescription>{config.description}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {step === "pick" ? (
            <PickStep
              onPick={() => fileInputRef.current?.click()}
              parseError={parseError}
              inputRef={fileInputRef}
              onChange={onFileChosen}
            />
          ) : null}

          {step === "preview" && preview ? (
            <PreviewStep
              fileName={fileRef.current?.name ?? ""}
              preview={preview}
              fields={config.fields}
              mapping={mapping}
              setMapping={setMapping}
              unmappedRequired={unmappedRequired}
              onBack={() => {
                reset();
              }}
              onCommit={onCommit}
            />
          ) : null}

          {step === "committing" ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-brand" />
              <p className="text-sm text-muted-foreground">
                Importing {preview?.totalRows.toLocaleString()} rows…
              </p>
            </div>
          ) : null}

          {step === "done" && commitResult ? (
            <DoneStep
              result={commitResult}
              entity={config.entity}
              onClose={() => handleOpenChange(false)}
              onImportMore={() => reset()}
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Sub-views — extracted for readability, not reusability. Inlined into
// the same module so the component graph stays flat for callers.
// ---------------------------------------------------------------------------

function PickStep({
  onPick,
  parseError,
  inputRef,
  onChange,
}: {
  onPick: () => void;
  parseError: string | null;
  inputRef: React.RefObject<HTMLInputElement>;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onPick}
        className={cn(
          "flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border bg-card px-6 py-14 text-center transition-colors",
          "hover:border-brand/50 hover:bg-brand-muted/20",
        )}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-muted/40 text-brand">
          <Upload className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">Choose a CSV file</p>
          <p className="text-xs text-muted-foreground">
            Up to 5 MB. Headers in the first row.
          </p>
        </div>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={onChange}
      />
      {parseError ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{parseError}</span>
        </div>
      ) : null}
    </div>
  );
}

function PreviewStep<TField extends string>({
  fileName,
  preview,
  fields,
  mapping,
  setMapping,
  unmappedRequired,
  onBack,
  onCommit,
}: {
  fileName: string;
  preview: ParsePreview;
  fields: ImportFieldConfig<TField>[];
  mapping: Record<string, TField | "">;
  setMapping: React.Dispatch<React.SetStateAction<Record<string, TField | "">>>;
  unmappedRequired: TField[];
  onBack: () => void;
  onCommit: () => void;
}) {
  const fieldLabelByField = useMemo(
    () => Object.fromEntries(fields.map((f) => [f.field, f.label])) as Record<TField, string>,
    [fields],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-xs">
        <div className="flex items-center gap-2 truncate">
          <FileUp className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="truncate font-medium">{fileName}</span>
        </div>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {preview.totalRows.toLocaleString()} row
          {preview.totalRows === 1 ? "" : "s"}
          {preview.sanitizedCells > 0
            ? ` · ${preview.sanitizedCells} cell${preview.sanitizedCells === 1 ? "" : "s"} sanitized`
            : ""}
        </span>
      </div>

      <div className="space-y-2">
        <Label className="text-[13px] font-medium">Column mapping</Label>
        <p className="text-xs text-muted-foreground">
          Each CSV column maps to a StoneDash field. Required fields are
          marked with a dot.
        </p>
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>CSV column</TableHead>
                <TableHead>StoneDash field</TableHead>
                <TableHead className="text-muted-foreground">Sample</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.headers.map((header) => {
                const sample =
                  preview.rows.find((r) => (r[header] ?? "") !== "")?.[header] ?? "—";
                return (
                  <TableRow key={header}>
                    <TableCell className="font-mono text-xs">{header}</TableCell>
                    <TableCell>
                      <Select
                        value={mapping[header] ?? ""}
                        onValueChange={(value) =>
                          setMapping((prev) => ({
                            ...prev,
                            [header]: value as TField | "",
                          }))
                        }
                      >
                        <SelectTrigger className="h-8 w-[200px] text-xs">
                          <SelectValue placeholder="(skip)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">(skip this column)</SelectItem>
                          {fields.map((f) => (
                            <SelectItem key={f.field} value={f.field}>
                              {f.label}
                              {f.required ? (
                                <span className="ml-1 text-brand">•</span>
                              ) : null}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground">
                      {sample}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {unmappedRequired.length > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
          <span className="text-amber-900">
            Map these required fields before importing:{" "}
            {unmappedRequired.map((f) => fieldLabelByField[f]).join(", ")}.
          </span>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={onBack}>
          Choose a different file
        </Button>
        <Button
          type="button"
          onClick={onCommit}
          disabled={unmappedRequired.length > 0}
        >
          Import {preview.totalRows.toLocaleString()} rows
        </Button>
      </div>
    </div>
  );
}

function DoneStep({
  result,
  entity,
  onClose,
  onImportMore,
}: {
  result: CommitResult;
  entity: { singular: string; plural: string };
  onClose: () => void;
  onImportMore: () => void;
}) {
  if (!result.ok) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{result.error}</span>
        </div>
        <div className="flex justify-end">
          <Button onClick={onImportMore}>Try again</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-md border border-success/40 bg-success/10 px-3 py-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
        <div className="space-y-0.5">
          <p className="text-sm font-medium">
            Imported {result.inserted.toLocaleString()}{" "}
            {result.inserted === 1 ? entity.singular : entity.plural}.
          </p>
          {result.skipped > 0 ? (
            <p className="text-xs text-muted-foreground">
              {result.skipped.toLocaleString()} row
              {result.skipped === 1 ? "" : "s"} skipped (duplicates or
              validation errors).
            </p>
          ) : null}
        </div>
      </div>

      {result.warnings.length > 0 ? (
        <div className="rounded-md border bg-muted/30 p-3 text-xs">
          <p className="mb-1.5 font-medium">Warnings</p>
          <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
            {result.warnings.slice(0, 10).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
            {result.warnings.length > 10 ? (
              <li className="text-muted-foreground/70">
                + {result.warnings.length - 10} more
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button variant="ghost" onClick={onImportMore}>
          Import another file
        </Button>
        <Button onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}
