"use client";

import { useEffect, useRef } from "react";
import { IconClose } from "./icons";
import { cx } from "./primitives";

/*
 * Page-scroll locking and Escape handling, shared by Modal and Drawer.
 *
 * Both used to keep their own `prev = document.body.style.overflow` and restore
 * it on close. That breaks as soon as overlays nest — a confirm dialog inside a
 * drawer, a task form inside that — because React runs *every* effect teardown
 * before *any* re-run. On a re-render with two overlays open the teardowns
 * restore "" then "hidden", and the outer overlay's re-run then reads "hidden"
 * back as its "original" value. Closing everything afterwards restored
 * "hidden", and the page could not be scrolled again until a reload.
 *
 * A single counted stack has no per-instance value to poison: the first
 * overlay saves the real overflow, the last one puts it back.
 */
const stack: symbol[] = [];
let savedOverflow = "";

function useOverlay(open: boolean, onClose: () => void) {
  // Kept in a ref so `onClose` — an inline arrow at nearly every call site —
  // cannot re-trigger the effect on every parent render.
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const token = Symbol("overlay");
    stack.push(token);
    if (stack.length === 1) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }

    const onKey = (e: KeyboardEvent) => {
      // Only the topmost overlay answers Escape, so a dialog inside a drawer
      // closes itself and leaves the drawer standing.
      if (e.key === "Escape" && stack[stack.length - 1] === token) latest.current();
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      const at = stack.indexOf(token);
      if (at !== -1) stack.splice(at, 1);
      if (stack.length === 0) document.body.style.overflow = savedOverflow;
    };
  }, [open]);
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  useOverlay(open, onClose);

  if (!open) return null;

  const widths = {
    sm: "max-w-md",
    md: "max-w-2xl",
    lg: "max-w-4xl",
    xl: "max-w-6xl",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6">
      <div
        className="fixed inset-0 bg-scrim/80 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          "animate-fade-up relative my-auto w-full rounded-2xl border border-line bg-surface shadow-pop",
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-soft px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
            {subtitle ? (
              <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>
            ) : null}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <IconClose size={17} />
          </button>
        </div>

        <div className="max-h-[calc(100vh-16rem)] overflow-y-auto px-5 py-5">{children}</div>

        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line-soft px-5 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A workspace that takes the whole window — for work that deserves room rather
 * than a dialog to squint into. Unlike Modal there is no scrim and no click-out:
 * at this size a stray click outside the text should never discard the writing.
 *
 * The body is the only scrolling part, so a header and a footer stay put while
 * a long piece is being written.
 */
export function FullScreen({
  open,
  onClose,
  title,
  subtitle,
  toolbar,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Sits in the header, beside the close button. */
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useOverlay(open, onClose);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
      className="animate-fade-up fixed inset-0 z-50 flex flex-col bg-surface"
    >
      <header className="flex items-start gap-4 border-b border-line-soft px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold tracking-tight text-ink">{title}</h2>
          {subtitle ? (
            <p className="mt-0.5 truncate text-xs text-ink-muted">{subtitle}</p>
          ) : null}
        </div>
        {toolbar}
        <button
          onClick={onClose}
          aria-label="Close"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <IconClose size={17} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

      {footer ? (
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line-soft px-4 py-3 sm:px-6">
          {footer}
        </footer>
      ) : null}
    </div>
  );
}

/** Right-hand slide-over — used for the task detail view. */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  headerExtra,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  headerExtra?: React.ReactNode;
}) {
  useOverlay(open, onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40">
      <div
        className="absolute inset-0 bg-scrim/80 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        className="animate-fade-up absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-line bg-surface shadow-pop"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line-soft px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="font-display text-base font-semibold tracking-tight text-ink">{title}</div>
            {subtitle ? <div className="mt-1 text-xs text-ink-muted">{subtitle}</div> : null}
            {headerExtra}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <IconClose size={17} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </aside>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = "Delete",
  danger = true,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <p className="text-[13px] leading-relaxed text-ink-muted">{body}</p>
      <div className="mt-6 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="h-9 rounded-[10px] border border-line bg-surface-2 px-4 text-[13px] font-medium text-ink hover:bg-surface-3"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className={cx(
            "h-9 rounded-[10px] border px-4 text-[13px] font-medium",
            danger
              ? "border-st-rejected/40 bg-st-rejected/15 text-st-rejected hover:bg-st-rejected/25"
              : "border-brand-bright/40 bg-brand text-white hover:bg-brand-bright",
          )}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
