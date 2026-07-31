interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-cinema-800 ${className}`}
      aria-hidden="true"
    />
  );
}
