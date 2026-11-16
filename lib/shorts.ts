import { groupCodes } from "./task-groups";
import type { Short, Task, TaskGroup } from "./types";

/*
 * Shorts in a 3D project (0035): Shorts → SH1 → Cam1.1. A cam is a task that
 * renders a group, a sub-group or a task. It is ready to render once that work is
 * approved: the task itself, or every task in the group or sub-group. Worked out
 * here each time, never stored.
 */

export interface RenderTarget {
  kind: "group" | "sub-group" | "task";
  /** "T1", "T1.2" or "T1.2.3". */
  code: string;
  name: string;
  approved: number;
  total: number;
  /** Something to render, and all of it approved. */
  ready: boolean;
}

/** What a cam renders and how far it has got; null when it renders nothing. */
export function renderTarget(
  cam: Pick<Task, "renderGroupId" | "renderTaskId">,
  groups: TaskGroup[],
  tasks: Task[],
): RenderTarget | null {
  const count = (inside: Task[]) => {
    const approved = inside.filter((t) => t.status === "Approved").length;
    return { approved, total: inside.length, ready: inside.length > 0 && approved === inside.length };
  };

  if (cam.renderTaskId) {
    const task = tasks.find((t) => t.id === cam.renderTaskId);
    if (!task) return null;
    return { kind: "task", code: task.code ?? "", name: task.title, ...count([task]) };
  }
  if (cam.renderGroupId) {
    const group = groups.find((g) => g.id === cam.renderGroupId);
    if (!group) return null;
    // A group's work is in its sub-groups (0033).
    const inside = new Set([
      group.id,
      ...groups.filter((g) => g.parentId === group.id).map((g) => g.id),
    ]);
    return {
      kind: group.parentId ? "sub-group" : "group",
      code: groupCodes(groups).get(group.id) ?? "",
      name: group.name,
      ...count(tasks.filter((t) => !!t.groupId && inside.has(t.groupId))),
    };
  }
  return null;
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
