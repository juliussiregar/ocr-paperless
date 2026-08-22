"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Loader2,
} from "lucide-react";
import { humanizeFileName } from "@/lib/display-name";
import { cn } from "@/lib/utils";

type NodeKind = "directory" | "file";

type TreeNode = {
  path: string;
  name: string;
  kind: NodeKind;
  isPdf?: boolean;
  paperlessDocumentId?: number | null;
  children?: TreeNode[];
  loaded?: boolean;
  loading?: boolean;
};

export type TreeFileOpen = {
  path: string;
  name: string;
  isPdf: boolean;
  paperlessDocumentId: number | null;
};

const WIDTH_KEY = "cloud-browser:tree-width";
const DEFAULT_WIDTH = 224;
const MIN_WIDTH = 168;
const MAX_WIDTH = 480;

function normalizePath(p: string): string {
  if (!p || p === "/") return "/";
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return withSlash.replace(/\/$/, "") || "/";
}

function ancestorPaths(currentPath: string): string[] {
  const normalized = normalizePath(currentPath);
  const parts = normalized === "/" ? [] : normalized.split("/").filter(Boolean);
  const ancestors = ["/"];
  for (let i = 0; i < parts.length; i++) {
    ancestors.push("/" + parts.slice(0, i + 1).join("/"));
  }
  return ancestors;
}

function findNode(node: TreeNode, target: string): TreeNode | null {
  if (node.path === target) return node;
  if (!node.children) return null;
  for (const child of node.children) {
    const found = findNode(child, target);
    if (found) return found;
  }
  return null;
}

function clampWidth(n: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(n)));
}

function readStoredWidth(): number {
  if (typeof window === "undefined") return DEFAULT_WIDTH;
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    if (!raw) return DEFAULT_WIDTH;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_WIDTH;
    return clampWidth(n);
  } catch {
    return DEFAULT_WIDTH;
  }
}

function saveStoredWidth(w: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(clampWidth(w)));
  } catch {
    // ignore
  }
}

function indentForDepth(depth: number): number {
  if (depth <= 4) return 8 + depth * 12;
  if (depth <= 8) return 8 + 4 * 12 + (depth - 4) * 8;
  return 8 + 4 * 12 + 4 * 8 + (depth - 8) * 6;
}

