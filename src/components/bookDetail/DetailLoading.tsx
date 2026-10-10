import { Skeleton } from "../ui";
import { DETAIL_GRID_CLASS, DETAIL_PAGE_CLASS } from "./layout";

export function DetailLoading() {
  return (
    <div className={DETAIL_PAGE_CLASS} role="status">
      <div aria-hidden="true">
        <Skeleton className="mb-6 h-9 w-24 rounded-full" />
        <div className="flex flex-col items-center gap-8 rounded-stage border border-line-hairline bg-surface-1 p-6 sm:flex-row sm:items-start sm:gap-10 sm:p-10 lg:gap-12 lg:p-12">
          <Skeleton className="aspect-cover w-40 shrink-0 sm:w-48 lg:w-56" />
          <div className="flex w-full flex-1 flex-col items-center gap-4 sm:items-start sm:pt-2">
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-10 w-3/4 rounded-control" />
            <Skeleton className="h-5 w-1/3 rounded-full" />
            <Skeleton className="mt-2 h-4 w-2/3 rounded-full" />
            <Skeleton className="mt-4 h-12 w-36 rounded-full" />
          </div>
        </div>
        <div className={DETAIL_GRID_CLASS}>
          <div className="space-y-2">
            <Skeleton className="mb-4 h-7 w-32 rounded-control" />
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-20 rounded-tile" />
            ))}
          </div>
          <div className="space-y-4">
            <Skeleton className="h-7 w-32 rounded-control" />
            <Skeleton className="h-56 rounded-panel" />
          </div>
        </div>
      </div>
      <span className="sr-only">Loading book…</span>
    </div>
  );
}
