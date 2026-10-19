import { addDays, snapToWorkingDay, todayISO } from "./calendar";
import type { CalendarConfig, Task } from "./types";

/**
 * Task dependencies and step-by-step projects (0014). A dependent task starts
 * the day the task it waits on is approved and is due `durationDays` working
 * days later; until then its dates are a projection from that task's due date.
 * The database is the authority — schedule_dependent_task() and
 * follow_task_dependency() — and these mirror it so forms can show the dates
 * before anything is saved.
 */

/**
 * `n` working days on from the first working day at or after `iso`. Unlike
 * addWorkingDays this keeps past dates, as add_working_days() does, so a
 * projection behind an overdue task matches the database.
 */
export function workingDaysOn(iso: string, n: number, calendar: CalendarConfig): string {
  let cursor = snapToWorkingDay(iso, calendar);
  for (let i = 0; i < Math.max(0, n); i++) {
    cursor = snapToWorkingDay(addDays(cursor, 1), calendar);
  }
  return cursor;
}

/** Where a task sits if it starts the day a task due on `dueDate` is approved. */
export function projectedAfter(dueDate: string, durationDays: number, calendar: CalendarConfig) {
  const startDate = snapToWorkingDay(dueDate, calendar);
  return { startDate, dueDate: workingDaysOn(startDate, durationDays, calendar) };
}

/**
 * A dependent task's dates when it is linked to `waitedOn` now: projected while
 * that task is open, from today once it is already approved.
 */
export function dependentDates(
  waitedOn: Pick<Task, "status" | "dueDate">,
  durationDays: number,
  calendar: CalendarConfig,
) {
  return waitedOn.status === "Approved"
    ? projectedAfter(todayISO(), durationDays, calendar)
    : projectedAfter(waitedOn.dueDate, durationDays, calendar);
}

/**
 * Fills in `waitingOnTaskId` from the statuses on screen, so an approval made
 * here lifts the lock at once rather than after the refetch. A task waited on
 * that this user cannot see counts as not waiting; the database still refuses
 * a timer or submission on it.
 */
export function markWaiting(tasks: Task[]): Task[] {
  const status = new Map(tasks.map((t) => [t.id, t.status]));
  return tasks.map((t) => {
    const s = t.dependsOnTaskId ? status.get(t.dependsOnTaskId) : undefined;
    const waiting = s && s !== "Approved" ? t.dependsOnTaskId! : null;
    return waiting === (t.waitingOnTaskId ?? null) ? t : { ...t, waitingOnTaskId: waiting };
  });
}

/**
 * Tasks `taskId` may wait on: the rest of its project, minus anything already
 * waiting on it somewhere down the line, which would make a loop.
 */
export function dependencyCandidates(
  taskId: string | null,
  projectTasks: Task[],
): Task[] {
  const byId = new Map(projectTasks.map((t) => [t.id, t]));
  const leadsBack = (id: string) => {
    let cursor: string | null | undefined = id;
    for (let i = 0; cursor && i < 1000; i++) {
      if (cursor === taskId) return true;
      cursor = byId.get(cursor)?.dependsOnTaskId;
    }
    return false;
  };
  return projectTasks.filter((t) => t.id !== taskId && (!taskId || !leadsBack(t.id)));
}

/**
 * What a new task in a step-by-step project waits on by default: the last
 * standard task created there. Content tasks sit outside the chain.
 */
export function chainTail(projectTasks: Task[]): Task | undefined {
  return projectTasks
    .filter((t) => t.kind === "standard")
    .reduce<Task | undefined>(
      (last, t) => (!last || t.createdAt >= last.createdAt ? t : last),
      undefined,
    );
}
