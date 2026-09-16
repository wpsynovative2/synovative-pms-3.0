"use client";

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { addWorkingDays } from "./calendar";
import {
  ALL_SCOPES,
  EMPTY_DB,
  EXPENSE_COLUMNS,
  PROJECT_COLUMNS,
  TASK_COLUMNS,
  VENDOR_COLUMNS,
  loadScopes,
  patchColumns,
  projectRow,
  seriesColumns,
  taskRow,
  templateItemRow,
  toNotification,
  type Scope,
} from "./data/db";
import { getSupabase } from "./supabase/client";
import { isSupabaseConfigured } from "./supabase/config";
import type {
  CalendarConfig,
  Database,
  Expense,
  LinkGroup,
  OperationalLink,
  OutputLocation,
  Project,
  ProjectTemplate,
  RecurrenceSeries,
  Remark,
  Review,
  ReviewDecision,
  ReviewSource,
  Role,
  Task,
  TaskTemplate,
  User,
  Vendor,
} from "./types";

/*
 * Client-side state for the signed-in user, backed by Supabase.
 *
 * Reads: on sign-in every scope the user may see is loaded (Row Level Security
 * decides what that is). Afterwards a scope is refetched when this user changes
 * it, when a notification arrives (someone else changed something relevant),
 * and when the tab regains focus — Realtime is used for notifications only (§19).
 *
 * Writes: each mutation updates the screen straight away, then runs against
 * Supabase. Writes are queued so they reach the database in order; if one fails
 * the user sees why and the affected scopes are reloaded, undoing the change.
 * Workflow transitions (timer, submit, review, expense verdicts) go through the
 * SECURITY DEFINER functions in supabase/migrations, which re-check every rule.
 */

/* --------------------------------------------------------------- helpers */

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Turns Postgres / PostgREST errors into something a person can act on. */
function friendlyError(err: unknown): string {
  const e = err as { message?: string; code?: string };
  const message = e?.message ?? String(err);
  if (e?.code === "42501" || /row-level security|permission denied/i.test(message)) {
    return "You don't have permission to do that.";
  }
  if (e?.code === "23503" || /foreign key/i.test(message)) {
    return "It's still used elsewhere (for example by expenses or tasks), so it can't be removed.";
  }
  if (/link_groups_name_unique/.test(message)) {
    return "A group with that name already exists.";
  }
  if (e?.code === "23505" || /duplicate key|already exists/i.test(message)) {
    return "That already exists.";
  }
  if (/one_running_timer_per_user/.test(message)) {
    return "You already have a timer running — pause it first.";
  }
  if (/Failed to fetch|NetworkError|fetch failed/i.test(message)) {
    return "Can't reach the server. Check your connection and try again.";
  }
  return message;
}

/** Supabase calls resolve with `{ error }` rather than throwing. */
async function run<T extends { error: { message: string; code?: string } | null }>(
  q: PromiseLike<T>,
): Promise<T> {
  const res = await q;
  if (res.error) throw res.error;
  return res;
}

/* ------------------------------------------------------------ app state */

type AuthStatus = "starting" | "signed-out" | "loading" | "signed-in";

export interface Toast {
  id: string;
  kind: "error" | "success";
  message: string;
}

interface State {
  db: Database;
  auth: AuthStatus;
  userId: string | null;
  toasts: Toast[];
}

const SERVER_STATE: State = { db: EMPTY_DB, auth: "starting", userId: null, toasts: [] };
let state: State = SERVER_STATE;

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}
const setDb = (db: Database) => setState({ db });

const getSnapshot = () => state;
const getServerSnapshot = () => SERVER_STATE;

function toast(message: string, kind: Toast["kind"] = "error") {
  const id = newId();
  setState({ toasts: [...state.toasts, { id, kind, message }] });
  window.setTimeout(() => dismissToast(id), kind === "error" ? 7000 : 3500);
}
function dismissToast(id: string) {
  if (state.toasts.some((t) => t.id === id)) {
    setState({ toasts: state.toasts.filter((t) => t.id !== id) });
  }
}

const sb = (): SupabaseClient => getSupabase();

/* ------------------------------------------------------- refresh queue */

const queuedScopes = new Set<Scope>();
let pendingWrites = 0;
let writeEpoch = 0;
let refreshing = false;
let lastFullRefresh = 0;

function requestRefresh(scopes: Iterable<Scope>) {
  for (const s of scopes) queuedScopes.add(s);
  scheduleFlush();
}

