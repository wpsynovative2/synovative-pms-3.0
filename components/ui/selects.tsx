"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconChevronDown, IconClose, IconSearch } from "./icons";
import { Avatar, cx } from "./primitives";

export interface Option {
  value: string;
  label: string;
  hint?: string;
  /** Renders an avatar chip instead of a plain label — used for people. */
  avatarName?: string;
  disabled?: boolean;
}

function useOutsideClose(
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, onClose, active]);
}

/* ---------------------------------------------------------- MultiSelect */

/** Chips above a searchable dropdown — the pattern from the reference design. */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "Search…",
  emptyLabel = "Nothing selected",
  maxVisibleChips,
  disabled,
}: {
  options: Option[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  emptyLabel?: string;
  maxVisibleChips?: number;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  useOutsideClose(boxRef, () => setOpen(false), open);

  const byValue = useMemo(
    () => new Map(options.map((o) => [o.value, o])),
    [options],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter(
      (o) => !q || o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q),
    );
  }, [options, query]);

  const selected = value.map((v) => byValue.get(v)).filter(Boolean) as Option[];
  const shown = maxVisibleChips ? selected.slice(0, maxVisibleChips) : selected;
  const overflow = selected.length - shown.length;

  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <div ref={boxRef} className="flex flex-col gap-2">
      <div className="min-h-11 rounded-[10px] border border-line bg-surface-2 px-2.5 py-2">
        {selected.length === 0 ? (
          <span className="text-[13px] text-ink-faint">{emptyLabel}</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {shown.map((o) => (
              <span
                key={o.value}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-3 py-1 pr-1.5 pl-1.5 text-[12px] text-ink"
              >
                {o.avatarName ? <Avatar name={o.avatarName} size={20} /> : null}
                <span className="max-w-52 truncate">{o.label}</span>
                {!disabled ? (
                  <button
                    type="button"
                    onClick={() => toggle(o.value)}
                    aria-label={`Remove ${o.label}`}
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-ink-faint hover:bg-surface hover:text-ink"
                  >
                    <IconClose size={11} />
                  </button>
                ) : null}
              </span>
            ))}
            {overflow > 0 ? (
              <span className="inline-flex items-center rounded-full border border-line bg-surface-3 px-2 py-1 text-[12px] text-ink-muted">
                +{overflow} more
              </span>
            ) : null}
          </div>
        )}
      </div>

      {!disabled ? (
        <div className="relative">
          <div className="relative">
            <IconSearch
              size={15}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
            />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder={placeholder}
              className="h-9.5 w-full rounded-[10px] border border-line bg-surface-2 pr-9 pl-9 text-[13px] text-ink placeholder:text-ink-faint focus:border-brand-bright focus:ring-2 focus:ring-brand-bright/25 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-label="Toggle list"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-ink-faint hover:text-ink"
            >
              <IconChevronDown size={15} />
            </button>
          </div>

          {open ? (
            <div className="animate-fade-up absolute z-30 mt-1.5 max-h-64 w-full overflow-y-auto rounded-[10px] border border-line bg-surface-2 p-1 shadow-2xl shadow-black/50">
              {filtered.length === 0 ? (
                <p className="px-3 py-3 text-center text-xs text-ink-faint">No matches</p>
              ) : (
                filtered.map((o) => {
                  const on = value.includes(o.value);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      disabled={o.disabled}
                      onClick={() => toggle(o.value)}
                      className={cx(
                        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
                        o.disabled
                          ? "cursor-not-allowed opacity-40"
                          : on
                            ? "bg-brand/25 text-ink"
                            : "text-ink-muted hover:bg-surface-3 hover:text-ink",
                      )}
                    >
                      <span
                        className={cx(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                          on ? "border-brand-bright bg-brand-bright" : "border-line-soft",
                        )}
                      >
                        {on ? (
                          <svg viewBox="0 0 12 12" className="h-3 w-3 text-white">
                            <path
                              d="m2.5 6.2 2.2 2.3L9.5 3.6"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        ) : null}
                      </span>
                      {o.avatarName ? <Avatar name={o.avatarName} size={22} /> : null}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{o.label}</span>
                        {o.hint ? (
                          <span className="block truncate text-[11px] text-ink-faint">
                            {o.hint}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------- SearchSelect */

/** Single-choice searchable dropdown (project leader, assignee, vendor…). */
export function SearchSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  disabled,
  allowClear,
}: {
  options: Option[];
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  useOutsideClose(boxRef, () => setOpen(false), open);

  const current = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter(
      (o) => !q || o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q),
    );
  }, [options, query]);

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
        }}
        className={cx(
          "flex h-9.5 w-full items-center gap-2 rounded-[10px] border border-line bg-surface-2 px-3 text-left text-[13px] transition-colors",
          "focus:border-brand-bright focus:ring-2 focus:ring-brand-bright/25 focus:outline-none",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        {current?.avatarName ? <Avatar name={current.avatarName} size={20} /> : null}
        <span className={cx("min-w-0 flex-1 truncate", current ? "text-ink" : "text-ink-faint")}>
          {current?.label ?? placeholder}
        </span>
        {allowClear && current && !disabled ? (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear"
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
        <IconChevronDown size={15} className="shrink-0 text-ink-faint" />
      </button>

      {open && !disabled ? (
        <div className="animate-fade-up absolute z-30 mt-1.5 w-full rounded-[10px] border border-line bg-surface-2 p-1 shadow-2xl shadow-black/50">
          {options.length > 6 ? (
            <div className="relative p-1">
              <IconSearch
                size={14}
                className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ink-faint"
              />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="h-8 w-full rounded-lg border border-line bg-surface px-2 pl-8 text-[12px] text-ink placeholder:text-ink-faint focus:outline-none"
              />
            </div>
          ) : null}
          <div className="max-h-60 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-center text-xs text-ink-faint">No matches</p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  disabled={o.disabled}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={cx(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
                    o.disabled
                      ? "cursor-not-allowed opacity-40"
                      : o.value === value
                        ? "bg-brand/25 text-ink"
                        : "text-ink-muted hover:bg-surface-3 hover:text-ink",
                  )}
                >
                  {o.avatarName ? <Avatar name={o.avatarName} size={22} /> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{o.label}</span>
                    {o.hint ? (
                      <span className="block truncate text-[11px] text-ink-faint">{o.hint}</span>
                    ) : null}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------- ColorPicker */

export function ColorPicker({
  value,
  onChange,
  presets,
}: {
  value: string;
  onChange: (hex: string) => void;
  presets: string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={`Colour ${c}`}
          style={{ background: c }}
          className={cx(
            "h-7 w-7 rounded-lg transition-transform",
            value.toLowerCase() === c.toLowerCase()
              ? "ring-2 ring-ink ring-offset-2 ring-offset-surface"
              : "hover:scale-110",
          )}
        />
      ))}
      <label className="ml-1 inline-flex items-center gap-2 rounded-[10px] border border-line bg-surface-2 px-2.5 py-1.5">
        <span
          className="h-4 w-4 rounded border border-line-soft"
          style={{ background: value }}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="w-20 bg-transparent font-mono text-[12px] text-ink outline-none"
        />
      </label>
    </div>
  );
}

/* ------------------------------------------------------------ TagsInput */

export function TagsInput({
  value,
  onChange,
  placeholder = "Type a tag and press Enter",
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const parts = draft
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    onChange(Array.from(new Set([...value, ...parts])));
    setDraft("");
  };

  return (
    <div className="rounded-[10px] border border-line bg-surface-2 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-3 py-0.5 pr-1 pl-2 text-[12px] text-ink"
          >
            {t}
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x !== t))}
              aria-label={`Remove ${t}`}
              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-ink-faint hover:bg-surface hover:text-ink"
            >
              <IconClose size={11} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            } else if (e.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={commit}
          placeholder={value.length ? "" : placeholder}
          className="min-w-40 flex-1 bg-transparent py-1 text-[13px] text-ink placeholder:text-ink-faint outline-none"
        />
      </div>
    </div>
  );
}
