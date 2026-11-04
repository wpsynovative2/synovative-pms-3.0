"use client";

import { useMemo } from "react";
import { Button, Card, SearchInput, Select } from "@/components/ui/primitives";
import { isOverdue } from "@/lib/analytics";
import {
  PRIORITIES,
  TASK_STATUSES,
  THREE_D_CATEGORIES,
  THREE_D_SOFTWARE,
} from "@/lib/master-data";
import { useStore } from "@/lib/store";
import type { Priority, Task, TaskGroup, TaskStatus, ThreeDCategory, ThreeDSoftware } from "@/lib/types";

export interface ThreeDFilterState {
  query: string;
  category: ThreeDCategory | "all";
  software: ThreeDSoftware | "all";
  status: TaskStatus | "all" | "open" | "overdue";
  priority: Priority | "all";
  /** A group's id, or "none" for tasks outside any group. */
  groupId: string;
  /** Someone's id, or "none" for nobody yet. */
  assigneeId: string;
}

export const emptyThreeDFilters: ThreeDFilterState = {
  query: "",
  category: "all",
  software: "all",
  status: "all",
  priority: "all",
  groupId: "all",
  assigneeId: "all",
};

export const isFilteringThreeD = (f: ThreeDFilterState) =>
  JSON.stringify(f) !== JSON.stringify(emptyThreeDFilters);

export function applyThreeDFilters(tasks: Task[], f: ThreeDFilterState): Task[] {
  const q = f.query.trim().toLowerCase();
  return tasks.filter((t) => {
    if (
      q &&
      !t.title.toLowerCase().includes(q) &&
      !t.code?.toLowerCase().includes(q) &&
      !t.tags.some((x) => x.toLowerCase().includes(q))
    ) {
      return false;
    }
    if (f.category !== "all" && t.threeDCategory !== f.category) return false;
    if (f.software !== "all" && t.threeDSoftware !== f.software) return false;
    if (f.status === "open") {
      if (t.status === "Approved") return false;
    } else if (f.status === "overdue") {
      if (!isOverdue(t)) return false;
    } else if (f.status !== "all" && t.status !== f.status) return false;
    if (f.priority !== "all" && t.priority !== f.priority) return false;
    if (f.groupId === "none") {
      if (t.groupId) return false;
    } else if (f.groupId !== "all" && t.groupId !== f.groupId) return false;
    if (f.assigneeId === "none") {
      if (t.assigneeId !== null) return false;
    } else if (f.assigneeId !== "all" && t.assigneeId !== f.assigneeId) return false;
    return true;
  });
}

/** Narrows the tasks on a 3D project's page. Nothing is saved. */
export function ThreeDTaskFilters({
  value,
  onChange,
  tasks,
  groups,
  shown,
}: {
  value: ThreeDFilterState;
  onChange: (next: ThreeDFilterState) => void;
  /** Every task of the project. */
  tasks: Task[];
  groups: TaskGroup[];
  /** How many tasks the filters leave. */
  shown: number;
}) {
  const { db } = useStore();
  const set = <K extends keyof ThreeDFilterState>(k: K, v: ThreeDFilterState[K]) =>
    onChange({ ...value, [k]: v });

  // Only people with work here, so the list stays short.
  const assignees = useMemo(() => {
    const ids = new Set(tasks.map((t) => t.assigneeId));
    return db.users
      .filter((u) => ids.has(u.id))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [tasks, db.users]);

  return (
    <Card className="flex flex-wrap items-center gap-2.5 p-3.5">
      <SearchInput
        className="min-w-52 flex-1"
        placeholder="Search tasks, T1.2 or tags…"
        aria-label="Search tasks"
        value={value.query}
        active={!!value.query.trim()}
        onChange={(e) => set("query", e.target.value)}
      />

      <Select
        className="w-auto min-w-36"
        value={value.category}
        active={value.category !== "all"}
        onChange={(e) => set("category", e.target.value as ThreeDFilterState["category"])}
        aria-label="Task category"
      >
        <option value="all">All categories</option>
        {THREE_D_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </Select>

      <Select
        className="w-auto min-w-32"
        value={value.software}
        active={value.software !== "all"}
        onChange={(e) => set("software", e.target.value as ThreeDFilterState["software"])}
        aria-label="Software"
      >
        <option value="all">All software</option>
        {THREE_D_SOFTWARE.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>

      <Select
        className="w-auto min-w-36"
        value={value.status}
        active={value.status !== "all"}
        onChange={(e) => set("status", e.target.value as ThreeDFilterState["status"])}
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
        onChange={(e) => set("priority", e.target.value as ThreeDFilterState["priority"])}
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
        className="w-auto min-w-32"
        value={value.groupId}
        active={value.groupId !== "all"}
        onChange={(e) => set("groupId", e.target.value)}
        aria-label="Group"
      >
        <option value="all">All groups</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            T{g.number} {g.name}
          </option>
        ))}
        {tasks.some((t) => !t.groupId) ? <option value="none">Ungrouped</option> : null}
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

      {isFilteringThreeD(value) ? (
        <span className="flex items-center gap-2.5">
          <span className="text-[12px] text-ink-muted">
            {shown} of {tasks.length} task{tasks.length === 1 ? "" : "s"}
          </span>
          <Button size="sm" onClick={() => onChange(emptyThreeDFilters)}>
            Clear
          </Button>
        </span>
      ) : null}
    </Card>
  );
}
