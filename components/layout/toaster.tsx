"use client";

import { IconClose } from "@/components/ui/icons";
import { cx } from "@/components/ui/primitives";
import { useStore } from "@/lib/store";

/** Save failures and confirmations, stacked bottom-right above everything. */
export function Toaster() {
  const { toasts, dismissToast } = useStore();
  if (!toasts.length) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-[90] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            "animate-fade-up pointer-events-auto flex items-start gap-3 rounded-xl border bg-surface-2 px-4 py-3 text-[13px] shadow-pop",
            t.kind === "error" ? "border-st-rejected/40 text-ink" : "border-st-approved/40 text-ink",
          )}
        >
          <span
            className={cx(
              "mt-1.5 h-2 w-2 shrink-0 rounded-full",
              t.kind === "error" ? "bg-st-rejected" : "bg-st-approved",
            )}
          />
          <p className="min-w-0 flex-1 leading-relaxed">{t.message}</p>
          <button
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
            className="shrink-0 rounded p-0.5 text-ink-faint hover:text-ink"
          >
            <IconClose size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
