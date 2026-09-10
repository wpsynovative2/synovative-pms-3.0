import type { CalendarConfig } from "./types";

/**
 * Working-calendar rules (PRD §5.4). All dates are handled as local
 * `YYYY-MM-DD` strings so nothing shifts across the IST/UTC boundary.
 */

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fromISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function addDays(iso: string, days: number): string {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = fromISODate(fromISO).getTime();
  const b = fromISODate(toISO).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** Which Saturday of the month this is (1-based); 0 when not a Saturday. */
export function saturdayOrdinal(iso: string): number {
  const d = fromISODate(iso);
  if (d.getDay() !== 6) return 0;
  return Math.floor((d.getDate() - 1) / 7) + 1;
}

export type NonWorkingReason =
  | "past"
  | "sunday"
  | "alternate-saturday"
  | "holiday";

/**
 * Why a date is unavailable, or null when it is selectable.
 * `allowPast` lets read-only views (reports, history) evaluate old dates.
 */
export function nonWorkingReason(
  iso: string,
  config: CalendarConfig,
  opts: { allowPast?: boolean } = {},
): NonWorkingReason | null {
  // Rule 5: an HR override outranks every non-working rule except "past".
  const overridden = config.workingOverrides.includes(iso);

  if (!opts.allowPast && iso < todayISO()) return "past";
  if (overridden) return null;

  const d = fromISODate(iso);
  if (d.getDay() === 0) return "sunday";

  const sat = saturdayOrdinal(iso);
  if (sat === 2 || sat === 4) return "alternate-saturday";

  if (config.holidays.some((h) => h.date === iso)) return "holiday";

  return null;
}

export function isWorkingDay(
  iso: string,
  config: CalendarConfig,
  opts: { allowPast?: boolean } = {},
): boolean {
  return nonWorkingReason(iso, config, opts) === null;
}

export const NON_WORKING_LABEL: Record<NonWorkingReason, string> = {
  past: "Past date",
  sunday: "Sunday",
  "alternate-saturday": "2nd / 4th Saturday",
  holiday: "Company holiday",
};

/** Next selectable working day at or after `iso`. */
export function nextWorkingDay(iso: string, config: CalendarConfig): string {
  let cursor = iso < todayISO() ? todayISO() : iso;
  for (let i = 0; i < 400; i++) {
    if (isWorkingDay(cursor, config)) return cursor;
    cursor = addDays(cursor, 1);
  }
  return cursor;
}

/** Advance `n` working days from `iso` (n = 0 → next working day at/after iso). */
export function addWorkingDays(
  iso: string,
  n: number,
  config: CalendarConfig,
): string {
  let cursor = nextWorkingDay(iso, config);
  let left = n;
  while (left > 0) {
    cursor = addDays(cursor, 1);
    cursor = nextWorkingDay(cursor, config);
    left--;
  }
  return cursor;
}

/** Working days in [from, to] inclusive — used by the workload capacity model. */
export function workingDaysInRange(
  fromISO: string,
  toISO: string,
  config: CalendarConfig,
): string[] {
  const out: string[] = [];
  let cursor = fromISO;
  let guard = 0;
  while (cursor <= toISO && guard++ < 1000) {
    if (isWorkingDay(cursor, config, { allowPast: true })) out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/* --------------------------------------------------------- formatting */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const MONTHS_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = fromISODate(iso.slice(0, 10));
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = fromISODate(iso.slice(0, 10));
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function formatMonthYear(year: number, month: number): string {
  return `${MONTHS_FULL[month]} ${year}`;
}

export function formatDateTime(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  const time = d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${time}`;
}

export function relativeTime(isoTimestamp: string): string {
  const diff = Date.now() - new Date(isoTimestamp).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatShortDate(isoTimestamp.slice(0, 10));
}

/** Month grid (6 rows × 7 cols) starting Monday, for the calendar screen. */
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(year, month, 1);
  // Monday-first offset
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - offset);
  const cells: string[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    cells.push(toISODate(d));
  }
  return cells;
}