function scheduleFlush() {
  // Never apply server data over optimistic changes that haven't been written yet.
  if (pendingWrites > 0 || refreshing || queuedScopes.size === 0) return;
  if (state.auth !== "signed-in" && state.auth !== "loading") return;
  void flush();
}

async function flush() {
  const scopes = Array.from(queuedScopes);
  queuedScopes.clear();
  refreshing = true;
  const epoch = writeEpoch;
  try {
    const slice = await loadScopes(sb(), scopes);
    if (writeEpoch !== epoch) {
      // A write started while we were fetching — this data may predate it.
      for (const s of scopes) queuedScopes.add(s);
    } else if (state.userId) {
      setDb({ ...state.db, ...slice });
      if (scopes.length === ALL_SCOPES.length) lastFullRefresh = Date.now();
    }
  } catch (err) {
    toast(`Couldn't load the latest data: ${friendlyError(err)}`);
  } finally {
    refreshing = false;
    scheduleFlush();
  }
}

/* ---------------------------------------------------------- write queue */

let chain: Promise<unknown> = Promise.resolve();

/**
 * Apply `optimistic` to the screen now, then run `write` after every earlier
 * write. Resolves to whether it succeeded; failures are shown to the user and
 * the given scopes are reloaded either way.
 */
function commit(
  scopes: Scope[],
  optimistic: ((db: Database) => Database) | null,
  write: (client: SupabaseClient) => Promise<unknown>,
): Promise<boolean> {
  if (optimistic) setDb(optimistic(state.db));
  pendingWrites += 1;
  writeEpoch += 1;
  const result = chain.then(async () => {
    try {
      await write(sb());
      return true;
    } catch (err) {
      toast(friendlyError(err));
      return false;
    } finally {
      pendingWrites -= 1;
      requestRefresh(scopes);
    }
  });
  chain = result;
  return result;
}

/* ---------------------------------------------------- optimistic helpers */

const mapTask = (db: Database, id: string, fn: (t: Task) => Task): Database => ({
  ...db,
  tasks: db.tasks.map((t) => (t.id === id ? fn(t) : t)),
});

function closeOpenSession(task: Task, reason: Task["sessions"][number]["endReason"], note?: string): Task {
  return {
    ...task,
    sessions: task.sessions.map((s) =>
      s.endedAt === null ? { ...s, endedAt: now(), endReason: reason, endNote: note } : s,
    ),
  };
}

function openSession(task: Task, userId: string): Task {
  if (task.sessions.some((s) => s.endedAt === null)) return task;
  return {
    ...task,
    status: "In Progress",
    sessions: [
      ...task.sessions,
      { id: newId(), userId, startedAt: now(), endedAt: null, endReason: null },
    ],
  };
}

/* ------------------------------------------------------------- session */

let initialised = false;
let channel: RealtimeChannel | null = null;
let activating: string | null = null;

function subscribeToNotifications(userId: string) {
  channel?.unsubscribe();
  channel = sb()
    .channel(`notifications:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `profile_id=eq.${userId}`,
      },
      (payload) => {
        const n = toNotification(payload.new as Record<string, unknown>);
        if (state.db.notifications.some((x) => x.id === n.id)) return;
        setDb({ ...state.db, notifications: [n, ...state.db.notifications] });
        // A notification means someone changed work this user can see.
        requestRefresh(["tasks", "projects", "expenses"]);
      },
    )
    .subscribe();
}

function resetSession() {
  channel?.unsubscribe();
  channel = null;
  queuedScopes.clear();
  setState({ db: EMPTY_DB, auth: "signed-out", userId: null });
}

/**
 * Scopes the first screen actually needs. The rest — expenses, vendors,
 * templates, notifications, links — arrive straight after in the background,
 * so signing in doesn't wait on tables the dashboard never reads.
 */
const CORE_SCOPES: Scope[] = ["users", "projects", "tasks", "calendar"];
const DEFERRED_SCOPES: Scope[] = ALL_SCOPES.filter((s) => !CORE_SCOPES.includes(s));

/** Load this user's workspace and check their profile may use the app. */
async function activate(userId: string): Promise<{ ok: boolean; error?: string }> {
  if (activating === userId) return { ok: true };
  activating = userId;
  setState({ auth: "loading", userId });
  try {
    const db = await loadScopes(sb(), CORE_SCOPES);
    const full = { ...EMPTY_DB, ...db };
    const me = full.users.find((u) => u.id === userId);
    if (!me) {
      await sb().auth.signOut();
      resetSession();
      return { ok: false, error: "This login has no profile yet. Ask an administrator to add you." };
    }
    if (!me.active) {
      await sb().auth.signOut();
      resetSession();
      return { ok: false, error: "This account is deactivated." };
    }
    setState({ db: full, auth: "signed-in", userId });
    subscribeToNotifications(userId);
    // Everything else streams in behind the first render; the queue applies it
    // only once no optimistic write is in flight.
    requestRefresh(DEFERRED_SCOPES);
    return { ok: true };
  } catch (err) {
    resetSession();
    return { ok: false, error: `Couldn't load your workspace: ${friendlyError(err)}` };
  } finally {
    activating = null;
  }
}

