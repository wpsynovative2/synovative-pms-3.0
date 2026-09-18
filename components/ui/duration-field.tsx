"use client";

import { useState } from "react";
import { WORKDAY_HOURS } from "@/lib/master-data";
import { Input, Select } from "./primitives";

/**
 * An effort estimate entered the way people actually talk about it — "2 days",
 * "90 minutes" — instead of a decimal number of hours.
 *
 * The stored value is always hours, and a day is always WORKDAY_HOURS: the
 * estimate has to mean the same thing after the task is reassigned to someone
 * whose own daily capacity is different.
 */
const UNITS = {
  minutes: { label: "Minutes", hours: 1 / 60, step: 15 },
  hours: { label: "Hours", hours: 1, step: 0.5 },
  days: { label: "Days", hours: WORKDAY_HOURS, step: 0.5 },
  weeks: { label: "Weeks", hours: WORKDAY_HOURS * 5, step: 0.5 },
} as const;

type Unit = keyof typeof UNITS;
const ORDER: Unit[] = ["weeks", "days", "hours", "minutes"];

/** The largest unit that expresses the value without an awkward remainder. */
function describe(hours: number | null): { amount: string; unit: Unit } {
  if (hours === null || !Number.isFinite(hours) || hours <= 0) {
    return { amount: "", unit: "hours" };
  }
  for (const unit of ORDER) {
    const value = hours / UNITS[unit].hours;
    if (value >= 1 && Math.abs(value - Math.round(value * 100) / 100) < 1e-9) {
      return { amount: String(Math.round(value * 100) / 100), unit };
    }
  }
  return { amount: String(Math.round(hours * 100) / 100), unit: "hours" };
}

export function formatEstimate(hours: number): string {
  const { amount, unit } = describe(hours);
  if (!amount) return "—";
  const label = UNITS[unit].label.toLowerCase();
  return `${amount} ${amount === "1" ? label.replace(/s$/, "") : label}`;
}

export function DurationField({
  valueHours,
  onChange,
}: {
  valueHours: number | null;
  /** Hours, or null when the box is empty. */
  onChange: (hours: number | null) => void;
}) {
  // Seeded from the incoming value, then owned here: re-deriving it on every
  // render would fight the person typing "1", "15", "150".
  const seed = describe(valueHours);
  const [amount, setAmount] = useState(seed.amount);
  const [unit, setUnit] = useState<Unit>(seed.unit);

  const emit = (nextAmount: string, nextUnit: Unit) => {
    const n = Number(nextAmount);
    const empty = nextAmount.trim() === "" || !Number.isFinite(n) || n <= 0;
    onChange(empty ? null : Math.round(n * UNITS[nextUnit].hours * 100) / 100);
  };

  const hours = Number(amount) * UNITS[unit].hours;
  const showEquivalent =
    amount.trim() !== "" && Number.isFinite(hours) && hours > 0 && unit !== "hours";

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={0}
        step={UNITS[unit].step}
        className="w-24"
        value={amount}
        onChange={(e) => {
          setAmount(e.target.value);
          emit(e.target.value, unit);
        }}
        placeholder="0"
        aria-label="Estimated effort"
      />
      <Select
        className="w-auto min-w-28"
        value={unit}
        onChange={(e) => {
          const next = e.target.value as Unit;
          setUnit(next);
          emit(amount, next);
        }}
        aria-label="Unit"
      >
        {ORDER.map((u) => (
          <option key={u} value={u}>
            {UNITS[u].label}
          </option>
        ))}
      </Select>
      <span className="text-[11px] whitespace-nowrap text-ink-faint">
        {showEquivalent ? `= ${Math.round(hours * 100) / 100}h` : null}
      </span>
    </div>
  );
}
