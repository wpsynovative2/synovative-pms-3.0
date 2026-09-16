"use client";

import { useMemo } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { IconFilter, IconTasks } from "@/components/ui/icons";
import {
  Avatar,
  Card,
  EmptyState,
  SearchInput,
  Select,
  cx,
} from "@/components/ui/primitives";
import { DEPARTMENTS, PRIORITIES, TASK_STATUS_STYLE, TASK_STATUSES } from "@/lib/master-data";
import { useStore } from "@/lib/store";
import { formatDuration, isTimerRunning, taskElapsedMs } from "@/lib/time";
import type { Priority, Task, TaskStatus, User } from "@/lib/types";
import {
  DueDate,
  OverdueBadge,
  PriorityBadge,
  ProjectChip,
  RecurrenceBadge,
  StatusBadge,
} from "./task-bits";

/* ---------------------------------------------------------------- filters */

export interface TaskFilterState {
  query: string;
  status: TaskStatus | "all" | "open";
  priority: Priority | "all";
  department: string;
  assigneeId: string;
  from: string;
  to: string;
  tag: string;
}

export const emptyTaskFilters: TaskFilterState = {
  query: "",
  status: "all",
  priority: "all",
  department: "all",
  assigneeId: "all",
  from: "",
  to: "",
  tag: "all",
};

/**
 * Filters, then orders the list the way the work actually queues up: soonest
 * due date first, with finished (Approved) tasks pushed to the bottom so they
 * stop competing with what still needs doing.
 */
export function applyTaskFilters(tasks: Task[], f: TaskFilterState): Task[] {
  const q = f.query.trim().toLowerCase();
  const done = (t: Task) => (t.status === "Approved" ? 1 : 0);
  const matched = tasks.filter((t) => {
    if (q && !t.title.toLowerCase().includes(q) && !t.tags.some((x) => x.toLowerCase().includes(q)))
      return false;
    if (f.status === "open") {
      if (t.status === "Approved") return false;
    } else if (f.status !== "all" && t.status !== f.status) return false;
    if (f.priority !== "all" && t.priority !== f.priority) return false;
    if (f.department !== "all" && t.department !== f.department) return false;
    if (f.assigneeId !== "all" && t.assigneeId !== f.assigneeId) return false;
    if (f.tag !== "all" && !t.tags.includes(f.tag)) return false;
    if (f.from && t.dueDate < f.from) return false;
    if (f.to && t.dueDate > f.to) return false;
    return true;
  });
  return matched.sort(
    (a, b) =>
      done(a) - done(b) ||
      a.dueDate.localeCompare(b.dueDate) ||
      a.title.localeCompare(b.title),
  );
}