async function init() {
  if (initialised) return;
  initialised = true;
  if (!isSupabaseConfigured) {
    setState({ auth: "signed-out" });
    return;
  }

  const client = sb();
  const {
    data: { session },
  } = await client.auth.getSession();
  if (session?.user) {
    const result = await activate(session.user.id);
    if (!result.ok && result.error) toast(result.error);
  } else {
    setState({ auth: "signed-out" });
  }

  client.auth.onAuthStateChange((event, next) => {
    if (event === "SIGNED_OUT") {
      resetSession();
    } else if (event === "SIGNED_IN" && next?.user && next.user.id !== state.userId) {
      void activate(next.user.id);
    }
  });

  // Catch up on anything that changed while the tab was in the background.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || state.auth !== "signed-in") return;
    if (Date.now() - lastFullRefresh > 60_000) requestRefresh(ALL_SCOPES);
  });
}

/* ------------------------------------------------------- admin API calls */

async function callAdmin(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, error: json.error ?? `Request failed (${res.status}).` };
    requestRefresh(["users"]);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
}

/* ------------------------------------------------------------- context */

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

export interface NewUserInput {
  fullName: string;
  email: string;
  /** Temporary — the user must change it at first sign-in (§6). */
  password: string;
  role: Role;
  departments: string[];
}

export type UserPatch = Partial<Pick<User, "fullName" | "email" | "role" | "departments" | "active">> & {
  /** Resets the password and asks the user to change it again. */
  password?: string;
};

/** A link and where it goes: an existing group, or a new one created with it. */
export interface LinkInput {
  groupId?: string;
  newGroupName?: string;
  name: string;
  url: string;
}

type Result = Promise<{ ok: boolean; error?: string }>;

interface StoreValue {
  db: Database;
  /** False until we know who is signed in and their data has loaded. */
  ready: boolean;
  /** False when .env.local lacks the Supabase keys. */
  configured: boolean;
  currentUser: User | null;
  toasts: Toast[];
  showToast: (message: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: string) => void;

  login: (email: string, password: string) => Result;
  logout: () => Promise<void>;
  changePassword: (password: string) => Result;

  userById: (id: string) => User | undefined;
  projectById: (id: string) => Project | undefined;
  taskById: (id: string) => Task | undefined;
  vendorById: (id: string) => Vendor | undefined;

  createUser: (input: NewUserInput) => Result;
  updateUser: (id: string, patch: UserPatch) => Result;
  deleteUser: (id: string) => Result;

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

  createExpense: (input: Omit<Expense, "id" | "createdAt" | "createdBy" | "status">) => void;
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

  createLink: (input: LinkInput) => void;
  updateLink: (id: string, input: LinkInput) => void;
  deleteLink: (id: string) => void;
  renameLinkGroup: (id: string, name: string) => void;
  deleteLinkGroup: (id: string) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

/* -------------------------------------------------------- the mutations */

// Module-level so their identity is stable and the context value stays cheap.

const me = () => state.userId ?? "";

const actions = {
  /* ------------------------------------------------------------ auth */

  async login(email: string, password: string) {
    if (!isSupabaseConfigured) return { ok: false, error: "Supabase isn't configured yet." };
    const { data, error } = await sb().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error || !data.user) {
      return {
        ok: false,
        error: /invalid login/i.test(error?.message ?? "")
          ? "Incorrect email or password."
          : friendlyError(error),
      };
    }
    return activate(data.user.id);
  },

  async logout() {
    await sb().auth.signOut();
    resetSession();
  },

  async changePassword(password: string) {
    const { error } = await sb().auth.updateUser({ password });
    if (error) return { ok: false, error: friendlyError(error) };
    const ok = await commit(
      ["users"],
      (db) => ({
        ...db,
        users: db.users.map((u) => (u.id === me() ? { ...u, mustChangePassword: false } : u)),
      }),
      (c) => run(c.from("profiles").update({ must_change_password: false }).eq("id", me())),
    );
    return ok ? { ok: true } : { ok: false, error: "Password changed, but the profile didn't update." };
  },

