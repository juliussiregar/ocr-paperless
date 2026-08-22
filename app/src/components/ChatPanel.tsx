"use client";

import { useState, useRef, useEffect } from "react";
import {
  Send,
  Bot,
  User,
  Download,
  Sparkles,
  Copy,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TypingDots } from "@/components/ui/TypingDots";

interface Message {
  role: "user" | "assistant";
  content: string;
  citations?: Array<{ id: number; title: string; fileName: string }>;
}

const SUGGESTIONS = [
  "Apa isi laporan anggaran terbaru?",
  "Cari dokumen tentang RKP 2024",
  "Ringkas isi nota dinas terkait infrastruktur",
  "Ada dokumen tentang evaluasi kinerja?",
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="mt-2 flex items-center gap-1 text-[11px] text-slate-400 transition hover:text-slate-600"
      title="Salin jawaban"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? "Tersalin" : "Salin"}
    </button>
  );
}

export function ChatPanel() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function sendQuestion(q: string) {
    if (!q.trim() || loading) return;

    setQuestion("");
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.error ?? "Terjadi kesalahan" },
        ]);
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer,
          citations: data.citations,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Gagal menghubungi server." },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendQuestion(question);
  }

  return (
    <div className="flex h-[min(520px,60vh)] flex-col sm:h-[520px]">
      <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain pr-1">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500/15 to-blue-500/10 ring-1 ring-teal-500/10">
              <Sparkles className="text-teal-600" size={28} />
            </div>
            <p className="text-sm font-semibold text-slate-700">
              Tanya apapun tentang dokumen
            </p>
            <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-slate-500">
              AI membaca isi arsip dan menampilkan sumber rujukannya
            </p>
            <div className="mt-6 flex w-full max-w-md flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => sendQuestion(s)}
                  className={cn(
                    "animate-fade-in rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-xs text-slate-600 transition hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 hover:shadow-sm sm:text-center",
                    `stagger-${i + 1}`
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              "flex gap-2.5 animate-fade-in sm:gap-3",
              msg.role === "user" ? "flex-row-reverse" : "flex-row"
            )}
          >
            <div
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg sm:h-8 sm:w-8 sm:rounded-xl",
                msg.role === "user"
                  ? "bg-slate-800 text-white"
                  : "bg-gradient-to-br from-teal-500 to-teal-600 text-white shadow-sm"
              )}
            >
              {msg.role === "user" ? <User size={13} /> : <Bot size={13} />}
            </div>
            <div
              className={cn(
                "max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed sm:max-w-[85%] sm:px-4 sm:py-3",
                msg.role === "user"
                  ? "rounded-tr-sm bg-slate-800 text-white"
                  : "rounded-tl-sm border border-slate-100 bg-white text-slate-800 shadow-sm"
              )}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
              {msg.role === "assistant" && (
                <CopyButton text={msg.content} />
              )}
              {msg.citations && msg.citations.length > 0 && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Sumber dokumen
                  </p>
                  <ul className="space-y-1.5">
                    {msg.citations.map((c) => (
                      <li key={c.id}>
                        <a
                          href={`/api/documents/${c.id}/download`}
                          className="flex items-center gap-1.5 text-xs font-medium text-teal-700 transition hover:text-teal-900 hover:underline"
                        >
                          <Download size={11} />
                          <span className="truncate">{c.title || c.fileName}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2.5 animate-fade-in sm:gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-teal-600 text-white sm:h-8 sm:w-8 sm:rounded-xl">
              <Bot size={13} />
            </div>
            <div className="flex items-center gap-2.5 rounded-2xl rounded-tl-sm border border-slate-100 bg-white px-4 py-3 shadow-sm">
              <TypingDots />
              <span className="text-sm text-slate-500">Membaca dokumen</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="mt-3 flex gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm transition focus-within:border-teal-400 focus-within:ring-2 focus-within:ring-teal-500/10 sm:mt-4"
      >
        <input
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Tanya tentang isi dokumen..."
          className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-slate-400"
          disabled={loading}
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="btn btn-primary shrink-0 !rounded-lg !px-3 !py-2"
          aria-label="Kirim pertanyaan"
        >
          <Send size={16} />
        </button>
      </form>
      <p className="mt-1.5 hidden text-center text-[10px] text-slate-400 sm:block">
        Enter untuk kirim · AI merujuk ke dokumen yang sudah ter-index
      </p>
    </div>
  );
}
