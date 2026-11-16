import { groupCodes } from "./task-groups";
import type { Short, Task, TaskGroup } from "./types";

/*
 * Shorts in a 3D project (0035): Shorts → SH1 → Cam1.1. A cam is a task that
 * renders any mix of groups, sub-groups and tasks (0036). It is ready to render
 * once all of that work is approved: every task named, and every task in each
 * group or sub-group named. Worked out here each time, never stored.
 */

export type RenderKind = "group" | "sub-group" | "task";

export interface RenderTarget {
  id: string;
  kind: RenderKind;
  /** "T1", "T1.2" or "T1.2.3". */
  code: string;
  name: string;
  /** The tasks it covers: the task itself, or every task in the group. */
  taskIds: string[];
  approved: number;
  total: number;
  /** Something to render, and all of it approved. */
  ready: boolean;
}

export interface CamReadiness {
  targets: RenderTarget[];
  /** Over every task covered, each counted once however it was picked. */
  approved: number;
  total: number;
  ready: boolean;
}

/** The tasks inside a group or sub-group: a group's are in its sub-groups (0033). */
export function tasksInGroup(group: TaskGroup, groups: TaskGroup[], tasks: Task[]): Task[] {
  const inside = new Set([group.id, ...groups.filter((g) => g.parentId === group.id).map((g) => g.id)]);
  return tasks.filter((t) => !!t.groupId && inside.has(t.groupId));
}

const tally = (covered: Task[]) => {
  const approved = covered.filter((t) => t.status === "Approved").length;
  return {
    approved,
    total: covered.length,
    ready: covered.length > 0 && approved === covered.length,
  };
};

/**
 * Everything a cam renders, in number order, and how far it has got. Anything
 * deleted since it was picked is skipped.
 */
export function camReadiness(
  cam: Pick<Task, "renderGroupIds" | "renderTaskIds">,
  groups: TaskGroup[],
  tasks: Task[],
): CamReadiness {
  const codes = groupCodes(groups);
  const targets: RenderTarget[] = [];

  for (const id of cam.renderGroupIds ?? []) {
    const group = groups.find((g) => g.id === id);
    if (!group) continue;
    const covered = tasksInGroup(group, groups, tasks);
    targets.push({
      id,
      kind: group.parentId ? "sub-group" : "group",
      code: codes.get(group.id) ?? "",
      name: group.name,
      taskIds: covered.map((t) => t.id),
      ...tally(covered),
    });
  }
  for (const id of cam.renderTaskIds ?? []) {
    const task = tasks.find((t) => t.id === id);
    if (!task) continue;
    targets.push({
      id,
      kind: "task",
      code: task.code ?? "",
      name: task.title,
      taskIds: [task.id],
      ...tally([task]),
    });
  }
  targets.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  const ids = new Set(targets.flatMap((t) => t.taskIds));
  return { targets, ...tally(tasks.filter((t) => ids.has(t.id))) };
}

/** "T1 Club house, T2.1 Exterior and 2 more", for one line. */
export function describeTargets(targets: RenderTarget[], shown = 2): string {
  if (!targets.length) return "nothing yet";
  const named = targets.slice(0, shown).map((t) => `${t.code} ${t.name}`);
  const rest = targets.length - named.length;
  return rest > 0 ? `${named.join(", ")} and ${rest} more` : named.join(", ");
}

/** A short's cams, in number order. */
export const camsOf = (short: Pick<Short, "id">, tasks: Task[]) =>
  tasks
    .filter((t) => t.shortId === short.id)
    .sort((a, b) => (a.shortNumber ?? 0) - (b.shortNumber ?? 0));

/** Frames given out to the children, against what the parent has. */
export const framesUsed = (children: { frames?: number | null }[]) =>
  children.reduce((sum, c) => sum + (c.frames ?? 0), 0);

export const formatFrames = (n: number) => n.toLocaleString("en-IN");
