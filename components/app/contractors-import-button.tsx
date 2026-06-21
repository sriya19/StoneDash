"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CsvImportSheet } from "@/components/app/csv-import-sheet";
import { CONTRACTOR_IMPORT_CONFIG } from "@/lib/import/entities/contractors.config";

export function ContractorsImportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1"
        onClick={() => setOpen(true)}
      >
        <Download className="h-4 w-4" /> Import CSV
      </Button>
      <CsvImportSheet open={open} onOpenChange={setOpen} config={CONTRACTOR_IMPORT_CONFIG} />
    </>
  );
}
