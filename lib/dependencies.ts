import { addDays, snapToWorkingDay, todayISO } from "./calendar";
import type { CalendarConfig, Task, TaskGroup } from "./types";

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
 * A dependent task's dates when it is linked to `waitedOn` now: projected from
 * the latest due date among those still open (0021), from today once all of them
 * are approved.
 */
export function dependentDates(
  waitedOn: Pick<Task, "status" | "dueDate">[],
  durationDays: number,
  calendar: CalendarConfig,
) {
  const open = waitedOn.filter((t) => t.status !== "Approved");
  const from = open.length
    ? open.reduce((latest, t) => (t.dueDate > latest ? t.dueDate : latest), open[0].dueDate)
    : todayISO();
  return projectedAfter(from, durationDays, calendar);
}

/**
 * Fills in `waitingOnTaskIds` from the statuses on screen, so an approval made
 * here lifts the lock at once rather than after the refetch. A task waited on
 * that this user cannot see counts as not waiting; the database still refuses
 * a timer or submission on it.
 */
export function markWaiting(tasks: Task[]): Task[] {
  const status = new Map(tasks.map((t) => [t.id, t.status]));
  return tasks.map((t) => {
    const waiting = (t.dependsOnTaskIds ?? []).filter((id) => {
      const s = status.get(id);
      return s && s !== "Approved";
    });
    const had = t.waitingOnTaskIds ?? [];
    return waiting.length === had.length && waiting.every((id, i) => id === had[i])
      ? t
      : { ...t, waitingOnTaskIds: waiting };
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
    // Every task `id` waits on, however far up. A task can wait on several.
    const seen = new Set<string>();
    const queue = [id];
    while (queue.length) {
      const cursor = queue.pop()!;
      if (cursor === taskId) return true;
      if (seen.has(cursor)) continue;
      seen.add(cursor);
      queue.push(...(byId.get(cursor)?.dependsOnTaskIds ?? []));
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

/**
 * What a new task waits on by default in a step-by-step 3D project: the one
 * before it in number order, not the last one created, because a task can be added
 * to an earlier group at any time. A new task goes last in its group, so that is
 * the latest task at or before the group. Ungrouped tasks sit outside the chain.
 */
export function chainPredecessor(
  projectTasks: Task[],
  groups: TaskGroup[],
  groupId: string | null | undefined,
): Task | undefined {
  const numberOf = new Map(groups.map((g) => [g.id, g.number]));
  const limit = groupId ? numberOf.get(groupId) : undefined;
  if (limit === undefined) return undefined;
  const place = (t: Task) => [numberOf.get(t.groupId ?? "") ?? 0, t.groupNumber ?? 0] as const;
  return projectTasks
    .filter((t) => t.kind === "standard" && t.groupId && place(t)[0] <= limit)
    .reduce<Task | undefined>((last, t) => {
      if (!last) return t;
      const [g, n] = place(t);
      const [lg, ln] = place(last);
      return g > lg || (g === lg && n > ln) ? t : last;
    }, undefined);
}
