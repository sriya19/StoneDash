"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CsvImportSheet } from "@/components/app/csv-import-sheet";
import { CUSTOMER_IMPORT_CONFIG } from "@/lib/import/entities/customers.config";

// Thin wrapper that owns the open/close state for the import sheet.
// Kept separate from the page so the page stays a Server Component —
// only the button + sheet need client interactivity.
export function CustomersImportButton() {
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
      <CsvImportSheet open={open} onOpenChange={setOpen} config={CUSTOMER_IMPORT_CONFIG} />
    </>
  );
}
