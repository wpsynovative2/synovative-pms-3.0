"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import {
  addDays,
  addWorkingDays,
  daysBetween,
  formatDate,
  snapToWorkingDay,
  toISODate,
  todayISO,
} from "./calendar";
import { FINANCE_DEPARTMENT } from "./master-data";
import { occurrencesBetween, type Occurrence } from "./recurrence";
import { seedDatabase } from "./seed";
import { autoStopInstant } from "./time";
import type {
  AppNotification,
  CalendarConfig,
  Database,
  Expense,
  NotificationType,
  OutputLocation,
  Project,
  ProjectTemplate,
  RecurrenceSeries,
  Remark,
  Review,
  ReviewDecision,
  ReviewSource,
  Task,
  TaskTemplate,
  User,
  Vendor,
} from "./types";

const DB_KEY = "synovative-pms:db:v1";
const SESSION_KEY = "synovative-pms:session:v1";

let idCounter = 0;
function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}${idCounter.toString(36)}`;
}

const now = () => new Date().toISOString();

/* ------------------------------------------------------------ persistence */

function loadDb(): Database {
  try {
    const raw = window.localStorage.getItem(DB_KEY);
    if (!raw) return seedDatabase();
    const parsed = JSON.parse(raw) as Database;
    // Shallow shape check so an older payload can't break the app.
    if (!parsed.users || !parsed.tasks || !parsed.projects) return seedDatabase();
    return parsed;
  } catch {
    return seedDatabase();
  }
}

function saveDb(db: Database) {
  try {
    window.localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    /* quota or private mode — the app still works for this session */
  }
}

/* ----------------------------------------------------------- auto-stop */

/**
 * §11.3.4 — any timer still running at 11:59 PM is stopped. In production this
 * is a Supabase `pg_cron` job pinned to IST; here it runs once when the app
 * loads, so the data is consistent whenever it is next opened.
 */
function applyAutoStop(db: Database): Database {
  const today = todayISO();
  if (db.lastAutoStopSweep === today) return db;

  let changed = false;
  const newNotifications: AppNotification[] = [];

  const tasks = db.tasks.map((task) => {
    const open = task.sessions.find((s) => s.endedAt === null);
    if (!open) return task;
    const startedOn = toISODate(new Date(open.startedAt));
    if (startedOn >= today) return task;

    changed = true;
    const stopAt = autoStopInstant(new Date(open.startedAt)).toISOString();
    newNotifications.push({
      id: uid("n"),
      userId: task.assigneeId,
      type: "timer_autostop",
      title: "Timer auto-stopped at 11:59 PM",
      body: `Your timer on “${task.title}” was stopped automatically.`,
      href: `/tasks?task=${task.id}`,
      read: false,
      createdAt: stopAt,
    });
    return {
      ...task,
      sessions: task.sessions.map((s) =>
        s.id === open.id
          ? { ...s, endedAt: stopAt, endReason: "Auto-stopped" as const }
          : s,
      ),
    };
  });

  if (!changed) return { ...db, lastAutoStopSweep: today };
  return {
    ...db,
    tasks,
    notifications: [...newNotifications, ...db.notifications],
    lastAutoStopSweep: today,
  };
}

/* ---------------------------------------------------------- recurrence */

const TERMINAL_PROJECT_STATUSES: Project["status"][] = ["Completed", "Cancelled", "Archived"];

const clampISO = (iso: string, min: string, max: string) =>
  iso < min ? min : iso > max ? max : iso;

/** A task copied into a new occurrence: same brief and assignee, clean slate. */
function freshTaskCopy(source: Task, patch: Partial<Task>): Task {
  return {
    ...source,
    id: uid("t"),
    status: "Not Started",
    tags: [...source.tags],
    createdAt: now(),
    sessions: [],
    submissions: [],
    reviews: [],
    remarks: [],
    recurrence: null,
    series: null,
    ...patch,
  };
}

/**
 * One occurrence of a repeating project: a copy of the source project and all
 * of its current tasks, moved so the project starts on the occurrence date.
 * Dates snap forward to working days (§5.4); when two occurrences snap onto the
 * same day — a daily rule over a weekend — only one copy is made.
 */
function materializeProject(draft: Database, source: Project, occ: Occurrence): Database {
  const start = snapToWorkingDay(occ.date, draft.calendar);
  const taken =
    start === source.startDate ||
    draft.projects.some((p) => p.series?.sourceId === source.id && p.startDate === start);
  if (taken) return draft;

  const shift = daysBetween(source.startDate, start);
  const deadline = addDays(source.deadline, shift);
  const project: Project = {
    ...source,
    id: uid("p"),
    name: `${source.name} · ${formatDate(start)}`,
    startDate: start,
    deadline,
    status: TERMINAL_PROJECT_STATUSES.includes(source.status) ? "Planning" : source.status,
    memberIds: [...source.memberIds],
    services: [...source.services],
    createdAt: now(),
    recurrence: null,
    series: { sourceId: source.id, index: occ.index, date: occ.date },
  };

  const tasks = draft.tasks
    .filter((t) => t.projectId === source.id)
    .map((t) => {
      const taskStart = clampISO(
        snapToWorkingDay(addDays(t.startDate, shift), draft.calendar),
        start,
        deadline,
      );
      const taskDue = clampISO(
        snapToWorkingDay(addDays(t.dueDate, shift), draft.calendar),
        taskStart,
        deadline,
      );
      return freshTaskCopy(t, { projectId: project.id, startDate: taskStart, dueDate: taskDue });
    });

  let next: Database = {
    ...draft,
    projects: [project, ...draft.projects],
    tasks: [...draft.tasks, ...tasks],
  };
  for (const t of tasks) {
    next = pushNotifications(
      next,
      [t.assigneeId],
      "task_assigned",
      "New task assigned",
      `“${t.title}” in ${project.name}.`,
      `/projects/${project.id}?task=${t.id}`,
    );
  }
  return next;
}

/** One occurrence of a repeating individual task (§10). */
function materializeTask(draft: Database, source: Task, occ: Occurrence): Database {
  const start = snapToWorkingDay(occ.date, draft.calendar);
  const taken =
    start === source.startDate ||
    draft.tasks.some((t) => t.series?.sourceId === source.id && t.startDate === start);
  if (taken) return draft;

  const shift = daysBetween(source.startDate, start);
  const due = snapToWorkingDay(addDays(source.dueDate, shift), draft.calendar);
  const task = freshTaskCopy(source, {
    projectId: null,
    startDate: start,
    dueDate: due < start ? start : due,
    series: { sourceId: source.id, index: occ.index, date: occ.date },
  });

  return pushNotifications(
    { ...draft, tasks: [...draft.tasks, task] },
    [task.assigneeId],
    "task_assigned",
    "New task assigned",
    `“${task.title}” — repeat #${occ.index}, due ${formatDate(task.dueDate)}.`,
    `/individual-tasks?task=${task.id}`,
  );
}