  /* ----------------------------------------------------------- users */

  createUser: (input: NewUserInput) => callAdmin("/api/admin/users", "POST", input),
  updateUser: (id: string, patch: UserPatch) =>
    callAdmin(`/api/admin/users/${id}`, "PATCH", patch),
  deleteUser: (id: string) => callAdmin(`/api/admin/users/${id}`, "DELETE"),

  /* -------------------------------------------------------- projects */

  createProject(input: Omit<Project, "id" | "createdAt" | "createdBy">): Project {
    const project: Project = { ...input, id: newId(), createdBy: me(), createdAt: now() };
    void commit(
      ["projects"],
      (db) => ({ ...db, projects: [project, ...db.projects] }),
      async (c) => {
        await insertProject(c, project);
      },
    );
    return project;
  },

  createProjectFromTemplate({ templateId, project, assignments }: ProjectFromTemplateInput): Project {
    const created: Project = { ...project, id: newId(), createdBy: me(), createdAt: now() };
    const template = state.db.projectTemplates.find((t) => t.id === templateId);
    const calendar = state.db.calendar;

    // Tasks left unassigned are skipped (§13); dates follow working days.
    const tasks: Task[] = (template?.tasks ?? []).flatMap((item) => {
      const assigneeId = assignments[item.id];
      if (!assigneeId) return [];
      let startDate = addWorkingDays(created.startDate, item.startOffsetDays, calendar);
      if (startDate > created.deadline) startDate = created.deadline;
      let dueDate = addWorkingDays(startDate, item.durationDays, calendar);
      if (dueDate > created.deadline) dueDate = created.deadline;
      return [
        {
          id: newId(),
          projectId: created.id,
          title: item.title,
          description: item.description,
          department: item.department,
          assigneeId,
          status: "Not Started" as const,
          priority: item.priority,
          startDate,
          dueDate,
          estimatedHours: item.estimatedHours,
          tags: item.tags,
          createdBy: me(),
          createdAt: now(),
          sessions: [],
          submissions: [],
          reviews: [],
          remarks: [],
        },
      ];
    });

    void commit(
      ["projects", "tasks"],
      (db) => ({ ...db, projects: [created, ...db.projects], tasks: [...db.tasks, ...tasks] }),
      async (c) => {
        await insertProject(c, created);
        if (tasks.length) {
          await run(c.from("tasks").insert(tasks.map((t) => ({ ...taskRow(t), created_by: me() }))));
        }
      },
    );
    return created;
  },

