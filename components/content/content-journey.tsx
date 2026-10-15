"use client";

import { IconCheck } from "@/components/ui/icons";
import { Badge, cx } from "@/components/ui/primitives";
import { formatDateTime, formatMonth } from "@/lib/calendar";
import { CONTENT_STAGE_STYLE } from "@/lib/master-data";
import { useStore } from "@/lib/store";
import {
  contentHolders,
  isContentStarted,
  isFullyAllotted,
  type ContentEntry,
  type Task,
} from "@/lib/types";

/*
 * Where a piece has been, as six steps left to right:
 *
 *   Created -> Assigned to writer -> Started -> Ready To Design
 *           -> Allotted to designer -> Completed
 *
 * A step is done when the piece's current state says so; its date comes from
 * the stamps the database keeps (0018). Pieces older than those stamps still
 * show their steps done, just without a date. Started is only ever its own
 * stamp or something written (0027) - setting a status does not imply it.
 */

interface Step {
  label: string;
  done: boolean;
  /** Who, when it names a person. */
  who?: string;
  at: string | null;
}

/** "14 Oct", in the viewer's own time zone - a UTC timestamp sliced would not be. */
const shortDay = (ts: string) =>
  new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export function journeySteps(
  entry: ContentEntry,
  name: (id: string | null) => string | undefined,
  /** The content task the piece is a part of, when it is on one. */
  task: Pick<Task, "assigneeId" | "status"> | null,
): Step[] {
  // The content task being approved closes every piece on it.
  const completed =
    entry.stage === "Design Completed" ||
    entry.stage === "Scheduled" ||
    task?.status === "Approved";
  // A Static to Motion piece is allotted once both its parts are.
  const allotted = isFullyAllotted(entry);
  const ready =
    !!entry.readyAt ||
    entry.stage === "Ready To Design" ||
    entry.stage === "Design Completed" ||
    entry.stage === "Scheduled" ||
    !!entry.allottedTo;
  const started = isContentStarted(entry);
  // A piece written outside a task was its author's from the start.
  const writer = entry.taskId ? (task?.assigneeId ?? null) : entry.createdBy;

  return [
    { label: "Created", done: true, at: entry.createdAt },
    {
      label: "Assigned to writer",
      done: !!writer,
      who: name(writer),
      at: null,
    },
    {
      label: "Started",
      done: started,
      who: name(entry.startedBy ?? (started ? writer : null)),
      at: entry.startedAt,
    },
    { label: "Ready To Design", done: ready, at: entry.readyAt },
    {
      label: "Allotted to designer",
      done: allotted,
      who: contentHolders(entry)
        .map((id) => name(id))
        .filter(Boolean)
        .join(" → "),
      at: entry.allottedAt,
    },
    {
      label:
        entry.stage === "Scheduled" ? "Completed · Scheduled" : "Completed",
      done: completed,
      at: entry.completedAt,
    },
  ];
}

export function ContentJourney({
  entry,
  className,
}: {
  entry: ContentEntry;
  className?: string;
}) {
  const { userById, taskById } = useStore();
  const task = (entry.taskId ? taskById(entry.taskId) : undefined) ?? null;
  const steps = journeySteps(entry, (id) => userById(id)?.fullName, task);
  // The step the piece is waiting on; none once everything is done.
  const current = steps.findIndex((s) => !s.done);
  // Cancelled and carried-forward pieces have stepped off the path.
  const offPath =
    entry.stage === "Cancelled" || entry.stage === "Carry Forwarded";

  return (
    <div className={cx("flex min-w-0 flex-col gap-2", className)}>
      <ol className="grid grid-cols-6" aria-label="Content journey">
        {steps.map((s, i) => {
          const isCurrent = i === current && !offPath;
          const lineDone = i < steps.length - 1 && steps[i + 1].done;
          return (
            <li
              key={s.label}
              className="relative flex min-w-0 flex-col items-center px-1 text-center"
              aria-current={isCurrent ? "step" : undefined}
              title={s.at ? `${s.label}: ${formatDateTime(s.at)}` : s.label}
            >
              {/* The connector to the next step, drawn from this dot's centre. */}
              {i < steps.length - 1 ? (
                <span
                  aria-hidden
                  className={cx(
                    "absolute top-3 left-1/2 h-0.5 w-full",
                    lineDone ? "bg-st-approved" : "bg-line",
                  )}
                />
              ) : null}
              <span
                className={cx(
                  "relative z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold",
                  s.done
                    ? "border-st-approved bg-st-approved text-on-brand"
                    : isCurrent
                      ? "border-brand-bright bg-surface text-brand-bright ring-4 ring-brand/15"
                      : "border-line bg-surface-3 text-ink-faint",
                )}
              >
                {s.done ? <IconCheck size={12} /> : i + 1}
              </span>
              <span
                className={cx(
                  "mt-1.5 line-clamp-2 text-[11px] leading-tight font-medium",
                  s.done
                    ? "text-ink"
                    : isCurrent
                      ? "text-brand-bright"
                      : "text-ink-faint",
                )}
              >
                {s.label}
              </span>
              {s.done && s.who ? (
                <span className="mt-0.5 max-w-full truncate text-[10px] text-ink-muted">
                  {s.who}
                </span>
              ) : null}
              <span className="mt-0.5 text-[10px] text-ink-faint">
                {s.done
                  ? s.at
                    ? shortDay(s.at)
                    : "Done"
                  : isCurrent
                    ? "Next"
                    : ""}
              </span>
            </li>
          );
        })}
      </ol>
      {offPath ? (
        <div className="flex justify-center">
          <Badge className={CONTENT_STAGE_STYLE[entry.stage!]}>
            {entry.stage === "Cancelled"
              ? "Cancelled"
              : `Carried forward${entry.carryMonth ? ` to ${formatMonth(entry.carryMonth)}` : ""}`}
          </Badge>
        </div>
      ) : null}
    </div>
  );
}
