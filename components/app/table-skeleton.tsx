import { Skeleton } from "@/components/ui/skeleton";

type Props = {
  rows?: number;
  columns?: number;
  // Whether to render the page header strip (title bar + filters row)
  // above the table. Most list routes (/orders, /customers, etc.) want
  // it so the loading state matches the eventual rendered shape. Tab-
  // embedded tables don't.
  withHeader?: boolean;
};

// A skeleton that *shapes* like a list page, not a generic gray bar.
// Showing real-looking column widths + a row count that matches the
// usual page size makes the wait feel like "data is coming" instead of
// "something might be loading."
export function TableSkeleton({
  rows = 8,
  columns = 6,
  withHeader = true,
}: Props) {
  // Vary column widths so each skeleton row reads as different cells
  // rather than a strip of equal-width grey. Cycle through a small set
  // of fixed widths so the visual is stable across the rows.
  const widths = ["w-20", "w-32", "w-40", "w-24", "w-16", "w-28"];

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-6 py-6">
      {withHeader ? (
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-9 w-28" />
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="border-b bg-card px-3 py-3">
          <div className="flex gap-6">
            {Array.from({ length: columns }).map((_, i) => (
              <Skeleton key={i} className="h-3 w-16" />
            ))}
          </div>
        </div>
        <div className="divide-y">
          {Array.from({ length: rows }).map((_, r) => (
            <div key={r} className="flex items-center gap-6 px-3 py-3">
              {Array.from({ length: columns }).map((_, c) => (
                <Skeleton key={c} className={`h-4 ${widths[c % widths.length]}`} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
