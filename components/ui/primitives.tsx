"use client";

import { forwardRef, useState } from "react";
import { IconChevronDown, IconEye, IconEyeOff, IconSearch } from "./icons";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/* ----------------------------------------------------------------- Card */

export function Card({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        // Solid and unblurred on purpose: a backdrop-filter made every card
        // its own stacking context, which hid open dropdowns behind the next card.
        "rounded-card border border-line bg-surface shadow-card",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-wrap items-start justify-between gap-3 border-b border-line-soft px-5 py-4",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
        {subtitle ? (
          <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/* --------------------------------------------------------------- Button */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
type ButtonSize = "sm" | "md";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-white hover:bg-brand-bright border border-brand-bright/40 shadow-[0_1px_0_rgba(255,255,255,0.08)_inset]",
  secondary:
    "bg-surface-2 text-ink hover:bg-surface-3 border border-line",
  ghost: "bg-transparent text-ink-muted hover:text-ink hover:bg-surface-2 border border-transparent",
  danger: "bg-st-rejected/15 text-st-rejected hover:bg-st-rejected/25 border border-st-rejected/40",
  success:
    "bg-st-approved/15 text-st-approved hover:bg-st-approved/25 border border-st-approved/40",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
  md: "h-9.5 px-4 text-[13px] gap-2 rounded-[10px]",
};

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
  }
>(function Button(
  { variant = "secondary", size = "md", className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cx(
        "inline-flex shrink-0 items-center justify-center font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-bright",
        "disabled:cursor-not-allowed disabled:opacity-45",
        BUTTON_VARIANT[variant],
        BUTTON_SIZE[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export function IconButton({
  label,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line",
        "bg-surface-2 text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-bright",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------- Badge */

export function Badge({
  className,
  children,
  dot,
}: {
  className?: string;
  children: React.ReactNode;
  dot?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        className ?? "border-line bg-surface-2 text-ink-muted",
      )}
    >
      {dot ? <span className={cx("h-1.5 w-1.5 rounded-full", dot)} /> : null}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------- Form bits */

export function Field({
  label,
  required,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="text-[11px] font-medium tracking-wide text-ink-muted uppercase"
      >
        {label}
        {required ? <span className="ml-1 text-st-rejected">*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-[11px] text-st-rejected">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}

const CONTROL_BASE =
  "w-full rounded-[10px] border border-line bg-surface-2 px-3 text-[13px] text-ink placeholder:text-ink-faint " +
  "transition-colors focus:border-brand-bright focus:outline-none focus:ring-2 focus:ring-brand-bright/25 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(CONTROL_BASE, "h-9.5", className)} {...rest} />;
});

/**
 * A password box with a reveal toggle, so someone can check what they typed
 * before committing to it. Masked by default; `defaultVisible` starts it shown,
 * which is what an administrator handing over a temporary password needs.
 */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { defaultVisible?: boolean }
>(function PasswordInput({ className, defaultVisible = false, ...rest }, ref) {
  const [visible, setVisible] = useState(defaultVisible);
  const label = visible ? "Hide password" : "Show password";
  return (
    <div className="relative">
      <input
        ref={ref}
        type={visible ? "text" : "password"}
        className={cx(CONTROL_BASE, "h-9.5 pr-10", className)}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={label}
        aria-pressed={visible}
        title={label}
        // Never a form submit, and skipped by tab order: the toggle is a
        // convenience, not a step in filling the form in.
        tabIndex={-1}
        className={cx(
          "absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1.5 text-ink-faint",
          "transition-colors hover:bg-surface-3 hover:text-ink",
          "focus-visible:ring-2 focus-visible:ring-brand-bright/40 focus-visible:outline-none",
        )}
      >
        {visible ? <IconEyeOff size={15} /> : <IconEye size={15} />}
      </button>
    </div>
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx(CONTROL_BASE, "min-h-20 resize-y py-2 leading-relaxed", className)}
      {...rest}
    />
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...rest }, ref) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cx(CONTROL_BASE, "h-9.5 appearance-none pr-9", className)}
        {...rest}
      >
        {children}
      </select>
      <IconChevronDown
        size={15}
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-faint"
      />
    </div>
  );
});

export function SearchInput({
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cx("relative", className)}>
      <IconSearch
        size={15}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
      />
      <input className={cx(CONTROL_BASE, "h-9.5 pl-9")} {...rest} />
    </div>
  );
}

/* --------------------------------------------------------------- Avatar */

const AVATAR_TINTS = [
  "bg-brand/30 text-tint-violet",
  "bg-st-inprogress/25 text-tint-blue",
  "bg-st-approved/25 text-tint-green",
  "bg-st-submitted/25 text-tint-amber",
  "bg-st-changes/25 text-tint-orange",
  "bg-pink/25 text-tint-pink",
  "bg-teal/25 text-tint-teal",
];

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function tintFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

export function Avatar({
  name,
  size = 28,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        tintFor(name),
        className,
      )}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

/* ------------------------------------------------------------- Progress */

export function ProgressBar({
  value,
  className,
  barClassName,
}: {
  value: number;
  className?: string;
  barClassName?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cx("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cx("h-full rounded-full transition-[width] duration-500", barClassName ?? "bg-brand-bright")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------ Stat tile */

export function StatTile({
  icon,
  label,
  value,
  hint,
  tone = "brand",
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "brand" | "blue" | "green" | "amber" | "red" | "neutral";
}) {
  const tones = {
    brand: "bg-brand/15 text-brand-ink",
    blue: "bg-st-inprogress/15 text-st-inprogress",
    green: "bg-st-approved/15 text-st-approved",
    amber: "bg-st-submitted/15 text-st-submitted",
    red: "bg-st-rejected/15 text-st-rejected",
    neutral: "bg-surface-3 text-ink-muted",
  };
  return (
    <Card className="flex items-center gap-3.5 px-4 py-3.5">
      {icon ? (
        <span
          className={cx(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]",
            tones[tone],
          )}
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0">
        <div className="text-lg leading-tight font-semibold text-ink">{value}</div>
        <div className="truncate text-[11px] text-ink-muted">{label}</div>
        {hint ? <div className="mt-0.5 text-[11px] text-ink-faint">{hint}</div> : null}
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------- Empty state */

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon ? <div className="mb-1 text-ink-faint opacity-60">{icon}</div> : null}
      <p className="text-sm font-medium text-ink-muted">{title}</p>
      {body ? <p className="max-w-sm text-xs text-ink-faint">{body}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- Tabs */

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: { id: T; label: string; icon?: React.ReactNode; count?: number }[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex gap-1 overflow-x-auto rounded-card border border-line bg-surface/80 p-1.5",
        className,
      )}
      role="tablist"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            "inline-flex items-center gap-2 rounded-[10px] px-3.5 py-2 text-[13px] font-medium whitespace-nowrap transition-colors",
            active === t.id
              ? "bg-brand text-white"
              : "text-ink-muted hover:bg-surface-2 hover:text-ink",
          )}
        >
          {t.icon}
          {t.label}
          {typeof t.count === "number" ? (
            <span
              className={cx(
                "rounded-full px-1.5 py-px text-[10px]",
                active === t.id ? "bg-white/20" : "bg-surface-3",
              )}
            >
              {t.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- Section */

export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        {icon ? (
          <span className="mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand/15 text-brand-ink">
            {icon}
          </span>
        ) : null}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle ? (
            <p className="mt-0.5 text-[13px] text-ink-muted">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
