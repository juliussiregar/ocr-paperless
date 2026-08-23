"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Copy,
  Check,
  Download,
  Eye,
  Loader2,
  MessageSquarePlus,
  Trash2,
  Send,
  Square,
  PanelLeftClose,
  PanelLeft,
  X,
  GitCompare,
  AtSign,
  FileText,
  Pencil,
  Search,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatCitation } from "@/lib/openai";
import type { ChatScope } from "@/lib/chat-scope";
import { citationLabel, humanizeFileName } from "@/lib/display-name";
import { SafeMarkdown } from "@/components/SafeMarkdown";
type UiMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  citations?: ChatCitation[];
  streaming?: boolean;
};

type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
};

type ContextDoc = {
  id: number;
  fileName: string;
  remotePath: string;
  displayName?: string;
};

const FOLLOW_UPS = [
  "Ringkas jawaban di atas dalam 3 poin",
  "Tampilkan kutipan penting dari sumbernya",
  "Ada dokumen terkait lainnya?",
];

function docLabel(d: ContextDoc): string {
  return d.displayName || humanizeFileName(d.fileName);
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function conversationGroupLabel(iso: string): string {
  const t = new Date(iso).getTime();
  const today = startOfDay(new Date());
  const yesterday = today - 24 * 60 * 60 * 1000;
  if (t >= today) return "Hari ini";
  if (t >= yesterday) return "Kemarin";
  return "Lebih lama";
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--auth-ink)]/40 transition hover:text-[var(--auth-teal)]"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? "Tersalin" : "Salin jawaban"}
    </button>
  );
}

function FeedbackButtons({
  messageId,
  conversationId,
}: {
  messageId?: string;
  conversationId: string | null;
}) {
  const [sent, setSent] = useState<"up" | "down" | null>(null);
  async function send(rating: "up" | "down") {
    if (sent) return;
    setSent(rating);
    await fetch("/api/chat/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, messageId, conversationId }),
    }).catch(() => undefined);
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={!!sent}
        onClick={() => send("up")}
        className={cn(
          "inline-flex items-center gap-1 text-[11px] transition",
          sent === "up"
            ? "text-[var(--auth-teal)]"
            : "text-[var(--auth-ink)]/35 hover:text-[var(--auth-teal)]"
        )}
        aria-label="Jawaban membantu"
      >
        <ThumbsUp size={11} />
      </button>
      <button
        type="button"
        disabled={!!sent}
        onClick={() => send("down")}
        className={cn(
          "inline-flex items-center gap-1 text-[11px] transition",
          sent === "down"
            ? "text-amber-700"
            : "text-[var(--auth-ink)]/35 hover:text-amber-700"
        )}
        aria-label="Jawaban kurang membantu"
      >
        <ThumbsDown size={11} />
      </button>
      {sent && (
        <span className="text-[10px] text-[var(--auth-ink)]/30">Terima kasih</span>
      )}
    </span>
  );
}

type RailDoc = ChatCitation & { usedInAnswer?: boolean };

