import { Skeleton } from "../ui";

export function DetailLoading() {
  return (
    <div className="max-w-6xl mx-auto px-5 sm:px-6 py-12 space-y-10">
      <Skeleton className="h-4 w-28 rounded-md" />
      <div className="flex gap-10 items-center">
        <Skeleton className="w-44 aspect-[2/3] rounded-2xl shimmer" />
        <div className="space-y-4 flex-1">
          <Skeleton className="h-10 w-2/3 rounded-md" />
          <Skeleton className="h-5 w-1/3 rounded-md" />
          <Skeleton className="h-7 w-24 rounded-full" />
        </div>
      </div>
      <Skeleton className="h-36 rounded-3xl shimmer" />
      <Skeleton className="h-72 rounded-3xl shimmer" />
    </div>
  );
}
