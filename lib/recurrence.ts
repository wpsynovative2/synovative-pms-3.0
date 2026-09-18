import { addDays, daysBetween, formatDate, fromISODate, todayISO } from "./calendar";
import type {
  MonthlyMode,
  RecurrenceEnd,
  RecurrenceFreq,
  RecurrenceRule,
  RecurrenceSeries,
} from "./types";

/**
 * Repeating projects and individual tasks, with the same options as a Google
 * Calendar event: daily / weekly / monthly / yearly, every N units, specific
 * weekdays, day-of-month or nth weekday, and Never / On date / After N ends.
 *
 * A rule is evaluated day by day from its anchor (the first occurrence), which
 * keeps the logic identical to `recurrence_matches()` in the Supabase job.
 */

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Monday-first, matching the rest of the app's calendars. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const MONTH_NAMES = [
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

const ORDINALS = ["first", "second", "third", "fourth", "fifth"];

export const FREQ_UNIT: Record<RecurrenceFreq, string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  yearly: "year",
};

/** Longest stretch a rule is scanned for — keeps a never-matching rule finite. */
const MAX_SCAN_DAYS = 366 * 30;

/* ---------------------------------------------------------------- helpers */

/** Which occurrence of its weekday this date is within the month (1–5). */
function weekdayOrdinal(d: Date): number {
  return Math.floor((d.getDate() - 1) / 7) + 1;
}

function isLastWeekdayOfMonth(d: Date): boolean {
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return d.getDate() + 7 > daysInMonth;
}

function mondayOfWeek(iso: string): string {
  const dow = fromISODate(iso).getDay();
  return addDays(iso, -((dow + 6) % 7));
}

/** The weekdays a weekly rule fires on — defaults to the anchor's weekday. */
export function ruleWeekdays(rule: RecurrenceRule, anchor: string): number[] {
  const days = rule.weekdays?.length ? rule.weekdays : [fromISODate(anchor).getDay()];
  return WEEKDAY_ORDER.filter((d) => days.includes(d));
}

/** Clean up a rule so equivalent rules compare equal and junk never persists. */
export function normalizeRule(rule: RecurrenceRule): RecurrenceRule {
  const interval = Math.min(99, Math.max(1, Math.floor(rule.interval) || 1));
  const ends: RecurrenceEnd =
    rule.ends.type === "after"
      ? { type: "after", count: Math.max(1, Math.floor(rule.ends.count) || 1) }
      : rule.ends;
  const out: RecurrenceRule = { freq: rule.freq, interval, ends };
  if (rule.freq === "weekly" && rule.weekdays?.length) {
    out.weekdays = WEEKDAY_ORDER.filter((d) => rule.weekdays!.includes(d));
  }
  if (rule.freq === "monthly") out.monthlyMode = rule.monthlyMode ?? "monthday";
  return out;
}

/* --------------------------------------------------------------- matching */

/** Does the rule fire on `iso`? The anchor itself always counts. */
export function matchesRule(rule: RecurrenceRule, anchor: string, iso: string): boolean {
  if (iso < anchor) return false;
  if (iso === anchor) return true;

  const n = Math.max(1, Math.floor(rule.interval) || 1);
  const a = fromISODate(anchor);
  const d = fromISODate(iso);

  switch (rule.freq) {
    case "daily":
      return daysBetween(anchor, iso) % n === 0;

    case "weekly": {
      if (!ruleWeekdays(rule, anchor).includes(d.getDay())) return false;
      const weeks = Math.round(daysBetween(mondayOfWeek(anchor), mondayOfWeek(iso)) / 7);
      return weeks % n === 0;
    }

    case "monthly": {
      const months =
        (d.getFullYear() - a.getFullYear()) * 12 + (d.getMonth() - a.getMonth());
      if (months % n !== 0) return false;
      const mode: MonthlyMode = rule.monthlyMode ?? "monthday";
      if (mode === "monthday") return d.getDate() === a.getDate();
      if (d.getDay() !== a.getDay()) return false;
      return mode === "nthWeekday"
        ? weekdayOrdinal(d) === weekdayOrdinal(a)
        : isLastWeekdayOfMonth(d);
    }

    case "yearly": {
      const years = d.getFullYear() - a.getFullYear();
      return (
        years % n === 0 && d.getMonth() === a.getMonth() && d.getDate() === a.getDate()
      );
    }
  }
}

