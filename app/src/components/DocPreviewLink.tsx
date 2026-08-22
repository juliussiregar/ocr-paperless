import type { MouseEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** File title that opens the PDF preview in a new browser tab. */
export function DocPreviewLink({
  docId,
  children,
  className,
  title,
  onClick,
}: {
  docId: number;
  children: ReactNode;
  className?: string;
  title?: string;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <a
      href={`/api/documents/${docId}/preview`}
      target="_blank"
      rel="noopener noreferrer"
      title={title ?? "Buka preview di tab baru"}
      onClick={onClick}
      className={cn(
        "truncate text-[var(--auth-ink)] underline-offset-2 transition hover:text-[var(--auth-teal)] hover:underline",
        className
      )}
    >
      {children}
    </a>
  );
}
