import { Skeleton } from "@/components/ui/skeleton";

export function BoardSkeleton() {
  return (
    <div className="w-full space-y-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-20" />
      </div>

      {/* Filter card skeleton */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <div className="space-y-3">
          <Skeleton className="h-5 w-16" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            <Skeleton className="h-9 sm:col-span-2 md:col-span-2 lg:col-span-2" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        </div>
      </div>

      {/* Stage summary skeleton */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <Skeleton className="mb-2 h-5 w-28" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-20" />
          ))}
        </div>
      </div>

      {/* Kanban columns skeleton */}
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max flex-nowrap items-start gap-4">
          {Array.from({ length: 6 }).map((_, colIndex) => (
            <div
              key={colIndex}
              className="inline-flex w-[220px] shrink-0 flex-col space-y-2 rounded-lg p-1.5"
              style={{ flex: "0 0 220px" }}
            >
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-5 w-8" />
              </div>
              {Array.from({ length: 3 - (colIndex % 2) }).map(
                (_, cardIndex) => (
                  <div
                    key={cardIndex}
                    className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800"
                  >
                    <div className="space-y-2">
                      <Skeleton className="h-3 w-28" />
                      <Skeleton className="h-3 w-36" />
                      <Skeleton className="h-3 w-24" />
                      <div className="flex gap-1.5 pt-1">
                        <Skeleton className="h-7 w-12" />
                      </div>
                    </div>
                  </div>
                ),
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