export interface Occurrence {
  date: string;
  /** 1-based; the anchor is #1. */
  index: number;
}

/** Every occurrence in order, honouring the end condition. */
export function* iterateOccurrences(
  rule: RecurrenceRule,
  anchor: string,
): Generator<Occurrence> {
  yield { date: anchor, index: 1 };
  let index = 1;
  let cursor = anchor;
  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    cursor = addDays(cursor, 1);
    if (rule.ends.type === "on" && cursor > rule.ends.date) return;
    if (!matchesRule(rule, anchor, cursor)) continue;
    index += 1;
    if (rule.ends.type === "after" && index > rule.ends.count) return;
    yield { date: cursor, index };
  }
}

/** Occurrences in (after, through] — what the generator still has to create. */
export function occurrencesBetween(
  series: RecurrenceSeries,
  after: string,
  through: string,
): Occurrence[] {
  const out: Occurrence[] = [];
  for (const occ of iterateOccurrences(series.rule, series.anchor)) {
    if (occ.date > through) break;
    if (occ.date > after) out.push(occ);
  }
  return out;
}

/** The next `count` occurrences strictly after `after` — for previews. */
export function upcomingOccurrences(
  rule: RecurrenceRule,
  anchor: string,
  after: string,
  count: number,
): Occurrence[] {
  const out: Occurrence[] = [];
  for (const occ of iterateOccurrences(rule, anchor)) {
    if (occ.date <= after) continue;
    out.push(occ);
    if (out.length >= count) break;
  }
  return out;
}

/** Total occurrences when the series is finite, else null. */
export function totalOccurrences(rule: RecurrenceRule, anchor: string): number | null {
  if (rule.ends.type === "never") return null;
  if (rule.ends.type === "after") return rule.ends.count;
  let last = 0;
  for (const occ of iterateOccurrences(rule, anchor)) last = occ.index;
  return last;
}

/* ---------------------------------------------------------------- series */

/**
 * Where generation starts for a newly enabled series. A future anchor waits for
 * its own date; an anchor already in the past starts from today, so switching
 * repeat on for an old project never backfills weeks of copies.
 */
export function initialCursor(anchor: string): string {
  const today = todayISO();
  return anchor >= today ? anchor : addDays(today, -1);
}

/** The series to store after a form save; keeps the cursor of an existing one. */
export function seriesFor(
  existing: RecurrenceSeries | null | undefined,
  rule: RecurrenceRule | null,
  anchor: string,
): RecurrenceSeries | null {
  if (!rule) return null;
  return {
    rule: normalizeRule(rule),
    anchor,
    cursor: existing ? existing.cursor : initialCursor(anchor),
    // Editing the rule never silently resumes a series someone paused.
    paused: existing?.paused ?? false,
  };
}

export function ruleError(rule: RecurrenceRule | null, anchor: string): string | undefined {
  if (!rule) return undefined;
  if (rule.freq === "weekly" && rule.weekdays && rule.weekdays.length === 0) {
    return "Pick at least one day of the week.";
  }
  if (rule.ends.type === "on" && rule.ends.date < anchor) {
    return "The repeat must end on or after the start date.";
  }
  if (rule.ends.type === "after" && !(rule.ends.count >= 1)) {
    return "Enter how many times it should repeat.";
  }
  return undefined;
}

/* ------------------------------------------------------------ describing */

