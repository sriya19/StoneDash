"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Search } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { CrewListRow } from "@/lib/queries/crew";

type Props = {
  rows: CrewListRow[];
  totalInOrg: number;
};

type SortKey = "name" | "role" | "active" | "last";

export function CrewTable({ rows, totalInOrg }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeOnly = searchParams.get("active") !== "0";
  const search = searchParams.get("q") ?? "";
  const sort = (searchParams.get("sort") ?? "name") as SortKey;
  const dir = searchParams.get("dir") === "desc" ? "desc" : "asc";

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sort) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "role":
          cmp = (a.role ?? "").localeCompare(b.role ?? "");
          break;
        case "active":
          cmp = a.activeAssignmentCount - b.activeAssignmentCount;
          break;
        case "last":
          cmp = (a.lastAssignmentAt ?? "").localeCompare(b.lastAssignmentAt ?? "");
          break;
      }
      return dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [rows, sort, dir]);

  function updateParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    router.replace(`/team?${params.toString()}`);
  }

  function toggleSort(key: SortKey) {
    if (sort === key) {
      updateParams({ sort: key, dir: dir === "asc" ? "desc" : "asc" });
    } else {
      // Name + role default ascending; counts and dates default descending.
      updateParams({
        sort: key,
        dir: key === "name" || key === "role" ? "asc" : "desc",
      });
    }
  }

  function openDetail(id: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("id", id);
    router.push(`/team?${params.toString()}`);
  }

  const emptyShown = sorted.length === 0;
  const emptyState = totalInOrg === 0 ? "org" : "filtered";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, role, phone, email…"
            defaultValue={search}
            onChange={(e) => {
              const value = e.target.value;
              updateParams({ q: value.length >= 2 ? value : null });
            }}
            className="pl-8"
          />
        </div>
        <Label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={activeOnly}
            onCheckedChange={(v) =>
              updateParams({ active: v === true ? null : "0" })
            }
          />
          Active only
        </Label>
      </div>

      {emptyShown ? (
        emptyState === "org" ? (
          <div className="rounded-xl border bg-card p-12 text-center">
            <p className="text-sm font-medium">No crew yet.</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              Add the people you assign installs and measurements to. They
              don&apos;t need to log in — you just need a name, a role, and a
              phone number to text the address to.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
            No crew match the current filter.
          </div>
        )
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Name" active={sort === "name"} dir={dir} onClick={() => toggleSort("name")} />
                <SortableHead label="Role" active={sort === "role"} dir={dir} onClick={() => toggleSort("role")} />
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <SortableHead
                  className="text-right"
                  label="Active assignments"
                  active={sort === "active"}
                  dir={dir}
                  onClick={() => toggleSort("active")}
                />
                <SortableHead
                  className="text-right"
                  label="Last assignment"
                  active={sort === "last"}
                  dir={dir}
                  onClick={() => toggleSort("last")}
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => openDetail(row.id)}
                >
                  <TableCell>
                    <span className="font-medium">{row.name}</span>
                    {!row.isActive ? (
                      <Badge variant="secondary" className="ml-2 text-[10px]">
                        Inactive
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.role ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.phone ? (
                      <a
                        href={`tel:${row.phone}`}
                        onClick={(e) => e.stopPropagation()}
                        className="hover:text-foreground hover:underline"
                      >
                        {row.phone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.email ? (
                      <a
                        href={`mailto:${row.email}`}
                        onClick={(e) => e.stopPropagation()}
                        className="hover:text-foreground hover:underline"
                      >
                        {row.email}
                      </a>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.activeAssignmentCount > 0 ? (
                      <span className="font-medium">{row.activeAssignmentCount}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {row.lastAssignmentAt
                      ? formatDistanceToNow(parseISO(row.lastAssignmentAt), { addSuffix: true })
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function SortableHead({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  className?: string;
}) {
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        {active ? (
          <span aria-hidden className="text-[10px]">
            {dir === "asc" ? "▲" : "▼"}
          </span>
        ) : null}
      </button>
    </TableHead>
  );
}