  updateProject(id: string, patch: Partial<Project>) {
    void commit(
      ["projects"],
      (db) => ({ ...db, projects: db.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) }),
      async (c) => {
        const columns: Record<string, unknown> = patchColumns(patch, PROJECT_COLUMNS);
        if ("recurrence" in patch) Object.assign(columns, seriesColumns(patch.recurrence));
        if (Object.keys(columns).length) {
          await run(c.from("projects").update(columns).eq("id", id));
        }
        if (patch.services) {
          await run(c.from("project_services").delete().eq("project_id", id));
          if (patch.services.length) {
            await run(
              c.from("project_services").insert(patch.services.map((service) => ({ project_id: id, service }))),
            );
          }
        }
        if (patch.memberIds) {
          await run(c.from("project_members").delete().eq("project_id", id));
          if (patch.memberIds.length) {
            await run(
              c
                .from("project_members")
                .insert(patch.memberIds.map((profile_id) => ({ project_id: id, profile_id }))),
            );
          }
        }
      },
    );
  },

  deleteProject(id: string) {
    void commit(
      ["projects", "tasks", "expenses"],
      (db) => ({
        ...db,
        projects: db.projects.filter((p) => p.id !== id),
        tasks: db.tasks.filter((t) => t.projectId !== id),
        expenses: db.expenses.filter((e) => e.projectId !== id),
      }),
      (c) => run(c.from("projects").delete().eq("id", id)),
    );
  },

  /* ----------------------------------------------------------- tasks */

  createTask(input: NewTaskInput): Task {
    const task: Task = {
      ...input,
      // Only individual tasks repeat on their own; project tasks repeat with their project.
      recurrence: input.projectId === null ? (input.recurrence ?? null) : null,
      id: newId(),
      createdBy: me(),
      createdAt: now(),
      sessions: [],
      submissions: [],
      reviews: [],
      remarks: [],
    };
    void commit(
      ["tasks"],
      (db) => ({ ...db, tasks: [...db.tasks, task] }),
      (c) =>
        run(
          c.from("tasks").insert({
            ...taskRow(task),
            created_by: me(),
            ...seriesColumns(task.recurrence),
          }),
        ),
    );
    return task;
  },

  updateTask(id: string, patch: Partial<Task>) {
    const before = state.db.tasks.find((t) => t.id === id);
    if (!before) return;
    const reassigned = !!patch.assigneeId && patch.assigneeId !== before.assigneeId;
    // Handing a task to someone else puts it back at the start (§12.2 parallel).
    const status = reassigned ? (patch.status ?? "Not Started") : (patch.status ?? before.status);
    const effective: Partial<Task> = { ...patch, status };
    const isIndividual = (patch.projectId ?? before.projectId) === null;

    void commit(
      ["tasks"],
      (db) => mapTask(db, id, (t) => ({ ...t, ...effective })),
      (c) => {
        const columns: Record<string, unknown> = patchColumns(effective, TASK_COLUMNS);
        if ("recurrence" in patch) {
          Object.assign(columns, seriesColumns(isIndividual ? patch.recurrence : null));
        }
        return run(c.from("tasks").update(columns).eq("id", id));
      },
    );
  },

  deleteTask(id: string) {
    void commit(
      ["tasks"],
      (db) => ({ ...db, tasks: db.tasks.filter((t) => t.id !== id) }),
      (c) => run(c.from("tasks").delete().eq("id", id)),
    );
  },

  addRemark(taskId: string, text: string) {
    const remark: Remark = { id: newId(), byUserId: me(), at: now(), text };
    void commit(
      ["tasks"],
      (db) => mapTask(db, taskId, (t) => ({ ...t, remarks: [...t.remarks, remark] })),
      (c) =>
        run(c.from("remarks").insert({ id: remark.id, task_id: taskId, by_profile_id: me(), body: text })),
    );
  },

  /* ----------------------------------------------------------- timer */

  startTimer(taskId: string) {
    const userId = me();
    void commit(
      ["tasks"],
      (db) => ({
        ...db,
        // §11.3.1 — one timer per user: any other open session closes as "Switched".
        tasks: db.tasks.map((t) =>
          t.id === taskId
            ? openSession(t, userId)
            : t.sessions.some((s) => s.endedAt === null && s.userId === userId)
              ? closeOpenSession(t, "Switched")
              : t,
        ),
      }),
      (c) => run(c.rpc("start_timer", { p_task_id: taskId })),
    );
  },

  /** "Done for the day" — session ends, task stays In Progress (Paused). */
  pauseTimer(taskId: string, note?: string) {
    void commit(
      ["tasks"],
      (db) => mapTask(db, taskId, (t) => closeOpenSession(t, "End of day", note)),
      (c) =>
        run(c.rpc("pause_timer", { p_task_id: taskId, p_reason: "End of day", p_note: note ?? null })),
    );
  },

  /** "Working on a different project" — close here, open there (§11.2 option 2). */
  switchTimer(fromTaskId: string, toTaskId: string) {
    const userId = me();
    const target = state.db.tasks.find((t) => t.id === toTaskId);
    const targetProject = target?.projectId
      ? state.db.projects.find((p) => p.id === target.projectId)
      : null;
    const note = targetProject
      ? `Switched to ${targetProject.name}`
      : `Switched to ${target?.title ?? "another task"}`;
    void commit(
      ["tasks"],
      (db) => ({
        ...db,
        tasks: db.tasks.map((t) => {
          if (t.id === fromTaskId) return closeOpenSession(t, "Switched", note);
          if (t.id === toTaskId) return openSession(t, userId);
          return t;
        }),
      }),
      async (c) => {
        await run(c.rpc("pause_timer", { p_task_id: fromTaskId, p_reason: "Switched", p_note: note }));
        await run(c.rpc("start_timer", { p_task_id: toTaskId }));
      },
    );
  },

  submitTask(taskId: string, input: SubmissionInput) {
    void commit(
      ["tasks"],
      (db) =>
        mapTask(db, taskId, (t) => ({
          ...closeOpenSession(t, "Submitted"),
          status: "Submitted",
          submissions: [
            ...t.submissions,
            {
              id: newId(),
              byUserId: me(),
              at: now(),
              outputLocation: input.outputLocation,
              driveLink: input.driveLink,
              description: input.description,
            },
          ],
        })),
      (c) =>
        run(
          c.rpc("submit_task", {
            p_task_id: taskId,
            p_output: input.outputLocation,
            p_drive_link: input.driveLink ?? null,
            p_description: input.description,
          }),
        ),
    );
  },

  reviewTask(taskId: string, input: ReviewInput) {
    void commit(
      ["tasks"],
      (db) =>
        mapTask(db, taskId, (task) => {
          const review: Review = {
            id: newId(),
            submissionId: task.submissions[task.submissions.length - 1]?.id ?? "",
            byUserId: me(),
            at: now(),
            decision: input.decision,
            source: input.source,
            remarks: input.remarks,
            newAssigneeId: input.newAssigneeId,
            newDueDate: input.newDueDate,
          };
          const reviewed = { ...task, reviews: [...task.reviews, review] };
          if (input.decision === "Approved") return { ...reviewed, status: "Approved" };
          if (input.decision === "Changes Required") return { ...reviewed, status: "Changes Required" };
          // Reject → reassign, reset to Not Started, optionally move the due date.
          return {
            ...reviewed,
            status: "Not Started",
            assigneeId: input.newAssigneeId ?? task.assigneeId,
            dueDate: input.newDueDate ?? task.dueDate,
          };
        }),
      (c) =>
        run(
          c.rpc("review_task", {
            p_task_id: taskId,
            p_decision: input.decision,
            p_remarks: input.remarks,
            p_source: input.source ?? null,
            p_new_assignee: input.newAssigneeId ?? null,
            p_new_due_date: input.newDueDate ?? null,
          }),
        ),
    );
  },

  /* -------------------------------------------------------- expenses */

  createExpense(input: Omit<Expense, "id" | "createdAt" | "createdBy" | "status">) {
    const expense: Expense = { ...input, id: newId(), status: "Pending", createdBy: me(), createdAt: now() };
    void commit(
      ["expenses"],
      (db) => ({ ...db, expenses: [expense, ...db.expenses] }),
      (c) =>
        run(
          c.from("expenses").insert({
            id: expense.id,
            ...patchColumns(expense, EXPENSE_COLUMNS),
            status: "Pending",
            created_by: me(),
          }),
        ),
    );
  },

  updateExpense(id: string, patch: Partial<Expense>) {
    void commit(
      ["expenses"],
      (db) => ({ ...db, expenses: db.expenses.map((e) => (e.id === id ? { ...e, ...patch } : e)) }),
      (c) => run(c.from("expenses").update(patchColumns(patch, EXPENSE_COLUMNS)).eq("id", id)),
    );
  },

  deleteExpense(id: string) {
    void commit(
      ["expenses"],
      (db) => ({ ...db, expenses: db.expenses.filter((e) => e.id !== id) }),
      (c) => run(c.from("expenses").delete().eq("id", id)),
    );
  },

  reviewExpense(id: string, approved: boolean, remarks?: string) {
    void commit(
      ["expenses"],
      (db) => ({
        ...db,
        expenses: db.expenses.map((e) =>
          e.id === id
            ? {
                ...e,
                status: approved ? "Approved" : "Rejected",
                financeRemarks: remarks,
                reviewedBy: me(),
                reviewedAt: now(),
              }
            : e,
        ),
      }),
      (c) =>
        run(c.rpc("review_expense", { p_expense_id: id, p_approved: approved, p_remarks: remarks ?? null })),
    );
  },

  /* --------------------------------------------------------- vendors */

  createVendor(input: Omit<Vendor, "id">) {
    const vendor: Vendor = { ...input, id: newId() };
    void commit(
      ["vendors"],
      (db) => ({ ...db, vendors: [...db.vendors, vendor] }),
      (c) => run(c.from("vendors").insert({ id: vendor.id, ...patchColumns(vendor, VENDOR_COLUMNS) })),
    );
  },

  updateVendor(id: string, patch: Partial<Vendor>) {
    void commit(
      ["vendors"],
      (db) => ({ ...db, vendors: db.vendors.map((v) => (v.id === id ? { ...v, ...patch } : v)) }),
      (c) => run(c.from("vendors").update(patchColumns(patch, VENDOR_COLUMNS)).eq("id", id)),
    );
  },

  deleteVendor(id: string) {
    void commit(
      ["vendors"],
      (db) => ({ ...db, vendors: db.vendors.filter((v) => v.id !== id) }),
      (c) => run(c.from("vendors").delete().eq("id", id)),
    );
  },

  /* ------------------------------------------------------- templates */

  saveProjectTemplate(input: ProjectTemplate) {
    const t = { ...input, id: UUID.test(input.id) ? input.id : newId() };
    void commit(
      ["templates"],
      (db) => ({
        ...db,
        projectTemplates: db.projectTemplates.some((x) => x.id === input.id)
          ? db.projectTemplates.map((x) => (x.id === input.id ? t : x))
          : [...db.projectTemplates, t],
      }),
      async (c) => {
        await run(
          c.from("project_templates").upsert({
            id: t.id,
            name: t.name,
            description: t.description,
            color: t.color,
            priority: t.priority,
            duration_days: t.durationDays,
          }),
        );
        await run(c.from("project_template_services").delete().eq("template_id", t.id));
        if (t.services.length) {
          await run(
            c
              .from("project_template_services")
              .insert(t.services.map((service) => ({ template_id: t.id, service }))),
          );
        }
        await run(c.from("project_template_tasks").delete().eq("template_id", t.id));
        if (t.tasks.length) {
          await run(
            c.from("project_template_tasks").insert(
              t.tasks.map((item, position) => ({ template_id: t.id, position, ...templateItemRow(item) })),
            ),
          );
        }
      },
    );
  },

  deleteProjectTemplate(id: string) {
    void commit(
      ["templates"],
      (db) => ({ ...db, projectTemplates: db.projectTemplates.filter((t) => t.id !== id) }),
      (c) => run(c.from("project_templates").delete().eq("id", id)),
    );
  },

  saveTaskTemplate(input: TaskTemplate) {
    const t = { ...input, id: UUID.test(input.id) ? input.id : newId() };
    void commit(
      ["templates"],
      (db) => ({
        ...db,
        taskTemplates: db.taskTemplates.some((x) => x.id === input.id)
          ? db.taskTemplates.map((x) => (x.id === input.id ? t : x))
          : [...db.taskTemplates, t],
      }),
      (c) => run(c.from("task_templates").upsert({ id: t.id, ...templateItemRow(t) })),
    );
  },

  deleteTaskTemplate(id: string) {
    void commit(
      ["templates"],
      (db) => ({ ...db, taskTemplates: db.taskTemplates.filter((t) => t.id !== id) }),
      (c) => run(c.from("task_templates").delete().eq("id", id)),
    );
  },

  /* -------------------------------------------------------- calendar */

  updateCalendar(patch: Partial<CalendarConfig>) {
    const before = state.db.calendar;
    const next = { ...before, ...patch };
    const beforeDates = new Map(before.holidays.map((h) => [h.date, h.name]));
    const nextDates = new Map(next.holidays.map((h) => [h.date, h.name]));
    const addedHolidays = next.holidays.filter((h) => beforeDates.get(h.date) !== h.name);
    const removedHolidays = before.holidays.filter((h) => !nextDates.has(h.date)).map((h) => h.date);
    const addedOverrides = next.workingOverrides.filter((d) => !before.workingOverrides.includes(d));
    const removedOverrides = before.workingOverrides.filter((d) => !next.workingOverrides.includes(d));

    void commit(
      ["calendar"],
      (db) => ({ ...db, calendar: next }),
      async (c) => {
        if (removedHolidays.length) {
          await run(c.from("holidays").delete().in("holiday_date", removedHolidays));
        }
        if (addedHolidays.length) {
          await run(
            c
              .from("holidays")
              .upsert(addedHolidays.map((h) => ({ holiday_date: h.date, name: h.name }))),
          );
        }
        if (removedOverrides.length) {
          await run(c.from("working_overrides").delete().in("override_date", removedOverrides));
        }
        if (addedOverrides.length) {
          await run(
            c
              .from("working_overrides")
              .insert(addedOverrides.map((d) => ({ override_date: d, created_by: me() }))),
          );
        }
      },
    );
  },

  /* --------------------------------------------------- notifications */

  markNotificationRead(id: string) {
    void commit(
      [],
      (db) => ({
        ...db,
        notifications: db.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
      }),
      (c) => run(c.from("notifications").update({ read: true }).eq("id", id)),
    );
  },

  markAllNotificationsRead() {
    const userId = me();
    void commit(
      [],
      (db) => ({
        ...db,
        notifications: db.notifications.map((n) => (n.userId === userId ? { ...n, read: true } : n)),
      }),
      (c) =>
        run(c.from("notifications").update({ read: true }).eq("profile_id", userId).eq("read", false)),
    );
  },
};

