"use client";

import { useMemo, useState } from "react";
import { addDays, formatDate, formatShortDate, fromISODate, snapToWorkingDay } from "@/lib/calendar";
import {
  FREQ_UNIT,
  WEEKDAY_NAMES,
  WEEKDAY_ORDER,
  describeRule,
  monthlyModeLabel,
  monthlyModesFor,
  recurrencePresets,
  ruleKey,
  ruleWeekdays,
  totalOccurrences,
  upcomingOccurrences,
} from "@/lib/recurrence";
import type {
  CalendarConfig,
  MonthlyMode,
  RecurrenceEnd,
  RecurrenceFreq,
  RecurrenceRule,
} from "@/lib/types";
import { DatePicker } from "./date-picker";
import { IconRepeat } from "./icons";
import { Input, Select, cx } from "./primitives";

const FREQS: RecurrenceFreq[] = ["daily", "weekly", "monthly", "yearly"];
const PREVIEW_COUNT = 4;

/**
 * Google Calendar-style repeat control: a quick-pick menu derived from the
 * start date ("Weekly on Thursday", "Monthly on the second Thursday", …) and
 * a Custom panel for every N units, weekdays, monthly mode and end condition.
 */
export function RecurrencePicker({
  value,
  onChange,
  anchor,
  config,
  error,
}: {
  value: RecurrenceRule | null;
  onChange: (rule: RecurrenceRule | null) => void;
  /** The first occurrence — the start date of the project or task. */
  anchor: string;
  config: CalendarConfig;
  error?: string;
}) {
  const presets = useMemo(() => recurrencePresets(anchor), [anchor]);
  const matched = presets.find((p) => ruleKey(p.rule, anchor) === ruleKey(value, anchor));
  const [customOpen, setCustomOpen] = useState(() => !!value && !matched);
  const showCustom = !!value && (customOpen || !matched);

  const selectPreset = (key: string) => {
    if (key === "custom") {
      setCustomOpen(true);
      if (!value) {
        onChange({
          freq: "weekly",
          interval: 1,
          weekdays: [fromISODate(anchor).getDay()],
          ends: { type: "never" },
        });
      }
      return;
    }
    setCustomOpen(false);
    onChange(presets.find((p) => p.key === key)?.rule ?? null);
  };

  return (
    <div className="flex flex-col gap-3">
      <Select
        value={showCustom ? "custom" : (matched?.key ?? "none")}
        onChange={(e) => selectPreset(e.target.value)}
        aria-label="Repeat"
      >
        {presets.map((p) => (
          <option key={p.key} value={p.key}>
            {p.label}
          </option>
        ))}
        <option value="custom">
          {showCustom && value ? `Custom: ${describeRule(value, anchor)}` : "Custom…"}
        </option>
      </Select>

      {showCustom && value ? (
        <CustomRulePanel value={value} onChange={onChange} anchor={anchor} config={config} />
      ) : null}

      {value ? (
        <RecurrenceSummary rule={value} anchor={anchor} config={config} />
      ) : null}

      {error ? <p className="text-[11px] text-st-rejected">{error}</p> : null}
    </div>
  );
}

/* ----------------------------------------------------------- custom panel */

