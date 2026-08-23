"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Minimal safe markdown: headings, bold, italics, lists, paragraphs.
 * No raw HTML, links rendered as text only.
 */
export function SafeMarkdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const blocks = splitBlocks(text);

  return (
    <div
      className={cn(
        "space-y-2.5 text-[15px] leading-[1.7] text-[var(--auth-ink)]/80",
        className
      )}
    >
      {blocks.map((block, i) => {
        if (block.type === "ul") {
          return (
            <ul key={i} className="list-disc space-y-2 pl-5">
              {block.items.map((item, j) => (
                <li key={j} className="whitespace-pre-wrap pl-1">
                  {renderInline(item.text)}
                </li>
              ))}
            </ul>
          );
        }
        if (block.type === "ol") {
          return (
            <ol key={i} className="list-decimal space-y-3 pl-5">
              {block.items.map((item, j) => (
                <li
                  key={j}
                  value={item.n}
                  className="whitespace-pre-wrap pl-1 marker:font-semibold marker:text-[var(--auth-ink)]"
                >
                  {renderInline(item.text)}
                </li>
              ))}
            </ol>
          );
        }
        if (block.type === "h2") {
          return (
            <h2
              key={i}
              className="auth-display pt-1 text-base font-bold tracking-tight text-[var(--auth-ink)]"
            >
              {renderInline(block.text)}
            </h2>
          );
        }
        if (block.type === "h3") {
          return (
            <h3
              key={i}
              className="pt-0.5 text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--auth-teal-deep)]"
            >
              {renderInline(block.text)}
            </h3>
          );
        }
        if (block.type === "p") {
          return (
            <p key={i} className="whitespace-pre-wrap">
              {renderInline(block.text)}
            </p>
          );
        }
        return null;
      })}
    </div>
  );
}

type ListItem = { n: number; text: string };
type Block =
  | { type: "p" | "h2" | "h3"; text: string }
  | { type: "ul"; items: ListItem[] }
  | { type: "ol"; items: ListItem[] };

function isListInterrupt(line: string): boolean {
  return (
    /^#{1,3}\s+/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line)
  );
}

/** Absorb detail lines under a list item until the next marker/heading. */
function takeContinuations(lines: string[], start: number): {
  text: string;
  next: number;
} {
  let i = start;
  const parts: string[] = [];
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      // Allow one blank inside an item; stop if next block is unrelated
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j += 1;
      if (j >= lines.length || isListInterrupt(lines[j])) break;
      parts.push("");
      i += 1;
      continue;
    }
    if (isListInterrupt(line)) break;
    parts.push(line);
    i += 1;
  }
  return { text: parts.join("\n"), next: i };
}

function splitBlocks(raw: string): Block[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (/^###\s+/.test(line)) {
      out.push({ type: "h3", text: line.replace(/^###\s+/, "") });
      i += 1;
      continue;
    }
    if (/^##\s+/.test(line)) {
      out.push({ type: "h2", text: line.replace(/^##\s+/, "") });
      i += 1;
      continue;
    }
    if (/^#\s+/.test(line)) {
      out.push({ type: "h2", text: line.replace(/^#\s+/, "") });
      i += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: ListItem[] = [];
      let n = 1;
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const head = lines[i].replace(/^\s*[-*]\s+/, "");
        i += 1;
        const cont = takeContinuations(lines, i);
        const text = cont.text ? `${head}\n${cont.text}` : head;
        i = cont.next;
        items.push({ n: n++, text });
        while (i < lines.length && !lines[i].trim()) {
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j += 1;
          if (j < lines.length && /^\s*[-*]\s+/.test(lines[j])) {
            i = j;
            break;
          }
          break;
        }
      }
      out.push({ type: "ul", items });
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ListItem[] = [];
      while (i < lines.length && /^\s*(\d+)\.\s+/.test(lines[i])) {
        const m = lines[i].match(/^\s*(\d+)\.\s+(.*)$/);
        const n = Number(m?.[1] ?? items.length + 1);
        const head = m?.[2] ?? "";
        i += 1;
        const cont = takeContinuations(lines, i);
        const text = cont.text ? `${head}\n${cont.text}` : head;
        i = cont.next;
        items.push({ n, text });
        while (i < lines.length && !lines[i].trim()) {
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j += 1;
          if (j < lines.length && /^\s*\d+\.\s+/.test(lines[j])) {
            i = j;
            break;
          }
          break;
        }
      }
      out.push({ type: "ol", items });
      continue;
    }

    const paras: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isListInterrupt(lines[i]) &&
      !/^#{1,3}\s+/.test(lines[i])
    ) {
      paras.push(lines[i]);
      i += 1;
    }
    out.push({ type: "p", text: paras.join("\n") });
  }

  return out.length > 0 ? out : [{ type: "p", text: raw }];
}

function renderInline(text: string): ReactNode {
  const cleaned = text.replace(/<\/?[^>]+>/g, "");
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(cleaned)) !== null) {
    if (m.index > last) {
      parts.push(cleaned.slice(last, m.index));
    }
    const token = m[0];
    if (token.startsWith("**")) {
      parts.push(
        <strong key={key++} className="font-semibold text-[var(--auth-ink)]">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("`")) {
      parts.push(
        <code
          key={key++}
          className="rounded-sm bg-[var(--auth-ink)]/[0.06] px-1 py-0.5 text-[13px]"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else {
      parts.push(
        <em key={key++} className="italic">
          {token.slice(1, -1)}
        </em>
      );
    }
    last = m.index + token.length;
  }
  if (last < cleaned.length) parts.push(cleaned.slice(last));
  return parts.length > 0 ? parts : cleaned;
}