/**
 * The group a link should go in. A typed name that matches an existing group
 * (ignoring case) reuses it; otherwise a new group is made alongside the link.
 */
function resolveLinkGroup(input: LinkInput): { groupId: string; created: LinkGroup | null } {
  const name = input.newGroupName?.trim();
  if (!name) return { groupId: input.groupId ?? "", created: null };
  const existing = state.db.linkGroups.find((g) => g.name.trim().toLowerCase() === name.toLowerCase());
  if (existing) return { groupId: existing.id, created: null };
  const created: LinkGroup = { id: newId(), name, createdAt: now() };
  return { groupId: created.id, created };
}

async function insertLinkGroup(c: SupabaseClient, group: LinkGroup | null) {
  if (group) await run(c.from("link_groups").insert({ id: group.id, name: group.name }));
}

const linkActions = {
  createLink(input: LinkInput) {
    const { groupId, created } = resolveLinkGroup(input);
    const link: OperationalLink = {
      id: newId(),
      groupId,
      name: input.name.trim(),
      url: input.url.trim(),
      createdBy: me(),
      createdAt: now(),
    };
    void commit(
      ["links"],
      (db) => ({
        ...db,
        linkGroups: created ? [...db.linkGroups, created] : db.linkGroups,
        operationalLinks: [...db.operationalLinks, link],
      }),
      async (c) => {
        await insertLinkGroup(c, created);
        await run(
          c.from("operational_links").insert({
            id: link.id,
            group_id: link.groupId,
            name: link.name,
            url: link.url,
          }),
        );
      },
    );
  },

  updateLink(id: string, input: LinkInput) {
    const { groupId, created } = resolveLinkGroup(input);
    const patch = { groupId, name: input.name.trim(), url: input.url.trim() };
    void commit(
      ["links"],
      (db) => ({
        ...db,
        linkGroups: created ? [...db.linkGroups, created] : db.linkGroups,
        operationalLinks: db.operationalLinks.map((l) => (l.id === id ? { ...l, ...patch } : l)),
      }),
      async (c) => {
        await insertLinkGroup(c, created);
        await run(
          c
            .from("operational_links")
            .update({ group_id: patch.groupId, name: patch.name, url: patch.url })
            .eq("id", id),
        );
      },
    );
  },

  deleteLink(id: string) {
    void commit(
      ["links"],
      (db) => ({ ...db, operationalLinks: db.operationalLinks.filter((l) => l.id !== id) }),
      (c) => run(c.from("operational_links").delete().eq("id", id)),
    );
  },

  renameLinkGroup(id: string, name: string) {
    const trimmed = name.trim();
    void commit(
      ["links"],
      (db) => ({
        ...db,
        linkGroups: db.linkGroups.map((g) => (g.id === id ? { ...g, name: trimmed } : g)),
      }),
      (c) => run(c.from("link_groups").update({ name: trimmed }).eq("id", id)),
    );
  },

  /** Removes the group and every link in it. */
  deleteLinkGroup(id: string) {
    void commit(
      ["links"],
      (db) => ({
        ...db,
        linkGroups: db.linkGroups.filter((g) => g.id !== id),
        operationalLinks: db.operationalLinks.filter((l) => l.groupId !== id),
      }),
      (c) => run(c.from("link_groups").delete().eq("id", id)),
    );
  },
};

