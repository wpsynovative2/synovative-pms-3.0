import type { TaskGroup } from "./types";

/*
 * The three levels of a 3D project (0022, 0033): a group T1 holds sub-groups T1.1,
 * T1.2, and a sub-group holds tasks T1.1.1, T1.1.2. Codes are put together from the
 * numbers on screen, never stored, so a rename cannot break them.
 */

/** "T1" for each group and "T1.2" for each sub-group, by id. */
export function groupCodes(groups: TaskGroup[]): Map<string, string> {
  const top = new Map(groups.filter((g) => !g.parentId).map((g) => [g.id, g.number]));
  const codes = new Map<string, string>();
  for (const g of groups) {
    if (!g.parentId) codes.set(g.id, `T${g.number}`);
    else if (top.has(g.parentId)) codes.set(g.id, `T${top.get(g.parentId)}.${g.number}`);
  }
  return codes;
}

/** "T1.2.3" for task 3 of sub-group T1.2. */
export const taskCodeIn = (groupCode: string, groupNumber: number | null | undefined) =>
  `${groupCode}.${groupNumber ?? 0}`;

/**
 * Where each group sits in number order, as task_group_place does: [1, 2] for
 * T1.2, and [1, 0] for T1 itself.
 */
export function groupPlaces(groups: TaskGroup[]): Map<string, [number, number]> {
  const top = new Map(groups.filter((g) => !g.parentId).map((g) => [g.id, g.number]));
  const places = new Map<string, [number, number]>();
  for (const g of groups) {
    if (!g.parentId) places.set(g.id, [g.number, 0]);
    else if (top.has(g.parentId)) places.set(g.id, [top.get(g.parentId)!, g.number]);
  }
  return places;
}

/** Negative when `a` comes first in number order. */
export function comparePlaces(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** The project's groups in number order, each with its sub-groups in number order. */
export function groupTree(
  groups: TaskGroup[],
  projectId: string,
): { group: TaskGroup; subGroups: TaskGroup[] }[] {
  const mine = groups.filter((g) => g.projectId === projectId);
  return mine
    .filter((g) => !g.parentId)
    .sort((a, b) => a.number - b.number)
    .map((group) => ({
      group,
      subGroups: mine
        .filter((s) => s.parentId === group.id)
        .sort((a, b) => a.number - b.number),
    }));
}
