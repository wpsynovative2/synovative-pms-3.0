"use client";

import { useEffect, useRef } from "react";
import { cx } from "./primitives";

/**
 * Lightweight rich text. The PRD asks for rich text on descriptions and
 * remarks; this keeps the surface small — bold, italic, lists and links —
 * and sanitises to an allowlist on both write and read.
 */

const ALLOWED_TAGS = new Set([
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "BR",
  "P",
  "DIV",
  "UL",
  "OL",
  "LI",
  "A",
  "SPAN",
]);

/** Strips every tag outside the allowlist and every attribute except safe hrefs. */
export function sanitizeHtml(html: string): string {
  if (typeof window === "undefined") return html.replace(/<[^>]*>/g, "");
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return "";

  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (!ALLOWED_TAGS.has(child.tagName)) {
        // Keep the text, drop the wrapper.
        const text = doc.createTextNode(child.textContent ?? "");
        child.replaceWith(text);
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const keepHref =
          child.tagName === "A" &&
          attr.name === "href" &&
          /^https?:\/\//i.test(attr.value);
        if (!keepHref) child.removeAttribute(attr.name);
      }
      if (child.tagName === "A") {
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noopener noreferrer");
      }
      walk(child);
    }
  };
  walk(root);
  return root.innerHTML;
}

export function isRichTextEmpty(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length === 0;
}

const PROSE =
  "[&_a]:text-brand-bright [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal " +
  "[&_ol]:pl-5 [&_li]:my-0.5 [&_p]:my-1 [&_strong]:text-ink [&_b]:text-ink";

/** Read-only renderer for stored rich text. */
export function RichText({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  if (isRichTextEmpty(html)) return null;
  return (
    <div
      className={cx("text-[13px] leading-relaxed text-ink-muted", PROSE, className)}
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
    />
  );
}

interface ToolButton {
  label: string;
  command: string;
  value?: string;
  glyph: React.ReactNode;
}

const TOOLS: ToolButton[] = [
  { label: "Bold", command: "bold", glyph: <span className="font-bold">B</span> },
  { label: "Italic", command: "italic", glyph: <span className="italic">I</span> },
  {
    label: "Underline",
    command: "underline",
    glyph: <span className="underline">U</span>,
  },
  {
    label: "Bulleted list",
    command: "insertUnorderedList",
    glyph: <span>&bull;&#8212;</span>,
  },
  {
    label: "Numbered list",
    command: "insertOrderedList",
    glyph: <span>1.</span>,
  },
];

export function RichTextEditor({
  value,
  onChange,
  placeholder = "Write something…",
  minHeight = 96,
  disabled,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Only push external values in when they diverge, so the caret never jumps.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value;
    }
  }, [value]);

  const run = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    if (ref.current) onChange(sanitizeHtml(ref.current.innerHTML));
  };

  const empty = isRichTextEmpty(value);

  return (
    <div
      className={cx(
        "rounded-[10px] border border-line bg-surface-2 transition-colors focus-within:border-brand-bright focus-within:ring-2 focus-within:ring-brand-bright/25",
        disabled && "opacity-50",
      )}
    >
      {!disabled ? (
        <div className="flex items-center gap-0.5 border-b border-line-soft px-1.5 py-1.5">
          {TOOLS.map((t) => (
            <button
              key={t.command}
              type="button"
              title={t.label}
              aria-label={t.label}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(t.command)}
              className="inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-[12px] text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
            >
              {t.glyph}
            </button>
          ))}
          <button
            type="button"
            title="Insert link"
            aria-label="Insert link"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const url = window.prompt("Link URL (https://…)");
              if (url && /^https?:\/\//i.test(url)) run("createLink", url);
            }}
            className="inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-[12px] text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
          >
            🔗
          </button>
        </div>
      ) : null}

      <div className="relative">
        {empty ? (
          <span className="pointer-events-none absolute top-2.5 left-3 text-[13px] text-ink-faint">
            {placeholder}
          </span>
        ) : null}
        <div
          ref={ref}
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          style={{ minHeight }}
          onInput={(e) => onChange(sanitizeHtml(e.currentTarget.innerHTML))}
          onBlur={(e) => onChange(sanitizeHtml(e.currentTarget.innerHTML))}
          onPaste={(e) => {
            // Paste as plain text so foreign markup never enters the document.
            e.preventDefault();
            const text = e.clipboardData.getData("text/plain");
            document.execCommand("insertText", false, text);
          }}
          className={cx(
            "px-3 py-2.5 text-[13px] leading-relaxed text-ink outline-none",
            PROSE,
          )}
        />
      </div>
    </div>
  );
}
