import { cn } from "@/lib/utils";

export function Skeleton({
  className,
}: {
  className?: string;
}) {
  return (
    <div
      className={cn(
        "animate-shimmer rounded-lg bg-gradient-to-r from-slate-100 via-slate-200/80 to-slate-100 bg-[length:200%_100%]",
        className
      )}
    />
  );
}

export function SearchResultSkeleton({ count = 3 }: { count?: number }) {
  return (
    <ul className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <li
          key={i}
          className="flex gap-3 rounded-xl border border-slate-100 p-3.5"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-full" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function StatSkeleton() {
  return (
    <div className="card p-5">
      <Skeleton className="h-10 w-10 rounded-xl" />
      <Skeleton className="mt-4 h-3 w-24" />
      <Skeleton className="mt-2 h-7 w-16" />
    </div>
  );
}

export function ChatSkeleton() {
  return (
    <div className="space-y-4 p-2">
      <div className="flex justify-end gap-3">
        <Skeleton className="h-12 w-2/3 rounded-2xl rounded-tr-sm" />
        <Skeleton className="h-8 w-8 shrink-0 rounded-xl" />
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-8 w-8 shrink-0 rounded-xl" />
        <Skeleton className="h-20 w-3/4 rounded-2xl rounded-tl-sm" />
      </div>
    </div>
  );
}

export function AdminTableSkeleton() {
  return (
    <div className="space-y-3 p-6">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex gap-4">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}
