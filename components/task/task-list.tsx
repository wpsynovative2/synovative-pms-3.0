"use client";

import { useMemo } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { IconFilter, IconTasks } from "@/components/ui/icons";
import {
  Avatar,
  Card,
  EmptyState,
  ProgressBar,
  SearchInput,
  Select,
  cx,
} from "@/components/ui/primitives";
import { PRIORITIES, TASK_STATUS_STYLE, TASK_STATUSES } from "@/lib/master-data";
import { useStore } from "@/lib/store";
import { isOverdue } from "@/lib/analytics";
import { formatDuration, isTimerRunning, taskElapsedMs } from "@/lib/time";
import { contentProgress } from "@/lib/types";
import type { Priority, Project, Task, TaskStatus, User } from "@/lib/types";
import {
  DueDate,
  OverdueBadge,
  PriorityBadge,
  ProjectChip,
  RecurrenceBadge,
  StatusBadge,
} from "./task-bits";

/* ---------------------------------------------------------------- filters */

/** How the list is ordered. "due" is the default the work queues up in. */
export type TaskSort =
  | "due"
  | "dueDesc"
  | "priority"
  | "status"
  | "title"
  | "created"
  | "logged";

export const TASK_SORT_LABEL: Record<TaskSort, string> = {
  due: "Due date — soonest",
  dueDesc: "Due date — latest",
  priority: "Priority — highest",
  status: "Status",
  title: "Title A–Z",
  created: "Recently added",
  logged: "Time logged — most",
};

export interface TaskFilterState {
  query: string;
  /** "overdue" is not a stored status — it is the same rule the badges use. */
  status: TaskStatus | "all" | "open" | "overdue";
  priority: Priority | "all";
  department: string;
  /** A profile id, "all", or "none" for work nobody holds yet. */
  assigneeId: string;
  /** Who allotted the task, i.e. who created it. */
  createdById: string;
  from: string;
  to: string;
  /** A service on the task's *project*; individual tasks have none. */
  service: string;
  projectId: string;
  sort: TaskSort;
}

export const emptyTaskFilters: TaskFilterState = {
  query: "",
  status: "all",
  createdById: "all",
  priority: "all",
  department: "all",
  assigneeId: "all",
  from: "",
  to: "",
  service: "all",
  projectId: "all",
  sort: "due",
};

/** Highest first, so Critical work sorts to the top. */
const PRIORITY_RANK: Record<Priority, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

/** The order a task moves through, rather than the alphabet. */
const STATUS_RANK = new Map(TASK_STATUSES.map((s, i) => [s, i]));

/**
 * Filters, then orders the list.
 *
 * Whatever the chosen order, finished (Approved) work is pushed to the bottom
 * so it stops competing with what still needs doing — the one rule that holds
 * across every sort.
 *
 * `projects` is only needed for the service filter, which reads the service
 * list off the task's project.
 */
export function applyTaskFilters(
  tasks: Task[],
  f: TaskFilterState,
  projects?: Project[],
): Task[] {
  const q = f.query.trim().toLowerCase();
  const done = (t: Task) => (t.status === "Approved" ? 1 : 0);
  const servicesOf = new Map((projects ?? []).map((p) => [p.id, p.services]));
  const matched = tasks.filter((t) => {
    if (q && !t.title.toLowerCase().includes(q) && !t.tags.some((x) => x.toLowerCase().includes(q)))
      return false;
    if (f.status === "open") {
      if (t.status === "Approved") return false;
    } else if (f.status === "overdue") {
      if (!isOverdue(t)) return false;
    } else if (f.status !== "all" && t.status !== f.status) return false;
    if (f.priority !== "all" && t.priority !== f.priority) return false;
    if (f.department !== "all" && t.department !== f.department) return false;
    if (f.assigneeId === "none") {
      if (t.assigneeId !== null) return false;
    } else if (f.assigneeId !== "all" && t.assigneeId !== f.assigneeId) return false;
    if (f.createdById !== "all" && t.createdBy !== f.createdById) return false;
    if (f.projectId !== "all" && t.projectId !== f.projectId) return false;
    if (f.service !== "all") {
      // Services belong to the project, so an individual task can never match.
      const services = t.projectId ? servicesOf.get(t.projectId) : undefined;
      if (!services?.includes(f.service)) return false;
    }
    if (f.from && t.dueDate < f.from) return false;
    if (f.to && t.dueDate > f.to) return false;
    return true;
  });

  const tiebreak = (a: Task, b: Task) =>
    a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title);

  const order: Record<TaskSort, (a: Task, b: Task) => number> = {
    due: tiebreak,
    dueDesc: (a, b) => b.dueDate.localeCompare(a.dueDate) || a.title.localeCompare(b.title),
    priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || tiebreak(a, b),
    status: (a, b) =>
      (STATUS_RANK.get(a.status) ?? 0) - (STATUS_RANK.get(b.status) ?? 0) || tiebreak(a, b),
    title: (a, b) => a.title.localeCompare(b.title),
    created: (a, b) => b.createdAt.localeCompare(a.createdAt),
    logged: (a, b) => taskElapsedMs(b) - taskElapsedMs(a) || tiebreak(a, b),
  };

  return matched.sort((a, b) => done(a) - done(b) || order[f.sort](a, b));
}

