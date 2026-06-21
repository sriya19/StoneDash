import { Skeleton } from "@/components/ui/skeleton";

// Mirrors the eventual dashboard shape: greeting header → 4 KPI cards →
// pipeline strip + activity feed. Same outer max-width and spacing as
// `app/(app)/dashboard/page.tsx` so nothing reflows when the data lands.
export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl space-y-7 px-6 py-10">
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex h-32 flex-col justify-between rounded-xl border bg-card p-5"
          >
            <Skeleton className="h-3 w-24" />
            <div className="space-y-2">
              <Skeleton className="h-7 w-20" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border bg-card lg:col-span-2">
          <div className="border-b px-5 py-3.5">
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="grid grid-cols-7 gap-px bg-border/70">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="space-y-2 bg-card px-3.5 py-5">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-6 w-6" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border bg-card lg:col-span-1">
          <div className="border-b px-5 py-3.5">
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="divide-y">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 px-5 py-3">
                <Skeleton className="h-6 w-6 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-2.5 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