function listNames(days: number[]): string {
  const names = days.map((d) => WEEKDAY_NAMES[d]);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function monthlyModeLabel(mode: MonthlyMode, anchor: string): string {
  const a = fromISODate(anchor);
  if (mode === "monthday") return `on day ${a.getDate()}`;
  if (mode === "lastWeekday") return `on the last ${WEEKDAY_NAMES[a.getDay()]}`;
  return `on the ${ORDINALS[weekdayOrdinal(a) - 1]} ${WEEKDAY_NAMES[a.getDay()]}`;
}

/** Monthly modes that make sense for this anchor, Google-style. */
export function monthlyModesFor(anchor: string): MonthlyMode[] {
  const a = fromISODate(anchor);
  const modes: MonthlyMode[] = ["monthday"];
  if (weekdayOrdinal(a) <= 4) modes.push("nthWeekday");
  if (isLastWeekdayOfMonth(a)) modes.push("lastWeekday");
  return modes;
}

/** "Every 2 weeks on Monday and Thursday, until 31 Dec 2026". */
export function describeRule(
  rule: RecurrenceRule,
  anchor: string,
  opts: { withEnds?: boolean } = {},
): string {
  const n = rule.interval;
  const a = fromISODate(anchor);
  let text: string;

  switch (rule.freq) {
    case "daily":
      text = n === 1 ? "Daily" : `Every ${n} days`;
      break;
    case "weekly": {
      const days = ruleWeekdays(rule, anchor);
      if (n === 1 && days.join() === "1,2,3,4,5") {
        text = "Every weekday (Monday to Friday)";
      } else {
        const head = n === 1 ? "Weekly" : `Every ${n} weeks`;
        text = days.length === 7 ? `${head} on all days` : `${head} on ${listNames(days)}`;
      }
      break;
    }
    case "monthly": {
      const head = n === 1 ? "Monthly" : `Every ${n} months`;
      text = `${head} ${monthlyModeLabel(rule.monthlyMode ?? "monthday", anchor)}`;
      break;
    }
    case "yearly": {
      const head = n === 1 ? "Annually" : `Every ${n} years`;
      text = `${head} on ${MONTH_NAMES[a.getMonth()]} ${a.getDate()}`;
      break;
    }
  }

  if (opts.withEnds === false) return text;
  if (rule.ends.type === "on") return `${text}, until ${formatDate(rule.ends.date)}`;
  if (rule.ends.type === "after") {
    return `${text}, ${rule.ends.count} time${rule.ends.count === 1 ? "" : "s"}`;
  }
  return text;
}

/** Compact label for badges: "Daily", "Weekly", "Every 2 months". */
export function shortRuleLabel(rule: RecurrenceRule): string {
  if (rule.interval === 1) {
    return { daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" }[
      rule.freq
    ];
  }
  return `Every ${rule.interval} ${FREQ_UNIT[rule.freq]}s`;
}

/* --------------------------------------------------------------- presets */

export interface RecurrencePreset {
  key: string;
  label: string;
  rule: RecurrenceRule | null;
}

const NEVER: RecurrenceEnd = { type: "never" };

/** The quick picks from Google Calendar's "Does not repeat" menu. */
export function recurrencePresets(anchor: string): RecurrencePreset[] {
  const a = fromISODate(anchor);
  const day = WEEKDAY_NAMES[a.getDay()];
  const presets: RecurrencePreset[] = [
    { key: "none", label: "Does not repeat", rule: null },
    { key: "daily", label: "Daily", rule: { freq: "daily", interval: 1, ends: NEVER } },
    {
      key: "weekly",
      label: `Weekly on ${day}`,
      rule: { freq: "weekly", interval: 1, ends: NEVER },
    },
  ];
  for (const mode of monthlyModesFor(anchor)) {
    presets.push({
      key: `monthly-${mode}`,
      label: `Monthly ${monthlyModeLabel(mode, anchor)}`,
      rule: { freq: "monthly", interval: 1, monthlyMode: mode, ends: NEVER },
    });
  }
  presets.push(
    {
      key: "yearly",
      label: `Annually on ${MONTH_NAMES[a.getMonth()]} ${a.getDate()}`,
      rule: { freq: "yearly", interval: 1, ends: NEVER },
    },
    {
      key: "weekdays",
      label: "Every weekday (Monday to Friday)",
      rule: { freq: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5], ends: NEVER },
    },
  );
  return presets;
}

/** Stable identity for a rule, so a stored rule can be matched to a preset. */
export function ruleKey(rule: RecurrenceRule | null, anchor: string): string {
  if (!rule) return "none";
  const r = normalizeRule(rule);
  return JSON.stringify({
    f: r.freq,
    i: r.interval,
    w: r.freq === "weekly" ? ruleWeekdays(r, anchor) : null,
    m: r.freq === "monthly" ? r.monthlyMode : null,
    e: r.ends,
  });
}
