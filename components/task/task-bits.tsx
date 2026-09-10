"use client";

import Link from "next/link";
import { formatShortDate, todayISO } from "@/lib/calendar";
import { PRIORITY_STYLE, TASK_STATUS_STYLE } from "@/lib/master-data";
import { isTimerPaused, isTimerRunning } from "@/lib/time";
import type { Priority, Project, Task, TaskStatus } from "@/lib/types";
import { Badge, cx } from "@/components/ui/primitives";

export function StatusBadge({
  status,
  task,
}: {
  status: TaskStatus;
  /** When given, In Progress also shows Running / Paused (§5.3). */
  task?: Task;
}) {
  const style = TASK_STATUS_STYLE[status];
  const running = task ? isTimerRunning(task) : false;
  const paused = task ? isTimerPaused(task) : false;

  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge className={style.chip} dot={style.dot}>
        {status}
      </Badge>
      {status === "In Progress" && (running || paused) ? (
        <span
          className={cx(
            "inline-flex items-center gap-1 text-[10px] font-medium",
            running ? "text-st-inprogress" : "text-ink-faint",
          )}
        >
          <span
            className={cx(
              "h-1.5 w-1.5 rounded-full",
              running ? "animate-pulse-dot bg-st-inprogress" : "bg-ink-faint",
            )}
          />
          {running ? "Running" : "Paused"}
        </span>
      ) : null}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <Badge className={PRIORITY_STYLE[priority]}>{priority}</Badge>;
}

/** Red overdue flag — due date passed and not yet Approved (§5.3). */
export function OverdueBadge({ task }: { task: Task }) {
  if (task.status === "Approved" || task.dueDate >= todayISO()) return null;
  return (
    <Badge className="border-st-rejected/40 bg-st-rejected/20 text-st-rejected">
      Overdue
    </Badge>
  );
}

export function ProjectChip({
  project,
  href,
}: {
  project: Project | null | undefined;
  href?: string;
}) {
  if (!project) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-faint">
        <span className="h-2 w-2 rounded-[3px] bg-ink-faint/60" />
        Individual task
      </span>
    );
  }
  const inner = (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
      <span
        className="h-2 w-2 shrink-0 rounded-[3px]"
        style={{ background: project.color }}
      />
      <span className="max-w-48 truncate">{project.name}</span>
    </span>
  );
  return href ? (
    <Link href={href} className="hover:underline">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function DueDate({ task }: { task: Task }) {
  const overdue = task.status !== "Approved" && task.dueDate < todayISO();
  return (
    <span
      className={cx("text-[11px]", overdue ? "text-st-rejected" : "text-ink-muted")}
    >
      Due {formatShortDate(task.dueDate)}
    </span>
  );
}