export function FolderTreeSidebar({
  currentPath,
  focusFilePath = null,
  syncKey = 0,
  onOpenFolder,
  onOpenFile,
}: {
  currentPath: string;
  /** File path to highlight (e.g. from Recent / search). */
  focusFilePath?: string | null;
  /** Bump on every navigation so tree re-reveals even if path unchanged. */
  syncKey?: number;
  onOpenFolder: (path: string) => void;
  onOpenFile?: (file: TreeFileOpen) => void;
}) {
  const [root, setRoot] = useState<TreeNode>({
    path: "/",
    name: "Root",
    kind: "directory",
    children: [],
    loaded: false,
  });
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    return new Set(ancestorPaths(currentPath));
  });
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const rootRef = useRef(root);
  const inflightRef = useRef<Map<string, Promise<void>>>(new Map());
  const prefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ensureGenRef = useRef(0);
  const widthRef = useRef(width);
  const scrollTargetRef = useRef<HTMLElement | null>(null);
  rootRef.current = root;
  widthRef.current = width;

  useLayoutEffect(() => {
    const stored = readStoredWidth();
    setWidth(stored);
    widthRef.current = stored;
  }, []);

  const loadChildren = useCallback(
    async (folderPath: string, force = false) => {
      const target = normalizePath(folderPath);

      if (!force) {
        const existing = findNode(rootRef.current, target);
        if (existing?.loaded) return;
      }

      const pending = inflightRef.current.get(target);
      if (pending) {
        await pending;
        if (!force) return;
        // After pending finishes, continue with force reload below
      }

      const job = (async () => {
        // Wait briefly for parent to appear (sequential ensure should add it)
        if (target !== "/") {
          let tries = 0;
          while (!findNode(rootRef.current, target) && tries < 8) {
            await new Promise((r) => setTimeout(r, 40));
            tries += 1;
          }
          if (!findNode(rootRef.current, target)) return;
        }

        setRoot((prev) => markLoading(prev, target, true));
        try {
          const res = await fetch(
            `/api/cloud/tree?path=${encodeURIComponent(target)}`
          );
          const data = await res.json();
          const rawEntries =
            (data.entries as
              | {
                  path: string;
                  name: string;
                  type?: string;
                  isPdf?: boolean;
                  paperlessDocumentId?: number | null;
                }[]
              | undefined) ??
            (
              (data.folders as { path: string; name: string }[] | undefined) ??
              []
            ).map((f) => ({ ...f, type: "directory" as const }));

          const children: TreeNode[] = rawEntries.map((e) => {
            const kind: NodeKind = e.type === "file" ? "file" : "directory";
            return {
              path: normalizePath(e.path),
              name: e.name,
              kind,
              isPdf: Boolean(e.isPdf),
              paperlessDocumentId: e.paperlessDocumentId ?? null,
              children: kind === "directory" ? [] : undefined,
              loaded: kind === "file" ? true : false,
            };
          });

          setRoot((prev) => {
            if (target !== "/" && !findNode(prev, target)) return prev;
            const next = setChildren(prev, target, children);
            rootRef.current = next;
            return next;
          });
        } catch {
          setRoot((prev) => markLoading(prev, target, false));
        } finally {
          inflightRef.current.delete(target);
        }
      })();

      inflightRef.current.set(target, job);
      await job;
    },
    []
  );

  // Whenever navigation happens: expand ancestors, load path, reload leaf, scroll into view
  useEffect(() => {
    const gen = ++ensureGenRef.current;
    const activePath = normalizePath(currentPath);
    const focus = focusFilePath ? normalizePath(focusFilePath) : null;
    const ancestors = ancestorPaths(activePath);

    setExpanded((prev) => {
      const next = new Set(prev);
      for (const a of ancestors) next.add(a);
      return next;
    });

    void (async () => {
      for (let i = 0; i < ancestors.length; i++) {
        if (gen !== ensureGenRef.current) return;
        const a = ancestors[i];
        const isLeaf = i === ancestors.length - 1;
        // Always refresh the open folder so tree matches the right panel
        await loadChildren(a, isLeaf);
      }
      if (gen !== ensureGenRef.current) return;

      // Allow DOM to paint expanded + children, then scroll
      requestAnimationFrame(() => {
        scrollTargetRef.current?.scrollIntoView({
          block: "nearest",
          inline: "nearest",
          behavior: "smooth",
        });
      });
    })();
  }, [currentPath, focusFilePath, syncKey, loadChildren]);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: PointerEvent) => {
      const startX = Number(document.body.dataset.treeDragStartX ?? e.clientX);
      const startW = Number(
        document.body.dataset.treeDragStartW ?? DEFAULT_WIDTH
      );
      const next = clampWidth(startW + (e.clientX - startX));
      setWidth(next);
      widthRef.current = next;
    };

    const onUp = () => {
      setDragging(false);
      saveStoredWidth(widthRef.current);
      delete document.body.dataset.treeDragStartX;
      delete document.body.dataset.treeDragStartW;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging]);

  useEffect(() => {
    if (!dragging) return;
    const flush = () => saveStoredWidth(widthRef.current);
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [dragging]);

  function startResize(e: ReactPointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    document.body.dataset.treeDragStartX = String(e.clientX);
    document.body.dataset.treeDragStartW = String(widthRef.current);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setDragging(true);
  }

  function resetWidth() {
    setWidth(DEFAULT_WIDTH);
    widthRef.current = DEFAULT_WIDTH;
    saveStoredWidth(DEFAULT_WIDTH);
  }

  function toggleExpand(node: TreeNode) {
    if (node.kind !== "directory") return;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(node.path)) next.delete(node.path);
      else next.add(node.path);
      return next;
    });
    if (!node.loaded) void loadChildren(node.path);
  }

  function collapseToCurrent() {
    setExpanded(new Set(ancestorPaths(currentPath)));
  }

  function prefetch(node: TreeNode) {
    if (node.kind !== "directory" || node.loaded || node.loading) return;
    if (prefetchTimer.current) clearTimeout(prefetchTimer.current);
    prefetchTimer.current = setTimeout(() => {
      void loadChildren(node.path);
    }, 120);
  }

  function handleOpen(node: TreeNode) {
    if (node.kind === "directory") {
      onOpenFolder(node.path);
      return;
    }
    onOpenFile?.({
      path: node.path,
      name: node.name,
      isPdf: Boolean(node.isPdf),
      paperlessDocumentId: node.paperlessDocumentId ?? null,
    });
  }

  const activePath = normalizePath(currentPath);
  const activeFile = focusFilePath ? normalizePath(focusFilePath) : null;

  return (
    <aside
      className={cn(
        "relative hidden min-h-full shrink-0 self-stretch border-r border-[var(--auth-teal)]/12 bg-gradient-to-b from-white/80 via-[var(--auth-teal)]/[0.04] to-amber-50/30 lg:block",
        dragging && "select-none"
      )}
      style={{ width }}
      aria-label="Folder tree"
    >
      <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 bg-gradient-to-b from-white via-white/95 to-transparent px-3 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--auth-teal)]">
          Browser
        </p>
        <button
          type="button"
          onClick={collapseToCurrent}
          className="text-[10px] font-medium text-[var(--auth-ink)]/35 transition hover:text-[var(--auth-teal)]"
          title="Collapse tree to current folder"
        >
          Collapse
        </button>
      </div>

      <div className="overflow-x-auto px-1 pb-10">
        <div className="min-w-max pr-2">
          <TreeRows
            nodes={[root]}
            depth={0}
            expanded={expanded}
            currentPath={activePath}
            focusFilePath={activeFile}
            scrollTargetRef={scrollTargetRef}
            onToggle={toggleExpand}
            onOpen={handleOpen}
            onPrefetch={prefetch}
          />
        </div>
      </div>

      <button
        type="button"
        aria-label="Resize folder panel"
        title="Drag to resize (saved locally). Double-click to reset."
        onPointerDown={startResize}
        onDoubleClick={resetWidth}
        className={cn(
          "absolute inset-y-0 -right-1 z-[2] w-2 cursor-col-resize border-0 bg-transparent p-0",
          "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-[var(--auth-teal)]/0 after:transition-colors",
          "hover:after:bg-[var(--auth-teal)]/35",
          dragging && "after:bg-[var(--auth-teal)]/55"
        )}
      />
    </aside>
  );
}

