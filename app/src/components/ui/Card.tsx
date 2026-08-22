import { cn } from "@/lib/utils";

export function Card({
  className,
  children,
  hover,
}: {
  className?: string;
  children?: React.ReactNode;
  hover?: boolean;
}) {
  return (
    <div className={cn("card p-6", hover && "card-hover", className)}>
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon,
  trend,
  accent = "teal",
  delay = 0,
  compactValue,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  trend?: string;
  accent?: "teal" | "blue" | "amber";
  delay?: number;
  compactValue?: boolean;
}) {
  const accents = {
    teal: "from-teal-500/10 to-teal-600/5 text-teal-600",
    blue: "from-blue-500/10 to-blue-600/5 text-blue-600",
    amber: "from-amber-500/10 to-amber-600/5 text-amber-600",
  };

  return (
    <div
      className={cn(
        "card card-hover p-4 animate-fade-in sm:p-5",
        delay > 0 && `stagger-${delay}`
      )}
    >
      <div className="flex items-start justify-between">
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br sm:h-10 sm:w-10",
            accents[accent]
          )}
        >
          {icon}
        </div>
        {trend && <span className="badge badge-amber">{trend}</span>}
      </div>
      <p className="mt-3 text-xs font-medium text-slate-500 sm:mt-4 sm:text-sm">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 font-bold tracking-tight text-slate-900",
          compactValue ? "text-base sm:text-lg" : "text-xl sm:text-2xl"
        )}
      >
        {value}
      </p>
    </div>
  );
}
