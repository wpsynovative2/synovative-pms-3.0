import { snapToWorkingDay, todayISO } from "./calendar";
import { workingDaysOn } from "./dependencies";
import type { CalendarConfig, FileGroup, FileItem, Task } from "./types";

/**
 * Files to receive (0016, 0018). The database decides when a group is received -
 * stamp_file_group() - and these mirror it so a tick shows at once. Tasks wait
 * on single files (`Task.fileItemIds`); a group's state is only for show.
 */

/** The files of one group, oldest first. */
export const filesOf = (groupId: string, items: FileItem[]) =>
  items.filter((f) => f.groupId === groupId);

/** "3/5": how many of a group's files are in. */
export function fileGroupProgress(groupId: string, items: FileItem[]) {
  const files = filesOf(groupId, items);
  return { total: files.length, received: files.filter((f) => f.received).length };
}

/**
 * Received once it has files and every one is in, on the day the last came in;
 * null otherwise. Mirrors stamp_file_group.
 */
export function groupReceivedOn(groupId: string, items: FileItem[]): string | null {
  const files = filesOf(groupId, items);
  if (!files.length || files.some((f) => !f.received)) return null;
  return files.reduce((last, f) => {
    const day = f.receivedOn ?? todayISO();
    return day > last ? day : last;
  }, "");
}

/** Puts every group's `receivedOn` right after its files changed on screen. */
export function restampGroups(groups: FileGroup[], items: FileItem[]): FileGroup[] {
  return groups.map((g) => {
    const receivedOn = groupReceivedOn(g.id, items);
    return receivedOn === g.receivedOn ? g : { ...g, receivedOn };
  });
}

/** "Chirag / DXF": a file with the group it is in, to tell same-named ones apart. */
export function fileLabel(item: Pick<FileItem, "groupId" | "name">, groups: FileGroup[]) {
  const group = groups.find((g) => g.id === item.groupId);
  return group ? `${group.name} / ${item.name}` : item.name;
}

/** Tasks waiting on any of `itemIds`, received or not. */
export const tasksOnFiles = (itemIds: string[], tasks: Task[]) =>
  tasks.filter((t) => t.fileItemIds?.some((id) => itemIds.includes(id)));

/**
 * What else `task` would still be waiting on once `itemIds` are settled - come
 * in or gone: its open tasks, and its other files not yet received.
 */
export function stillWaitingOn(task: Task, itemIds: string[]) {
  return {
    taskIds: task.waitingOnTaskIds ?? [],
    fileIds: (task.waitingOnFileItemIds ?? []).filter((id) => !itemIds.includes(id)),
  };
}

export const waitsOnNothingElse = (task: Task, itemIds: string[]) => {
  const rest = stillWaitingOn(task, itemIds);
  return rest.taskIds.length === 0 && rest.fileIds.length === 0;
};

/**
 * Where a task released today sits: today's working day, due `durationDays`
 * working days on. Mirrors follow_file_item.
 */
export function releasedToday(task: Pick<Task, "durationDays">, calendar: CalendarConfig) {
  const startDate = snapToWorkingDay(todayISO(), calendar);
  return { startDate, dueDate: workingDaysOn(startDate, task.durationDays ?? 0, calendar) };
}

/** Dates picked for the tasks a deletion frees, by task id (delete_file_item, 0018). */
export type FreedTaskDates = Record<string, { startDate: string; dueDate: string }>;

/** The shape delete_file_item / delete_file_group take. */
export const datesParam = (dates: FreedTaskDates) =>
  Object.fromEntries(
    Object.entries(dates).map(([id, d]) => [id, { start: d.startDate, due: d.dueDate }]),
  );
