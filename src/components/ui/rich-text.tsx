"use client";

import { Bold, Italic, List, Underline } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

type RichTextTextareaProps = {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
};

const ALLOWED_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "UL", "OL", "LI", "P", "DIV", "BR"]);
const HTML_TOKEN_PATTERN = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function markdownToHtml(value: string) {
  const lines = value.split(/\r?\n/);
  const html: string[] = [];
  let listItems: string[] = [];

  function flushList() {
    if (!listItems.length) return;
    html.push(`<ul>${listItems.map((item) => `<li>${item}</li>`).join("")}</ul>`);
    listItems = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    const formatted = escapeHtml(bulletMatch?.[1] ?? trimmed)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<u>$1</u>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");

    if (bulletMatch) {
      listItems.push(formatted);
      continue;
    }

    flushList();

    if (formatted) {
      html.push(`<p>${formatted}</p>`);
    }
  }

  flushList();
  return html.join("");
}

function sanitizeHtml(value: string) {
  if (!value.trim()) {
    return "";
  }

  let sanitized = "";
  let lastIndex = 0;

  for (const match of value.matchAll(HTML_TOKEN_PATTERN)) {
    sanitized += escapeHtml(value.slice(lastIndex, match.index));
    lastIndex = (match.index ?? 0) + match[0].length;

    const rawTagName = match[1].toUpperCase();
    if (!ALLOWED_TAGS.has(rawTagName)) {
      continue;
    }

    const isClosingTag = match[0].startsWith("</");
    if (rawTagName === "BR") {
      if (!isClosingTag) {
        sanitized += "<br>";
      }
      continue;
    }

    const tagName =
      rawTagName === "B" || rawTagName === "STRONG"
        ? "strong"
        : rawTagName === "I" || rawTagName === "EM"
          ? "em"
          : rawTagName === "DIV"
            ? "p"
            : rawTagName.toLowerCase();

    sanitized += isClosingTag ? `</${tagName}>` : `<${tagName}>`;
  }

  sanitized += escapeHtml(value.slice(lastIndex));

  return sanitized.replace(/<p>\s*(?:<br>)?\s*<\/p>/g, "").trim();
}

function normalizeStoredValue(value: string | null | undefined) {
  const raw = value ?? "";
  if (/<\/?[a-z][\s\S]*>/i.test(raw)) {
    return sanitizeHtml(raw);
  }

  return markdownToHtml(raw);
}

export function richTextToPlainText(value: string | null | undefined) {
  const raw = value ?? "";
  if (!raw.trim()) {
    return "";
  }

  return raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6])>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function RichTextDisplay({
  value,
  fallback = "Sin contenido.",
  className,
}: {
  value?: string | null;
  fallback?: string;
  className?: string;
}) {
  const html = normalizeStoredValue(value);

  if (!html) {
    return <p className={cn("text-sm leading-6 text-slate-500", className)}>{fallback}</p>;
  }

  return (
    <div
      className={cn(
        "rich-text-content space-y-2 text-sm leading-6 text-slate-700 [&_em]:italic [&_li]:ml-5 [&_li]:list-disc [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:m-0 [&_strong]:font-bold [&_u]:underline [&_u]:decoration-2 [&_u]:underline-offset-2 [&_ul]:list-disc [&_ul]:pl-5",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export function RichTextTextarea({
  value,
  onChange,
  rows = 4,
  placeholder,
  className,
}: RichTextTextareaProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastRenderedValueRef = useRef("");
  const minHeight = Math.max(112, rows * 32);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const normalizedValue = normalizeStoredValue(value);
    if (lastRenderedValueRef.current === normalizedValue) {
      return;
    }

    editor.innerHTML = normalizedValue;
    lastRenderedValueRef.current = normalizedValue;
  }, [value]);

  function emitChange() {
    const editor = editorRef.current;
    if (!editor) return;

    const nextValue = sanitizeHtml(editor.innerHTML);
    lastRenderedValueRef.current = nextValue;
    onChange(nextValue);
  }

  function applyCommand(command: "bold" | "italic" | "underline" | "insertUnorderedList") {
    editorRef.current?.focus();
    document.execCommand(command, false);
    emitChange();
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[color-mix(in_oklab,var(--accent)_20%,white)]">
      <div className="flex flex-wrap gap-1 border-b border-slate-100 bg-slate-50 px-2 py-1.5">
        <button type="button" onClick={() => applyCommand("bold")} className="rounded-md px-2 py-1 text-slate-600 transition hover:bg-white hover:text-slate-900" aria-label="Aplicar negrita">
          <Bold className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => applyCommand("underline")} className="rounded-md px-2 py-1 text-slate-600 transition hover:bg-white hover:text-slate-900" aria-label="Aplicar subrayado">
          <Underline className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => applyCommand("italic")} className="rounded-md px-2 py-1 text-slate-600 transition hover:bg-white hover:text-slate-900" aria-label="Aplicar cursiva">
          <Italic className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => applyCommand("insertUnorderedList")} className="rounded-md px-2 py-1 text-slate-600 transition hover:bg-white hover:text-slate-900" aria-label="Crear bullets">
          <List className="h-4 w-4" />
        </button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={emitChange}
        onBlur={emitChange}
        className={cn(
          "min-h-[112px] w-full overflow-y-auto px-3 py-2.5 text-sm leading-6 text-slate-900 outline-none empty:before:pointer-events-none empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)] [&_em]:italic [&_li]:ml-5 [&_li]:list-disc [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:m-0 [&_strong]:font-bold [&_u]:underline [&_u]:decoration-2 [&_u]:underline-offset-2 [&_ul]:list-disc [&_ul]:pl-5",
          className,
        )}
        style={{ minHeight }}
      />
    </div>
  );
}
