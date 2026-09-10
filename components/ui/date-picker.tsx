"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  NON_WORKING_LABEL,
  formatDate,
  formatMonthYear,
  fromISODate,
  monthGrid,
  nonWorkingReason,
  todayISO,
} from "@/lib/calendar";
import type { CalendarConfig } from "@/lib/types";
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
} from "./icons";
import { cx } from "./primitives";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

export interface DatePickerProps {
  value: string;
  onChange: (iso: string) => void;
  config: CalendarConfig;
  /** Inclusive bounds — the project window for project tasks (§9.1). */
  min?: string;
  max?: string;
  /** Calendar admin screen selects non-working days on purpose. */
  ignoreWorkingRules?: boolean;
  allowPast?: boolean;
  disabled?: boolean;
  placeholder?: string;
  clearable?: boolean;
}

/** Why a specific cell is unavailable, or null when it can be picked. */
export function dateUnavailableReason(
  iso: string,
  {
    config,
    min,
    max,
    ignoreWorkingRules,
    allowPast,
  }: Pick<
    DatePickerProps,
    "config" | "min" | "max" | "ignoreWorkingRules" | "allowPast"
  >,
): string | null {
  if (min && iso < min) return `Before ${formatDate(min)}`;
  if (max && iso > max) return `After ${formatDate(max)}`;
  if (ignoreWorkingRules) return null;
  const reason = nonWorkingReason(iso, config, { allowPast });
  return reason ? NON_WORKING_LABEL[reason] : null;
}

export function DatePicker({
  value,
  onChange,
  config,
  min,
  max,
  ignoreWorkingRules,
  allowPast,
  disabled,
  placeholder = "Select a date",
  clearable,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  /*
   * The visible month is derived from the selected date unless the user has
   * paged away, so opening the picker always lands on the right month without
   * an effect syncing state back and forth.
   */
  const [paged, setPaged] = useState<{ year: number; month: number } | null>(null);
  const anchorDate = fromISODate(value || min || todayISO());
  const cursor = paged ?? {
    year: anchorDate.getFullYear(),
    month: anchorDate.getMonth(),
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const cells = useMemo(
    () => monthGrid(cursor.year, cursor.month),
    [cursor.year, cursor.month],
  );

  const today = todayISO();
  const holidayByDate = useMemo(
    () => new Map(config.holidays.map((h) => [h.date, h.name])),
    [config.holidays],
  );

  const shift = (delta: number) => {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    setPaged({ year: d.getFullYear(), month: d.getMonth() });
  };

  const toggle = () => {
    setPaged(null);
    setOpen((o) => !o);
  };

  const choose = (iso: string) => {
    onChange(iso);
    setPaged(null);
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={toggle}
        className={cx(
          "flex h-9.5 w-full items-center gap-2 rounded-[10px] border border-line bg-surface-2 px-3 text-left text-[13px] transition-colors",
          "focus:border-brand-bright focus:ring-2 focus:ring-brand-bright/25 focus:outline-none",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <IconCalendar size={15} className="shrink-0 text-ink-faint" />
        <span className={cx("flex-1 truncate", value ? "text-ink" : "text-ink-faint")}>
          {value ? formatDate(value) : placeholder}
        </span>
        {clearable && value && !disabled ? (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear date"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                onChange("");
              }
            }}
            className="rounded p-0.5 text-ink-faint hover:text-ink"
          >
            <IconClose size={13} />
          </span>
        ) : null}
      </button>

      {open && !disabled ? (
        <div className="animate-fade-up absolute z-40 mt-1.5 w-72 rounded-xl border border-line bg-surface-2 p-3 shadow-2xl shadow-black/60">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shift(-1)}
              aria-label="Previous month"
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-3 hover:text-ink"
            >
              <IconChevronLeft size={15} />
            </button>
            <span className="text-[13px] font-medium text-ink">
              {formatMonthYear(cursor.year, cursor.month)}
            </span>
            <button
              type="button"
              onClick={() => shift(1)}
              aria-label="Next month"
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-3 hover:text-ink"
            >
              <IconChevronRight size={15} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {WEEKDAYS.map((w, i) => (
              <div
                key={`${w}-${i}`}
                className="py-1 text-center text-[10px] font-medium text-ink-faint"
              >
                {w}
              </div>
            ))}
            {cells.map((iso) => {
              const inMonth = fromISODate(iso).getMonth() === cursor.month;
              const blocked = dateUnavailableReason(iso, {
                config,
                min,
                max,
                ignoreWorkingRules,
                allowPast,
              });
              const holiday = holidayByDate.get(iso);
              const selected = iso === value;
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={!!blocked}
                  title={blocked ? (holiday ?? blocked) : (holiday ?? undefined)}
                  onClick={() => choose(iso)}
                  className={cx(
                    "relative h-8 rounded-lg text-[12px] transition-colors",
                    !inMonth && "opacity-35",
                    blocked
                      ? "cursor-not-allowed text-ink-faint line-through decoration-ink-faint/50"
                      : selected
                        ? "bg-brand font-semibold text-white"
                        : "text-ink-muted hover:bg-surface-3 hover:text-ink",
                    iso === today && !selected && "ring-1 ring-brand-bright/50",
                  )}
                >
                  {fromISODate(iso).getDate()}
                  {holiday && !selected ? (
                    <span className="absolute inset-x-0 bottom-0.5 mx-auto block h-1 w-1 rounded-full bg-st-rejected" />
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-line-soft pt-2.5 text-[10px] text-ink-faint">
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-st-rejected" /> Holiday
            </span>
            <span>Sundays &amp; 2nd/4th Saturdays are closed</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