function SourcesPanel({
  docs,
  previewId,
  onSelect,
  onClose,
  className,
}: {
  docs: RailDoc[];
  previewId: number | null;
  onSelect: (id: number) => void;
  onClose: () => void;
  className?: string;
}) {
  const activeIndex = docs.findIndex((d) => d.id === previewId);
  const hasNav = docs.length > 1;

  function goPrev() {
    if (!hasNav) return;
    const i = activeIndex < 0 ? 0 : (activeIndex - 1 + docs.length) % docs.length;
    onSelect(docs[i].id);
  }

  function goNext() {
    if (!hasNav) return;
    const i = activeIndex < 0 ? 0 : (activeIndex + 1) % docs.length;
    onSelect(docs[i].id);
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <p className="auth-display text-sm font-bold text-[var(--auth-ink)]">
            Sumber
          </p>
          <p className="text-[11px] text-[var(--auth-ink)]/40">
            {docs.length > 0
              ? `${docs.length} dokumen · klik Preview untuk cek cepat`
              : "Bukti dari jawaban"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 p-1.5 text-[var(--auth-ink)]/30 hover:text-[var(--auth-ink)]"
          aria-label="Tutup sumber"
        >
          <X size={16} />
        </button>
      </div>

      <ul className="max-h-44 space-y-1 overflow-y-auto border-y border-[var(--auth-ink)]/[0.06] px-2 py-2">
        {docs.map((c, idx) => {
          const selected = previewId === c.id;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition",
                  selected
                    ? "bg-[var(--auth-teal)]/10 ring-1 ring-[var(--auth-teal)]/25"
                    : "hover:bg-[var(--auth-ink)]/[0.03]"
                )}
              >
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "select-text text-[12px] leading-snug",
                      selected
                        ? "font-semibold text-[var(--auth-teal-deep)]"
                        : "font-medium text-[var(--auth-ink)]/70"
                    )}
                  >
                    {idx + 1}. {citationLabel(c)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide",
                        selected
                          ? "bg-[var(--auth-teal)] text-white"
                          : "bg-[var(--auth-teal)]/10 text-[var(--auth-teal-deep)]"
                      )}
                    >
                      <Eye size={11} />
                      {selected ? "Ditampilkan" : "Preview"}
                    </span>
                    {c.usedInAnswer && (
                      <span className="text-[10px] font-semibold text-[var(--auth-teal)]">
                        Dipakai di jawaban
                      </span>
                    )}
                  </div>
                </div>
              </button>
            </li>
          );
        })}
        {docs.length === 0 && (
          <li className="px-2 py-3 text-xs text-[var(--auth-ink)]/35">
            Sumber muncul setelah Ask AI menjawab.
          </li>
        )}
      </ul>

      <div className="flex min-h-0 flex-1 flex-col">
        {previewId ? (
          <>
            <div className="flex items-center gap-2 px-3 py-2.5">
              {hasNav && (
                <>
                  <button
                    type="button"
                    onClick={goPrev}
                    className="rounded-md px-2 py-1 text-[11px] font-semibold text-[var(--auth-ink)]/45 hover:bg-[var(--auth-ink)]/[0.04] hover:text-[var(--auth-ink)]"
                  >
                    Prev
                  </button>
                  <span className="text-[10px] text-[var(--auth-ink)]/35">
                    {Math.max(activeIndex, 0) + 1}/{docs.length}
                  </span>
                  <button
                    type="button"
                    onClick={goNext}
                    className="rounded-md px-2 py-1 text-[11px] font-semibold text-[var(--auth-ink)]/45 hover:bg-[var(--auth-ink)]/[0.04] hover:text-[var(--auth-ink)]"
                  >
                    Next
                  </button>
                </>
              )}
              <a
                href={`/api/documents/${previewId}/download`}
                className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--auth-ink)]/40 hover:text-[var(--auth-ink)]"
              >
                <Download size={12} />
                Unduh
              </a>
            </div>
            <iframe
              key={previewId}
              title="Document preview"
              src={`/api/documents/${previewId}/preview`}
              className="min-h-0 w-full flex-1 bg-[var(--auth-paper)]"
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-[var(--auth-ink)]/35">
            Pilih dokumen di daftar atas untuk menampilkan preview.
          </div>
        )}
      </div>
    </div>
  );
}