function TreeRows({
  nodes,
  depth,
  expanded,
  currentPath,
  focusFilePath,
  scrollTargetRef,
  onToggle,
  onOpen,
  onPrefetch,
}: {
  nodes: TreeNode[];
  depth: number;
  expanded: Set<string>;
  currentPath: string;
  focusFilePath: string | null;
  scrollTargetRef: RefObject<HTMLElement | null>;
  onToggle: (n: TreeNode) => void;
  onOpen: (n: TreeNode) => void;
  onPrefetch: (n: TreeNode) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => {
        const isDir = node.kind === "directory";
        const isOpen = isDir && expanded.has(node.path);
        const isCurrentFolder = isDir && currentPath === node.path;
        const isFocusedFile =
          !isDir && focusFilePath != null && focusFilePath === node.path;
        const isScrollTarget = isFocusedFile || (isCurrentFolder && !focusFilePath);
        const activeBranch =
          isCurrentFolder ||
          (isDir &&
            node.path !== "/" &&
            currentPath.startsWith(node.path + "/"));
        const childCount = node.children?.length ?? 0;
        const label = isDir ? node.name : humanizeFileName(node.name);

        return (
          <li key={`${node.kind}:${node.path}`}>
            <div
              ref={
                isScrollTarget
                  ? (el) => {
                      scrollTargetRef.current = el;
                    }
                  : undefined
              }
              className={cn(
                "flex items-center gap-0.5 rounded-md py-1 pr-1 text-[12px] transition-colors duration-200",
                isCurrentFolder || isFocusedFile
                  ? "bg-[var(--auth-teal)]/[0.12] font-semibold text-[var(--auth-teal-deep)]"
                  : activeBranch
                    ? "text-[var(--auth-ink)]/70"
                    : "text-[var(--auth-ink)]/50 hover:bg-[var(--auth-teal)]/[0.05] hover:text-[var(--auth-ink)]"
              )}
              style={{ paddingLeft: `${indentForDepth(depth)}px` }}
              onMouseEnter={() => onPrefetch(node)}
            >
              {isDir ? (
                <button
                  type="button"
                  className="shrink-0 rounded-sm p-0.5 text-[var(--auth-ink)]/30 transition hover:text-[var(--auth-teal)]"
                  onClick={() => onToggle(node)}
                  aria-label={isOpen ? "Collapse" : "Expand"}
                >
                  {node.loading ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <span className="inline-flex">
                      {isOpen ? (
                        <ChevronDown size={11} />
                      ) : (
                        <ChevronRight size={11} />
                      )}
                    </span>
                  )}
                </button>
              ) : (
                <span className="inline-block w-[19px] shrink-0" />
              )}
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm py-0.5 text-left transition active:scale-[0.99]"
                onClick={() => onOpen(node)}
                title={node.path}
              >
                {isDir ? (
                  <Folder
                    size={12}
                    className={cn(
                      "shrink-0 transition-colors duration-200",
                      isCurrentFolder
                        ? "text-[var(--auth-teal)]"
                        : "text-amber-600/80"
                    )}
                  />
                ) : (
                  <FileText
                    size={12}
                    className={cn(
                      "shrink-0",
                      node.isPdf
                        ? "text-[var(--auth-teal)]/70"
                        : "text-[var(--auth-ink)]/35"
                    )}
                  />
                )}
                <span className="whitespace-nowrap">{label}</span>
              </button>
            </div>
            {isOpen && childCount > 0 && (
              <div className="animate-fade-in origin-top">
                <TreeRows
                  nodes={node.children!}
                  depth={depth + 1}
                  expanded={expanded}
                  currentPath={currentPath}
                  focusFilePath={focusFilePath}
                  scrollTargetRef={scrollTargetRef}
                  onToggle={onToggle}
                  onOpen={onOpen}
                  onPrefetch={onPrefetch}
                />
              </div>
            )}
            {isOpen && node.loaded && childCount === 0 && !node.loading && (
              <p
                className="py-0.5 text-[10px] text-[var(--auth-ink)]/30"
                style={{ paddingLeft: `${indentForDepth(depth + 1) + 19}px` }}
              >
                Kosong
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function markLoading(
  node: TreeNode,
  target: string,
  loading: boolean
): TreeNode {
  if (node.path === target) return { ...node, loading };
  if (!node.children) return node;
  return {
    ...node,
    children: node.children.map((c) => markLoading(c, target, loading)),
  };
}

function setChildren(
  node: TreeNode,
  target: string,
  children: TreeNode[]
): TreeNode {
  if (node.path === target) {
    return { ...node, children, loaded: true, loading: false };
  }
  if (!node.children) return node;
  return {
    ...node,
    children: node.children.map((c) => setChildren(c, target, children)),
  };
}
