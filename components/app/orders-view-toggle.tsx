"use client";

import { parseAsStringEnum, useQueryState } from "nuqs";
import { Kanban, Table } from "lucide-react";

import { Button } from "@/components/ui/button";

export function OrdersViewToggle() {
  const [view, setView] = useQueryState(
    "view",
    parseAsStringEnum(["table", "board"] as const).withDefault("table").withOptions({ shallow: false }),
  );

  return (
    <div className="inline-flex rounded-md border p-0.5">
      <Button
        type="button"
        variant={view === "table" ? "secondary" : "ghost"}
        size="sm"
        className="gap-1.5"
        onClick={() => setView("table")}
      >
        <Table className="h-3.5 w-3.5" /> Table
      </Button>
      <Button
        type="button"
        variant={view === "board" ? "secondary" : "ghost"}
        size="sm"
        className="gap-1.5"
        onClick={() => setView("board")}
      >
        <Kanban className="h-3.5 w-3.5" /> Board
      </Button>
    </div>
  );
}