/**
 * Create every repeating occurrence that has come due. In production this is
 * `generate_recurring_occurrences()` on pg_cron (0004_recurrence.sql); here it
 * runs on load, after saves, and whenever the date rolls over in an open tab.
 * Returns `db` untouched when there is nothing to do.
 */
function applyRecurrence(db: Database): Database {
  const today = todayISO();
  let draft = db;

  const advance = (series: RecurrenceSeries): RecurrenceSeries => ({ ...series, cursor: today });

  for (const source of db.projects) {
    const series = source.recurrence;
    if (!series || series.cursor >= today) continue;
    for (const occ of occurrencesBetween(series, series.cursor, today)) {
      draft = materializeProject(draft, source, occ);
    }
    draft = {
      ...draft,
      projects: draft.projects.map((p) =>
        p.id === source.id ? { ...p, recurrence: advance(series) } : p,
      ),
    };
  }

  for (const source of db.tasks) {
    const series = source.recurrence;
    if (!series || source.projectId !== null || series.cursor >= today) continue;
    for (const occ of occurrencesBetween(series, series.cursor, today)) {
      draft = materializeTask(draft, source, occ);
    }
    draft = {
      ...draft,
      tasks: draft.tasks.map((t) =>
        t.id === source.id ? { ...t, recurrence: advance(series) } : t,
      ),
    };
  }

  return draft;
}

/** Moving a source's start date moves the series with it. */
function followAnchor<T extends { startDate: string; recurrence?: RecurrenceSeries | null }>(
  item: T,
): T {
  const series = item.recurrence;
  if (!series || series.anchor === item.startDate) return item;
  return { ...item, recurrence: { ...series, anchor: item.startDate } };
}