export function TaskFilters({
  value,
  onChange,
  users,
  /** The projects the list can draw on — drives the project and service pickers. */
  projects,
  showDepartment = true,
  showAssignee = true,
  /** Off on a project's own page, where every task is already that project's. */
  showProject = true,
}: {
  value: TaskFilterState;
  onChange: (next: TaskFilterState) => void;
  users: User[];
  projects?: Project[];
  showDepartment?: boolean;
  showAssignee?: boolean;
  showProject?: boolean;
}) {
  const { db } = useStore();

  // Only services actually in play, so the list stays short and truthful.
  const services = useMemo(() => {
    const seen = new Set<string>();
    for (const p of projects ?? []) for (const s of p.services) seen.add(s);
    return [...seen].sort();
  }, [projects]);
  const set = <K extends keyof TaskFilterState>(k: K, v: TaskFilterState[K]) =>
    onChange({ ...value, [k]: v });

  const dirty = JSON.stringify(value) !== JSON.stringify(emptyTaskFilters);

  return (
    <Card className="flex flex-wrap items-end gap-2.5 p-3.5">
      <SearchInput
        className="min-w-52 flex-1"
        placeholder="Search tasks or tags…"
        aria-label="Search tasks"
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
          {db.departments.map((d) => (
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
          <option value="none">Unassigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName}
            </option>
          ))}
        </Select>
      ) : null}

      <Select
        className="w-auto min-w-36"
        value={value.createdById}
        onChange={(e) => set("createdById", e.target.value)}
        aria-label="Allotted by"
      >
        <option value="all">Allotted by anyone</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.fullName}
          </option>
        ))}
      </Select>

      {services.length ? (
        <Select
          className="w-auto min-w-40"
          value={value.service}
          onChange={(e) => set("service", e.target.value)}
          aria-label="Service"
        >
          <option value="all">All services</option>
          {services.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </Select>
      ) : null}

      {showProject && projects && projects.length ? (
        <Select
          className="w-auto min-w-40"
          value={value.projectId}
          onChange={(e) => set("projectId", e.target.value)}
          aria-label="Project"
        >
          <option value="all">All projects</option>
          {[...projects]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
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

      <label className="ml-auto flex items-center gap-2 text-[12px] text-ink-faint">
        Sort
        <Select
          className="w-auto min-w-44"
          value={value.sort}
          onChange={(e) => set("sort", e.target.value as TaskSort)}
          aria-label="Sort by"
        >
          {(Object.keys(TASK_SORT_LABEL) as TaskSort[]).map((k) => (
            <option key={k} value={k}>
              {TASK_SORT_LABEL[k]}
            </option>
          ))}
        </Select>
      </label>

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
  const { db, userById, projectById } = useStore();
  const assignee = userById(task.assigneeId);
  const project = task.projectId ? projectById(task.projectId) : null;
  const elapsed = taskElapsedMs(task);
  const running = isTimerRunning(task);
  // A content task's real progress is its approved pieces, not its status.
  const batch = task.kind === "content" ? contentProgress(task, db.contentEntries) : null;

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
          {batch ? (
            <span className="shrink-0 rounded-full border border-brand-bright/30 bg-brand/10 px-1.5 py-0.5 font-mono text-[10px] text-brand-ink">
              {batch.approved}/{batch.total}
            </span>
          ) : null}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          {showProject ? <ProjectChip project={project} /> : null}
          <span className="text-[11px] text-ink-faint">{task.department}</span>
          <DueDate task={task} />
        </span>
        {batch ? (
          <span className="mt-1.5 block max-w-64">
            <ProgressBar value={batch.percent} barClassName="bg-st-approved" />
          </span>
        ) : null}
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
      {/* Re-keying on the visible set restarts the entrance animation whenever
          a filter changes which rows are shown. */}
      <div key={signatureOf(tasks)} className="rows-in">
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} onOpen={onOpen} showProject={showProject} />
        ))}
      </div>
    </Card>
  );
}

/** Cheap stable hash of the visible rows, used only as an animation key. */
function signatureOf(tasks: Task[]): string {
  let h = 0;
  for (const t of tasks) {
    for (let i = 0; i < t.id.length; i++) h = (Math.imul(h, 31) + t.id.charCodeAt(i)) | 0;
  }
  return `${tasks.length}:${h}`;
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