export function AskWorkspace({ documentCount }: { documentCount: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [railOpen, setRailOpen] = useState(false);
  const [mobileSourcesOpen, setMobileSourcesOpen] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>(
    []
  );
  const [threadSearch, setThreadSearch] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<
    Array<{ id: number; text: string }>
  >([]);
  const [docs, setDocs] = useState<ContextDoc[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [scope, setScope] = useState<ChatScope>({ mode: "all" });
  const [listLoading, setListLoading] = useState(true);
  const [pinned, setPinned] = useState<ContextDoc[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionRemote, setMentionRemote] = useState<ContextDoc[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [lastFocusIds, setLastFocusIds] = useState<number[]>([]);
  const [railDocs, setRailDocs] = useState<RailDoc[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const consumedDeepLink = useRef<string | null>(null);
  const mentionDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeCitations = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.citations && m.citations.length > 0) {
        return m.citations;
      }
    }
    return [] as ChatCitation[];
  }, [messages]);

  const panelDocs = useMemo(() => {
    if (railDocs.length > 0) return railDocs;
    return activeCitations.map((c) => ({ ...c, usedInAnswer: true }));
  }, [railDocs, activeCitations]);

  useEffect(() => {
    if (panelDocs.length > 0 && previewId == null) {
      setPreviewId(panelDocs[0].id);
    }
  }, [panelDocs, previewId]);

  function openSourcePreview(id: number) {
    setPreviewId(id);
    setRailOpen(true);
    setMobileSourcesOpen(true);
  }

  const mentionMatches = useMemo(() => {
    if (!mentionOpen) return [];
    const availableBase = docs.filter((d) => !pinned.some((p) => p.id === d.id));
    const q = mentionQuery.trim().toLowerCase();

    // Server results when typing; else local recent list
    const pool =
      q.length >= 1 && mentionRemote.length > 0
        ? mentionRemote.filter((d) => !pinned.some((p) => p.id === d.id))
        : availableBase;

    if (!q) return pool.slice(0, 8);

    const tokens = q
      .split(/[\s_]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const scored = pool
      .map((d) => {
        const label = docLabel(d).toLowerCase();
        const hay = `${label} ${d.fileName} ${d.remotePath}`
          .toLowerCase()
          .replace(/[_\-#]+/g, " ");
        const compact = hay.replace(/\s+/g, "");
        const qCompact = q.replace(/[\s_]+/g, "");
        const allHit = tokens.every(
          (t) => hay.includes(t) || compact.includes(t.replace(/\s+/g, ""))
        );
        if (!allHit && !compact.includes(qCompact)) return null;
        let score = 0;
        if (label.includes(q) || label.replace(/\s+/g, "").includes(qCompact))
          score += 40;
        for (const t of tokens) {
          if (label.includes(t)) score += 10;
          if (label.startsWith(t) || label.includes(` ${t}`)) score += 5;
        }
        return { d, score };
      })
      .filter((x): x is { d: ContextDoc; score: number } => x != null)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, 8).map((x) => x.d);
  }, [mentionOpen, mentionQuery, docs, pinned, mentionRemote]);

  useEffect(() => {
    if (!mentionOpen) return;
    const q = mentionQuery.trim();
    if (mentionDebounce.current) clearTimeout(mentionDebounce.current);
    if (q.length < 1) {
      setMentionRemote([]);
      setMentionLoading(false);
      return;
    }
    setMentionLoading(true);
    mentionDebounce.current = setTimeout(() => {
      void fetch(`/api/chat/docs?q=${encodeURIComponent(q)}&take=16`)
        .then((r) => r.json())
        .then((data) => {
          const list = (data.docs ?? []).map((d: ContextDoc) => ({
            ...d,
            displayName: d.displayName || humanizeFileName(d.fileName),
          }));
          setMentionRemote(list);
        })
        .catch(() => setMentionRemote([]))
        .finally(() => setMentionLoading(false));
    }, 220);
    return () => {
      if (mentionDebounce.current) clearTimeout(mentionDebounce.current);
    };
  }, [mentionOpen, mentionQuery]);

  const filteredConversations = useMemo(() => {
    const q = threadSearch.trim().toLowerCase();
    const list = q
      ? conversations.filter((c) => c.title.toLowerCase().includes(q))
      : conversations;
    const groups: { label: string; items: ConversationSummary[] }[] = [];
    for (const c of list) {
      const label = conversationGroupLabel(c.updatedAt);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(c);
      else groups.push({ label, items: [c] });
    }
    return groups;
  }, [conversations, threadSearch]);

  const scopeLabel = useMemo(() => {
    if (scope.mode === "folder") return `Folder: ${scope.pathPrefix}`;
    if (scope.mode === "docs") return "5 dokumen terbaru";
    return "Semua arsip saya";
  }, [scope]);

  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/chat/conversations");
    if (!res.ok) return;
    const data = await res.json();
    setConversations(data.conversations ?? []);
  }, []);

  const loadContext = useCallback(async () => {
    const res = await fetch("/api/chat/context");
    if (!res.ok) return;
    const data = await res.json();
    setDocs(
      (data.docs ?? []).map((d: ContextDoc) => ({
        ...d,
        displayName: d.displayName || humanizeFileName(d.fileName),
      }))
    );
    setFolders(data.folders ?? []);
    const raw = data.suggestions ?? [];
    setSuggestions(
      raw.map((s: string | { id: number; text: string }, i: number) =>
        typeof s === "string" ? { id: i, text: s } : s
      )
    );
  }, []);

  useEffect(() => {
    Promise.all([loadConversations(), loadContext()]).finally(() =>
      setListLoading(false)
    );
  }, [loadConversations, loadContext]);

  // Deep-link: /?doc=1,2&folder=/path&q=...
  useEffect(() => {
    if (listLoading) return;
    const docRaw = searchParams.get("doc");
    const folderRaw = searchParams.get("folder");
    const qRaw = searchParams.get("q");
    if (!docRaw && !folderRaw && !qRaw) return;

    const key = `${docRaw ?? ""}|${folderRaw ?? ""}|${qRaw ?? ""}`;
    if (consumedDeepLink.current === key) return;
    consumedDeepLink.current = key;

    // Always start a fresh thread so body.scope is applied on first send
    setActiveId(null);
    setMessages([]);
    setRailDocs([]);
    setError(null);

    const clearParams = () => {
      router.replace("/", { scroll: false });
    };

    if (qRaw?.trim()) {
      setQuestion(qRaw.trim());
    }

    if (folderRaw?.trim()) {
      const pathPrefix = folderRaw.startsWith("/")
        ? folderRaw
        : `/${folderRaw}`;
      setScope({ mode: "folder", pathPrefix });
    } else if (!docRaw) {
      setScope({ mode: "all" });
    }

    if (!docRaw) {
      setPinned([]);
      setLastFocusIds([]);
      clearParams();
      textareaRef.current?.focus();
      return;
    }

    const ids = docRaw
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((id) => Number.isInteger(id) && id > 0)
      .slice(0, 5);

    if (ids.length === 0) {
      clearParams();
      return;
    }

    void (async () => {
      const pinnedDocs: ContextDoc[] = [];
      for (const id of ids) {
        const fromList = docs.find((d) => d.id === id);
        if (fromList) {
          pinnedDocs.push(fromList);
          continue;
        }
        try {
          const res = await fetch(`/api/documents/${id}/meta`);
          if (res.ok) {
            const data = await res.json();
            pinnedDocs.push({
              id,
              fileName: data.fileName || data.title || `Dokumen ${id}`,
              remotePath: data.remotePath || "",
              displayName: data.displayName,
            });
            continue;
          }
        } catch {
          // fall through
        }
        pinnedDocs.push({
          id,
          fileName: `Dokumen ${id}`,
          remotePath: "",
          displayName: `Dokumen ${id}`,
        });
      }

      setPinned(pinnedDocs.slice(0, 5));
      setLastFocusIds(ids);
      setPreviewId(ids[0] ?? null);
      setRailOpen(true);
      if (!qRaw?.trim() && pinnedDocs[0]) {
        setQuestion(
          pinnedDocs.length === 1
            ? `Ringkas isi: ${docLabel(pinnedDocs[0])}`
            : `Bandingkan: ${pinnedDocs.map(docLabel).join(" vs ")}`
        );
      }
      clearParams();
      textareaRef.current?.focus();
    })();
  }, [searchParams, listLoading, docs, router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, status]);

  async function openConversation(id: string) {
    setError(null);
    setActiveId(id);
    setStatus("Memuat percakapan…");
    const res = await fetch(`/api/chat/conversations/${id}`);
    setStatus(null);
    if (!res.ok) {
      setError("Gagal memuat percakapan");
      return;
    }
    const data = await res.json();
    setMessages(data.messages ?? []);
    setPinned([]);
    setLastFocusIds([]);
    setPreviewId(null);
    const msgs = (data.messages ?? []) as UiMessage[];
    const lastWithCitations = [...msgs]
      .reverse()
      .find((m) => m.role === "assistant" && (m.citations?.length ?? 0) > 0);
    setRailDocs(
      (lastWithCitations?.citations ?? []).map((c) => ({
        ...c,
        usedInAnswer: true,
      }))
    );
    if (lastWithCitations?.citations?.[0]) {
      setPreviewId(lastWithCitations.citations[0].id);
      setRailOpen(true);
    }
    try {
      setScope(JSON.parse(data.scope || '{"mode":"all"}'));
    } catch {
      setScope({ mode: "all" });
    }
  }

  function startNewChat() {
    setError(null);
    setActiveId(null);
    setMessages([]);
    setPinned([]);
    setLastFocusIds([]);
    setPreviewId(null);
    setRailDocs([]);
    textareaRef.current?.focus();
  }

  async function deleteConversation(id: string) {
    if (!confirm("Hapus percakapan ini?")) return;
    await fetch(`/api/chat/conversations/${id}`, { method: "DELETE" });
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
      setPreviewId(null);
      setRailDocs([]);
    }
    await loadConversations();
  }

  async function saveRename(id: string) {
    const title = renameValue.trim();
    setRenamingId(null);
    if (!title) return;
    await fetch(`/api/chat/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    await loadConversations();
  }

  async function persistScope(next: ChatScope) {
    setScope(next);
    if (!activeId) return;
    await fetch(`/api/chat/conversations/${activeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: next }),
    });
  }

  function pinDoc(doc: ContextDoc) {
    setPinned((prev) =>
      prev.some((p) => p.id === doc.id) || prev.length >= 5
        ? prev
        : [...prev, doc]
    );
    setMentionOpen(false);
    setMentionQuery("");
  }

  function unpinDoc(id: number) {
    setPinned((prev) => prev.filter((p) => p.id !== id));
  }

  const syncTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxPx = Math.min(window.innerHeight * 0.4, 240);
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
  }, []);

  useEffect(() => {
    syncTextareaHeight();
  }, [question, syncTextareaHeight]);

  function onQuestionChange(value: string) {
    setQuestion(value);
    const at = value.lastIndexOf("@");
    if (at < 0) {
      setMentionOpen(false);
      setMentionQuery("");
      return;
    }
    const after = value.slice(at + 1);
    if (after.includes("\n")) {
      setMentionOpen(false);
      setMentionQuery("");
      return;
    }
    setMentionOpen(true);
    setMentionQuery(after);
  }

  function insertMention(doc: ContextDoc) {
    const at = question.lastIndexOf("@");
    const next =
      at >= 0 ? question.slice(0, at).trimEnd() : question.trimEnd();
    setQuestion(next ? `${next} ` : "");
    pinDoc(doc);
    textareaRef.current?.focus();
  }

  function runComparePinned() {
    if (pinned.length < 2) {
      setError("Pin minimal 2 dokumen dengan @ lalu bandingkan.");
      return;
    }
    const a = pinned[0];
    const b = pinned[1];
    const topic = question.trim() || "isi dan poin pentingnya";
    sendQuestion(
      `Bandingkan kedua dokumen berikut terkait ${topic}. Jelaskan persamaan, perbedaan, dan kesimpulan singkat.\n1) ${docLabel(a)}\n2) ${docLabel(b)}`,
      [a.id, b.id]
    );
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setStatus(null);
  }

  function openSources(id?: number) {
    if (id != null) setPreviewId(id);
    setRailOpen(true);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      setMobileSourcesOpen(true);
    }
  }

  async function sendQuestion(q: string, focusOverride?: number[]) {
    const text = q.trim();
    if (!text || loading) return;

    const focusDocIds =
      focusOverride ??
      (pinned.length > 0
        ? pinned.map((p) => p.id)
        : lastFocusIds.length > 0
          ? lastFocusIds
          : undefined);

    setQuestion("");
    setError(null);
    setMentionOpen(false);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    setStatus("Mencari dokumen…");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          question: text,
          conversationId: activeId,
          scope,
          focusDocIds,
          stream: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Gagal mengirim pertanyaan");
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", streaming: true },
      ]);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let citations: ChatCitation[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith("data:")) continue;
          const payload = JSON.parse(line.slice(5).trim()) as {
            type: string;
            content?: string;
            conversationId?: string;
            citations?: ChatCitation[];
            error?: string;
            messageId?: string;
          };

          if (payload.type === "meta" && payload.conversationId) {
            setActiveId(payload.conversationId);
          }
          if (payload.type === "reading" && payload.citations) {
            citations = payload.citations;
            if (citations.length > 0) {
              setLastFocusIds(citations.map((c) => c.id));
              setRailDocs(
                citations.map((c) => ({ ...c, usedInAnswer: false }))
              );
              setPreviewId(citations[0].id);
              setRailOpen(true);
              const names = citations.map((c) => citationLabel(c));
              setStatus(
                names.length === 1
                  ? `Membaca: ${names[0]}`
                  : `Membaca ${names.length} dokumen…`
              );
            } else {
              setStatus("Menulis jawaban…");
            }
          }
          if (payload.type === "token" && payload.content) {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "assistant") {
                next[next.length - 1] = {
                  ...last,
                  content: last.content + payload.content!,
                  streaming: true,
                };
              }
              return next;
            });
            if (citations.length > 0) {
              setStatus(
                citations.length === 1
                  ? `Menulis dari: ${citationLabel(citations[0])}`
                  : `Menulis dari ${citations.length} dokumen…`
              );
            } else {
              setStatus("Menulis jawaban…");
            }
          }
          if (payload.type === "citations" && payload.citations) {
            const used = payload.citations;
            citations = used;
            const usedIds = new Set(used.map((c) => c.id));
            setRailDocs((prev) => {
              const byId = new Map<number, RailDoc>();
              for (const c of prev) byId.set(c.id, { ...c, usedInAnswer: false });
              for (const c of used) {
                byId.set(c.id, { ...c, usedInAnswer: true });
              }
              // Used docs first, then other candidates
              const usedList = used.map((c) => byId.get(c.id)!);
              const rest = [...byId.values()].filter((c) => !usedIds.has(c.id));
              return [...usedList, ...rest];
            });
            if (used[0]) {
              setLastFocusIds(used.map((c) => c.id));
              setPreviewId(used[0].id);
              setRailOpen(true);
            } else if (citations.length === 0) {
              // keep candidate rail from reading phase
              setRailOpen(true);
            }
          }
          if (payload.type === "done") {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "assistant") {
                next[next.length - 1] = {
                  ...last,
                  id: payload.messageId,
                  citations,
                  streaming: false,
                };
              }
              return next;
            });
          }
          if (payload.type === "error") {
            throw new Error(payload.error ?? "Stream error");
          }
        }
      }

      await loadConversations();
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && last.streaming) {
            next[next.length - 1] = {
              ...last,
              content: last.content || "(Dihentikan)",
              streaming: false,
            };
          }
          return next;
        });
      } else {
        const msg = err instanceof Error ? err.message : "Terjadi kesalahan";
        setError(msg);
        setMessages((prev) => [...prev, { role: "assistant", content: msg }]);
      }
    } finally {
      setLoading(false);
      setStatus(null);
      abortRef.current = null;
      textareaRef.current?.focus();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionOpen && mentionMatches.length > 0 && e.key === "Enter") {
      e.preventDefault();
      insertMention(mentionMatches[0]);
      return;
    }
    if (e.key === "Escape") {
      setMentionOpen(false);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendQuestion(question);
    }
  }

  const emptyLibrary = documentCount === 0;
  const showDesktopRail =
    railOpen && (panelDocs.length > 0 || previewId != null);
  const activeTitle =
    conversations.find((c) => c.id === activeId)?.title ?? "Percakapan baru";

  return (
    <div className="flex min-h-0 w-full flex-1 bg-[var(--auth-paper)]">
      {/* Threads */}
      <aside
        className={cn(
          "flex shrink-0 flex-col border-r border-[var(--auth-ink)]/[0.08] bg-white/70 backdrop-blur-sm transition-[width] duration-200",
          sidebarOpen ? "w-[280px]" : "w-0 overflow-hidden border-r-0"
        )}
      >
        <div className="space-y-2 px-3 pb-2 pt-4">
          <button
            type="button"
            onClick={startNewChat}
            className="group flex w-full items-center gap-2 py-2 text-left text-[13px] font-semibold text-[var(--auth-teal)] transition hover:text-[var(--auth-teal-deep)]"
          >
            <MessageSquarePlus
              size={16}
              className="transition group-hover:translate-x-0.5"
            />
            Chat baru
          </button>
          <div className="flex items-center gap-2 border-b border-[var(--auth-ink)]/15 pb-1.5">
            <Search size={13} className="shrink-0 text-[var(--auth-ink)]/30" />
            <input
              value={threadSearch}
              onChange={(e) => setThreadSearch(e.target.value)}
              placeholder="Cari riwayat…"
              className="w-full bg-transparent text-xs outline-none placeholder:text-[var(--auth-ink)]/30"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {listLoading && (
            <p className="px-3 py-4 text-xs text-[var(--auth-ink)]/35">
              Memuat…
            </p>
          )}
          {!listLoading && conversations.length === 0 && (
            <p className="px-3 py-4 text-xs leading-relaxed text-[var(--auth-ink)]/35">
              Belum ada riwayat. Mulai pertanyaan di sebelah kanan.
            </p>
          )}
          {!listLoading &&
            filteredConversations.length === 0 &&
            conversations.length > 0 && (
              <p className="px-3 py-4 text-xs text-[var(--auth-ink)]/35">
                Tidak ada yang cocok.
              </p>
            )}
          {filteredConversations.map((group) => (
            <div key={group.label} className="mb-3">
              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--auth-ink)]/30">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((c) => (
                  <li key={c.id} className="group relative">
                    {renamingId === c.id ? (
                      <form
                        className="px-2 py-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          saveRename(c.id);
                        }}
                      >
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => saveRename(c.id)}
                          className="w-full border-b border-[var(--auth-teal)] bg-transparent px-1 py-1.5 text-[13px] outline-none"
                        />
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => openConversation(c.id)}
                          className={cn(
                            "w-full truncate rounded-sm px-3 py-2 pr-16 text-left text-[13px] transition",
                            activeId === c.id
                              ? "bg-[var(--auth-teal)]/[0.08] font-medium text-[var(--auth-teal-deep)]"
                              : "text-[var(--auth-ink)]/55 hover:bg-[var(--auth-ink)]/[0.03] hover:text-[var(--auth-ink)]"
                          )}
                          title={c.title}
                        >
                          {c.title}
                        </button>
                        <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 group-hover:flex">
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingId(c.id);
                              setRenameValue(c.title);
                            }}
                            className="p-1.5 text-[var(--auth-ink)]/25 hover:text-[var(--auth-teal)]"
                            aria-label="Ganti nama"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteConversation(c.id)}
                            className="p-1.5 text-[var(--auth-ink)]/25 hover:text-red-600"
                            aria-label="Hapus chat"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </aside>

      {/* Main */}
      <section className="relative flex min-w-0 flex-1 flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% -10%, rgb(11 110 99 / 0.07), transparent 55%)",
          }}
        />

        <header className="relative z-[1] flex items-center gap-3 px-5 py-3 lg:px-8">
          <button
            type="button"
            onClick={() => setSidebarOpen((o) => !o)}
            className="p-1.5 text-[var(--auth-ink)]/40 transition hover:text-[var(--auth-ink)]"
            aria-label="Toggle sidebar"
          >
            {sidebarOpen ? (
              <PanelLeftClose size={18} />
            ) : (
              <PanelLeft size={18} />
            )}
          </button>
          <div className="min-w-0 flex-1">
            <p className="auth-display text-[15px] font-bold tracking-tight text-[var(--auth-ink)]">
              Ask AI
            </p>
            <p className="truncate text-[11px] text-[var(--auth-ink)]/40">
              {activeTitle}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (panelDocs.length === 0 && previewId == null) return;
              openSources();
              setRailOpen((v) => !v);
              setMobileSourcesOpen((v) => !v);
            }}
            className={cn(
              "text-[11px] font-semibold uppercase tracking-[0.14em] transition",
              showDesktopRail || mobileSourcesOpen
                ? "text-[var(--auth-teal)]"
                : "text-[var(--auth-ink)]/35 hover:text-[var(--auth-ink)]"
            )}
          >
            Sumber
          </button>
        </header>

        {emptyLibrary && (
          <div className="relative z-[1] mx-5 mb-2 flex flex-wrap items-center justify-between gap-3 border-y border-[var(--auth-ink)]/[0.06] py-4 lg:mx-8">
            <p className="text-sm text-[var(--auth-ink)]/55">
              Belum ada dokumen ter-index. Ambil PDF lewat Library dulu.
            </p>
            <Link
              href="/cloud"
              className="inline-flex items-center gap-2 text-[12px] font-bold uppercase tracking-wider text-[var(--auth-teal)] hover:text-[var(--auth-teal-deep)]"
            >
              Buka Library
              <ArrowRight size={13} />
            </Link>
          </div>
        )}

        {error && (
          <div className="relative z-[1] mx-5 mb-2 py-2 text-sm text-red-700 lg:mx-8">
            {error}
          </div>
        )}

        <div className="relative z-[1] min-h-0 flex-1 overflow-y-auto px-5 py-6 lg:px-8">
          {messages.length === 0 && (
            <div className="mx-auto flex max-w-xl flex-col py-10">
              <p className="auth-display text-[clamp(2.75rem,7vw,4.25rem)] font-bold leading-[0.9] tracking-[-0.045em] text-[var(--auth-ink)]">
                Ask <span className="text-[var(--auth-teal)]">AI</span>
              </p>
              <p className="mt-5 max-w-md text-[15px] leading-relaxed text-[var(--auth-ink)]/50">
                Tanya arsip Cloud Bappenas yang sudah di-OCR. Pin dengan{" "}
                <span className="font-semibold text-[var(--auth-ink)]">@</span>
                , bandingkan dua file yang di-pin.
              </p>

              {!emptyLibrary && suggestions.length > 0 && (
                <ul className="mt-12 space-y-0">
                  {suggestions.map((s, i) => (
                    <li
                      key={`${s.id}-${i}`}
                      className="border-t border-[var(--auth-ink)]/[0.08] last:border-b"
                    >
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => sendQuestion(s.text, [s.id])}
                        className="group flex w-full items-start justify-between gap-4 py-3.5 text-left transition hover:pl-1"
                      >
                        <span className="min-w-0 flex-1 break-words text-[14px] leading-snug text-[var(--auth-ink)]/70 group-hover:text-[var(--auth-teal)]">
                          {s.text}
                        </span>
                        <ArrowRight
                          size={14}
                          className="mt-0.5 shrink-0 text-[var(--auth-ink)]/20 transition group-hover:translate-x-0.5 group-hover:text-[var(--auth-teal)]"
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mx-auto max-w-2xl space-y-8">
            {messages.map((msg, i) => (
              <div
                key={msg.id ?? `m-${i}`}
                className={cn("auth-enter", msg.role === "user" && "pl-6")}
              >
                <p
                  className={cn(
                    "mb-2 text-[10px] font-semibold uppercase tracking-[0.18em]",
                    msg.role === "user"
                      ? "text-[var(--auth-teal)]"
                      : "text-[var(--auth-ink)]/30"
                  )}
                >
                  {msg.role === "user" ? "Anda" : "Ask AI"}
                </p>
                <div>
                  {msg.role === "user" ? (
                    <p className="whitespace-pre-wrap text-[15px] font-medium leading-[1.7] text-[var(--auth-ink)]">
                      {msg.content}
                    </p>
                  ) : (
                    <div className="relative">
                      <SafeMarkdown text={msg.content || (msg.streaming ? "…" : "")} />
                      {msg.streaming && (
                        <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-[var(--auth-teal)] align-middle" />
                      )}
                    </div>
                  )}

                  {msg.role === "assistant" &&
                    !msg.streaming &&
                    msg.content && (
                      <div className="mt-3 flex flex-wrap items-center gap-4">
                        <CopyButton text={msg.content} />
                        <FeedbackButtons
                          messageId={msg.id}
                          conversationId={activeId}
                        />
                      </div>
                    )}

                  {msg.citations && msg.citations.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {msg.citations.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => openSourcePreview(c.id)}
                          className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-[var(--auth-teal)]/10 px-2 py-1 text-[12px] font-medium text-[var(--auth-teal-deep)] hover:bg-[var(--auth-teal)]/15"
                        >
                          <Eye size={12} className="shrink-0 opacity-70" />
                          <span className="truncate">{citationLabel(c)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {msg.role === "assistant" &&
                  !msg.streaming &&
                  i === messages.length - 1 &&
                  !loading && (
                    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
                      {FOLLOW_UPS.map((f) => (
                        <button
                          key={f}
                          type="button"
                          onClick={() => sendQuestion(f)}
                          className="text-[12px] text-[var(--auth-ink)]/40 transition hover:text-[var(--auth-teal)]"
                        >
                          {f}
                        </button>
                      ))}
                    </div>
                  )}
              </div>
            ))}

            {loading && status && (
              <p className="flex items-center gap-2 text-sm text-[var(--auth-ink)]/40">
                <Loader2
                  size={14}
                  className="animate-spin text-[var(--auth-teal)]"
                />
                {status}
              </p>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="relative z-[1] px-5 pb-5 pt-2 lg:px-8">
          {mentionOpen && (
            <div className="absolute bottom-full left-5 right-5 z-20 mb-1 max-h-56 overflow-y-auto border-t border-[var(--auth-ink)]/[0.08] bg-white/95 backdrop-blur-md lg:left-8 lg:right-8">
              {mentionMatches.length === 0 ? (
                <p className="px-2 py-3 text-sm text-[var(--auth-ink)]/40">
                  {mentionLoading
                    ? "Mencari dokumen…"
                    : mentionQuery.trim()
                      ? `Tidak ada dokumen cocok untuk "${mentionQuery.trim()}"`
                      : "Ketik nama file untuk memfilter"}
                </p>
              ) : (
                mentionMatches.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => insertMention(d)}
                    className="flex w-full items-start gap-2 border-b border-[var(--auth-ink)]/[0.05] px-1 py-2.5 text-left text-sm hover:bg-[var(--auth-paper)]"
                  >
                    <AtSign
                      size={14}
                      className="mt-0.5 shrink-0 text-[var(--auth-teal)]"
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {docLabel(d)}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--auth-ink)]/35">
                        {d.remotePath}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {pinned.length > 0 && (
            <div className="mb-3 flex w-full flex-wrap items-center gap-x-3 gap-y-2">
              {pinned.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex max-w-full items-center gap-1.5 text-[12px] font-medium text-[var(--auth-teal-deep)]"
                >
                  <AtSign size={11} />
                  <button
                    type="button"
                    onClick={() => openSourcePreview(p.id)}
                    className="truncate text-left text-[var(--auth-teal-deep)] hover:underline"
                  >
                    {docLabel(p)}
                  </button>
                  <button
                    type="button"
                    onClick={() => unpinDoc(p.id)}
                    className="p-0.5 text-[var(--auth-ink)]/30 hover:text-[var(--auth-ink)]"
                    aria-label="Unpin"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
              {pinned.length >= 2 && (
                <button
                  type="button"
                  onClick={runComparePinned}
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--auth-teal)] hover:text-[var(--auth-teal-deep)] disabled:opacity-40"
                >
                  <GitCompare size={13} />
                  Bandingkan yang di-pin
                </button>
              )}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendQuestion(question);
            }}
            className="flex w-full items-end gap-2 rounded-2xl border border-[var(--auth-ink)]/12 bg-white/85 px-3.5 py-3 shadow-[0_1px_0_rgb(11_110_99/0.05)] ring-1 ring-black/[0.02] transition focus-within:border-[var(--auth-teal)]/45 focus-within:shadow-[0_0_0_3px_rgb(11_110_99/0.08)]"
          >
            <textarea
              ref={textareaRef}
              value={question}
              onChange={(e) => onQuestionChange(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              placeholder="Tanya arsip… ketik @ untuk pin dokumen"
              disabled={loading || emptyLibrary}
              className="max-h-[min(40vh,240px)] min-h-[64px] flex-1 resize-none overflow-y-auto bg-transparent py-1.5 text-[15px] leading-relaxed outline-none placeholder:text-[var(--auth-ink)]/30 disabled:opacity-50"
            />
            {loading ? (
              <button
                type="button"
                onClick={stop}
                className="mb-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--auth-ink)]/50 transition hover:bg-[var(--auth-ink)]/[0.05] hover:text-[var(--auth-ink)]"
                aria-label="Stop"
              >
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!question.trim() || emptyLibrary}
                className="mb-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--auth-teal)] text-white transition hover:bg-[var(--auth-teal-deep)] disabled:bg-[var(--auth-ink)]/10 disabled:text-[var(--auth-ink)]/30"
                aria-label="Kirim"
              >
                <Send size={16} />
              </button>
            )}
          </form>

          {/* Scope chips near composer */}
          <div className="mt-3 flex w-full flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--auth-ink)]/30">
              Mencari di
            </span>
            <button
              type="button"
              onClick={() => persistScope({ mode: "all" })}
              className={cn(
                "text-[12px] transition",
                scope.mode === "all"
                  ? "font-semibold text-[var(--auth-teal)]"
                  : "text-[var(--auth-ink)]/40 hover:text-[var(--auth-ink)]"
              )}
            >
              Semua arsip saya
            </button>
            <span className="text-[var(--auth-ink)]/20">·</span>
            <button
              type="button"
              onClick={() =>
                persistScope({
                  mode: "docs",
                  docIds: docs.slice(0, 5).map((d) => d.id),
                })
              }
              className={cn(
                "text-[12px] transition",
                scope.mode === "docs"
                  ? "font-semibold text-[var(--auth-teal)]"
                  : "text-[var(--auth-ink)]/40 hover:text-[var(--auth-ink)]"
              )}
            >
              5 terbaru
            </button>
            {folders[0] && (
              <>
                <span className="text-[var(--auth-ink)]/20">·</span>
                <select
                  className={cn(
                    "max-w-[220px] truncate border-0 bg-transparent py-0 text-[12px] outline-none",
                    scope.mode === "folder"
                      ? "font-semibold text-[var(--auth-teal)]"
                      : "text-[var(--auth-ink)]/40"
                  )}
                  value={
                    scope.mode === "folder" ? scope.pathPrefix : ""
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) persistScope({ mode: "all" });
                    else persistScope({ mode: "folder", pathPrefix: v });
                  }}
                  aria-label="Scope folder"
                >
                  <option value="">Folder ini…</option>
                  {folders.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </>
            )}
            <span className="ml-auto hidden text-[10px] text-[var(--auth-ink)]/30 sm:inline">
              {scopeLabel}
            </span>
          </div>
          <p className="mt-2 w-full text-center text-[10px] text-[var(--auth-ink)]/30">
            Enter kirim · Shift+Enter baris baru · @ pin · pin 2 file lalu
            Bandingkan
          </p>
        </div>
      </section>

      {/* Desktop sources rail */}
      {showDesktopRail && (
        <aside className="hidden w-[min(100%,340px)] shrink-0 flex-col border-l border-[var(--auth-ink)]/[0.08] bg-white/60 backdrop-blur-sm lg:flex">
          <SourcesPanel
            docs={panelDocs}
            previewId={previewId}
            onSelect={setPreviewId}
            onClose={() => setRailOpen(false)}
          />
        </aside>
      )}

      {/* Mobile sources sheet */}
      {mobileSourcesOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-[var(--auth-ink)]/30"
            aria-label="Tutup"
            onClick={() => setMobileSourcesOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 flex h-[78vh] flex-col rounded-t-2xl bg-white shadow-xl">
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-[var(--auth-ink)]/15" />
            <SourcesPanel
              docs={panelDocs}
              previewId={previewId}
              onSelect={setPreviewId}
              onClose={() => setMobileSourcesOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