/* --------------------------------------------------------- external store */

/*
 * The database lives outside React so `useSyncExternalStore` can serve a
 * stable server snapshot during hydration and the persisted browser state
 * immediately afterwards — no hydration mismatch, and no setState-in-effect.
 */

const SERVER_DB: Database = seedDatabase();

let dbState: Database = SERVER_DB;
let sessionState: string | null = null;

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Runs once when this client module is first evaluated — before any render.
if (typeof window !== "undefined") {
  const hydrated = applyRecurrence(applyAutoStop(loadDb()));
  dbState = hydrated;
  saveDb(hydrated);
  try {
    const sid = window.localStorage.getItem(SESSION_KEY);
    if (sid && hydrated.users.some((u) => u.id === sid && u.active)) sessionState = sid;
  } catch {
    /* ignore */
  }
}

const getDbSnapshot = () => dbState;
const getServerDbSnapshot = () => SERVER_DB;
const getSessionSnapshot = () => sessionState;
const getServerSessionSnapshot = (): string | null => null;

/** True only after hydration, so guards don't fire against the server snapshot. */
const getReady = () => true;
const getServerReady = () => false;

function mutate(updater: (db: Database) => Database) {
  const next = updater(dbState);
  if (next === dbState) return;
  dbState = next;
  saveDb(next);
  emit();
}

