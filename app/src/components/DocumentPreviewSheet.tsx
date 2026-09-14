"use client";

import Link from "next/link";
import { GripVertical, MessageSquare, X } from "lucide-react";
import { cn } from "@/lib/utils";

export const PREVIEW_WIDTH_KEY = "cloud-browser:preview-width";
export const PREVIEW_MIN = 320;
export const PREVIEW_MAX = 960;
export const PREVIEW_DEFAULT = 480;

interface PreviewResizeHandleProps {
  onResizeStart: (e: React.MouseEvent) => void;
  onResetWidth?: () => void;
  resizing?: boolean;
}

export function PreviewResizeHandle({
  onResizeStart,
  onResetWidth,
  resizing,
}: PreviewResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Ubah lebar preview"
      title="Geser untuk ubah lebar · double-click reset"
      className={cn(
        "group absolute inset-y-0 left-0 z-10 flex w-3 -translate-x-1/2 cursor-col-resize items-center justify-center border-0 bg-transparent",
        resizing && "bg-[var(--auth-teal)]/15"
      )}
      onMouseDown={onResizeStart}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onResetWidth?.();
      }}
    >
      <span className="flex h-12 w-1.5 items-center justify-center rounded-full bg-[var(--auth-ink)]/10 transition group-hover:bg-[var(--auth-teal)]/35">
        <GripVertical
          size={12}
          className="text-[var(--auth-ink)]/35 group-hover:text-[var(--auth-teal-deep)]"
        />
      </span>
    </div>
  );
}

interface DocumentPreviewSheetProps {
  docId: number;
  onClose: () => void;
  width: number;
  onResizeStart: (e: React.MouseEvent) => void;
  onResetWidth?: () => void;
  resizing?: boolean;
  /** Jump to PDF page when supported by the browser viewer (#page=N) */
  page?: number | null;
}

export function DocumentPreviewSheet({
  docId,
  onClose,
  width,
  onResizeStart,
  onResetWidth,
  resizing,
  page,
}: DocumentPreviewSheetProps) {
  const pageHash =
    page != null && Number.isFinite(page) && page > 0
      ? `#page=${Math.floor(page)}`
      : "";
  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        className="absolute inset-0 bg-[var(--auth-ink)]/30"
        aria-label="Tutup preview"
        onClick={onClose}
      />
      <div
        className="absolute inset-y-0 right-0 flex max-w-[96vw] flex-col bg-white shadow-xl"
        style={{ width }}
      >
        <PreviewResizeHandle
          onResizeStart={onResizeStart}
          onResetWidth={onResetWidth}
          resizing={resizing}
        />

        <div className="flex items-center justify-between gap-3 border-b border-[var(--auth-ink)]/[0.06] px-4 py-3 pl-5">
          <div className="flex flex-wrap items-center gap-3 text-[12px]">
            <Link
              href={`/?doc=${docId}`}
              className="inline-flex items-center gap-1 font-semibold text-[var(--auth-teal)]"
            >
              <MessageSquare size={13} />
              Tanya Arsip
            </Link>
            <a
              href={`/api/documents/${docId}/download`}
              className="text-[var(--auth-ink)]/40 hover:text-[var(--auth-ink)]"
            >
              Download
            </a>
            {page != null && page > 0 ? (
              <span className="text-[10px] tabular-nums text-[var(--auth-ink)]/40">
                Hal. ~{Math.floor(page)}
              </span>
            ) : null}
            <span className="hidden text-[10px] tabular-nums text-[var(--auth-ink)]/30 sm:inline">
              {Math.round(width)}px
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[var(--auth-ink)]/40 hover:text-[var(--auth-ink)]"
            aria-label="Tutup"
          >
            <X size={16} />
          </button>
        </div>
        <iframe
          title="Preview dokumen"
          key={`${docId}-${page ?? 0}`}
          src={`/api/documents/${docId}/preview${pageHash}`}
          className="min-h-0 w-full flex-1 bg-[var(--auth-paper)]"
        />
      </div>
    </div>
  );
}

export function readStoredPreviewWidth(): number {
  try {
    const raw = localStorage.getItem(PREVIEW_WIDTH_KEY);
    if (!raw) return PREVIEW_DEFAULT;
    const w = Number(raw);
    if (!Number.isFinite(w)) return PREVIEW_DEFAULT;
    return Math.min(PREVIEW_MAX, Math.max(PREVIEW_MIN, w));
  } catch {
    return PREVIEW_DEFAULT;
  }
}

export function storePreviewWidth(width: number) {
  try {
    localStorage.setItem(PREVIEW_WIDTH_KEY, String(width));
  } catch {
    // ignore
  }
}

export function createPreviewResizeHandler(
  previewWidth: number,
  setPreviewWidth: React.Dispatch<React.SetStateAction<number>>,
  setResizing?: (v: boolean) => void
) {
  return (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = previewWidth;
    setResizing?.(true);

    function onMove(ev: MouseEvent) {
      const next = startW + (startX - ev.clientX);
      setPreviewWidth(Math.min(PREVIEW_MAX, Math.max(PREVIEW_MIN, next)));
    }

    function onUp() {
      setResizing?.(false);
      setPreviewWidth((w) => {
        storePreviewWidth(w);
        return w;
      });
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };
}
