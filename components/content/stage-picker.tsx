"use client";

import { useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { Modal } from "@/components/ui/modal";
import { Badge, Button, Field, Select } from "@/components/ui/primitives";
import { addMonths, formatDate, formatMonth, monthOf } from "@/lib/calendar";
import { CONTENT_STAGE_STYLE } from "@/lib/master-data";
import { useStore } from "@/lib/store";
import { CONTENT_STAGES, type ContentStage } from "@/lib/types";

/*
 * A piece's status, with the date two of them need (0013): Scheduled asks for
 * the day it goes out, Carry Forwarded for the month it moves to. Choosing one
 * of those opens a small prompt; cancelling it leaves the status as it was.
 * The picker only reports a choice - the caller saves it now (a piece on a
 * task) or with the rest of the form (the editor).
 */

export interface StageValue {
  stage: ContentStage | null;
  /** Scheduled: the day. Carry Forwarded: the month, first of the month. */
  date: string | null;
}

/** "Scheduled · 12 Oct 2026", "Carry Forwarded → December 2026". */
export function stageDetail(v: StageValue): string {
  if (v.stage === "Scheduled" && v.date) return `on ${formatDate(v.date)}`;
  if (v.stage === "Carry Forwarded" && v.date) return `to ${formatMonth(v.date)}`;
  return "";
}

export function StagePicker({
  value,
  forMonth,
  onChange,
  disabled,
}: {
  value: StageValue;
  /** The month the piece is for; carrying forward must go past it. */
  forMonth: string;
  onChange: (next: StageValue) => void;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState<ContentStage | null>(null);
  const detail = stageDetail(value);

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Select
        aria-label="Status"
        disabled={disabled}
        value={value.stage ?? ""}
        onChange={(e) => {
          const stage = (e.target.value || null) as ContentStage | null;
          if (stage === "Scheduled" || stage === "Carry Forwarded") setAsking(stage);
          else onChange({ stage, date: null });
        }}
      >
        <option value="">Not set</option>
        {CONTENT_STAGES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>
      {detail ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => value.stage && setAsking(value.stage)}
          className="truncate text-left text-[11px] text-ink-faint hover:text-ink"
          title="Change"
        >
          {detail}
        </button>
      ) : null}

      {asking ? (
        <StageDatePrompt
          stage={asking}
          initial={value.stage === asking ? value.date : null}
          forMonth={forMonth}
          onCancel={() => setAsking(null)}
          onConfirm={(date) => {
            setAsking(null);
            onChange({ stage: asking, date });
          }}
        />
      ) : null}
    </div>
  );
}

/** Read-only form of the same thing, for people who may not move the piece. */
export function StageBadge({ value }: { value: StageValue }) {
  if (!value.stage) return <span className="text-[13px] text-ink-faint">Not set</span>;
  const detail = stageDetail(value);
  return (
    <span className="flex min-w-0 flex-col items-start gap-0.5">
      <Badge className={CONTENT_STAGE_STYLE[value.stage]}>{value.stage}</Badge>
      {detail ? <span className="text-[11px] text-ink-faint">{detail}</span> : null}
    </span>
  );
}

function StageDatePrompt({
  stage,
  initial,
  forMonth,
  onCancel,
  onConfirm,
}: {
  stage: ContentStage;
  initial: string | null;
  forMonth: string;
  onCancel: () => void;
  onConfirm: (date: string) => void;
}) {
  const { db } = useStore();
  const scheduling = stage === "Scheduled";
  // Carrying forward means a later month than the one the piece is for.
  const months = Array.from({ length: 12 }, (_, i) => addMonths(monthOf(forMonth), i + 1));
  const [date, setDate] = useState<string>(
    initial ?? (scheduling ? "" : months[0]),
  );

  return (
    <Modal
      open
      onClose={onCancel}
      size="sm"
      title={scheduling ? "Scheduled for which date?" : "Carried forward to which month?"}
      subtitle={
        scheduling
          ? "The day this piece goes out."
          : `It is for ${formatMonth(forMonth)}; pick a later month.`
      }
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={!date} onClick={() => date && onConfirm(date)}>
            Set {stage}
          </Button>
        </>
      }
    >
      {scheduling ? (
        <Field label="Date" required>
          {/* Posts go out on Sundays and holidays too. */}
          <DatePicker
            value={date}
            onChange={setDate}
            config={db.calendar}
            ignoreWorkingRules
            allowPast
            placeholder="Pick the day"
          />
        </Field>
      ) : (
        <Field label="Month" required>
          <Select value={date} onChange={(e) => setDate(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m)}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </Modal>
  );
}