function setSession(id: string | null) {
  sessionState = id;
  try {
    if (id) window.localStorage.setItem(SESSION_KEY, id);
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
  emit();
}

/* ------------------------------------------------------ shared behaviour */

function pushNotifications(
  draft: Database,
  userIds: string[],
  type: NotificationType,
  title: string,
  body: string,
  href: string,
): Database {
  const unique = Array.from(new Set(userIds)).filter(Boolean);
  if (unique.length === 0) return draft;
  const created = unique.map<AppNotification>((userId) => ({
    id: uid("n"),
    userId,
    type,
    title,
    body,
    href,
    read: false,
    createdAt: now(),
  }));
  return { ...draft, notifications: [...created, ...draft.notifications] };
}

/** Who reviews this task (§12.2) — also the notification audience. */
function reviewersFor(draft: Database, task: Task): string[] {
  if (task.projectId === null) {
    return draft.users
      .filter((u) => ["super_admin", "admin", "manager"].includes(u.role) && u.active)
      .map((u) => u.id);
  }
  const project = draft.projects.find((p) => p.id === task.projectId);
  return project ? [project.leaderId] : [];
}

function financeMembers(draft: Database): string[] {
  return draft.users
    .filter((u) => u.active && u.departments.includes(FINANCE_DEPARTMENT))
    .map((u) => u.id);
}

function taskHref(task: Task): string {
  return task.projectId
    ? `/projects/${task.projectId}?task=${task.id}`
    : `/individual-tasks?task=${task.id}`;
}

function closeOpenSession(
  task: Task,
  reason: Task["sessions"][number]["endReason"],
  note?: string,
): Task {
  return {
    ...task,
    sessions: task.sessions.map((s) =>
      s.endedAt === null ? { ...s, endedAt: now(), endReason: reason, endNote: note } : s,
    ),
  };
}

function openSessionFor(task: Task, userId: string): Task {
  if (task.sessions.some((s) => s.endedAt === null)) return task;
  return {
    ...task,
    status: "In Progress",
    sessions: [
      ...task.sessions,
      { id: uid("s"), userId, startedAt: now(), endedAt: null, endReason: null },
    ],
  };
}

/* --------------------------------------------------------------- context */

export interface SubmissionInput {
  outputLocation: OutputLocation;
  driveLink?: string;
  description: string;
}

export interface ReviewInput {
  decision: ReviewDecision;
  source?: ReviewSource;
  remarks: string;
  newAssigneeId?: string;
  newDueDate?: string;
}

export interface ProjectFromTemplateInput {
  templateId: string;
  project: Omit<Project, "id" | "createdAt" | "createdBy">;
  /** template task id → assignee id */
  assignments: Record<string, string>;
}

export type NewTaskInput = Omit<
  Task,
  "id" | "createdAt" | "createdBy" | "sessions" | "submissions" | "reviews" | "remarks"
>;

interface StoreValue {
  db: Database;
  ready: boolean;
  currentUser: User | null;

  login: (email: string, password: string) => { ok: boolean; error?: string };
  logout: () => void;
  switchUser: (userId: string) => void;
  changePassword: (password: string) => void;

  userById: (id: string) => User | undefined;
  projectById: (id: string) => Project | undefined;
  taskById: (id: string) => Task | undefined;
  vendorById: (id: string) => Vendor | undefined;

  createUser: (input: Omit<User, "id" | "createdAt">) => void;
  updateUser: (id: string, patch: Partial<User>) => void;
  deleteUser: (id: string) => void;

  createProject: (input: Omit<Project, "id" | "createdAt" | "createdBy">) => Project;
  createProjectFromTemplate: (input: ProjectFromTemplateInput) => Project;
  updateProject: (id: string, patch: Partial<Project>) => void;
  deleteProject: (id: string) => void;

  createTask: (input: NewTaskInput) => Task;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  addRemark: (taskId: string, text: string) => void;

  startTimer: (taskId: string) => void;
  pauseTimer: (taskId: string, note?: string) => void;
  switchTimer: (fromTaskId: string, toTaskId: string) => void;
  submitTask: (taskId: string, input: SubmissionInput) => void;
  reviewTask: (taskId: string, input: ReviewInput) => void;

  createExpense: (
    input: Omit<Expense, "id" | "createdAt" | "createdBy" | "status">,
  ) => void;
  updateExpense: (id: string, patch: Partial<Expense>) => void;
  deleteExpense: (id: string) => void;
  reviewExpense: (id: string, approved: boolean, remarks?: string) => void;

  createVendor: (input: Omit<Vendor, "id">) => void;
  updateVendor: (id: string, patch: Partial<Vendor>) => void;
  deleteVendor: (id: string) => void;

  saveProjectTemplate: (t: ProjectTemplate) => void;
  deleteProjectTemplate: (id: string) => void;
  saveTaskTemplate: (t: TaskTemplate) => void;
  deleteTaskTemplate: (id: string) => void;

  updateCalendar: (patch: Partial<CalendarConfig>) => void;

  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;

  resetDemoData: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const db = useSyncExternalStore(subscribe, getDbSnapshot, getServerDbSnapshot);
  const currentUserId = useSyncExternalStore(
    subscribe,
    getSessionSnapshot,
    getServerSessionSnapshot,
  );
  const ready = useSyncExternalStore(subscribe, getReady, getServerReady);

  // Pick up occurrences that come due while the tab stays open past midnight.
  useEffect(() => {
    const id = window.setInterval(() => mutate(applyRecurrence), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const currentUser = useMemo(
    () => db.users.find((u) => u.id === currentUserId) ?? null,
    [db.users, currentUserId],
  );

  /* ------------------------------------------------------------- auth */

  const login = useCallback((email: string, password: string) => {
    const user = dbState.users.find(
      (u) => u.email.toLowerCase() === email.trim().toLowerCase(),
    );
    if (!user) return { ok: false, error: "No account with that email." };
    if (!user.active) return { ok: false, error: "This account is deactivated." };
    if (user.password !== password) return { ok: false, error: "Incorrect password." };
    setSession(user.id);
    return { ok: true };
  }, []);

  const logout = useCallback(() => setSession(null), []);
  const switchUser = useCallback((userId: string) => setSession(userId), []);

  const changePassword = useCallback((password: string) => {
    const uidNow = sessionState;
    if (!uidNow) return;
    mutate((d) => ({
      ...d,
      users: d.users.map((u) =>
        u.id === uidNow ? { ...u, password, mustChangePassword: false } : u,
      ),
    }));
  }, []);

  /* ---------------------------------------------------------- lookups */

  const userById = useCallback(
    (id: string) => db.users.find((u) => u.id === id),
    [db.users],
  );
  const projectById = useCallback(
    (id: string) => db.projects.find((p) => p.id === id),
    [db.projects],
  );
  const taskById = useCallback((id: string) => db.tasks.find((t) => t.id === id), [db.tasks]);
  const vendorById = useCallback(
    (id: string) => db.vendors.find((v) => v.id === id),
    [db.vendors],
  );

  /* ------------------------------------------------------------ users */

  const createUser = useCallback((input: Omit<User, "id" | "createdAt">) => {
    mutate((d) => ({
      ...d,
      users: [...d.users, { ...input, id: uid("u"), createdAt: now() }],
    }));
  }, []);

  const updateUser = useCallback((id: string, patch: Partial<User>) => {
    mutate((d) => ({
      ...d,
      users: d.users.map((u) => (u.id === id ? { ...u, ...patch } : u)),
    }));
  }, []);

  const deleteUser = useCallback((id: string) => {
    mutate((d) => ({ ...d, users: d.users.filter((u) => u.id !== id) }));
  }, []);

  /* --------------------------------------------------------- projects */

  const createProject = useCallback(
    (input: Omit<Project, "id" | "createdAt" | "createdBy">) => {
      const project: Project = {
        ...input,
        id: uid("p"),
        createdBy: sessionState ?? "system",
        createdAt: now(),
      };
      mutate((d) => applyRecurrence({ ...d, projects: [project, ...d.projects] }));
      return project;
    },
    [],
  );

  const createProjectFromTemplate = useCallback(
    ({ templateId, project, assignments }: ProjectFromTemplateInput) => {
      const created: Project = {
        ...project,
        id: uid("p"),
        createdBy: sessionState ?? "system",
        createdAt: now(),
      };
      mutate((d) => {
        let draft: Database = { ...d, projects: [created, ...d.projects] };
        const template = d.projectTemplates.find((t) => t.id === templateId);
        if (!template) return draft;

        const newTasks: Task[] = [];
        for (const item of template.tasks) {
          const assigneeId = assignments[item.id];
          if (!assigneeId) continue;
          let startDate = addWorkingDays(created.startDate, item.startOffsetDays, d.calendar);
          if (startDate > created.deadline) startDate = created.deadline;
          let dueDate = addWorkingDays(startDate, item.durationDays, d.calendar);
          if (dueDate > created.deadline) dueDate = created.deadline;
          newTasks.push({
            id: uid("t"),
            projectId: created.id,
            title: item.title,
            description: item.description,
            department: item.department,
            assigneeId,
            status: "Not Started",
            priority: item.priority,
            startDate,
            dueDate,
            estimatedHours: item.estimatedHours,
            tags: item.tags,
            createdBy: sessionState ?? "system",
            createdAt: now(),
            sessions: [],
            submissions: [],
            reviews: [],
            remarks: [],
          });
        }

        draft = { ...draft, tasks: [...draft.tasks, ...newTasks] };
        for (const t of newTasks) {
          draft = pushNotifications(
            draft,
            [t.assigneeId],
            "task_assigned",
            "New task assigned",
            `“${t.title}” in ${created.name}.`,
            `/projects/${created.id}?task=${t.id}`,
          );
        }
        return applyRecurrence(draft);
      });
      return created;
    },
    [],
  );

  const updateProject = useCallback((id: string, patch: Partial<Project>) => {
    mutate((d) =>
      applyRecurrence({
        ...d,
        projects: d.projects.map((p) => (p.id === id ? followAnchor({ ...p, ...patch }) : p)),
      }),
    );
  }, []);

  const deleteProject = useCallback((id: string) => {
    mutate((d) => ({
      ...d,
      projects: d.projects.filter((p) => p.id !== id),
      tasks: d.tasks.filter((t) => t.projectId !== id),
      expenses: d.expenses.filter((e) => e.projectId !== id),
    }));
  }, []);

  /* ------------------------------------------------------------ tasks */

  const createTask = useCallback((input: NewTaskInput) => {
    const task: Task = {
      ...input,
      // Only individual tasks repeat on their own; project tasks repeat with their project.
      recurrence: input.projectId === null ? (input.recurrence ?? null) : null,
      id: uid("t"),
      createdBy: sessionState ?? "system",
      createdAt: now(),
      sessions: [],
      submissions: [],
      reviews: [],
      remarks: [],
    };
    mutate((d) => {
      const draft: Database = { ...d, tasks: [...d.tasks, task] };
      const project = task.projectId
        ? d.projects.find((p) => p.id === task.projectId)
        : null;
      return applyRecurrence(
        pushNotifications(
          draft,
          [task.assigneeId],
          "task_assigned",
          "New task assigned",
          project ? `“${task.title}” in ${project.name}.` : `“${task.title}”.`,
          taskHref(task),
        ),
      );
    });
    return task;
  }, []);

  const updateTask = useCallback((id: string, patch: Partial<Task>) => {
    mutate((d) => {
      const before = d.tasks.find((t) => t.id === id);
      if (!before) return d;

      const reassigned = !!patch.assigneeId && patch.assigneeId !== before.assigneeId;
      // Handing a task to someone else puts it back at the start (§12.2 parallel).
      const combined: Task = {
        ...before,
        ...patch,
        status: reassigned ? (patch.status ?? "Not Started") : (patch.status ?? before.status),
      };
      const merged = followAnchor(
        combined.projectId === null ? combined : { ...combined, recurrence: null },
      );

      let draft: Database = {
        ...d,
        tasks: d.tasks.map((t) => (t.id === id ? merged : t)),
      };

      if (reassigned) {
        const project = merged.projectId
          ? d.projects.find((p) => p.id === merged.projectId)
          : null;
        draft = pushNotifications(
          draft,
          [merged.assigneeId],
          "task_assigned",
          "Task assigned to you",
          project ? `“${merged.title}” in ${project.name}.` : `“${merged.title}”.`,
          taskHref(merged),
        );
      }
      return applyRecurrence(draft);
    });
  }, []);

  const deleteTask = useCallback((id: string) => {
    mutate((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== id) }));
  }, []);

  const addRemark = useCallback((taskId: string, text: string) => {
    const author = sessionState;
    if (!author) return;
    mutate((d) => {
      const task = d.tasks.find((t) => t.id === taskId);
      if (!task) return d;
      const remark: Remark = { id: uid("rm"), byUserId: author, at: now(), text };
      const draft: Database = {
        ...d,
        tasks: d.tasks.map((t) =>
          t.id === taskId ? { ...t, remarks: [...t.remarks, remark] } : t,
        ),
      };
      // Only the assignee's remarks notify the reviewers (§17).
      if (task.assigneeId !== author) return draft;
      const name = d.users.find((u) => u.id === author)?.fullName ?? "The assignee";
      return pushNotifications(
        draft,
        reviewersFor(d, task),
        "remark_added",
        "New remark on a task",
        `${name} added a remark on “${task.title}”.`,
        taskHref(task),
      );
    });
  }, []);

  /* ------------------------------------------------------------ timer */

  const startTimer = useCallback((taskId: string) => {
    const author = sessionState;
    if (!author) return;
    mutate((d) => ({
      ...d,
      tasks: d.tasks.map((t) => (t.id === taskId ? openSessionFor(t, author) : t)),
    }));
  }, []);

  /** "Done for the day" — session ends, task stays In Progress (Paused). */
  const pauseTimer = useCallback((taskId: string, note?: string) => {
    mutate((d) => ({
      ...d,
      tasks: d.tasks.map((t) =>
        t.id === taskId ? closeOpenSession(t, "End of day", note) : t,
      ),
    }));
  }, []);

  /** "Working on a different project" — close here, open there (§11.2 option 2). */
  const switchTimer = useCallback((fromTaskId: string, toTaskId: string) => {
    const author = sessionState;
    if (!author) return;
    mutate((d) => {
      const target = d.tasks.find((t) => t.id === toTaskId);
      const targetProject = target?.projectId
        ? d.projects.find((p) => p.id === target.projectId)
        : null;
      const note = targetProject
        ? `Switched to ${targetProject.name}`
        : `Switched to ${target?.title ?? "another task"}`;
      return {
        ...d,
        tasks: d.tasks.map((t) => {
          if (t.id === fromTaskId) return closeOpenSession(t, "Switched", note);
          if (t.id === toTaskId) return openSessionFor(t, author);
          return t;
        }),
      };
    });
  }, []);

  const submitTask = useCallback((taskId: string, input: SubmissionInput) => {
    const author = sessionState;
    if (!author) return;
    mutate((d) => {
      const task = d.tasks.find((t) => t.id === taskId);
      if (!task) return d;
      const submitted: Task = {
        ...closeOpenSession(task, "Submitted"),
        status: "Submitted",
        submissions: [
          ...task.submissions,
          {
            id: uid("sub"),
            byUserId: author,
            at: now(),
            outputLocation: input.outputLocation,
            driveLink: input.driveLink,
            description: input.description,
          },
        ],
      };
      const draft: Database = {
        ...d,
        tasks: d.tasks.map((t) => (t.id === taskId ? submitted : t)),
      };
      const name = d.users.find((u) => u.id === author)?.fullName ?? "The assignee";
      return pushNotifications(
        draft,
        reviewersFor(d, task),
        "task_submitted",
        "Task submitted for review",
        `${name} submitted “${task.title}”.`,
        taskHref(task),
      );
    });
  }, []);

  const reviewTask = useCallback((taskId: string, input: ReviewInput) => {
    const reviewer = sessionState;
    if (!reviewer) return;
    mutate((d) => {
      const task = d.tasks.find((t) => t.id === taskId);
      if (!task) return d;

      const lastSubmission = task.submissions[task.submissions.length - 1];
      const review: Review = {
        id: uid("rev"),
        submissionId: lastSubmission?.id ?? "",
        byUserId: reviewer,
        at: now(),
        decision: input.decision,
        source: input.source,
        remarks: input.remarks,
        newAssigneeId: input.newAssigneeId,
        newDueDate: input.newDueDate,
      };

      let updated: Task = { ...task, reviews: [...task.reviews, review] };
      if (input.decision === "Approved") {
        updated = { ...updated, status: "Approved" };
      } else if (input.decision === "Changes Required") {
        // Same assignee reworks and resubmits (§12.2).
        updated = { ...updated, status: "Changes Required" };
      } else {
        // Reject → reassign, reset to Not Started, optionally move the due date.
        updated = {
          ...updated,
          status: "Not Started",
          assigneeId: input.newAssigneeId ?? task.assigneeId,
          dueDate: input.newDueDate ?? task.dueDate,
        };
      }

      let draft: Database = {
        ...d,
        tasks: d.tasks.map((t) => (t.id === taskId ? updated : t)),
      };

      draft = pushNotifications(
        draft,
        [task.assigneeId],
        "review_decision",
        `Review: ${input.decision}`,
        `“${task.title}” was marked ${input.decision}.`,
        taskHref(task),
      );

      if (input.decision === "Rejected" && updated.assigneeId !== task.assigneeId) {
        draft = pushNotifications(
          draft,
          [updated.assigneeId],
          "task_assigned",
          "Task reassigned to you",
          `“${task.title}” was reassigned to you after a rejection.`,
          taskHref(task),
        );
      }
      return draft;
    });
  }, []);

  /* --------------------------------------------------------- expenses */

  const createExpense = useCallback(
    (input: Omit<Expense, "id" | "createdAt" | "createdBy" | "status">) => {
      mutate((d) => {
        const expense: Expense = {
          ...input,
          id: uid("e"),
          status: "Pending",
          createdBy: sessionState ?? "system",
          createdAt: now(),
        };
        const project = d.projects.find((p) => p.id === expense.projectId);
        const draft: Database = { ...d, expenses: [expense, ...d.expenses] };
        return pushNotifications(
          draft,
          financeMembers(d),
          "expense_added",
          "New expense to verify",
          `₹${expense.amount.toLocaleString("en-IN")} — ${expense.description}${
            project ? ` (${project.name})` : ""
          }.`,
          `/expenses?expense=${expense.id}`,
        );
      });
    },
    [],
  );

  const updateExpense = useCallback((id: string, patch: Partial<Expense>) => {
    mutate((d) => ({
      ...d,
      expenses: d.expenses.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  }, []);

  const deleteExpense = useCallback((id: string) => {
    mutate((d) => ({ ...d, expenses: d.expenses.filter((e) => e.id !== id) }));
  }, []);

  const reviewExpense = useCallback((id: string, approved: boolean, remarks?: string) => {
    const reviewer = sessionState;
    if (!reviewer) return;
    mutate((d) => {
      const expense = d.expenses.find((e) => e.id === id);
      if (!expense) return d;
      const project = d.projects.find((p) => p.id === expense.projectId);
      const draft: Database = {
        ...d,
        expenses: d.expenses.map((e) =>
          e.id === id
            ? {
                ...e,
                status: approved ? "Approved" : "Rejected",
                financeRemarks: remarks,
                reviewedBy: reviewer,
                reviewedAt: now(),
              }
            : e,
        ),
      };
      return pushNotifications(
        draft,
        project ? [project.leaderId] : [],
        "expense_reviewed",
        `Expense ${approved ? "approved" : "rejected"}`,
        `₹${expense.amount.toLocaleString("en-IN")} — ${expense.description}.`,
        `/expenses?expense=${expense.id}`,
      );
    });
  }, []);

  /* ---------------------------------------------------------- vendors */

  const createVendor = useCallback((input: Omit<Vendor, "id">) => {
    mutate((d) => ({ ...d, vendors: [...d.vendors, { ...input, id: uid("v") }] }));
  }, []);

  const updateVendor = useCallback((id: string, patch: Partial<Vendor>) => {
    mutate((d) => ({
      ...d,
      vendors: d.vendors.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    }));
  }, []);

  const deleteVendor = useCallback((id: string) => {
    mutate((d) => ({ ...d, vendors: d.vendors.filter((v) => v.id !== id) }));
  }, []);

  /* -------------------------------------------------------- templates */

  const saveProjectTemplate = useCallback((t: ProjectTemplate) => {
    mutate((d) => ({
      ...d,
      projectTemplates: d.projectTemplates.some((x) => x.id === t.id)
        ? d.projectTemplates.map((x) => (x.id === t.id ? t : x))
        : [...d.projectTemplates, t],
    }));
  }, []);

  const deleteProjectTemplate = useCallback((id: string) => {
    mutate((d) => ({
      ...d,
      projectTemplates: d.projectTemplates.filter((t) => t.id !== id),
    }));
  }, []);

  const saveTaskTemplate = useCallback((t: TaskTemplate) => {
    mutate((d) => ({
      ...d,
      taskTemplates: d.taskTemplates.some((x) => x.id === t.id)
        ? d.taskTemplates.map((x) => (x.id === t.id ? t : x))
        : [...d.taskTemplates, t],
    }));
  }, []);

  const deleteTaskTemplate = useCallback((id: string) => {
    mutate((d) => ({ ...d, taskTemplates: d.taskTemplates.filter((t) => t.id !== id) }));
  }, []);

  /* --------------------------------------------------------- calendar */

  const updateCalendar = useCallback((patch: Partial<CalendarConfig>) => {
    mutate((d) => ({ ...d, calendar: { ...d.calendar, ...patch } }));
  }, []);

  /* ---------------------------------------------------- notifications */

  const markNotificationRead = useCallback((id: string) => {
    mutate((d) => ({
      ...d,
      notifications: d.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
    }));
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    const me = sessionState;
    if (!me) return;
    mutate((d) => ({
      ...d,
      notifications: d.notifications.map((n) =>
        n.userId === me ? { ...n, read: true } : n,
      ),
    }));
  }, []);

  const resetDemoData = useCallback(() => {
    mutate(() => seedDatabase());
    setSession(null);
  }, []);

  const value = useMemo<StoreValue>(
    () => ({
      db,
      ready,
      currentUser,
      login,
      logout,
      switchUser,
      changePassword,
      userById,
      projectById,
      taskById,
      vendorById,
      createUser,
      updateUser,
      deleteUser,
      createProject,
      createProjectFromTemplate,
      updateProject,
      deleteProject,
      createTask,
      updateTask,
      deleteTask,
      addRemark,
      startTimer,
      pauseTimer,
      switchTimer,
      submitTask,
      reviewTask,
      createExpense,
      updateExpense,
      deleteExpense,
      reviewExpense,
      createVendor,
      updateVendor,
      deleteVendor,
      saveProjectTemplate,
      deleteProjectTemplate,
      saveTaskTemplate,
      deleteTaskTemplate,
      updateCalendar,
      markNotificationRead,
      markAllNotificationsRead,
      resetDemoData,
    }),
    [
      db,
      ready,
      currentUser,
      login,
      logout,
      switchUser,
      changePassword,
      userById,
      projectById,
      taskById,
      vendorById,
      createUser,
      updateUser,
      deleteUser,
      createProject,
      createProjectFromTemplate,
      updateProject,
      deleteProject,
      createTask,
      updateTask,
      deleteTask,
      addRemark,
      startTimer,
      pauseTimer,
      switchTimer,
      submitTask,
      reviewTask,
      createExpense,
      updateExpense,
      deleteExpense,
      reviewExpense,
      createVendor,
      updateVendor,
      deleteVendor,
      saveProjectTemplate,
      deleteProjectTemplate,
      saveTaskTemplate,
      deleteTaskTemplate,
      updateCalendar,
      markNotificationRead,
      markAllNotificationsRead,
      resetDemoData,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}