function CustomRulePanel({
  value,
  onChange,
  anchor,
  config,
}: {
  value: RecurrenceRule;
  onChange: (rule: RecurrenceRule) => void;
  anchor: string;
  config: CalendarConfig;
}) {
  // Remember the last end date / count so flipping between options keeps them.
  const [endDate, setEndDate] = useState(
    value.ends.type === "on" ? value.ends.date : addDays(anchor, 90),
  );
  const [endCount, setEndCount] = useState(
    value.ends.type === "after" ? String(value.ends.count) : "13",
  );

  const set = (patch: Partial<RecurrenceRule>) => onChange({ ...value, ...patch });

  const setFreq = (freq: RecurrenceFreq) =>
    onChange({
      freq,
      interval: value.interval,
      ends: value.ends,
      weekdays: freq === "weekly" ? value.weekdays : undefined,
      monthlyMode: freq === "monthly" ? (value.monthlyMode ?? "monthday") : undefined,
    });

  const activeDays = ruleWeekdays(value, anchor);
  const toggleDay = (day: number) => {
    const next = activeDays.includes(day)
      ? activeDays.filter((d) => d !== day)
      : [...activeDays, day];
    if (next.length === 0) return; // a weekly rule needs at least one day
    set({ weekdays: WEEKDAY_ORDER.filter((d) => next.includes(d)) });
  };

  const monthlyModes = Array.from(
    new Set<MonthlyMode>([...monthlyModesFor(anchor), value.monthlyMode ?? "monthday"]),
  );

  const setEnds = (ends: RecurrenceEnd) => set({ ends });

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface-2/60 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-ink-muted">Repeat every</span>
        {/* Inputs are w-full by design, so width comes from a wrapper. */}
        <div className="w-16">
          <Input
            type="number"
            min={1}
            max={99}
            value={value.interval}
            onChange={(e) => set({ interval: Math.max(1, Number(e.target.value) || 1) })}
            className="text-center"
            aria-label="Repeat interval"
          />
        </div>
        <div className="w-32">
          <Select
            value={value.freq}
            onChange={(e) => setFreq(e.target.value as RecurrenceFreq)}
            aria-label="Repeat unit"
          >
            {FREQS.map((f) => (
              <option key={f} value={f}>
                {FREQ_UNIT[f]}
                {value.interval === 1 ? "" : "s"}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {value.freq === "weekly" ? (
        <div className="flex flex-col gap-2">
          <span className="text-[12px] text-ink-muted">Repeat on</span>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_ORDER.map((day) => {
              const on = activeDays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  aria-pressed={on}
                  aria-label={WEEKDAY_NAMES[day]}
                  title={WEEKDAY_NAMES[day]}
                  className={cx(
                    "h-8 w-8 rounded-full border text-[11px] font-semibold transition-colors",
                    on
                      ? "border-brand-bright bg-brand text-on-brand"
                      : "border-line bg-surface-3 text-ink-muted hover:text-ink",
                  )}
                >
                  {WEEKDAY_NAMES[day][0]}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {value.freq === "monthly" ? (
        <div className="max-w-xs">
          <Select
            value={value.monthlyMode ?? "monthday"}
            onChange={(e) => set({ monthlyMode: e.target.value as MonthlyMode })}
            aria-label="Monthly on"
          >
            {monthlyModes.map((m) => (
              <option key={m} value={m}>
                Monthly {monthlyModeLabel(m, anchor)}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-2.5">
        <legend className="mb-2 text-[12px] text-ink-muted">Ends</legend>

        <label className="flex h-9.5 items-center gap-2.5 text-[13px] text-ink">
          <input
            type="radio"
            name="recurrence-ends"
            className="accent-brand-bright"
            checked={value.ends.type === "never"}
            onChange={() => setEnds({ type: "never" })}
          />
          Never
        </label>

        <div className="grid grid-cols-[5.5rem_minmax(0,14rem)] items-center gap-2.5">
          <label className="flex items-center gap-2.5 text-[13px] text-ink">
            <input
              type="radio"
              name="recurrence-ends"
              className="accent-brand-bright"
              checked={value.ends.type === "on"}
              onChange={() => setEnds({ type: "on", date: endDate })}
            />
            On
          </label>
          <DatePicker
            value={endDate}
            onChange={(v) => {
              setEndDate(v);
              setEnds({ type: "on", date: v });
            }}
            config={config}
            min={anchor}
            ignoreWorkingRules
            disabled={value.ends.type !== "on"}
          />
        </div>

        <div className="grid grid-cols-[5.5rem_minmax(0,14rem)] items-center gap-2.5">
          <label className="flex items-center gap-2.5 text-[13px] text-ink">
            <input
              type="radio"
              name="recurrence-ends"
              className="accent-brand-bright"
              checked={value.ends.type === "after"}
              onChange={() =>
                setEnds({ type: "after", count: Math.max(1, Number(endCount) || 1) })
              }
            />
            After
          </label>
          <div className="flex items-center gap-2">
            <div className="w-20">
              <Input
                type="number"
                min={1}
                max={999}
                value={endCount}
                disabled={value.ends.type !== "after"}
                onChange={(e) => {
                  setEndCount(e.target.value);
                  const n = Math.floor(Number(e.target.value));
                  if (n >= 1) setEnds({ type: "after", count: n });
                }}
                className="text-center"
                aria-label="Number of occurrences"
              />
            </div>
            <span className="text-[12px] text-ink-muted">occurrences</span>
          </div>
        </div>
      </fieldset>
    </div>
  );
}

/* ---------------------------------------------------------------- summary */

function RecurrenceSummary({
  rule,
  anchor,
  config,
}: {
  rule: RecurrenceRule;
  anchor: string;
  config: CalendarConfig;
}) {
  // Occurrences that snap onto the same working day become one copy, so the
  // preview de-duplicates them the same way generation does.
  const seen = new Set([anchor]);
  const upcoming = upcomingOccurrences(rule, anchor, anchor, PREVIEW_COUNT * 3)
    .map((o) => ({ ...o, actual: snapToWorkingDay(o.date, config) }))
    .filter((o) => {
      if (seen.has(o.actual)) return false;
      seen.add(o.actual);
      return true;
    })
    .slice(0, PREVIEW_COUNT);
  const total = totalOccurrences(rule, anchor);
  const anyMoved = upcoming.some((o) => o.actual !== o.date);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-brand-bright/25 bg-brand/8 px-3 py-2.5">
      <div className="flex items-start gap-2 text-[12px] text-ink">
        <IconRepeat size={14} className="mt-px shrink-0 text-brand-ink" />
        <span>
          {describeRule(rule, anchor)}
          {total !== null ? (
            <span className="text-ink-faint">
              {" "}
              · {total} occurrence{total === 1 ? "" : "s"} in total
            </span>
          ) : null}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-5.5 text-[11px] text-ink-faint">
        <span>First: {formatDate(anchor)}</span>
        {upcoming.length ? <span>· Then:</span> : <span>· No further occurrences</span>}
        {upcoming.map((o) => (
          <span
            key={o.date}
            title={
              o.actual !== o.date
                ? `${formatDate(o.date)} is not a working day — moves to ${formatDate(o.actual)}`
                : formatDate(o.actual)
            }
            className={cx(
              "rounded-full border px-2 py-px",
              o.actual !== o.date
                ? "border-st-submitted/40 text-st-submitted"
                : "border-line text-ink-muted",
            )}
          >
            {formatShortDate(o.actual)}
            {o.actual !== o.date ? "*" : ""}
          </span>
        ))}
        {upcoming.length === PREVIEW_COUNT && (total === null || total > PREVIEW_COUNT + 1) ? (
          <span>…</span>
        ) : null}
      </div>
      {anyMoved ? (
        <p className="pl-5.5 text-[10px] text-ink-faint">
          * Falls on a non-working day, so it moves to the next working day.
        </p>
      ) : null}
    </div>
  );
}