export function TaskFilters({
  value,
  onChange,
  users,
  tags,
  showDepartment = true,
  showAssignee = true,
  showTags = true,
}: {
  value: TaskFilterState;
  onChange: (next: TaskFilterState) => void;
  users: User[];
  tags?: string[];
  showDepartment?: boolean;
  showAssignee?: boolean;
  showTags?: boolean;
}) {
  const { db } = useStore();
  const set = <K extends keyof TaskFilterState>(k: K, v: TaskFilterState[K]) =>
    onChange({ ...value, [k]: v });

  const dirty = JSON.stringify(value) !== JSON.stringify(emptyTaskFilters);

  return (
    <Card className="flex flex-wrap items-end gap-2.5 p-3.5">
      <SearchInput
        className="min-w-52 flex-1"
        placeholder="Search tasks or tags…"
        value={value.query}
        onChange={(e) => set("query", e.target.value)}
      />

      <Select
        className="w-auto min-w-36"
        value={value.status}
        onChange={(e) => set("status", e.target.value as TaskFilterState["status"])}
        aria-label="Status"
      >
        <option value="all">All statuses</option>
        <option value="open">Open (not approved)</option>
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>

      <Select
        className="w-auto min-w-32"
        value={value.priority}
        onChange={(e) => set("priority", e.target.value as TaskFilterState["priority"])}
        aria-label="Priority"
      >
        <option value="all">All priorities</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </Select>

      {showDepartment ? (
        <Select
          className="w-auto min-w-40"
          value={value.department}
          onChange={(e) => set("department", e.target.value)}
          aria-label="Department"
        >
          <option value="all">All departments</option>
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
      ) : null}

      {showAssignee ? (
        <Select
          className="w-auto min-w-36"
          value={value.assigneeId}
          onChange={(e) => set("assigneeId", e.target.value)}
          aria-label="Assignee"
        >
          <option value="all">Anyone</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName}
            </option>
          ))}
        </Select>
      ) : null}

      {showTags && tags && tags.length ? (
        <Select
          className="w-auto min-w-28"
          value={value.tag}
          onChange={(e) => set("tag", e.target.value)}
          aria-label="Tag"
        >
          <option value="all">All tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
        </Select>
      ) : null}

      <div className="flex items-end gap-2">
        <div className="w-36">
          <DatePicker
            value={value.from}
            onChange={(v) => set("from", v)}
            config={db.calendar}
            ignoreWorkingRules
            allowPast
            placeholder="Due from"
            clearable
          />
        </div>
        <div className="w-36">
          <DatePicker
            value={value.to}
            onChange={(v) => set("to", v)}
            config={db.calendar}
            ignoreWorkingRules
            allowPast
            placeholder="Due to"
            clearable
          />
        </div>
      </div>

      {dirty ? (
        <button
          onClick={() => onChange(emptyTaskFilters)}
          className="inline-flex h-9.5 items-center gap-1.5 rounded-[10px] border border-line bg-surface-2 px-3 text-[12px] text-ink-muted hover:text-ink"
        >
          <IconFilter size={13} /> Clear
        </button>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------- task rows */

export function TaskRow({
  task,
  onOpen,
  showProject = true,
}: {
  task: Task;
  onOpen: (id: string) => void;
  showProject?: boolean;
}) {
  const { userById, projectById } = useStore();
  const assignee = userById(task.assigneeId);
  const project = task.projectId ? projectById(task.projectId) : null;
  const elapsed = taskElapsedMs(task);
  const running = isTimerRunning(task);

  return (
    <button
      onClick={() => onOpen(task.id)}
      className={cx(
        "group flex w-full items-center gap-3 border-b border-line-soft px-4 py-3 text-left transition-colors last:border-0 hover:bg-surface-2",
        running && "bg-brand/6",
      )}
    >
      <span
        className={cx(
          "h-2.5 w-2.5 shrink-0 rounded-full",
          TASK_STATUS_STYLE[task.status].dot,
        )}
      />

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-ink group-hover:text-ink-strong">
            {task.title}
          </span>
          <RecurrenceBadge item={task} />
          <OverdueBadge task={task} />
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          {showProject ? <ProjectChip project={project} /> : null}
          <span className="text-[11px] text-ink-faint">{task.department}</span>
          <DueDate task={task} />
        </span>
      </span>

      <span className="hidden shrink-0 items-center gap-1.5 text-[11px] text-ink-muted sm:flex">
        <span className="font-mono">{formatDuration(elapsed)}</span>
        <span className="text-ink-faint">/ {task.estimatedHours}h</span>
      </span>

      <span className="hidden shrink-0 sm:block">
        <PriorityBadge priority={task.priority} />
      </span>

      <span className="shrink-0">
        <StatusBadge status={task.status} task={task} />
      </span>

      {assignee ? (
        <Avatar name={assignee.fullName} size={26} className="shrink-0" />
      ) : null}
    </button>
  );
}

export function TaskListCard({
  tasks,
  onOpen,
  showProject = true,
  emptyTitle = "No tasks match these filters",
  emptyBody,
}: {
  tasks: Task[];
  onOpen: (id: string) => void;
  showProject?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  if (tasks.length === 0) {
    return (
      <Card>
        <EmptyState icon={<IconTasks size={28} />} title={emptyTitle} body={emptyBody} />
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} onOpen={onOpen} showProject={showProject} />
      ))}
    </Card>
  );
}

/* -------------------------------------------------------------- timeline */

/**
 * §9.3 — vertical timeline in creation order, each node coloured by status.
 */
export function TaskTimeline({
  tasks,
  onOpen,
}: {
  tasks: Task[];
  onOpen: (id: string) => void;
}) {
  const { userById } = useStore();
  const ordered = useMemo(
    () => [...tasks].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [tasks],
  );

  if (ordered.length === 0) {
    return (
      <EmptyState
        icon={<IconTasks size={30} />}
        title="No tasks yet"
        body="Tasks will appear here once they're added to this project."
      />
    );
  }

  return (
    <ol className="relative space-y-3 py-2 pl-8">
      <span className="absolute top-3 bottom-3 left-[13px] w-px bg-line" />
      {ordered.map((task) => {
        const assignee = userById(task.assigneeId);
        const running = isTimerRunning(task);
        return (
          <li key={task.id} className="relative">
            <span
              className={cx(
                "absolute top-4 -left-8 h-3.5 w-3.5 rounded-full border-2 border-canvas",
                TASK_STATUS_STYLE[task.status].dot,
                running && "ring-2 ring-brand-bright/60",
              )}
            />
            <button
              onClick={() => onOpen(task.id)}
              className="group w-full rounded-xl border border-line bg-surface-2/70 px-4 py-3 text-left transition-colors hover:border-brand-bright/40 hover:bg-surface-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                  {task.title}
                </span>
                <OverdueBadge task={task} />
                <PriorityBadge priority={task.priority} />
                <StatusBadge status={task.status} task={task} />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-muted">
                {assignee ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Avatar name={assignee.fullName} size={18} />
                    {assignee.fullName}
                  </span>
                ) : null}
                <span className="text-ink-faint">{task.department}</span>
                <DueDate task={task} />
                <span className="font-mono text-ink-faint">
                  {formatDuration(taskElapsedMs(task))} / {task.estimatedHours}h
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