async function insertProject(c: SupabaseClient, p: Project) {
  await run(
    c.from("projects").insert({
      ...projectRow(p),
      created_by: me(),
      ...seriesColumns(p.recurrence as RecurrenceSeries | null | undefined),
    }),
  );
  if (p.services.length) {
    await run(c.from("project_services").insert(p.services.map((service) => ({ project_id: p.id, service }))));
  }
  if (p.memberIds.length) {
    await run(
      c.from("project_members").insert(p.memberIds.map((profile_id) => ({ project_id: p.id, profile_id }))),
    );
  }
}

/* ------------------------------------------------------------ provider */

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    void init();
  }, []);

  const { db, auth, userId, toasts } = snapshot;

  const currentUser = useMemo(
    () => (auth === "signed-in" ? (db.users.find((u) => u.id === userId) ?? null) : null),
    [auth, db.users, userId],
  );

  const userById = useCallback((id: string) => db.users.find((u) => u.id === id), [db.users]);
  const projectById = useCallback((id: string) => db.projects.find((p) => p.id === id), [db.projects]);
  const taskById = useCallback((id: string) => db.tasks.find((t) => t.id === id), [db.tasks]);
  const vendorById = useCallback((id: string) => db.vendors.find((v) => v.id === id), [db.vendors]);

  const value = useMemo<StoreValue>(
    () => ({
      db,
      ready: auth === "signed-in" || auth === "signed-out",
      configured: isSupabaseConfigured,
      currentUser,
      toasts,
      showToast: toast,
      dismissToast,
      userById,
      projectById,
      taskById,
      vendorById,
      ...actions,
      ...linkActions,
    }),
    [db, auth, currentUser, toasts, userById, projectById, taskById, vendorById],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}
