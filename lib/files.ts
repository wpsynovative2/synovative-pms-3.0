import { todayISO } from "./calendar";
import type { FileGroup, FileItem } from "./types";

/**
 * Files to receive (0016). The database decides when a group is received -
 * stamp_file_group() - and these mirror it so a tick shows at once.
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
