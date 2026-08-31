"use client";

import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Folder,
  FolderOpen,
  Inbox,
  Loader2,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CloudFolderHint } from "@/lib/cloud-folder-hint";
import { folderSiapMetrics } from "@/lib/cloud-folder-hint";
import type { FolderStats } from "@/lib/folder-stats";
import {
  FOLDER_VISUAL_LABELS,
  resolveFolderVisualState,
  type FolderVisualState,
} from "@/lib/folder-visual";

const FOLDER_VISUAL: Record<
  FolderVisualState,
  {
    iconClass: string;
    wrapClass: string;
    treeIconClass: string;
    Icon: typeof Folder;
  }
> = {
  loading: {
    iconClass: "text-[var(--auth-ink)]/35",
    wrapClass: "bg-[var(--auth-ink)]/[0.04]",
    treeIconClass: "text-[var(--auth-ink)]/35",
    Icon: Folder,
  },
  empty: {
    iconClass: "text-[var(--auth-ink)]/30",
    wrapClass: "bg-[var(--auth-ink)]/[0.04] ring-1 ring-[var(--auth-ink)]/10",
    treeIconClass: "text-[var(--auth-ink)]/30",
    Icon: FolderOpen,
  },
  unknown: {
    iconClass: "text-amber-500",
    wrapClass: "bg-amber-50/70",
    treeIconClass: "text-amber-500/80",
    Icon: Folder,
  },
  cloud_only: {
    iconClass: "text-sky-600",
    wrapClass: "bg-sky-50 ring-1 ring-sky-200/70",
    treeIconClass: "text-sky-600",
    Icon: Folder,
  },
  pending: {
    iconClass: "text-amber-600",
    wrapClass: "bg-amber-50 ring-1 ring-amber-200/80",
    treeIconClass: "text-amber-600",
    Icon: Folder,
  },
  processing: {
    iconClass: "text-sky-700",
    wrapClass: "bg-sky-50 ring-1 ring-sky-200/80",
    treeIconClass: "text-sky-700",
    Icon: Folder,
  },
  partial: {
    iconClass: "text-[var(--auth-teal)]",
    wrapClass: "bg-[var(--auth-teal)]/10 ring-1 ring-[var(--auth-teal)]/25",
    treeIconClass: "text-[var(--auth-teal)]",
    Icon: Folder,
  },
  ready: {
    iconClass: "text-[var(--auth-teal)]",
    wrapClass: "bg-[var(--auth-teal)]/15 ring-1 ring-[var(--auth-teal)]/35",
    treeIconClass: "text-[var(--auth-teal-deep)]",
    Icon: Folder,
  },
  issue: {
    iconClass: "text-amber-700",
    wrapClass: "bg-amber-100/80 ring-1 ring-amber-300/80",
    treeIconClass: "text-amber-700",
    Icon: Folder,
  },
};

function StatusDot({ state, size = "md" }: { state: FolderVisualState; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-2 w-2" : "h-3.5 w-3.5";
  const iconSize = size === "sm" ? 6 : 8;

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full border border-white shadow-sm",
        dim,
        state === "ready" && "bg-[var(--auth-teal)] text-white",
        state === "partial" && "bg-[var(--auth-teal)]/80 text-white",
        state === "pending" && "bg-amber-500 text-white",
        state === "processing" && "bg-sky-600 text-white",
        state === "issue" && "bg-amber-600 text-white",
        state === "empty" && "bg-[var(--auth-ink)]/35 text-white",
        state === "cloud_only" && "bg-sky-500 text-white",
        state === "loading" && "bg-white text-[var(--auth-ink)]/50",
        state === "unknown" && "bg-amber-400/90 text-white"
      )}
      aria-hidden
    >
      {state === "loading" || state === "processing" ? (
        <Loader2 size={iconSize} className="animate-spin" />
      ) : state === "ready" ? (
        <CheckCircle2 size={iconSize} strokeWidth={3} />
      ) : state === "partial" ? (
        size === "sm" ? null : (
          <span className="text-[7px] font-bold leading-none">½</span>
        )
      ) : state === "pending" ? (
        <Clock size={iconSize} strokeWidth={3} />
      ) : state === "issue" ? (
        <AlertCircle size={iconSize} strokeWidth={3} />
      ) : state === "empty" ? (
        <Minus size={iconSize} strokeWidth={3} />
      ) : state === "cloud_only" ? (
        <Inbox size={iconSize} strokeWidth={3} />
      ) : (
        <span className="h-1 w-1 rounded-full bg-white" />
      )}
    </span>
  );
}

