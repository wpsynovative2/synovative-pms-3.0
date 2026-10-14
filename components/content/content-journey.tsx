"use client";

import { IconCheck } from "@/components/ui/icons";
import { Badge, cx } from "@/components/ui/primitives";
import { formatDateTime, formatMonth } from "@/lib/calendar";
import { CONTENT_STAGE_STYLE } from "@/lib/master-data";
import { useStore } from "@/lib/store";
import { isContentEmpty, type ContentEntry } from "@/lib/types";

/*
 * Where a piece has been, as five steps left to right:
 *
 *   Created -> Started -> Ready To Design -> Allotted -> Completed
 *
 * A step is done when the piece's current state says so; its date comes from
 * the stamps the database keeps (0018). Pieces older than those stamps still
 * show their steps done, just without a date. A later step being done implies
 * the earlier ones were, so a piece written and moved straight to Design
 * Completed shows Ready To Design as passed.
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
): Step[] {
  const completed =
    entry.stage === "Design Completed" || entry.stage === "Scheduled";
  const allotted = !!entry.allottedTo;
  const ready =
    !!entry.readyAt ||
    entry.stage === "Ready To Design" ||
    completed ||
    allotted;
  const started = !isContentEmpty(entry) || !!entry.startedAt || ready;

  return [
    { label: "Created", done: true, at: entry.createdAt },
    {
      label: "Started",
      done: started,
      who: name(entry.createdBy),
      at: entry.startedAt,
    },
    { label: "Ready To Design", done: ready, at: entry.readyAt },
    {
      label: "Allotted",
      done: allotted,
      who: name(entry.allottedTo),
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
  const { userById } = useStore();
  const steps = journeySteps(entry, (id) => userById(id)?.fullName);
  // The step the piece is waiting on; none once everything is done.
  const current = steps.findIndex((s) => !s.done);
  // Cancelled and carried-forward pieces have stepped off the path.
  const offPath =
    entry.stage === "Cancelled" || entry.stage === "Carry Forwarded";

  return (
    <div className={cx("flex min-w-0 flex-col gap-2", className)}>
      <ol className="grid grid-cols-5" aria-label="Content journey">
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
