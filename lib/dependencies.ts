import { addDays, snapToWorkingDay, todayISO } from "./calendar";
import { comparePlaces, groupPlaces } from "./task-groups";
import type { CalendarConfig, FileItem, Project, Task, TaskGroup } from "./types";

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
 * Where files still to come in (0016) count as settled: the project's start date, or today once that
 * has passed. Mirrors greatest(start_date, ist_today()) in schedule_dependent_task, which
 * reproject_file_waits re-applies each night while a file is still missing (0020).
 */
export function pendingFrom(project: Pick<Project, "startDate">) {
  const today = todayISO();
  return project.startDate > today ? project.startDate : today;
}

/**
 * A dependent task's dates when it is linked to `waitedOn` now: projected from
 * the latest due date among those still open (0021) and, if it waits on files
 * not yet in, the date `pendingFrom` gives (0016); from today once nothing is
 * open.
 */
export function dependentDates(
  waitedOn: Pick<Task, "status" | "dueDate">[],
  durationDays: number,
  calendar: CalendarConfig,
  startFrom: string | null = null,
) {
  const dates = [
    ...waitedOn.filter((t) => t.status !== "Approved").map((t) => t.dueDate),
    ...(startFrom ? [startFrom] : []),
  ];
  const from = dates.length ? dates.reduce((a, b) => (b > a ? b : a)) : todayISO();
  return projectedAfter(from, durationDays, calendar);
}

/**
 * Fills in `waitingOnTaskIds` and `waitingOnFileItemIds` from what is on
 * screen, so an approval or a file ticked here lifts the lock at once rather
 * than after the refetch. A task waited on that this user cannot see
 * counts as not waiting; the database still refuses a timer or submission on it.
 */
export function markWaiting(
  tasks: Task[],
  fileItems: Pick<FileItem, "id" | "received">[],
): Task[] {
  const status = new Map(tasks.map((t) => [t.id, t.status]));
  const notReceived = new Set(fileItems.filter((f) => !f.received).map((f) => f.id));
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  return tasks.map((t) => {
    const waiting = (t.dependsOnTaskIds ?? []).filter((id) => {
      const s = status.get(id);
      return s && s !== "Approved";
    });
    // A file this user cannot see counts as received, as with tasks above.
    const onFiles = (t.fileItemIds ?? []).filter((id) => notReceived.has(id));
    return same(waiting, t.waitingOnTaskIds ?? []) &&
      same(onFiles, t.waitingOnFileItemIds ?? [])
      ? t
      : {
          ...t,
          waitingOnTaskIds: waiting,
          waitingOnFileItemIds: onFiles,
        };
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
 * before it in number order (T1.1.1, T1.1.2, T1.2.1, T2.1.1), not the last one
 * created, because a task can be added to an earlier sub-group at any time. A new
 * task goes last in its sub-group, so that is the latest task at or before the
 * sub-group. Ungrouped tasks sit outside the chain. Mirrors place_task_in_chain.
 */
export function chainPredecessor(
  projectTasks: Task[],
  groups: TaskGroup[],
  groupId: string | null | undefined,
): Task | undefined {
  const places = groupPlaces(groups);
  const limit = groupId ? places.get(groupId) : undefined;
  if (!limit) return undefined;
  const place = (t: Task) => [...(places.get(t.groupId ?? "") ?? [0, 0]), t.groupNumber ?? 0];
  return projectTasks
    .filter(
      (t) =>
        t.kind === "standard" &&
        !!t.groupId &&
        places.has(t.groupId) &&
        comparePlaces(places.get(t.groupId)!, limit) <= 0,
    )
    .reduce<Task | undefined>(
      (last, t) => (!last || comparePlaces(place(t), place(last)) > 0 ? t : last),
      undefined,
    );
}
