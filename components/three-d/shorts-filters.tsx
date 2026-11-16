"use client";

import { useMemo } from "react";
import { Button, Card, SearchInput, Select } from "@/components/ui/primitives";
import { isOverdue } from "@/lib/analytics";
import { PRIORITIES, TASK_STATUSES } from "@/lib/master-data";
import { camReadiness, tasksInGroup } from "@/lib/shorts";
import { useStore } from "@/lib/store";
import { groupTree } from "@/lib/task-groups";
import type { Priority, Short, Task, TaskGroup, TaskStatus } from "@/lib/types";

export interface ShortsFilterState {
  query: string;
  /** A short's id. */
  shortId: string;
  /** Whether what it renders is all approved; "none" renders nothing yet. */
  ready: "all" | "ready" | "waiting" | "none";
  status: TaskStatus | "all" | "open" | "overdue";
  priority: Priority | "all";
  /** A group's or sub-group's id: cams rendering any of its work. */
  renders: string;
  /** Someone's id, or "none" for nobody yet. */
  assigneeId: string;
}

export const emptyShortsFilters: ShortsFilterState = {
  query: "",
  shortId: "all",
  ready: "all",
  status: "all",
  priority: "all",
  renders: "all",
  assigneeId: "all",
};

export const isFilteringShorts = (f: ShortsFilterState) =>
  JSON.stringify(f) !== JSON.stringify(emptyShortsFilters);

/** The cams the filters leave (0035, 0036). */
export function applyShortsFilters(
  cams: Task[],
  f: ShortsFilterState,
  groups: TaskGroup[],
  tasks: Task[],
): Task[] {
  const q = f.query.trim().toLowerCase();
  const rendersGroup = f.renders === "all" ? undefined : groups.find((g) => g.id === f.renders);
  // A group's work: itself, its sub-groups and every task in them.
  const inRendersGroup = rendersGroup
    ? new Set([
        rendersGroup.id,
        ...groups.filter((g) => g.parentId === rendersGroup.id).map((g) => g.id),
        ...tasksInGroup(rendersGroup, groups, tasks).map((t) => t.id),
      ])
    : null;

  return cams.filter((cam) => {
    if (q && !cam.title.toLowerCase().includes(q) && !cam.code?.toLowerCase().includes(q)) {
      return false;
    }
    if (f.shortId !== "all" && cam.shortId !== f.shortId) return false;
    if (f.status === "open") {
      if (cam.status === "Approved") return false;
    } else if (f.status === "overdue") {
      if (!isOverdue(cam)) return false;
    } else if (f.status !== "all" && cam.status !== f.status) return false;
    if (f.priority !== "all" && cam.priority !== f.priority) return false;
    if (f.assigneeId === "none") {
      if (cam.assigneeId !== null) return false;
    } else if (f.assigneeId !== "all" && cam.assigneeId !== f.assigneeId) return false;

    if (f.ready !== "all" || inRendersGroup) {
      const readiness = camReadiness(cam, groups, tasks);
      if (f.ready === "ready" && !readiness.ready) return false;
      if (f.ready === "waiting" && (readiness.ready || !readiness.targets.length)) return false;
      if (f.ready === "none" && readiness.targets.length) return false;
      if (
        inRendersGroup &&
        !readiness.targets.some(
          (t) => inRendersGroup.has(t.id) || t.taskIds.some((id) => inRendersGroup.has(id)),
        )
      ) {
        return false;
      }
    }
    return true;
  });
}

/** Narrows the cams on a 3D project's Shorts tab. Nothing is saved. */
export function ShortsFilters({
  value,
  onChange,
  cams,
  shorts,
  groups,
  shown,
}: {
  value: ShortsFilterState;
  onChange: (next: ShortsFilterState) => void;
  /** Every cam of the project. */
  cams: Task[];
  shorts: Short[];
  /** The project's groups and sub-groups. */
  groups: TaskGroup[];
  /** How many cams the filters leave. */
  shown: number;
}) {
  const { db } = useStore();
  const set = <K extends keyof ShortsFilterState>(k: K, v: ShortsFilterState[K]) =>
    onChange({ ...value, [k]: v });
  const tree = useMemo(
    () => (groups[0] ? groupTree(groups, groups[0].projectId) : []),
    [groups],
  );
  // Only people with a cam here, so the list stays short.
  const assignees = useMemo(() => {
    const ids = new Set(cams.map((t) => t.assigneeId));
    return db.users
      .filter((u) => ids.has(u.id))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [cams, db.users]);

  return (
    <Card className="flex flex-wrap items-center gap-2.5 p-3.5">
      <SearchInput
        className="min-w-52 flex-1"
        placeholder="Search cams or Cam1.2…"
        aria-label="Search cams"
        value={value.query}
        active={!!value.query.trim()}
        onChange={(e) => set("query", e.target.value)}
      />

      <Select
        className="w-auto min-w-32"
        value={value.shortId}
        active={value.shortId !== "all"}
        onChange={(e) => set("shortId", e.target.value)}
        aria-label="Short"
      >
        <option value="all">All shorts</option>
        {shorts.map((s) => (
          <option key={s.id} value={s.id}>
            SH{s.number} {s.title}
          </option>
        ))}
      </Select>

      <Select
        className="w-auto min-w-36"
        value={value.ready}
        active={value.ready !== "all"}
        onChange={(e) => set("ready", e.target.value as ShortsFilterState["ready"])}
        aria-label="Ready to render"
      >
        <option value="all">Ready or not</option>
        <option value="ready">Ready to render</option>
        <option value="waiting">Not ready yet</option>
        <option value="none">Renders nothing yet</option>
      </Select>

      <Select
        className="w-auto min-w-36"
        value={value.status}
        active={value.status !== "all"}
        onChange={(e) => set("status", e.target.value as ShortsFilterState["status"])}
        aria-label="Status"
      >
        <option value="all">All statuses</option>
        <option value="open">Open (not approved)</option>
        <option value="overdue">Overdue</option>
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>

      <Select
        className="w-auto min-w-32"
        value={value.priority}
        active={value.priority !== "all"}
        onChange={(e) => set("priority", e.target.value as ShortsFilterState["priority"])}
        aria-label="Priority"
      >
        <option value="all">All priorities</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </Select>

      <Select
        className="w-auto min-w-36"
        value={value.renders}
        active={value.renders !== "all"}
        onChange={(e) => set("renders", e.target.value)}
        aria-label="Renders"
      >
        <option value="all">Renders anything</option>
        {tree.map(({ group, subGroups }) => [
          <option key={group.id} value={group.id}>
            Renders T{group.number} {group.name}
          </option>,
          ...subGroups.map((s) => (
            <option key={s.id} value={s.id}>
              {"   "}T{group.number}.{s.number} {s.name}
            </option>
          )),
        ])}
      </Select>

      <Select
        className="w-auto min-w-36"
        value={value.assigneeId}
        active={value.assigneeId !== "all"}
        onChange={(e) => set("assigneeId", e.target.value)}
        aria-label="Assigned to"
      >
        <option value="all">Anyone</option>
        <option value="none">Nobody yet</option>
        {assignees.map((u) => (
          <option key={u.id} value={u.id}>
            {u.fullName}
          </option>
        ))}
      </Select>

      {isFilteringShorts(value) ? (
        <span className="flex items-center gap-2.5">
          <span className="text-[12px] text-ink-muted">
            {shown} of {cams.length} cam{cams.length === 1 ? "" : "s"}
          </span>
          <Button size="sm" onClick={() => onChange(emptyShortsFilters)}>
            Clear
          </Button>
        </span>
      ) : null}
    </Card>
  );
}
