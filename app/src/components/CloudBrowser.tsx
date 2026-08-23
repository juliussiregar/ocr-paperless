"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Folder,
  FileText,
  ChevronRight,
  Loader2,
  RefreshCw,
  Download,
  Square,
  Pause,
  Play,
  AlertCircle,
  CheckCircle2,
  Clock,
  Inbox,
  Sparkles,
  Globe,
  Star,
  Eye,
  MessageSquare,
  X,
  Search,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { showToast } from "@/components/Toast";
import { humanizeFileName } from "@/lib/display-name";
import {
  syncStageLabel,
  syncStageProgress,
  humanizeSyncError,
  formatSyncAge,
} from "@/lib/bappenas";
import { DocPreviewLink } from "@/components/DocPreviewLink";
import { FolderTreeSidebar, type TreeFileOpen } from "@/components/FolderTreeSidebar";

type IngestStatus = "not_ingested" | "processing" | "done" | "failed" | null;

type CloudItem = {
  type: "directory" | "file";
  path: string;
  name: string;
  size: number | null;
  lastModified: string | null;
  mimeType: string | null;
  isPdf: boolean;
  ingestStatus: IngestStatus;
  syncStage: string | null;
  errorMessage: string | null;
  paperlessDocumentId: number | null;
  selectable: boolean;
};

type Breadcrumb = { name: string; path: string };

type RecentFile = {
  id: string;
  fileName: string;
  remotePath: string;
  lastSyncedAt: string | null;
  paperlessDocumentId: number | null;
};

type IngestProgress = {
  status: string;
  phase: string;
  phaseTitle: string;
  phaseDetail: string;
  progressPercent: number | null;
  processedFiles: number;
  totalFiles: number;
  failedFiles: number;
  newFiles: number;
  skippedFiles?: number;
  currentFile?: string | null;
  ocrPendingCount?: number;
  ocrDoneCount?: number;
  ocrTotalCount?: number;
  ocrProgressPercent?: number | null;
  errorMessage?: string | null;
  etaSeconds?: number | null;
};

type StatusFilter = "all" | "not_ingested" | "processing" | "done" | "failed";
type SortKey = "name" | "date" | "size" | "status";
type QueueTab = "summary" | "failed" | "processing";

type FavoriteItem = {
  path: string;
  label: string;
  newCount: number;
};

type SearchResult = {
  path: string;
  name: string;
  displayName: string;
  paperlessDocumentId: number | null;
  ingestStatus: IngestStatus;
};

type QueueFileItem = {
  id: string;
  fileName: string;
  remotePath: string;
  errorMessage?: string | null;
  syncStatus?: string;
  updatedAt?: string;
  ocrPendingAt?: string | null;
  paperlessDocumentId?: number | null;
};

const LAST_FOLDER_KEY = "cloud-browser:last-folder";
const LAST_FOLDER_TTL_MS = 24 * 60 * 60 * 1000;
const FAVORITES_KEY = "cloud-browser:favorites";

const VALID_STATUS: StatusFilter[] = [
  "all",
  "not_ingested",
  "processing",
  "done",
  "failed",
];
const VALID_SORT: SortKey[] = ["name", "date", "size", "status"];

function readLastFolder(): string | null {
  try {
    const raw = localStorage.getItem(LAST_FOLDER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { path?: unknown; savedAt?: unknown };
    if (typeof parsed.path !== "string" || typeof parsed.savedAt !== "number") {
      localStorage.removeItem(LAST_FOLDER_KEY);
      return null;
    }
    if (Date.now() - parsed.savedAt > LAST_FOLDER_TTL_MS) {
      localStorage.removeItem(LAST_FOLDER_KEY);
      return null;
    }
    return parsed.path || "/";
  } catch {
    return null;
  }
}

function normalizeFolderPath(folderPath: string): string {
  if (!folderPath || folderPath === "/") return "/";
  const withSlash = folderPath.startsWith("/")
    ? folderPath
    : `/${folderPath}`;
  return withSlash.replace(/\/$/, "") || "/";
}

/** Prefer URL so SSR + client match; localStorage is applied on mount. */
function pathFromSearchParam(raw: string | null): string | null {
  if (!raw) return null;
  return normalizeFolderPath(raw);
}

function breadcrumbsForPath(folderPath: string): Breadcrumb[] {
  const normalized = normalizeFolderPath(folderPath);
  const parts = normalized === "/" ? [] : normalized.split("/").filter(Boolean);
  return [
    { name: "Root", path: "/" },
    ...parts.map((name, i) => ({
      name,
      path: "/" + parts.slice(0, i + 1).join("/"),
    })),
  ];
}

function saveLastFolder(folderPath: string) {
  try {
    localStorage.setItem(
      LAST_FOLDER_KEY,
      JSON.stringify({ path: folderPath || "/", savedAt: Date.now() })
    );
  } catch {
    // ignore
  }
}

function clearLastFolder() {
  try {
    localStorage.removeItem(LAST_FOLDER_KEY);
  } catch {
    // ignore
  }
}

function readFavoritesLocal(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.slice(0, 12) : [];
  } catch {
    return [];
  }
}

function clearFavoritesLocal() {
  try {
    localStorage.removeItem(FAVORITES_KEY);
  } catch {
    // ignore
  }
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function statusRank(s: IngestStatus): number {
  if (s === "failed") return 0;
  if (s === "not_ingested") return 1;
  if (s === "processing") return 2;
  if (s === "done") return 3;
  return 4;
}

function folderLabel(p: string): string {
  if (p === "/") return "Root";
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] || p;
}

