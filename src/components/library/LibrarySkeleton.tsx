import { Skeleton } from "../ui";
import { LIBRARY_GRID_CLASS, SKELETON_CARD_COUNT } from "./layout";

export function LibrarySkeleton() {
  return (
    <div role="status">
      <ul className={LIBRARY_GRID_CLASS} aria-hidden="true">
        {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
          <li key={index} className={`flex flex-col gap-3 ${index >= 6 ? "max-md:hidden" : ""}`}>
            <Skeleton className="aspect-cover w-full" />
            <div className="space-y-2 px-0.5">
              <Skeleton className="h-4 w-4/5 rounded-full" />
              <Skeleton className="h-3 w-1/2 rounded-full" />
            </div>
          </li>
        ))}
      </ul>
      <span className="sr-only">Loading your library…</span>
    </div>
  );
}