export function FolderStateIcon({
  stats,
  cloudHint,
  loading,
}: {
  stats: FolderStats | null;
  cloudHint: CloudFolderHint | null;
  loading?: boolean;
}) {
  const state = resolveFolderVisualState(stats, cloudHint, loading);
  const visual = FOLDER_VISUAL[state];
  const Icon = visual.Icon;

  return (
    <div
      className={cn(
        "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
        visual.wrapClass,
        visual.iconClass
      )}
      title={FOLDER_VISUAL_LABELS[state]}
    >
      <Icon size={18} strokeWidth={2} />
      <span className="absolute -bottom-0.5 -right-0.5">
        <StatusDot state={state} />
      </span>
    </div>
  );
}

/** Compact folder row for tree sidebar (aligned with main list). */
export function FolderTreeIcon({
  stats,
  cloudHint,
  loading,
  isCurrent,
}: {
  stats: FolderStats | null;
  cloudHint: CloudFolderHint | null;
  loading?: boolean;
  isCurrent?: boolean;
}) {
  const state = resolveFolderVisualState(stats, cloudHint, loading);
  const visual = FOLDER_VISUAL[state];
  const Icon = visual.Icon;

  return (
    <span
      className="relative inline-flex shrink-0 items-center"
      title={FOLDER_VISUAL_LABELS[state]}
    >
      <Icon
        size={12}
        className={cn(
          "transition-colors",
          isCurrent ? "text-[var(--auth-teal)]" : visual.treeIconClass
        )}
      />
      <span className="absolute -bottom-0.5 -right-1">
        <StatusDot state={state} size="sm" />
      </span>
    </span>
  );
}

export function FolderStatusChip({
  stats,
  cloudHint,
  compact,
}: {
  stats: FolderStats | null;
  cloudHint: CloudFolderHint | null;
  compact?: boolean;
}) {
  const metrics = folderSiapMetrics(stats, cloudHint);
  if (!metrics) return null;
  const { done, total, pct } = metrics;
  const incompleteCache = cloudHint?.recursiveComplete === false;
  const tone =
    stats && stats.failedCount > 0
      ? "text-amber-700 bg-amber-50 border-amber-200"
      : done === total && !incompleteCache
        ? "text-[var(--auth-teal)] bg-[var(--auth-teal)]/10 border-[var(--auth-teal)]/20"
        : "text-[var(--auth-ink)]/55 bg-[var(--auth-ink)]/[0.04] border-[var(--auth-ink)]/10";

  return (
    <span
      className={cn(
        "shrink-0 rounded-full border font-semibold tabular-nums",
        compact
          ? "px-1 py-0 text-[9px]"
          : "hidden px-2 py-0.5 text-[10px] sm:inline",
        tone
      )}
      title={`${done} dari ${total} dokumen siap${
        incompleteCache ? " (cache cloud belum lengkap)" : ""
      }`}
    >
      {incompleteCache && metrics.cloudKnown ? `~${pct}%` : `${pct}%`}
      {!compact && " siap"}
    </span>
  );
}

export function FolderIconLegend() {
  const items: { state: FolderVisualState; short: string }[] = [
    { state: "empty", short: "Kosong" },
    { state: "cloud_only", short: "Ada isi" },
    { state: "pending", short: "Belum scan" },
    { state: "processing", short: "Proses" },
    { state: "partial", short: "Sebagian" },
    { state: "ready", short: "Siap" },
    { state: "issue", short: "Gagal / 0 B" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[var(--auth-ink)]/45">
      <span className="font-semibold uppercase tracking-[0.12em] text-[var(--auth-ink)]/30">
        Ikon folder
      </span>
      {items.map(({ state, short }) => {
        const v = FOLDER_VISUAL[state];
        const Icon = v.Icon;
        return (
          <span
            key={state}
            className="inline-flex items-center gap-1"
            title={FOLDER_VISUAL_LABELS[state]}
          >
            <span className={cn("inline-flex", v.iconClass)}>
              <Icon size={12} />
            </span>
            {short}
          </span>
        );
      })}
    </div>
  );
}