function parentFolder(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  return parts.length > 1 ? "/" + parts.slice(0, -1).join("/") : "/";
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

function CloudBrowserInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlPath = pathFromSearchParam(searchParams.get("path"));

  const [path, setPath] = useState(() => urlPath ?? "/");
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>(() =>
    breadcrumbsForPath(urlPath ?? "/")
  );
  const [items, setItems] = useState<CloudItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [credsMissing, setCredsMissing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ingestJobId, setIngestJobId] = useState<string | null>(null);
  const [ingestProgress, setIngestProgress] = useState<IngestProgress | null>(
    null
  );
  const [ingesting, setIngesting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [watchingOcr, setWatchingOcr] = useState(false);
  const [postIngestAsk, setPostIngestAsk] = useState<{
    href: string;
    label: string;
  } | null>(null);
  const [newestLimit, setNewestLimit] = useState("10");
  const [scope, setScope] = useState<"cloud" | "folder">("folder");
  const [recent, setRecent] = useState<RecentFile[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [pdfOnly, setPdfOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("name");
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [queue, setQueue] = useState<{
    ocrPending: number;
    downloading: number;
    queued: number;
    failed: number;
    ready: number;
  } | null>(null);
  const [queueFiles, setQueueFiles] = useState<{
    failed: QueueFileItem[];
    processing: QueueFileItem[];
    failedHasMore?: boolean;
    processingHasMore?: boolean;
  }>({ failed: [], processing: [] });
  const [queueTab, setQueueTab] = useState<QueueTab>("summary");
  const [scanLimits, setScanLimits] = useState({
    maxFiles: 50,
    maxNewest: 50,
    retryBatch: 50,
    ocrTimeoutMinutes: 180,
  });
  const [batchLimit, setBatchLimit] = useState("50");
  const [queueLimit, setQueueLimit] = useState(50);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const [folderIngesting, setFolderIngesting] = useState(false);
  const [treeSyncKey, setTreeSyncKey] = useState(0);
  const [treeFocusFile, setTreeFocusFile] = useState<string | null>(null);

  const initialLoadDone = useRef(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const browseReqId = useRef(0);
  const browseAbortRef = useRef<AbortController | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;
  const favCountsAt = useRef(0);

  const syncPathUrl = useCallback(
    (
      folderPath: string,
      overrides?: {
        status?: StatusFilter;
        sort?: SortKey;
        pdfOnly?: boolean;
      }
    ) => {
      const params = new URLSearchParams();
      if (folderPath && folderPath !== "/") params.set("path", folderPath);
      const sf = overrides?.status ?? statusFilter;
      const sk = overrides?.sort ?? sort;
      const pdf = overrides?.pdfOnly ?? pdfOnly;
      if (sf !== "all") params.set("status", sf);
      if (sk !== "name") params.set("sort", sk);
      if (pdf) params.set("pdf", "1");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, statusFilter, sort, pdfOnly]
  );

  const loadFavorites = useCallback(async (opts?: { counts?: boolean }) => {
    try {
      const withCounts = opts?.counts === true;
      const res = await fetch(
        withCounts ? "/api/cloud/favorites?counts=1" : "/api/cloud/favorites"
      );
      if (!res.ok) return;
      const data = await res.json();
      const next = (data.favorites ?? []) as FavoriteItem[];
      if (withCounts) {
        setFavorites(next);
        favCountsAt.current = Date.now();
      } else {
        setFavorites((prev) => {
          const countMap = new Map(prev.map((f) => [f.path, f.newCount]));
          return next.map((f) => ({
            ...f,
            newCount: countMap.get(f.path) ?? f.newCount ?? 0,
          }));
        });
      }
    } catch {
      // ignore
    }
  }, []);

  const refreshFavoriteCounts = useCallback(async (force = false) => {
    if (!force && Date.now() - favCountsAt.current < 90_000) return;
    await loadFavorites({ counts: true });
  }, [loadFavorites]);

  const migrateLocalFavorites = useCallback(async () => {
    const local = readFavoritesLocal();
    if (local.length === 0) return;
    for (const p of local) {
      try {
        await fetch("/api/cloud/favorites", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "add", path: p }),
        });
      } catch {
        // ignore individual failures
      }
    }
    clearFavoritesLocal();
    await loadFavorites();
  }, [loadFavorites]);

  const loadRecent = useCallback(async () => {
    try {
      const res = await fetch("/api/cloud/recent?limit=5");
      if (!res.ok) return;
      const data = await res.json();
      setRecent(data.files ?? []);
    } catch {
      // ignore
    }
  }, []);

  const loadQueue = useCallback(async (limit?: number) => {
    try {
      const take = limit ?? queueLimit;
      const res = await fetch(`/api/scan?queueLimit=${take}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.queue) setQueue(data.queue);
      if (data.limits) {
        setScanLimits({
          maxFiles: data.limits.maxFiles ?? 50,
          maxNewest: data.limits.maxNewest ?? 50,
          retryBatch: data.limits.retryBatch ?? 50,
          ocrTimeoutMinutes: data.limits.ocrTimeoutMinutes ?? 180,
        });
        if (!limit) {
          const mf = data.limits.maxFiles > 0 ? data.limits.maxFiles : 50;
          setBatchLimit(String(mf));
          setQueueLimit(mf);
        }
      }
      if (data.queueFiles) {
        setQueueFiles({
          failed: data.queueFiles.failed ?? [],
          processing: data.queueFiles.processing ?? [],
          failedHasMore: Boolean(data.queueFiles.failedHasMore),
          processingHasMore: Boolean(data.queueFiles.processingHasMore),
        });
      }
    } catch {
      // ignore
    }
  }, [queueLimit]);

  const load = useCallback(
    async (targetPath: string, silent = false) => {
      const nextPath = normalizeFolderPath(targetPath);

      // Soft refresh during scan poll must not race with folder clicks:
      // - do not bump browseReqId / abort navigation
      // - do not clear the list
      // - only apply if user is still on that folder
      if (silent) {
        try {
          const res = await fetch(
            `/api/cloud/browse?path=${encodeURIComponent(targetPath)}`
          );
          if (normalizeFolderPath(pathRef.current) !== nextPath) return;
          const data = await res.json();
          if (normalizeFolderPath(pathRef.current) !== nextPath) return;
          if (!res.ok) return;
          setCredsMissing(false);
          setBreadcrumbs(data.breadcrumbs ?? breadcrumbsForPath(data.path));
          setItems(data.items ?? []);
        } catch {
          // ignore soft-refresh errors
        }
        return;
      }

      const reqId = ++browseReqId.current;
      browseAbortRef.current?.abort();
      const ac = new AbortController();
      browseAbortRef.current = ac;

      setLoading(true);
      setError(null);
      setPath(nextPath);
      setBreadcrumbs(breadcrumbsForPath(nextPath));
      // Leave old list immediately so navigation doesn't feel like a long refresh
      setItems([]);
      setSelected(new Set());
      setFocusIndex(-1);

      try {
        const res = await fetch(
          `/api/cloud/browse?path=${encodeURIComponent(targetPath)}`,
          { signal: browseAbortRef.current.signal }
        );
        if (reqId !== browseReqId.current) return;

        const data = await res.json();
        if (reqId !== browseReqId.current) return;

        if (data.code === "NO_CREDS") {
          setCredsMissing(true);
        }
        if (!res.ok) {
          const errMsg = data.error ?? "Gagal memuat folder";
          if (
            data.code === "NO_CREDS" ||
            errMsg.toLowerCase().includes("kredensial")
          ) {
            setCredsMissing(true);
          }
          if (targetPath !== "/") {
            clearLastFolder();
            await load("/", false);
            return;
          }
          setError(errMsg);
          setItems([]);
          return;
        }
        setCredsMissing(false);
        setPath(data.path);
        setBreadcrumbs(data.breadcrumbs ?? []);
        setItems(data.items ?? []);
        setSelected(new Set());
        setFocusIndex(-1);
        saveLastFolder(data.path);
        syncPathUrl(data.path);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (reqId !== browseReqId.current) return;
        setError("Gagal memuat folder");
        setItems([]);
      } finally {
        if (reqId === browseReqId.current) setLoading(false);
      }
    },
    [syncPathUrl]
  );

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchResults([]);
    setSearchOpen(false);
    setSearchLoading(false);
  }, []);

  const openFolder = useCallback(
    (folderPath: string, opts?: { focusFile?: string | null }) => {
      const normalized = normalizeFolderPath(folderPath);
      const focusFile =
        opts?.focusFile != null ? normalizeFolderPath(opts.focusFile) : null;

      clearSearch();
      setTreeFocusFile(focusFile);
      setTreeSyncKey((k) => k + 1);

      // Don't block navigation on favorite bookkeeping
      const isFav = favorites.some((f) => f.path === normalized);
      if (isFav) {
        void fetch("/api/cloud/favorites", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "open", path: normalized }),
        })
          .then(() => loadFavorites())
          .catch(() => {});
      }

      if (normalized === path && !loading) {
        // Same folder: still force sidebar to reveal/scroll
        return;
      }
      void load(normalized);
    },
    [clearSearch, favorites, load, loadFavorites, loading, path]
  );

  useEffect(() => {
    const statusParam = searchParams.get("status");
    const sortParam = searchParams.get("sort");
    const pdfParam = searchParams.get("pdf");
    if (statusParam && VALID_STATUS.includes(statusParam as StatusFilter)) {
      setStatusFilter(statusParam as StatusFilter);
    }
    if (sortParam && VALID_SORT.includes(sortParam as SortKey)) {
      setSort(sortParam as SortKey);
    }
    if (pdfParam === "1") setPdfOnly(true);

    const fromUrl = pathFromSearchParam(searchParams.get("path"));
    const initial = normalizeFolderPath(
      fromUrl ?? readLastFolder() ?? path ?? "/"
    );
    if (initial !== path) {
      setPath(initial);
      setBreadcrumbs(breadcrumbsForPath(initial));
    }
    void load(initial);
    loadRecent();
    loadQueue();
    void loadFavorites()
      .then(() => migrateLocalFavorites())
      .then(() => refreshFavoriteCounts(true));
    initialLoadDone.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  useEffect(() => {
    if (!initialLoadDone.current || loading) return;
    syncPathUrl(path);
  }, [statusFilter, sort, pdfOnly, path, loading, syncPathUrl]);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchOpen(false);
      return;
    }
    setSearchLoading(true);
    setSearchOpen(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/cloud/search?q=${encodeURIComponent(q)}`
        );
        if (!res.ok) {
          setSearchResults([]);
          return;
        }
        const data = await res.json();
        setSearchResults(data.results ?? []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (
        searchWrapRef.current &&
        !searchWrapRef.current.contains(e.target as Node)
      ) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (!queue) return;
    const busy =
      queue.ocrPending + queue.downloading + queue.queued > 0;
    if (!busy) return;
    const id = window.setInterval(() => {
      void loadQueue();
    }, 8000);
    return () => window.clearInterval(id);
  }, [queue, loadQueue]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/scan");
      if (!res.ok || cancelled) return;
      const data = await res.json();
      const active = data.activeJob ?? data.latestJob;
      if (
        !active ||
        (active.status !== "RUNNING" &&
          active.status !== "PENDING" &&
          active.status !== "PAUSED")
      ) {
        return;
      }
      // Seed progress immediately so Stop/Pause stay visible after refresh
      // (poll fills details a moment later).
      setIngestJobId(active.id);
      setIngesting(true);
      setCancelling(false);
      setIngestProgress({
        status: active.status,
        phase: active.phase ?? "running",
        phaseTitle:
          active.status === "PAUSED"
            ? "Scan dijeda"
            : active.status === "PENDING"
              ? "Menunggu antrean…"
              : "Scan masih berjalan…",
        phaseDetail: active.currentFile
          ? `File: ${active.currentFile}`
          : "Memulihkan progress setelah refresh. Tombol Stop tersedia.",
        progressPercent:
          active.totalFiles > 0
            ? Math.round(
                (active.processedFiles / active.totalFiles) * 100
              )
            : null,
        processedFiles: active.processedFiles ?? 0,
        totalFiles: active.totalFiles ?? 0,
        failedFiles: active.failedFiles ?? 0,
        newFiles: active.newFiles ?? 0,
        skippedFiles: active.skippedFiles ?? 0,
        currentFile: active.currentFile ?? null,
        ocrPendingCount: 0,
        ocrDoneCount: 0,
        ocrTotalCount: 0,
        ocrProgressPercent: null,
        errorMessage: active.errorMessage ?? null,
        etaSeconds: null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ingestJobId) return;
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/scan/${ingestJobId}`);
        if (!res.ok || cancelled) {
          if (!cancelled && ingestJobId) {
            setTimeout(poll, 2500);
          }
          return;
        }
        const job = await res.json();
        setIngestProgress({
          status: job.status,
          phase: job.phase ?? "unknown",
          phaseTitle: job.phaseTitle ?? job.status,
          phaseDetail: job.phaseDetail ?? "",
          progressPercent: job.progressPercent ?? null,
          processedFiles: job.processedFiles,
          totalFiles: job.totalFiles,
          failedFiles: job.failedFiles,
          newFiles: job.newFiles,
          skippedFiles: job.skippedFiles,
          currentFile: job.currentFile,
          ocrPendingCount: job.ocrPendingCount ?? 0,
          ocrDoneCount: job.ocrDoneCount ?? 0,
          ocrTotalCount: job.ocrTotalCount ?? 0,
          ocrProgressPercent: job.ocrProgressPercent ?? null,
          errorMessage: job.errorMessage,
          etaSeconds: job.etaSeconds ?? null,
        });
        await load(pathRef.current, true);
        if (
          job.status === "RUNNING" ||
          job.status === "PENDING" ||
          job.status === "PAUSED"
        ) {
          setIngesting(true);
          setTimeout(poll, job.status === "PAUSED" ? 2500 : 1500);
        } else {
          setIngesting(false);
          setCancelling(false);
          await loadRecent();
          await loadQueue();
          if ((job.ocrPendingCount ?? 0) > 0 && job.status === "COMPLETED") {
            setWatchingOcr(true);
          } else {
            setIngestProgress(null);
          }
          if (job.status === "COMPLETED") {
            const msg =
              job.totalFiles === 0 && job.errorMessage
                ? job.errorMessage
                : `Selesai dikirim: ${job.newFiles} baru, ${job.failedFiles} gagal` +
                  ((job.ocrPendingCount ?? 0) > 0
                    ? ` · OCR masih jalan untuk ${job.ocrPendingCount} file`
                    : "");
            showToast(msg, "success");
            const folderPath = pathRef.current || "/";
            if ((job.newFiles ?? 0) > 0 || (job.ocrPendingCount ?? 0) > 0) {
              setPostIngestAsk({
                href: `/?folder=${encodeURIComponent(folderPath)}`,
                label: "Tanyakan dokumen folder ini di Ask AI",
              });
            }
            void refreshFavoriteCounts(true);
          } else if (job.status === "CANCELLED") {
            showToast("Pengambilan dihentikan", "success");
            setIngestProgress(null);
            setIngestJobId(null);
          } else if (job.status === "FAILED") {
            showToast(job.errorMessage ?? "Pengambilan gagal", "error");
            setIngestProgress(null);
            setIngestJobId(null);
          }
        }
      } catch {
        if (!cancelled) setTimeout(poll, 2500);
      }
    }
    poll();
    return () => {
      cancelled = true;
    };
  }, [ingestJobId, load, loadRecent, loadQueue, refreshFavoriteCounts]);

  useEffect(() => {
    if (!watchingOcr || !ingestJobId) return;
    let cancelled = false;
    async function tick() {
      const res = await fetch(`/api/scan/${ingestJobId}`);
      if (!res.ok || cancelled) return;
      const job = await res.json();
      const pending = job.ocrPendingCount ?? 0;
      const done = job.ocrDoneCount ?? 0;
      const ocrTotal = job.ocrTotalCount ?? pending + done;
      const ocrPct =
        job.ocrProgressPercent ??
        (ocrTotal > 0 ? Math.round((done / ocrTotal) * 100) : null);
      setIngestProgress({
        status: job.status,
        phase: pending > 0 ? "ocr_wait" : "done",
        phaseTitle:
          pending > 0 ? "OCR Paperless sedang berjalan…" : "Semua file siap",
        phaseDetail:
          pending > 0
            ? `${done}/${ocrTotal || "?"} file OCR selesai · ${pending} masih diproses`
            : "OCR selesai untuk semua file yang dikirim.",
        progressPercent: pending > 0 ? ocrPct : 100,
        processedFiles: job.processedFiles,
        totalFiles: job.totalFiles,
        failedFiles: job.failedFiles,
        newFiles: job.newFiles,
        skippedFiles: job.skippedFiles,
        currentFile: null,
        ocrPendingCount: pending,
        ocrDoneCount: done,
        ocrTotalCount: ocrTotal,
        ocrProgressPercent: ocrPct,
        errorMessage: job.errorMessage,
      });
      await load(pathRef.current, true);
      if (cancelled) return;
      if (pending === 0) {
        setWatchingOcr(false);
        await loadRecent();
        void refreshFavoriteCounts(true);
        const folderPath = pathRef.current || "/";
        const normalized =
          !folderPath || folderPath === "/"
            ? "/"
            : folderPath.replace(/\/$/, "") || "/";
        const prefix = normalized === "/" ? null : `${normalized}/`;

        const readyDocs = (await fetch("/api/cloud/recent?limit=5")
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)) as { files?: RecentFile[] } | null;

        const ids = (readyDocs?.files ?? [])
          .filter((f) => {
            if (!f.paperlessDocumentId) return false;
            if (!prefix) return true;
            return (
              f.remotePath === normalized || f.remotePath.startsWith(prefix)
            );
          })
          .slice(0, 5)
          .map((f) => f.paperlessDocumentId!);

        if (ids.length > 0) {
          setPostIngestAsk({
            href: `/?doc=${ids.join(",")}&folder=${encodeURIComponent(normalized)}`,
            label:
              ids.length === 1
                ? "Tanyakan dokumen ini di Ask AI"
                : `Tanyakan ${ids.length} dokumen folder ini di Ask AI`,
          });
        } else {
          setPostIngestAsk({
            href: `/?folder=${encodeURIComponent(normalized)}`,
            label: "Tanyakan dokumen folder ini di Ask AI",
          });
        }
        setTimeout(() => setIngestProgress(null), 2500);
        return;
      }
      setTimeout(tick, 2500);
    }
    tick();
    return () => {
      cancelled = true;
    };
  }, [watchingOcr, ingestJobId, load, loadRecent, refreshFavoriteCounts]);

  const selectableItems = useMemo(
    () => items.filter((i) => i.selectable),
    [items]
  );
  const failedItems = useMemo(
    () => items.filter((i) => i.type === "file" && i.ingestStatus === "failed"),
    [items]
  );
  const pendingInFolder = selectableItems.length;
  const effectiveRoot = scope === "cloud" ? "/" : path;
  const isFavorite = favorites.some((f) => f.path === path);

  const visibleItems = useMemo(() => {
    let list = [...items];
    if (pdfOnly) {
      list = list.filter((i) => i.type === "directory" || i.isPdf);
    }
    if (statusFilter !== "all") {
      list = list.filter(
        (i) =>
          i.type === "directory" || i.ingestStatus === statusFilter
      );
    }
    list.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      if (sort === "date") {
        const at = a.lastModified ? new Date(a.lastModified).getTime() : 0;
        const bt = b.lastModified ? new Date(b.lastModified).getTime() : 0;
        return bt - at;
      }
      if (sort === "size") return (b.size ?? 0) - (a.size ?? 0);
      if (sort === "status") {
        return statusRank(a.ingestStatus) - statusRank(b.ingestStatus);
      }
      return humanizeFileName(a.name).localeCompare(
        humanizeFileName(b.name),
        "id"
      );
    });
    return list;
  }, [items, pdfOnly, statusFilter, sort]);

  useEffect(() => {
    setFocusIndex((i) => {
      if (visibleItems.length === 0) return -1;
      if (i < 0) return -1;
      return Math.min(i, visibleItems.length - 1);
    });
  }, [visibleItems]);

  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of items) {
      if (i.type !== "file" || !i.isPdf) continue;
      const key = humanizeFileName(i.name).toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const dups = new Set<string>();
    for (const [k, n] of counts) if (n > 1) dups.add(k);
    return dups;
  }, [items]);

  async function toggleFavorite() {
    const action = isFavorite ? "remove" : "add";
    try {
      const res = await fetch("/api/cloud/favorites", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, path }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Gagal memperbarui favorit", "error");
        return;
      }
      setFavorites(data.favorites ?? []);
    } catch {
      showToast("Gagal memperbarui favorit", "error");
    }
  }

  function toggle(pathKey: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pathKey)) next.delete(pathKey);
      else next.add(pathKey);
      return next;
    });
  }

  async function startJob(body: Record<string, unknown>, okMessage: string) {
    setIngesting(true);
    try {
      const res = await fetch("/api/cloud/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let data: { jobId?: string; error?: string; message?: string } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        setIngesting(false);
        showToast(
          res.ok
            ? "Respons tidak valid"
            : `Gagal memulai pengambilan (${res.status})`,
          "error"
        );
        return;
      }
      if (!res.ok) {
        setIngesting(false);
        if (data.jobId) {
          setIngestJobId(data.jobId);
          showToast("Proses sebelumnya masih berjalan", "error");
        } else {
          showToast(data.error ?? "Gagal memulai pengambilan", "error");
        }
        return;
      }
      showToast(data.message ?? okMessage, "success");
      setIngestJobId(data.jobId ?? null);
      setSelected(new Set());
    } catch (err) {
      setIngesting(false);
      showToast(
        err instanceof Error ? err.message : "Gagal memulai pengambilan",
        "error"
      );
    }
  }

  async function handleIngestSelected() {
    if (selected.size === 0) {
      showToast("Pilih minimal satu PDF", "error");
      return;
    }
    await startJob(
      { mode: "paths", paths: [...selected] },
      `Mengantre ${selected.size} file…`
    );
  }

  async function handleNewest() {
    const maxN = scanLimits.maxNewest || 50;
    const limit = Math.min(maxN, Math.max(1, parseInt(newestLimit, 10) || 10));
    setNewestLimit(String(limit));
    const where =
      effectiveRoot === "/"
        ? "seluruh cloud"
        : `folder ${folderLabel(effectiveRoot)} (+ subfolder)`;
    if (
      !confirm(
        `Ambil ${limit} PDF terbaru yang belum di aplikasi dari ${where}?\n\n` +
          `Batas sistem: ${scanLimits.maxFiles || "tanpa batas"} file/batch.\n` +
          `OCR timeout: ${scanLimits.ocrTimeoutMinutes} menit.\n\n` +
          `Discovery bisa lama di folder besar. Anda bisa Stop kapan saja.`
      )
    ) {
      return;
    }
    await startJob(
      { mode: "newest", rootPath: effectiveRoot, limit },
      `Mencari ${limit} PDF terbaru…`
    );
  }

  async function handleScanAll() {
    const cap =
      parseInt(batchLimit, 10) ||
      scanLimits.maxFiles ||
      50;
    const where =
      effectiveRoot === "/"
        ? "seluruh cloud"
        : `folder ini (+ subfolder):\n${effectiveRoot}`;
    if (
      !confirm(
        `Ambil hingga ${cap} PDF yang belum di aplikasi dari ${where}?\n\n` +
          `Ini dibatasi SCAN_MAX_FILES / batch size (bukan seluruh cloud tanpa batas).\n` +
          `OCR timeout: ${scanLimits.ocrTimeoutMinutes} menit. Stop kapan saja.`
      )
    ) {
      return;
    }
    await startJob(
      { mode: "all", rootPath: effectiveRoot, limit: cap },
      `Memulai pengambilan (max ${cap})…`
    );
  }

  async function handleIngestThisFolder() {
    setFolderIngesting(true);
    try {
      const res = await fetch(
        `/api/cloud/count?path=${encodeURIComponent(path)}`
      );
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Gagal menghitung file", "error");
        return;
      }
      const count = Number(data.total ?? 0);
      const suffix = data.truncated ? "+" : "";
      const label = folderLabel(path);
      const cap =
        parseInt(batchLimit, 10) ||
        scanLimits.maxFiles ||
        50;
      const willTake = data.truncated
        ? `hingga ${cap}`
        : `hingga ${Math.min(count || cap, cap)}`;
      const heavy = count > cap || data.truncated;
      const ok = confirm(
        `Scan folder "${label}"?\n\n` +
          `Perkiraan di folder: ${count}${suffix} PDF.\n` +
          `Batch ini akan mengambil ${willTake} file yang belum siap (subfolder termasuk).\n` +
          `OCR timeout: ${scanLimits.ocrTimeoutMinutes} menit.\n\n` +
          (heavy
            ? `PERINGATAN: jumlah besar. Kerjakan bertahap; ulang Scan folder untuk batch berikutnya.\n\n`
            : "") +
          `Lanjut?`
      );
      if (!ok) return;
      await startJob(
        { mode: "all", rootPath: path, limit: cap },
        `Memulai scan folder (max ${cap})…`
      );
    } catch {
      showToast("Gagal menghitung file", "error");
    } finally {
      setFolderIngesting(false);
    }
  }

  async function handleRetry(paths?: string[], allFailed = false) {
    try {
      const res = await fetch("/api/cloud/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          allFailed ? { allFailed: true } : { paths: paths ?? [] }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.jobId) {
          setIngestJobId(data.jobId);
          showToast("Proses sebelumnya masih berjalan", "error");
        } else {
          showToast(data.error ?? "Gagal mengulang", "error");
        }
        return;
      }
      showToast(
        allFailed
          ? `Mengulang ${data.totalFiles ?? 0} file gagal (max ${data.maxFiles ?? scanLimits.retryBatch}/batch)…`
          : "Mengulang file…",
        "success"
      );
      setIngestJobId(data.jobId ?? null);
      setIngesting(true);
      void loadQueue();
    } catch {
      showToast("Gagal mengulang", "error");
    }
  }

  async function handlePause() {
    if (!ingestJobId) return;
    const res = await fetch(`/api/scan/${ingestJobId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pause" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast((data as { error?: string }).error ?? "Gagal menjeda", "error");
      return;
    }
    showToast(
      (data as { message?: string }).message ?? "Dijeda",
      "success"
    );
  }

  async function handleResume() {
    if (!ingestJobId) return;
    const res = await fetch(`/api/scan/${ingestJobId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resume" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(
        (data as { error?: string }).error ?? "Gagal melanjutkan",
        "error"
      );
      return;
    }
    showToast((data as { message?: string }).message ?? "Dilanjutkan", "success");
  }

  async function handleStop() {
    if (!ingestJobId || cancelling) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/scan/${ingestJobId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCancelling(false);
        showToast(
          (data as { error?: string }).error ?? "Gagal menghentikan",
          "error"
        );
        return;
      }
      setIngestProgress((prev) =>
        prev
          ? {
              ...prev,
              status: "CANCELLED",
              phase: "done",
              phaseTitle: "Menghentikan…",
              phaseDetail:
                "Menunggu worker menghentikan unduhan yang sedang berjalan.",
            }
          : prev
      );
      // Keep ingestJobId + polling; final toast when poll sees CANCELLED.
    } catch {
      setCancelling(false);
      showToast("Gagal menghentikan", "error");
    }
  }

  function openSearchResult(result: SearchResult) {
    clearSearch();
    openFolder(parentFolder(result.path), { focusFile: result.path });
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (visibleItems.length === 0) return;

      if (e.key === "j") {
        e.preventDefault();
        setFocusIndex((i) =>
          i < 0 ? 0 : Math.min(i + 1, visibleItems.length - 1)
        );
      } else if (e.key === "k") {
        e.preventDefault();
        setFocusIndex((i) => (i <= 0 ? 0 : i - 1));
      } else if (e.key === "Enter" && focusIndex >= 0) {
        e.preventDefault();
        const item = visibleItems[focusIndex];
        if (item.paperlessDocumentId) {
          setPreviewId(item.paperlessDocumentId);
        } else if (item.type === "directory") {
          void openFolder(item.path);
        }
      } else if (e.key === " " && focusIndex >= 0) {
        e.preventDefault();
        const item = visibleItems[focusIndex];
        if (item.selectable) toggle(item.path);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visibleItems, focusIndex, openFolder]);

  const showProgressPanel =
    !!ingestProgress &&
    (ingesting ||
      watchingOcr ||
      ingestProgress.status === "RUNNING" ||
      ingestProgress.status === "PENDING" ||
      ingestProgress.status === "PAUSED");

  const showEmptyRoot =
    !loading &&
    !error &&
    path === "/" &&
    items.length === 0 &&
    !credsMissing;

  return (
    <div className="relative w-full bg-[var(--auth-paper)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 80% 50% at 10% -10%, rgb(11 110 99 / 0.14), transparent 55%),
            radial-gradient(ellipse 60% 40% at 95% 5%, rgb(180 120 60 / 0.08), transparent 50%),
            linear-gradient(180deg, rgb(255 255 255 / 0.55), transparent 28%)
          `,
        }}
      />

      {/* Header */}
      <div className="relative z-[1] border-b border-[var(--auth-teal)]/10 bg-gradient-to-br from-white/70 via-[var(--auth-paper)]/80 to-[var(--auth-teal)]/[0.06] px-5 pb-4 pt-5 backdrop-blur-[2px] lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--auth-teal)]">
              Cloud Bappenas
            </p>
            <p className="auth-display text-[clamp(1.75rem,4vw,2.5rem)] font-bold leading-none tracking-[-0.03em] text-[var(--auth-ink)]">
              Library
            </p>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--auth-ink)]/55">
              Buka folder, pilih PDF, lalu scan agar teks bisa dicari dan
              ditanya di Ask AI.
            </p>
          </div>
        </div>

        {postIngestAsk && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-[var(--auth-teal)]/20 bg-[var(--auth-teal)]/8 px-3 py-2.5">
            <MessageSquare
              size={16}
              className="shrink-0 text-[var(--auth-teal)]"
            />
            <p className="min-w-0 flex-1 text-[13px] text-[var(--auth-ink)]/75">
              Pengambilan selesai.{" "}
              <Link
                href={postIngestAsk.href}
                className="font-semibold text-[var(--auth-teal-deep)] hover:underline"
              >
                {postIngestAsk.label}
              </Link>
            </p>
            <button
              type="button"
              onClick={() => setPostIngestAsk(null)}
              className="p-1 text-[var(--auth-ink)]/35 hover:text-[var(--auth-ink)]"
              aria-label="Tutup"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Global search */}
        <div ref={searchWrapRef} className="relative mt-5 max-w-lg">
          <div className="flex items-center gap-2 rounded-md border border-[var(--auth-teal)]/15 bg-white/80 px-3 shadow-[0_1px_0_rgb(11_110_99/0.06)] ring-1 ring-black/[0.02]">
            <Search
              size={15}
              className="shrink-0 text-[var(--auth-teal)]/70"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => {
                if (searchQuery.trim().length >= 2) setSearchOpen(true);
              }}
              placeholder="Cari nama file di seluruh cloud…"
              className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-[var(--auth-ink)]/35"
              aria-label="Cari file"
              aria-expanded={searchOpen}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={clearSearch}
                className="p-1 text-[var(--auth-ink)]/30 hover:text-[var(--auth-ink)]"
                aria-label="Hapus pencarian"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {searchOpen && searchQuery.trim().length >= 2 && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-72 overflow-y-auto rounded-md border border-[var(--auth-teal)]/15 bg-white shadow-lg">
              {searchLoading && (
                <p className="flex items-center gap-2 px-3 py-3 text-[13px] text-[var(--auth-ink)]/40">
                  <Loader2 size={13} className="animate-spin" />
                  Mencari…
                </p>
              )}
              {!searchLoading && searchResults.length === 0 && (
                <p className="px-3 py-3 text-[13px] text-[var(--auth-ink)]/40">
                  Tidak ada hasil
                </p>
              )}
              {!searchLoading &&
                searchResults.map((r) => (
                  <div
                    key={r.path}
                    role="button"
                    tabIndex={0}
                    onClick={() => openSearchResult(r)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") openSearchResult(r);
                    }}
                    className="flex w-full cursor-pointer flex-col gap-0.5 border-t border-[var(--auth-ink)]/[0.06] px-3 py-2.5 text-left first:border-t-0 hover:bg-[var(--auth-teal)]/[0.06]"
                  >
                    {r.paperlessDocumentId ? (
                      <DocPreviewLink
                        docId={r.paperlessDocumentId}
                        className="block truncate text-[13px] font-medium"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.displayName || humanizeFileName(r.name)}
                      </DocPreviewLink>
                    ) : (
                      <span className="truncate text-[13px] font-medium text-[var(--auth-ink)]">
                        {r.displayName || humanizeFileName(r.name)}
                      </span>
                    )}
                    <span className="truncate text-[11px] text-[var(--auth-ink)]/35">
                      {r.path}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>

        {credsMissing && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-amber-300/70 bg-amber-50/90 px-4 py-3">
            <AlertCircle size={16} className="shrink-0 text-amber-700" />
            <p className="text-[13px] text-[var(--auth-ink)]/70">
              Kredensial Cloud Bappenas belum diisi.
            </p>
            <Link
              href="/profile"
              className="text-[12px] font-semibold text-[var(--auth-teal)]"
            >
              Isi kredensial di Akun
            </Link>
          </div>
        )}
      </div>


      {/* Scan - above folder browser */}
      <div className="relative z-[1] border-b border-[var(--auth-teal)]/10 px-5 py-3 lg:px-8">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--auth-teal)]">
          Scan
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <button
            type="button"
            onClick={() => void handleIngestThisFolder()}
            disabled={ingesting || folderIngesting || credsMissing}
            className="inline-flex items-center gap-2 rounded-md bg-[var(--auth-teal)] px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
            title={`Ambil hingga ${batchLimit} PDF di folder ${folderLabel(path)} + subfolder`}
          >
            {folderIngesting ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Folder size={13} />
            )}
            Scan folder: {folderLabel(path)}
          </button>
          <span className="hidden text-[var(--auth-ink)]/20 sm:inline">·</span>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1 text-[11px] text-[var(--auth-ink)]/45">
              Batch
              <select
                value={batchLimit}
                onChange={(e) => setBatchLimit(e.target.value)}
                className="rounded-md border border-[var(--auth-ink)]/15 bg-white/80 px-1.5 py-1 text-[12px] outline-none focus:border-[var(--auth-teal)]"
                disabled={ingesting}
              >
                {[10, 20, 50, 100]
                  .filter(
                    (n) =>
                      scanLimits.maxFiles <= 0 || n <= scanLimits.maxFiles
                  )
                  .map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                {scanLimits.maxFiles > 0 &&
                  ![10, 20, 50, 100].includes(scanLimits.maxFiles) && (
                    <option value={String(scanLimits.maxFiles)}>
                      {scanLimits.maxFiles}
                    </option>
                  )}
              </select>
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={newestLimit}
              onChange={(e) =>
                setNewestLimit(e.target.value.replace(/\D/g, ""))
              }
              onBlur={() => {
                const n = parseInt(newestLimit, 10);
                const maxN = scanLimits.maxNewest || 50;
                if (!Number.isFinite(n) || n < 1) setNewestLimit("10");
                else setNewestLimit(String(Math.min(maxN, n)));
              }}
              className="w-12 rounded-md border border-[var(--auth-ink)]/15 bg-white/80 px-1.5 py-1 text-center text-[12px] outline-none focus:border-[var(--auth-teal)]"
              disabled={ingesting}
              aria-label="Jumlah file terbaru"
            />
            <button
              type="button"
              disabled={ingesting}
              onClick={() => setScope("folder")}
              className={cn(
                "rounded-md px-2 py-1 text-[11px]",
                scope === "folder"
                  ? "bg-[var(--auth-teal)]/10 font-semibold text-[var(--auth-teal)]"
                  : "text-[var(--auth-ink)]/40"
              )}
            >
              Folder
            </button>
            <button
              type="button"
              disabled={ingesting}
              onClick={() => setScope("cloud")}
              className={cn(
                "rounded-md px-2 py-1 text-[11px]",
                scope === "cloud"
                  ? "bg-[var(--auth-teal)]/10 font-semibold text-[var(--auth-teal)]"
                  : "text-[var(--auth-ink)]/40"
              )}
            >
              Cloud
            </button>
            <button
              type="button"
              onClick={handleNewest}
              disabled={ingesting || credsMissing}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-800 px-2.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
              title="Ambil N PDF terbaru yang belum di app"
            >
              <Download size={12} />
              Fetch {parseInt(newestLimit, 10) || 10} newest
            </button>
            <button
              type="button"
              onClick={handleScanAll}
              disabled={ingesting || credsMissing}
              className="text-[11px] font-medium text-[var(--auth-ink)]/40 hover:text-[var(--auth-ink)] disabled:opacity-40"
            >
              Pending (max {batchLimit})
            </button>
          </div>
        </div>
        <p className="mt-1.5 text-[11px] text-[var(--auth-ink)]/40">
          Batch max {scanLimits.maxFiles || "∞"} · OCR timeout{" "}
          {scanLimits.ocrTimeoutMinutes}m · Folder/Pending dibatasi batch, bukan
          unlimited.
        </p>
      </div>

      {/* Recent - above folder browser */}
      <div className="relative z-[1] border-b border-[var(--auth-teal)]/10 px-5 py-3 lg:px-8">
        <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--auth-teal)]">
          <Sparkles size={11} />
          Recent
        </p>
        {recent.length === 0 ? (
          <p className="text-[12px] text-[var(--auth-ink)]/40">
            Belum ada file yang baru di-scan.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {recent.slice(0, 5).map((f) => (
              <li
                key={f.id}
                className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px]"
              >
                {f.paperlessDocumentId ? (
                  <DocPreviewLink
                    docId={f.paperlessDocumentId}
                    className="min-w-0 max-w-md truncate font-medium"
                  >
                    {humanizeFileName(f.fileName)}
                  </DocPreviewLink>
                ) : (
                  <span className="min-w-0 max-w-md truncate font-medium text-[var(--auth-ink)]">
                    {humanizeFileName(f.fileName)}
                  </span>
                )}
                <span className="flex shrink-0 items-center gap-2 text-[11px]">
                  {f.paperlessDocumentId && (
                    <Link
                      href={`/?doc=${f.paperlessDocumentId}`}
                      className="text-[var(--auth-teal)] hover:underline"
                    >
                      Ask AI
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      openFolder(parentFolder(f.remotePath), {
                        focusFile: f.remotePath,
                      })
                    }
                    className="text-[var(--auth-ink)]/35 hover:text-[var(--auth-ink)]"
                  >
                    Open folder
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {favorites.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--auth-ink)]/30">
              Favorites
            </span>
            {favorites.map((f) => (
              <button
                key={f.path}
                type="button"
                onClick={() => void openFolder(f.path)}
                className={cn(
                  "inline-flex max-w-[140px] items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px]",
                  path === f.path
                    ? "bg-[var(--auth-teal)] font-semibold text-white"
                    : "bg-[var(--auth-teal)]/10 text-[var(--auth-teal-deep)]"
                )}
                title={f.path}
              >
                <span className="truncate">{f.label || folderLabel(f.path)}</span>
                {f.newCount > 0 && (
                  <span
                    className="font-semibold"
                    title={`${f.newCount} PDF baru sejak sync terakhir`}
                  >
                    {f.newCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Sidebar + file list: stable min height, grows only when content overflows */}
      <div className="relative z-[1] flex min-h-[min(72dvh,44rem)] w-full items-stretch">
        <FolderTreeSidebar
          currentPath={path}
          focusFilePath={treeFocusFile}
          syncKey={treeSyncKey}
          onOpenFolder={(p) => openFolder(p)}
          onOpenFile={(file: TreeFileOpen) => {
            openFolder(parentFolder(file.path), { focusFile: file.path });
            if (file.paperlessDocumentId) {
              setPreviewId(file.paperlessDocumentId);
            }
          }}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Browser toolbar */}
          <div className="flex flex-col gap-3 border-b border-[var(--auth-teal)]/10 bg-white/40 px-5 py-3 lg:px-8">
            <div className="flex flex-wrap items-center gap-2">
              <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm">
                {breadcrumbs.map((crumb, i) => (
                  <span key={crumb.path} className="flex items-center gap-1">
                    {i > 0 && (
                      <ChevronRight
                        size={14}
                        className="shrink-0 text-[var(--auth-ink)]/25"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => void openFolder(crumb.path)}
                      className={cn(
                        "truncate px-1 py-0.5 font-medium",
                        i === breadcrumbs.length - 1
                          ? "text-[var(--auth-ink)]"
                          : "text-[var(--auth-teal)] hover:underline"
                      )}
                    >
                      {crumb.name}
                    </button>
                  </span>
                ))}
              </nav>
              <button
                type="button"
                onClick={() => void toggleFavorite()}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px]",
                  isFavorite
                    ? "bg-[var(--auth-teal)]/10 font-semibold text-[var(--auth-teal)]"
                    : "text-[var(--auth-ink)]/40 hover:bg-white/60 hover:text-[var(--auth-teal)]"
                )}
                title={isFavorite ? "Remove favorite" : "Add favorite"}
              >
                <Star
                  size={13}
                  fill={isFavorite ? "currentColor" : "none"}
                />
                Favorite
              </button>
              <button
                type="button"
                onClick={() => load(path)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--auth-ink)]/40 hover:bg-white/60 hover:text-[var(--auth-ink)]"
                disabled={loading}
              >
                <RefreshCw size={12} className={cn(loading && "animate-spin")} />
                Refresh
              </button>
              {loading && (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--auth-teal)]">
                  <Loader2 size={12} className="animate-spin" />
                  Memuat…
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px]">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--auth-ink)]/30">
                Filter
              </span>
              {(
                [
                  ["all", "All"],
                  ["not_ingested", "Pending"],
                  ["processing", "Processing"],
                  ["done", "Ready"],
                  ["failed", "Failed"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusFilter(key)}
                  className={cn(
                    statusFilter === key
                      ? "font-semibold text-[var(--auth-teal)]"
                      : "text-[var(--auth-ink)]/40 hover:text-[var(--auth-ink)]"
                  )}
                >
                  {label}
                  {key === "not_ingested" && pendingInFolder > 0
                    ? ` (${pendingInFolder})`
                    : ""}
                  {key === "failed" && failedItems.length > 0
                    ? ` (${failedItems.length})`
                    : ""}
                </button>
              ))}
              <span className="text-[var(--auth-ink)]/15">|</span>
              <label className="inline-flex items-center gap-1.5 text-[var(--auth-ink)]/45">
                <input
                  type="checkbox"
                  checked={pdfOnly}
                  onChange={(e) => setPdfOnly(e.target.checked)}
                  className="accent-[var(--auth-teal)]"
                />
                PDF only
              </label>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="border-0 bg-transparent text-[12px] text-[var(--auth-ink)]/45 outline-none"
              >
                <option value="name">Name</option>
                <option value="date">Date</option>
                <option value="size">Size</option>
                <option value="status">Status</option>
              </select>
              {failedItems.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setSelected(new Set(failedItems.map((i) => i.path)))
                  }
                  className="text-[var(--auth-ink)]/45 hover:text-amber-700"
                >
                  Select failed
                </button>
              )}
              {selectableItems.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setSelected(new Set(selectableItems.map((i) => i.path)))
                  }
                  className="text-[var(--auth-ink)]/45 hover:text-[var(--auth-teal)]"
                >
                  Select all pending
                </button>
              )}
            </div>

            {showProgressPanel && ingestProgress && (
              <div className="space-y-2 border-t border-[var(--auth-teal)]/20 pt-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-semibold text-[var(--auth-teal-deep)]">
                      {(ingesting || watchingOcr) &&
                        ingestProgress.status !== "PAUSED" && (
                        <Loader2 size={14} className="shrink-0 animate-spin" />
                      )}
                      {ingestProgress.phaseTitle}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--auth-ink)]/50">
                      {ingestProgress.phaseDetail}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-[11px] text-[var(--auth-ink)]/45">
                    <span>
                      Kirim: {ingestProgress.processedFiles}/
                      {ingestProgress.totalFiles || "?"}
                    </span>
                    {(ingestProgress.ocrTotalCount ?? 0) > 0 && (
                      <span className="font-semibold text-[var(--auth-teal-deep)]">
                        OCR: {ingestProgress.ocrDoneCount ?? 0}/
                        {ingestProgress.ocrTotalCount} selesai
                        {(ingestProgress.ocrPendingCount ?? 0) > 0 &&
                          ` · ${ingestProgress.ocrPendingCount} antre`}
                      </span>
                    )}
                    {(ingestProgress.ocrTotalCount ?? 0) === 0 &&
                      (ingestProgress.ocrPendingCount ?? 0) > 0 && (
                        <span>
                          {ingestProgress.ocrPendingCount} OCR antre
                        </span>
                      )}
                    {ingesting && ingestJobId && (
                      <div className="flex items-center gap-2">
                        {ingestProgress.status === "PAUSED" ? (
                          <button
                            type="button"
                            onClick={() => void handleResume()}
                            className="inline-flex items-center gap-1 font-semibold text-[var(--auth-teal)]"
                          >
                            <Play size={10} fill="currentColor" />
                            Resume
                          </button>
                        ) : ingestProgress.status === "RUNNING" ? (
                          <button
                            type="button"
                            onClick={() => void handlePause()}
                            className="inline-flex items-center gap-1 font-semibold text-amber-700"
                          >
                            <Pause size={10} fill="currentColor" />
                            Pause
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={handleStop}
                          disabled={cancelling}
                          className="inline-flex items-center gap-1 font-semibold text-red-600"
                        >
                          {cancelling ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Square size={10} fill="currentColor" />
                          )}
                          Stop
                        </button>
                      </div>
                    )}
                    {watchingOcr && !ingesting && (
                      <button
                        type="button"
                        onClick={() => {
                          setWatchingOcr(false);
                          setIngestProgress(null);
                        }}
                        className="hover:underline"
                      >
                        Sembunyikan
                      </button>
                    )}
                  </div>
                </div>
                <div className="h-1.5 overflow-hidden bg-[var(--auth-teal)]/15">
                  {ingestProgress.progressPercent == null ? (
                    <div className="h-full w-1/3 animate-pulse bg-[var(--auth-teal)]/70" />
                  ) : (
                    <div
                      className="h-full bg-[var(--auth-teal)] transition-[width] duration-500"
                      style={{
                        width: `${Math.max(2, ingestProgress.progressPercent)}%`,
                      }}
                    />
                  )}
                </div>
                {(ingestProgress.ocrTotalCount ?? 0) > 0 &&
                  (ingesting || watchingOcr) &&
                  (ingestProgress.ocrPendingCount ?? 0) > 0 &&
                  ingestProgress.phase !== "ocr_wait" && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-[var(--auth-ink)]/40">
                        <span>Progress OCR Paperless</span>
                        <span>
                          {ingestProgress.ocrProgressPercent ?? 0}%
                        </span>
                      </div>
                      <div className="h-1 overflow-hidden bg-amber-500/15">
                        <div
                          className="h-full bg-amber-600 transition-[width] duration-500"
                          style={{
                            width: `${Math.max(
                              2,
                              ingestProgress.ocrProgressPercent ?? 0
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
              </div>
            )}
          </div>

          {/* File list - fills remaining height; section grows past min when long */}
          <div className="relative flex-1 px-5 pb-28 pt-1 lg:px-8">
            {!loading && error && !credsMissing && (
              <div className="flex flex-col items-start gap-3 py-12">
                <AlertCircle className="text-amber-600" size={24} />
                <p className="text-sm text-[var(--auth-ink)]/70">{error}</p>
                {error.includes("Profil") && (
                  <Link
                    href="/profile"
                    className="text-[12px] font-semibold text-[var(--auth-teal)]"
                  >
                    Buka Profil
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => load(path)}
                  className="text-[12px] text-[var(--auth-ink)]/45 hover:text-[var(--auth-ink)]"
                >
                  Retry
                </button>
              </div>
            )}

            {showEmptyRoot && (
              <div className="flex flex-col items-start gap-3 py-16 text-[var(--auth-ink)]/35">
                <Inbox size={24} />
                <p className="text-sm font-medium text-[var(--auth-ink)]/60">
                  Cloud Anda kosong atau belum terhubung
                </p>
                <p className="max-w-md text-[13px] text-[var(--auth-ink)]/45">
                  Tip: gunakan panel folder di kiri untuk menavigasi, atau cari
                  file lewat kotak pencarian di atas. Setelah menemukan PDF,
                  centang lalu klik Fetch & OCR.
                </p>
              </div>
            )}

            {loading && visibleItems.length === 0 && !error && (
              <ul className="animate-fade-in overflow-hidden rounded-lg border border-[var(--auth-teal)]/12 bg-white/50">
                {Array.from({ length: 6 }).map((_, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-3 border-t border-[var(--auth-ink)]/[0.05] px-2 py-3 first:border-t-0"
                  >
                    <span className="h-4 w-4 shrink-0 rounded bg-[var(--auth-ink)]/[0.06]" />
                    <span className="h-9 w-9 shrink-0 rounded-md bg-[var(--auth-teal)]/[0.08]" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div
                        className="h-3.5 rounded bg-[var(--auth-ink)]/[0.08]"
                        style={{ width: `${55 + ((i * 17) % 30)}%` }}
                      />
                      <div className="h-2.5 w-24 rounded bg-[var(--auth-ink)]/[0.05]" />
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {!loading &&
              !error &&
              !showEmptyRoot &&
              visibleItems.length === 0 && (
                <div className="flex flex-col items-start gap-2 py-16 text-[var(--auth-ink)]/35">
                  <Inbox size={24} />
                  <p className="text-sm">
                    Folder kosong atau tidak ada yang cocok filter.
                  </p>
                </div>
              )}

            {!loading && visibleItems.length > 0 && (
              <ul
                key={path}
                className="animate-fade-in overflow-hidden rounded-lg border border-[var(--auth-teal)]/12 bg-white/50"
              >
                {visibleItems.map((item, idx) => {
                  const display = humanizeFileName(item.name);
                  const isDup =
                    item.type === "file" &&
                    item.isPdf &&
                    duplicateNames.has(display.toLowerCase());
                  const focused = focusIndex === idx;
                  return (
                    <li
                      key={item.path}
                      className={cn(
                        "flex items-center gap-3 border-t border-[var(--auth-ink)]/[0.05] px-2 py-3 transition last:border-b hover:bg-[var(--auth-teal)]/[0.04]",
                        focused &&
                          "bg-[var(--auth-teal)]/[0.07] ring-2 ring-inset ring-[var(--auth-teal)]/40"
                      )}
                      onMouseEnter={() => setFocusIndex(idx)}
                    >
                      {item.type === "file" && item.isPdf ? (
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[var(--auth-teal)]"
                          checked={selected.has(item.path)}
                          disabled={!item.selectable || ingesting}
                          onChange={() => toggle(item.path)}
                          aria-label={`Pilih ${display}`}
                        />
                      ) : (
                        <span className="w-4" />
                      )}

                      {item.type === "directory" ? (
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          onClick={() => void openFolder(item.path)}
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center text-amber-600">
                            <Folder size={18} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-[var(--auth-ink)]">
                              {display}
                            </p>
                            <p className="truncate text-[11px] text-[var(--auth-ink)]/35">
                              Folder
                              {item.lastModified &&
                                ` · ${new Date(item.lastModified).toLocaleDateString("id-ID")}`}
                            </p>
                          </div>
                        </button>
                      ) : (
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center text-[var(--auth-ink)]/35">
                            <FileText size={18} />
                          </div>
                          <div className="min-w-0 flex-1">
                            {item.paperlessDocumentId &&
                            item.ingestStatus === "done" ? (
                              <DocPreviewLink
                                docId={item.paperlessDocumentId}
                                className="block truncate text-sm font-medium"
                              >
                                {display}
                                {isDup && (
                                  <span className="ml-2 text-[10px] font-normal text-amber-700 no-underline hover:no-underline">
                                    mirip nama lain
                                  </span>
                                )}
                              </DocPreviewLink>
                            ) : (
                              <p className="truncate text-sm font-medium text-[var(--auth-ink)]">
                                {display}
                                {isDup && (
                                  <span className="ml-2 text-[10px] font-normal text-amber-700">
                                    mirip nama lain
                                  </span>
                                )}
                              </p>
                            )}
                            <p className="truncate text-[11px] text-[var(--auth-ink)]/35">
                              {formatSize(item.size)}
                              {item.lastModified &&
                                ` · ${new Date(item.lastModified).toLocaleDateString("id-ID")}`}
                            </p>
                            {item.isPdf &&
                              (item.ingestStatus === "processing" ||
                                item.ingestStatus === "failed") && (
                                <FileProgress
                                  stage={
                                    item.ingestStatus === "failed"
                                      ? "FAILED"
                                      : item.syncStage
                                  }
                                  errorMessage={item.errorMessage}
                                />
                              )}
                          </div>
                        </div>
                      )}

                      {item.type === "file" && item.ingestStatus && (
                        <StatusBadge
                          status={item.ingestStatus}
                          stage={item.syncStage}
                        />
                      )}

                      {item.type === "file" && item.isPdf && (
                        <a
                          href={`/api/cloud/raw?path=${encodeURIComponent(item.path)}`}
                          className="shrink-0 text-[11px] text-[var(--auth-ink)]/40 hover:text-[var(--auth-teal)]"
                        >
                          Download original
                        </a>
                      )}

                      {item.type === "file" &&
                        item.paperlessDocumentId &&
                        item.ingestStatus === "done" && (
                          <div className="flex shrink-0 flex-col items-end gap-1 text-[11px]">
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewId(item.paperlessDocumentId)
                              }
                              className="inline-flex items-center gap-1 text-[var(--auth-teal)]"
                            >
                              <Eye size={11} />
                              Preview
                            </button>
                            <Link
                              href={`/?doc=${item.paperlessDocumentId}`}
                              className="inline-flex items-center gap-1 text-[var(--auth-ink)]/40 hover:text-[var(--auth-teal)]"
                            >
                              <MessageSquare size={11} />
                              Ask AI
                            </Link>
                          </div>
                        )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* OCR Queue - end of page */}
      <div className="relative z-[1] border-t border-[var(--auth-teal)]/15 bg-gradient-to-t from-[var(--auth-teal)]/[0.07] to-[var(--auth-paper)] px-5 py-5 lg:px-8">
      {queue && (
        <div className="rounded-lg border border-[var(--auth-teal)]/15 bg-white/70 px-4 py-3 shadow-[0_-1px_0_rgb(11_110_99/0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--auth-teal)]">
              <Clock size={11} />
              OCR Queue
            </p>
            <div className="flex items-center gap-3">
              <div className="flex gap-2 text-[11px]">
                {(
                  [
                    ["summary", "Summary"],
                    ["failed", "Failed"],
                    ["processing", "Processing"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setQueueTab(key)}
                    className={cn(
                      queueTab === key
                        ? "font-semibold text-[var(--auth-teal)]"
                        : "text-[var(--auth-ink)]/40 hover:text-[var(--auth-ink)]"
                    )}
                  >
                    {label}
                    {key === "failed" && queue.failed > 0
                      ? ` (${queue.failed})`
                      : ""}
                    {key === "processing" &&
                    queue.downloading + queue.queued + queue.ocrPending > 0
                      ? ` (${queue.downloading + queue.queued + queue.ocrPending})`
                      : ""}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void loadQueue()}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--auth-ink)]/40 hover:text-[var(--auth-teal)]"
              >
                <RefreshCw size={11} />
                Refresh
              </button>
            </div>
          </div>

          {queueTab === "summary" && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
              <span className="text-[var(--auth-ink)]/60">
                <span className="font-semibold text-[var(--auth-ink)]">
                  {queue.ready}
                </span>{" "}
                siap
              </span>
              {(queue.downloading > 0 || queue.queued > 0) && (
                <span className="text-[var(--auth-teal)]">
                  <span className="font-semibold">
                    {queue.downloading + queue.queued}
                  </span>{" "}
                  unduh / antre
                </span>
              )}
              {queue.ocrPending > 0 && (
                <span className="text-[var(--auth-teal)]">
                  <span className="font-semibold">{queue.ocrPending}</span>{" "}
                  OCR
                </span>
              )}
              {queue.failed > 0 && (
                <span className="text-amber-700">
                  <span className="font-semibold">{queue.failed}</span> gagal
                </span>
              )}
              {queue.ocrPending + queue.downloading + queue.queued === 0 &&
                queue.failed === 0 && (
                  <span className="text-[var(--auth-ink)]/40">
                    Tidak ada proses berjalan
                  </span>
                )}
            </div>
          )}

          {queueTab === "failed" && (
            <div className="mt-2">
              {queueFiles.failed.length === 0 ? (
                <p className="text-[13px] text-[var(--auth-ink)]/40">
                  Tidak ada file gagal
                </p>
              ) : (
                <>
                  <ul className="space-y-0">
                    {queueFiles.failed.map((f) => {
                      const human = humanizeSyncError(f.errorMessage);
                      const age = formatSyncAge(f.updatedAt);
                      return (
                      <li
                        key={f.id}
                        className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--auth-ink)]/[0.06] py-2 first:border-t-0"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            openFolder(parentFolder(f.remotePath), {
                              focusFile: f.remotePath,
                            })
                          }
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="truncate text-[13px] font-medium text-[var(--auth-ink)]">
                            {humanizeFileName(f.fileName)}
                          </p>
                          <p className="truncate text-[11px] text-[var(--auth-ink)]/35">
                            {f.remotePath}
                          </p>
                          <p className="mt-0.5 text-[11px] font-medium text-amber-800">
                            {human.title}
                            {age ? ` · ${age}` : ""}
                          </p>
                          <p className="truncate text-[10px] text-amber-700/80">
                            {human.hint}
                          </p>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void handleRetry([f.remotePath])
                          }
                          disabled={ingesting}
                          className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[var(--auth-teal)] disabled:opacity-40"
                        >
                          <RotateCcw size={11} />
                          Coba OCR lagi
                        </button>
                      </li>
                      );
                    })}
                  </ul>
                  {queueFiles.failed.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void handleRetry(undefined, true)}
                        disabled={ingesting}
                        className="text-[12px] font-semibold text-[var(--auth-teal)] disabled:opacity-40"
                      >
                        Coba OCR lagi semua (max {scanLimits.retryBatch}/batch)
                      </button>
                      {queueFiles.failedHasMore && (
                        <button
                          type="button"
                          onClick={() => {
                            const next = queueLimit + 50;
                            setQueueLimit(next);
                            void loadQueue(next);
                          }}
                          className="text-[12px] text-[var(--auth-ink)]/45 hover:text-[var(--auth-ink)]"
                        >
                          Show more
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {queueTab === "processing" && (
            <div className="mt-2">
              {queueFiles.processing.length === 0 ? (
                <p className="text-[13px] text-[var(--auth-ink)]/40">
                  Tidak ada file sedang diproses
                </p>
              ) : (
                <>
                  <ul className="space-y-0">
                    {queueFiles.processing.map((f) => {
                      const age = formatSyncAge(
                        f.syncStatus === "OCR_PENDING"
                          ? f.ocrPendingAt ?? f.updatedAt
                          : f.updatedAt
                      );
                      return (
                      <li key={f.id}>
                        <button
                          type="button"
                          onClick={() =>
                            void openFolder(parentFolder(f.remotePath), {
                              focusFile: f.remotePath,
                            })
                          }
                          className="flex w-full flex-col gap-0.5 border-t border-[var(--auth-ink)]/[0.06] py-2 text-left first:border-t-0 hover:bg-[var(--auth-teal)]/[0.03]"
                        >
                          <p className="truncate text-[13px] font-medium text-[var(--auth-ink)]">
                            {humanizeFileName(f.fileName)}
                          </p>
                          <p className="truncate text-[11px] text-[var(--auth-ink)]/35">
                            {f.remotePath}
                          </p>
                          {f.syncStatus && (
                            <p className="text-[10px] text-[var(--auth-teal)]">
                              {f.syncStatus === "OCR_PENDING"
                                ? `Menunggu OCR Paperless${age ? ` · ${age}` : ""} (batas ${scanLimits.ocrTimeoutMinutes} mnt)`
                                : syncStageLabel(f.syncStatus)}
                            </p>
                          )}
                        </button>
                      </li>
                      );
                    })}
                  </ul>
                  {queueFiles.processingHasMore && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = queueLimit + 50;
                        setQueueLimit(next);
                        void loadQueue(next);
                      }}
                      className="mt-2 text-[12px] text-[var(--auth-ink)]/45 hover:text-[var(--auth-ink)]"
                    >
                      Show more
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
      </div>

      {/* Sticky selection bar */}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--auth-ink)]/[0.08] bg-white/95 px-5 py-3 backdrop-blur-md lg:px-8">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[var(--auth-ink)]/70">
              <span className="font-semibold text-[var(--auth-ink)]">
                {selected.size} PDF
              </span>{" "}
              dipilih
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-[12px] text-[var(--auth-ink)]/40 hover:text-[var(--auth-ink)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleIngestSelected}
                disabled={ingesting}
                className="inline-flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-[var(--auth-teal)] disabled:opacity-40"
              >
                <Download size={14} />
                Fetch & OCR
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview sheet / rail overlay */}
      {previewId != null && (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            className="absolute inset-0 bg-[var(--auth-ink)]/30"
            aria-label="Close"
            onClick={() => setPreviewId(null)}
          />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--auth-ink)]/[0.06] px-4 py-3">
              <div className="flex items-center gap-3 text-[12px]">
                <Link
                  href={`/?doc=${previewId}`}
                  className="inline-flex items-center gap-1 font-semibold text-[var(--auth-teal)]"
                >
                  <MessageSquare size={13} />
                  Ask AI
                </Link>
                <a
                  href={`/api/documents/${previewId}/download`}
                  className="text-[var(--auth-ink)]/40 hover:text-[var(--auth-ink)]"
                >
                  Download
                </a>
              </div>
              <button
                type="button"
                onClick={() => setPreviewId(null)}
                className="p-1.5 text-[var(--auth-ink)]/40"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <iframe
              title="Preview"
              src={`/api/documents/${previewId}/preview`}
              className="min-h-0 w-full flex-1 bg-[var(--auth-paper)]"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function FileProgress({
  stage,
  errorMessage,
}: {
  stage: string | null;
  errorMessage: string | null;
}) {
  const pct = syncStageProgress(stage);
  const label = syncStageLabel(stage);
  const active =
    stage === "DOWNLOADING" ||
    stage === "QUEUED" ||
    stage === "OCR_PENDING";
  const human =
    stage === "FAILED" ? humanizeSyncError(errorMessage) : null;

  return (
    <div className="mt-1.5 max-w-sm">
      <div className="mb-0.5 flex items-center justify-between gap-2 text-[10px] text-[var(--auth-ink)]/40">
        <span className="truncate">{label}</span>
        <span className="shrink-0 tabular-nums">{pct}%</span>
      </div>
      <div className="h-1 overflow-hidden bg-[var(--auth-ink)]/[0.06]">
        <div
          className={cn(
            "h-full transition-[width] duration-500",
            stage === "FAILED" ? "bg-amber-500" : "bg-[var(--auth-teal)]",
            active && "animate-pulse"
          )}
          style={{ width: `${Math.max(4, pct)}%` }}
        />
      </div>
      {human && (
        <p className="mt-0.5 truncate text-[10px] text-amber-700" title={human.hint}>
          {human.title}: {human.hint}
        </p>
      )}
      {!human && errorMessage && (
        <p className="mt-0.5 truncate text-[10px] text-amber-700">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

function StatusBadge({
  status,
  stage,
}: {
  status: IngestStatus;
  stage: string | null;
}) {
  if (!status) return null;
  const label =
    status === "processing"
      ? syncStageLabel(stage)
      : status === "not_ingested"
        ? "Pending"
        : status === "done"
          ? stage === "SKIPPED"
            ? "Duplicate"
            : "Ready"
          : "Failed";

  const color =
    status === "done"
      ? "text-[var(--auth-teal)]"
      : status === "failed"
        ? "text-amber-700"
        : status === "processing"
          ? "text-sky-700"
          : "text-[var(--auth-ink)]/40";

  const Icon =
    status === "done"
      ? CheckCircle2
      : status === "failed"
        ? AlertCircle
        : status === "processing"
          ? Clock
          : Inbox;

  return (
    <span
      className={cn(
        "inline-flex max-w-[9rem] shrink-0 items-center gap-1 text-[11px] font-medium",
        color
      )}
      title={label}
    >
      {status === "processing" ? (
        <Loader2 size={11} className="shrink-0 animate-spin" />
      ) : (
        <Icon size={11} className="shrink-0" />
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}

export function CloudBrowser() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--auth-ink)]/40">
          Memuat Library…
        </div>
      }
    >
      <CloudBrowserInner />
    </Suspense>
  );
}
