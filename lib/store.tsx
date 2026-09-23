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
import {
  ALL_SCOPES,
  CLIENT_COLUMNS,
  COMPANY_COLUMNS,
  CONTENT_COLUMNS,
  EMPTY_DB,
  EXPENSE_COLUMNS,
  OBC_COLUMNS,
  PROJECT_COLUMNS,
  PROPERTY_COLUMNS,
  TASK_COLUMNS,
  VENDOR_COLUMNS,
  configRow,
  loadScopes,
  obcItemRow,
  obcServiceRow,
  patchColumns,
  projectRow,
  seriesColumns,
  taskRow,
  templateItemRow,
  toNotification,
  type Scope,
  type ScopeFailure,
} from "./data/db";
import { getSupabase } from "./supabase/client";
import { isSupabaseConfigured } from "./supabase/config";
import { isAllotted } from "./types";
import type {
  CalendarConfig,
  Client,
  CollabEntity,
  Comment,
  Company,
  ContentDecision,
  ContentEntry,
  ContentReview,
  ContentStage,
  Database,
  DriveFolder,
  Expense,
  LinkGroup,
  MeetingMinutes,
  Obc,
  ObcAllotment,
  ObcItem,
  ObcService,
  OperationalLink,
  OutputLocation,
  Project,
  ProjectTemplate,
  Property,
  PropertyConfig,
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

/**
 * What a broken scope should say. A table PostgREST cannot find is nearly
 * always a migration that has not been run, so say that rather than leaving
 * someone to read "schema cache" and conclude their data is gone.
 */
function describeFailures(failures: ScopeFailure[]): string {
  const names = failures.map((f) => f.scope).join(", ");
  const missing = failures.some((f) => /schema cache|does not exist|find the table/i.test(f.message));
  const detail = failures[0]?.message ?? "";
  return missing
    ? `Couldn't load ${names}: ${detail}. This usually means a database migration is still to be run — everything else is unaffected, and no data has been lost.`
    : `Couldn't load ${names}: ${detail}`;
}

/*
 * A scope that keeps failing would otherwise toast on every save and every
 * time the tab regains focus. Say it once, and again only if what is broken
 * changes.
 */
let reportedFailures = "";

async function flush() {
  const scopes = Array.from(queuedScopes);
  queuedScopes.clear();
  refreshing = true;
  const epoch = writeEpoch;
  try {
    const { data, failures } = await loadScopes(sb(), scopes);
    if (writeEpoch !== epoch) {
      // A write started while we were fetching — this data may predate it.
      for (const s of scopes) queuedScopes.add(s);
    } else if (state.userId) {
      // Whatever did load is applied; a scope that failed keeps what it had.
      setDb({ ...state.db, ...data });
      if (scopes.length === ALL_SCOPES.length && failures.length === 0) {
        lastFullRefresh = Date.now();
      }
    }

    const signature = failures.map((f) => f.scope).sort().join("|");
    if (signature && signature !== reportedFailures) toast(describeFailures(failures));
    if (signature !== reportedFailures) reportedFailures = signature;
  } catch (err) {
    // loadScopes reports per-scope problems rather than throwing, so reaching
    // here means something broader went wrong - no session, no network.
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
  reportedFailures = "";
  setState({ db: EMPTY_DB, auth: "signed-out", userId: null });
}

/**
 * Scopes the first screen actually needs. The rest — expenses, vendors,
 * templates, notifications, links — arrive straight after in the background,
 * so signing in doesn't wait on tables the dashboard never reads.
 */
const CORE_SCOPES: Scope[] = ["master", "users", "projects", "tasks", "calendar"];
const DEFERRED_SCOPES: Scope[] = ALL_SCOPES.filter((s) => !CORE_SCOPES.includes(s));

/** Load this user's workspace and check their profile may use the app. */
async function activate(userId: string): Promise<{ ok: boolean; error?: string }> {
  if (activating === userId) return { ok: true };
  activating = userId;
  setState({ auth: "loading", userId });
  try {
    // The core scopes are not optional: without users there is no way to tell
    // whether this login may be here at all, so a failure is fatal to sign-in.
    const { data, failures } = await loadScopes(sb(), CORE_SCOPES);
    if (failures.length) throw new Error(describeFailures(failures));
    const full = { ...EMPTY_DB, ...data };
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

/**
 * A project to create. The CRM chain is optional: only a project converted
 * from an OBC carries one, and everything raised by hand leaves it empty.
 */
export type NewProjectInput = Omit<
  Project,
  "id" | "createdAt" | "createdBy" | "companyId" | "clientId" | "propertyId" | "obcId"
> &
  Partial<Pick<Project, "companyId" | "clientId" | "propertyId" | "obcId">>;

/**
 * A task created in the same breath as its project, with its dates already
 * resolved — a template's row as the creator edited it, or one typed straight
 * into the form. Both arrive the same way, because by the time Create is
 * pressed there is no difference between them.
 */
export type NewProjectTaskInput = Pick<
  Task,
  | "title"
  | "description"
  | "department"
  | "assigneeId"
  | "priority"
  | "estimatedHours"
  | "startDate"
  | "dueDate"
  | "tags"
> &
  // As with NewTaskInput: a plain task says nothing and gets one, and only a
  // content task fills these in.
  Partial<Pick<Task, "kind" | "contentCount">>;

export interface ProjectWithTasksInput {
  project: NewProjectInput;
  /** Empty creates the project on its own. */
  tasks: NewProjectTaskInput[];
}

export type NewTaskInput = Omit<
  Task,
  | "id"
  | "createdAt"
  | "createdBy"
  | "sessions"
  | "submissions"
  | "reviews"
  | "remarks"
  | "kind"
  | "contentCount"
> &
  // A plain task is the overwhelming default, so callers say nothing and get
  // one; only the content-task form fills these in.
  Partial<Pick<Task, "kind" | "contentCount">>;

export interface NewUserInput {
  fullName: string;
  email: string;
  /** Temporary — the user must change it at first sign-in (§6). */
  password: string;
  role: Role;
  departments: string[];
  /** Hours per working day; defaults to a standard day when left out. */
  capacityHoursPerDay?: number;
}

export type UserPatch = Partial<
  Pick<
    User,
    "fullName" | "email" | "role" | "departments" | "active" | "capacityHoursPerDay"
  >
> & {
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

/* ------------------------------------------------------------- CRM inputs */

export type CompanyInput = Omit<Company, "id" | "createdBy" | "createdAt">;
export type ClientInput = Omit<Client, "id" | "createdBy" | "createdAt">;

/** Configs come in with the property; the whole list is rewritten on save. */
export type PropertyInput = Omit<
  Property,
  "id" | "createdBy" | "createdAt" | "folders" | "driveFolderId" | "driveFolderUrl"
>;

export type ObcInput = Omit<
  Obc,
  "id" | "code" | "createdBy" | "createdAt" | "status" | "projectId" | "submittedAt" | "convertedAt"
>;

/**
 * Writing a piece. The workflow fields are deliberately not here: status,
 * submittedAt and the review trail are moved only by `submitContent` and
 * `reviewContent`, and the stage only by `setContentStage` — each re-checks
 * the rule in the database.
 */
export type ContentInput = Omit<
  ContentEntry,
  "id" | "createdBy" | "createdAt" | "status" | "submittedAt" | "reviews" | "stage"
>;

export type MinutesInput = Omit<MeetingMinutes, "id" | "createdBy" | "createdAt">;

/** What the Drive route hands back once the folder tree exists. */
export interface DriveResult {
  folderId: string;
  url: string;
  folders: { name: string; folderId: string; url: string }[];
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

  /** Accepts null: a project may have no leader and a task no assignee. */
  userById: (id: string | null | undefined) => User | undefined;
  projectById: (id: string) => Project | undefined;
  taskById: (id: string) => Task | undefined;
  vendorById: (id: string) => Vendor | undefined;

  createUser: (input: NewUserInput) => Result;
  updateUser: (id: string, patch: UserPatch) => Result;
  deleteUser: (id: string) => Result;

  createProject: (input: NewProjectInput) => Project;
  createProjectWithTasks: (input: ProjectWithTasksInput) => Project;
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

  companyById: (id: string | null | undefined) => Company | undefined;
  clientById: (id: string | null | undefined) => Client | undefined;
  propertyById: (id: string | null | undefined) => Property | undefined;
  obcById: (id: string | null | undefined) => Obc | undefined;

  /** Master data — Super Admin only; Row Level Security is the real guard. */
  addDepartment: (name: string) => void;
  removeDepartment: (name: string) => void;
  addService: (name: string) => void;
  removeService: (name: string) => void;

  createCompany: (input: CompanyInput) => Company;
  updateCompany: (id: string, patch: Partial<CompanyInput>) => void;
  deleteCompany: (id: string) => void;

  createClient: (input: ClientInput) => Client;
  updateClient: (id: string, patch: Partial<ClientInput>) => void;
  deleteClient: (id: string) => void;

  createProperty: (input: PropertyInput) => Property;
  updateProperty: (id: string, patch: Partial<PropertyInput>) => void;
  deleteProperty: (id: string) => void;
  /** Records the folder tree the Drive route just created. */
  saveDriveFolders: (propertyId: string, result: DriveResult) => void;

  createObc: (input: ObcInput) => Obc;
  updateObc: (id: string, patch: Partial<ObcInput>) => void;
  deleteObc: (id: string) => void;
  submitObc: (id: string) => void;
  /** Raises a project (and its opening tasks) for the given delivery services. */
  convertObc: (
    id: string,
    project: NewProjectInput,
    serviceIds: string[],
    tasks?: NewProjectTaskInput[],
  ) => Project;
  /** Points delivery services at work that already exists. */
  allotObcServices: (id: string, serviceIds: string[], to: ObcAllotment) => void;

  createContentEntry: (input: ContentInput) => ContentEntry;
  updateContentEntry: (id: string, patch: Partial<ContentInput>) => void;
  deleteContentEntry: (id: string) => void;

  /** The writer hands one piece to its reviewer. */
  submitContent: (entryId: string) => void;
  /** A verdict on one piece; the content task closes itself once all are approved. */
  reviewContent: (entryId: string, decision: ContentDecision, remarks: string) => void;
  /** Hand a piece to someone (or take it back) without rewriting it. */
  allotContent: (entryId: string, userId: string | null) => void;
  /** Where the piece has got to after writing. */
  setContentStage: (entryId: string, stage: ContentStage | null) => void;

  addComment: (entityType: CollabEntity, entityId: string, body: string) => void;
  deleteComment: (id: string) => void;
  saveMinutes: (input: MinutesInput, id?: string) => void;
  deleteMinutes: (id: string) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

/**
 * The opening tasks of a project being created, with every date clamped to the
 * project window here rather than at each call site — a form that laid a task
 * out against an older deadline can never push one outside it.
 */
function projectTaskRows(project: Project, tasks: NewProjectTaskInput[]): Task[] {
  const clamp = (iso: string) =>
    iso < project.startDate ? project.startDate : iso > project.deadline ? project.deadline : iso;
  return tasks.map((input) => {
    const startDate = clamp(input.startDate);
    return {
      ...input,
      // After the spread, not before it: a caller passing `kind: undefined`
      // outright would otherwise beat a default written above it.
      kind: input.kind ?? "standard",
      contentCount: input.kind === "content" ? (input.contentCount ?? 0) : 0,
      id: newId(),
      projectId: project.id,
      status: "Not Started" as const,
      startDate,
      dueDate: clamp(input.dueDate < startDate ? startDate : input.dueDate),
      createdBy: me(),
      createdAt: now(),
      sessions: [],
      submissions: [],
      reviews: [],
      remarks: [],
    };
  });
}

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

  createProject(input: NewProjectInput): Project {
    const project: Project = { ...withoutCrmChain(input), id: newId(), createdBy: me(), createdAt: now() };
    void commit(
      ["projects"],
      (db) => ({ ...db, projects: [project, ...db.projects] }),
      async (c) => {
        await insertProject(c, project);
      },
    );
    return project;
  },

  /**
   * The project and its opening tasks in one write. Tasks arrive with their
   * dates already worked out — the form owns that, because it is where they
   * can be seen and changed — and are clamped to the project window here so
   * nothing can land outside it whatever the caller did. Unassigned tasks are
   * still created: the work is planned now and handed out later (§13).
   */
  createProjectWithTasks({ project, tasks }: ProjectWithTasksInput): Project {
    const created: Project = {
      ...withoutCrmChain(project),
      id: newId(),
      createdBy: me(),
      createdAt: now(),
    };
    const rows = projectTaskRows(created, tasks);

    void commit(
      ["projects", "tasks"],
      (db) => ({ ...db, projects: [created, ...db.projects], tasks: [...db.tasks, ...rows] }),
      async (c) => {
        await insertProject(c, created);
        if (rows.length) {
          await run(c.from("tasks").insert(rows.map((t) => ({ ...taskRow(t), created_by: me() }))));
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
      kind: "standard",
      contentCount: 0,
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
          // Parked with the client: the reviewer settles it once they answer.
          if (input.decision === "Waiting for Client Response") return { ...reviewed, status: "Waiting for Client Response" };
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

/* ----------------------------------------------------------------- CRM */

/** A project raised by hand has no company, client, property or OBC behind it. */
function withoutCrmChain(input: NewProjectInput) {
  return {
    ...input,
    companyId: input.companyId ?? null,
    clientId: input.clientId ?? null,
    propertyId: input.propertyId ?? null,
    obcId: input.obcId ?? null,
  };
}

/**
 * Line items belong to their parent, so they are rewritten wholesale rather
 * than diffed: the form always hands back the complete list.
 */
async function rewriteConfigs(c: SupabaseClient, propertyId: string, configs: PropertyConfig[]) {
  await run(c.from("property_configs").delete().eq("property_id", propertyId));
  if (configs.length) {
    await run(c.from("property_configs").insert(configs.map((x, i) => configRow(propertyId, x, i))));
  }
}

/**
 * Saves a quote's lines without disturbing where any of them was allotted.
 *
 * This used to delete every line and re-insert it, which blanked `project_id`
 * and `task_id` on each save — an OBC edit would quietly un-allot work that
 * was already running. Now only the lines that were taken off the quote are
 * deleted, and the rest are upserted: `obcItemRow` omits the allotment
 * columns, so an existing line keeps them and a new one starts with none.
 */
async function rewriteObcItems(c: SupabaseClient, obcId: string, items: ObcItem[]) {
  const kept = items.map((x) => x.id);
  let gone = c.from("obc_items").delete().eq("obc_id", obcId);
  if (kept.length) gone = gone.not("id", "in", `(${kept.join(",")})`);
  await run(gone);
  if (items.length) {
    await run(c.from("obc_items").upsert(items.map((x, i) => obcItemRow(obcId, x, i))));
  }
}

/** The delivery list, saved the same careful way and for the same reason. */
async function rewriteObcServices(c: SupabaseClient, obcId: string, services: ObcService[]) {
  const kept = services.map((x) => x.id);
  let gone = c.from("obc_services").delete().eq("obc_id", obcId);
  if (kept.length) gone = gone.not("id", "in", `(${kept.join(",")})`);
  await run(gone);
  if (services.length) {
    await run(
      c.from("obc_services").upsert(services.map((x, i) => obcServiceRow(obcId, x, i))),
    );
  }
}

/**
 * Adding and retiring the names every picker is built from.
 *
 * Deleting needs no check of its own: `department` and `service` are real
 * foreign keys across projects, tasks, profiles, templates and vendors, so the
 * database refuses to remove a name still in use and the user sees why.
 */
const masterActions = {
  addDepartment(name: string) {
    const value = name.trim();
    if (!value) return;
    void commit(
      ["master"],
      (db) => ({ ...db, departments: [...db.departments, value].sort() }),
      (c) => run(c.from("departments").insert({ name: value })),
    );
  },

  removeDepartment(name: string) {
    void commit(
      ["master"],
      (db) => ({ ...db, departments: db.departments.filter((d) => d !== name) }),
      (c) => run(c.from("departments").delete().eq("name", name)),
    );
  },

  addService(name: string) {
    const value = name.trim();
    if (!value) return;
    void commit(
      ["master"],
      (db) => ({ ...db, services: [...db.services, value].sort() }),
      (c) => run(c.from("services").insert({ name: value })),
    );
  },

  removeService(name: string) {
    void commit(
      ["master"],
      (db) => ({ ...db, services: db.services.filter((x) => x !== name) }),
      (c) => run(c.from("services").delete().eq("name", name)),
    );
  },
};

const crmActions = {
  /* ------------------------------------------------------- companies */

  createCompany(input: CompanyInput): Company {
    const company: Company = { ...input, id: newId(), createdBy: me(), createdAt: now() };
    void commit(
      ["crm"],
      (db) => ({ ...db, companies: [...db.companies, company] }),
      (c) =>
        run(
          c.from("companies").insert({
            id: company.id,
            ...patchColumns(input, COMPANY_COLUMNS),
          }),
        ),
    );
    return company;
  },

  updateCompany(id: string, patch: Partial<CompanyInput>) {
    void commit(
      ["crm"],
      (db) => ({
        ...db,
        companies: db.companies.map((x) => (x.id === id ? { ...x, ...patch } : x)),
      }),
      (c) => run(c.from("companies").update(patchColumns(patch, COMPANY_COLUMNS)).eq("id", id)),
    );
  },

  /** Cascades in the database to the company's clients and their properties. */
  deleteCompany(id: string) {
    void commit(
      ["crm", "projects"],
      (db) => {
        const clientIds = new Set(db.clients.filter((x) => x.companyId === id).map((x) => x.id));
        return {
          ...db,
          companies: db.companies.filter((x) => x.id !== id),
          clients: db.clients.filter((x) => !clientIds.has(x.id)),
          properties: db.properties.filter((x) => x.companyId !== id),
          obcs: db.obcs.filter((x) => x.companyId !== id),
        };
      },
      (c) => run(c.from("companies").delete().eq("id", id)),
    );
  },

  /* --------------------------------------------------------- clients */

  createClient(input: ClientInput): Client {
    const client: Client = { ...input, id: newId(), createdBy: me(), createdAt: now() };
    void commit(
      ["crm"],
      (db) => ({ ...db, clients: [...db.clients, client] }),
      (c) =>
        run(c.from("clients").insert({ id: client.id, ...patchColumns(input, CLIENT_COLUMNS) })),
    );
    return client;
  },

  updateClient(id: string, patch: Partial<ClientInput>) {
    void commit(
      ["crm"],
      (db) => ({ ...db, clients: db.clients.map((x) => (x.id === id ? { ...x, ...patch } : x)) }),
      (c) => run(c.from("clients").update(patchColumns(patch, CLIENT_COLUMNS)).eq("id", id)),
    );
  },

  deleteClient(id: string) {
    void commit(
      ["crm"],
      (db) => ({
        ...db,
        clients: db.clients.filter((x) => x.id !== id),
        // The property survives its contact; it just loses the link.
        properties: db.properties.map((p) => (p.clientId === id ? { ...p, clientId: null } : p)),
      }),
      (c) => run(c.from("clients").delete().eq("id", id)),
    );
  },

  /* ------------------------------------------------------ properties */

  createProperty(input: PropertyInput): Property {
    const property: Property = {
      ...input,
      id: newId(),
      driveFolderId: "",
      driveFolderUrl: "",
      folders: [],
      createdBy: me(),
      createdAt: now(),
    };
    void commit(
      ["crm"],
      (db) => ({ ...db, properties: [...db.properties, property] }),
      async (c) => {
        await run(
          c.from("properties").insert({
            id: property.id,
            ...patchColumns(input, PROPERTY_COLUMNS),
          }),
        );
        await rewriteConfigs(c, property.id, property.configs);
      },
    );
    return property;
  },

  updateProperty(id: string, patch: Partial<PropertyInput>) {
    void commit(
      ["crm"],
      (db) => ({
        ...db,
        properties: db.properties.map((x) => (x.id === id ? { ...x, ...patch } : x)),
      }),
      async (c) => {
        const columns = patchColumns(patch, PROPERTY_COLUMNS);
        if (Object.keys(columns).length) {
          await run(c.from("properties").update(columns).eq("id", id));
        }
        if (patch.configs) await rewriteConfigs(c, id, patch.configs);
      },
    );
  },

  deleteProperty(id: string) {
    void commit(
      ["crm"],
      (db) => ({ ...db, properties: db.properties.filter((x) => x.id !== id) }),
      (c) => run(c.from("properties").delete().eq("id", id)),
    );
  },

  /**
   * Stores what the Drive route created. The folder id on the property is what
   * stops a second click from building a second tree.
   */
  saveDriveFolders(propertyId: string, result: DriveResult) {
    const folders: DriveFolder[] = result.folders.map((f) => ({
      id: newId(),
      name: f.name,
      folderId: f.folderId,
      url: f.url,
    }));
    void commit(
      ["crm"],
      (db) => ({
        ...db,
        properties: db.properties.map((p) =>
          p.id === propertyId
            ? { ...p, driveFolderId: result.folderId, driveFolderUrl: result.url, folders }
            : p,
        ),
      }),
      async (c) => {
        await run(
          c
            .from("properties")
            .update({ drive_folder_id: result.folderId, drive_folder_url: result.url })
            .eq("id", propertyId),
        );
        await run(c.from("property_drive_folders").delete().eq("property_id", propertyId));
        if (folders.length) {
          await run(
            c.from("property_drive_folders").insert(
              folders.map((f) => ({
                id: f.id,
                property_id: propertyId,
                name: f.name,
                folder_id: f.folderId,
                url: f.url,
              })),
            ),
          );
        }
      },
    );
  },

  /* ------------------------------------------------------------ OBCs */

  createObc(input: ObcInput): Obc {
    const obc: Obc = {
      ...input,
      id: newId(),
      // The database assigns the real code; this placeholder only lives until
      // the refetch that follows the insert.
      code: "OBC-…",
      status: "Draft",
      projectId: null,
      createdBy: me(),
      createdAt: now(),
    };
    void commit(
      ["crm"],
      (db) => ({ ...db, obcs: [obc, ...db.obcs] }),
      async (c) => {
        await run(c.from("obcs").insert({ id: obc.id, ...patchColumns(input, OBC_COLUMNS) }));
        await rewriteObcItems(c, obc.id, obc.items);
        await rewriteObcServices(c, obc.id, obc.services);
      },
    );
    return obc;
  },

  /**
   * Edits stay in step with the work. An OBC that has raised projects should
   * not disagree with them about who the client is, so the chain it owns —
   * company, client and property — is pushed down to every project raised
   * from it.
   *
   * Services are *not* pushed down any more. A project is now raised for the
   * particular services it covers, so overwriting its list with everything the
   * quote happens to mention would hand each project the others' work.
   *
   * Tasks are left alone for the same reason they always were. They are
   * written by hand and then lived in: renamed, reassigned, half-submitted,
   * with time logged against them. An OBC edit must never throw that away.
   */
  updateObc(id: string, patch: Partial<ObcInput>) {
    const obc = state.db.obcs.find((x) => x.id === id);
    const linked = state.db.projects.filter((p) => p.obcId === id);
    const syncing = !!obc && linked.length > 0;

    const chain = {
      ...("companyId" in patch ? { companyId: patch.companyId ?? null } : {}),
      ...("clientId" in patch ? { clientId: patch.clientId ?? null } : {}),
      ...("propertyId" in patch ? { propertyId: patch.propertyId ?? null } : {}),
    };
    const clientName = "clientId" in patch
      ? (state.db.clients.find((x) => x.id === patch.clientId)?.fullName ??
         state.db.companies.find((x) => x.id === (patch.companyId ?? obc?.companyId))?.name ??
         "")
      : undefined;

    void commit(
      syncing ? ["crm", "projects"] : ["crm"],
      (db) => ({
        ...db,
        obcs: db.obcs.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        projects: syncing
          ? db.projects.map((p) =>
              p.obcId === id
                ? {
                    ...p,
                    ...chain,
                    ...(clientName !== undefined ? { clientName } : {}),
                  }
                : p,
            )
          : db.projects,
      }),
      async (c) => {
        const columns = patchColumns(patch, OBC_COLUMNS);
        if (Object.keys(columns).length) {
          await run(c.from("obcs").update(columns).eq("id", id));
        }
        if (patch.items) await rewriteObcItems(c, id, patch.items);
        if (patch.services) await rewriteObcServices(c, id, patch.services);

        if (!syncing) return;
        const projectColumns: Record<string, unknown> = patchColumns(chain, PROJECT_COLUMNS);
        if (clientName !== undefined) projectColumns.client_name = clientName;
        if (!Object.keys(projectColumns).length) return;
        for (const p of linked) {
          await run(c.from("projects").update(projectColumns).eq("id", p.id));
        }
      },
    );
  },

  /**
   * Deleting an OBC takes the work it created with it — the projects raised
   * from it, and through them (the database cascades) their tasks, time and
   * expenses. The foreign key alone would only blank the link and strand the
   * projects, so they are removed first, by hand.
   */
  deleteObc(id: string) {
    const projectIds = state.db.projects.filter((p) => p.obcId === id).map((p) => p.id);
    void commit(
      projectIds.length ? ["crm", "projects", "tasks", "expenses"] : ["crm"],
      (db) => ({
        ...db,
        obcs: db.obcs.filter((x) => x.id !== id),
        projects: db.projects.filter((p) => !projectIds.includes(p.id)),
        tasks: db.tasks.filter((t) => !t.projectId || !projectIds.includes(t.projectId)),
        expenses: db.expenses.filter((e) => !projectIds.includes(e.projectId)),
      }),
      async (c) => {
        if (projectIds.length) {
          await run(c.from("projects").delete().in("id", projectIds));
        }
        await run(c.from("obcs").delete().eq("id", id));
      },
    );
  },

  /** Locks the quoted services in; the database stamps the time. */
  submitObc(id: string) {
    void commit(
      ["crm"],
      (db) => ({
        ...db,
        obcs: db.obcs.map((x) =>
          x.id === id ? { ...x, status: "Submitted" as const, submittedAt: now() } : x,
        ),
      }),
      (c) => run(c.from("obcs").update({ status: "Submitted" }).eq("id", id)),
    );
  },

  /**
   * Raises a project for some of an OBC's quoted services.
   *
   * Work is allotted line by line: the services that are ready become a
   * project now, the rest wait. `projects.obc_id` carries every project raised
   * from the quote, each line records which of them it went to, and
   * `obcs.project_id` keeps naming the first — it is the handle the sales team
   * already has.
   *
   * The OBC only reads as Converted ("Allotted" on screen) once no line is
   * still waiting. Losing an allotment later is handled in the database, since
   * whoever deletes a project need not be a manager.
   */
  convertObc(
    id: string,
    project: NewProjectInput,
    serviceIds: string[],
    tasks: NewProjectTaskInput[] = [],
  ): Project {
    const created: Project = {
      ...withoutCrmChain({ ...project, obcId: id }),
      id: newId(),
      createdBy: me(),
      createdAt: now(),
    };
    const rows = projectTaskRows(created, tasks);
    const obc = state.db.obcs.find((x) => x.id === id);
    const taking = new Set(serviceIds);
    const services = (obc?.services ?? []).map((x) =>
      taking.has(x.id) ? { ...x, projectId: created.id, taskId: null } : x,
    );
    const first = !obc?.projectId;
    const done = services.length > 0 && services.every(isAllotted);

    void commit(
      ["crm", "projects", "tasks"],
      (db) => ({
        ...db,
        projects: [created, ...db.projects],
        tasks: [...db.tasks, ...rows],
        obcs: db.obcs.map((x) =>
          x.id === id
            ? {
                ...x,
                services,
                ...(first ? { projectId: created.id } : {}),
                ...(done
                  ? { status: "Converted" as const, convertedAt: x.convertedAt ?? now() }
                  : {}),
              }
            : x,
        ),
      }),
      async (c) => {
        // The project has to exist before anything can point at it.
        await insertProject(c, created);
        if (rows.length) {
          await run(c.from("tasks").insert(rows.map((t) => ({ ...taskRow(t), created_by: me() }))));
        }
        if (taking.size) {
          await run(
            c
              .from("obc_services")
              .update({ project_id: created.id, task_id: null })
              .in("id", [...taking]),
          );
        }
        const columns: Record<string, unknown> = {};
        if (first) columns.project_id = created.id;
        if (done) columns.status = "Converted";
        if (Object.keys(columns).length) {
          await run(c.from("obcs").update(columns).eq("id", id));
        }
      },
    );
    return created;
  },

  /**
   * Sends delivery services to work that already exists — in practice the
   * individual task just raised for them. Same bookkeeping as a conversion,
   * without a project: the services point at the task, and the OBC closes once
   * none is left waiting.
   */
  allotObcServices(id: string, serviceIds: string[], to: ObcAllotment) {
    const obc = state.db.obcs.find((x) => x.id === id);
    if (!obc || serviceIds.length === 0) return;
    const taking = new Set(serviceIds);
    const link =
      to.kind === "project"
        ? { projectId: to.projectId, taskId: null }
        : { projectId: null, taskId: to.taskId };
    const services = obc.services.map((x) => (taking.has(x.id) ? { ...x, ...link } : x));
    const done = services.length > 0 && services.every(isAllotted);

    void commit(
      ["crm"],
      (db) => ({
        ...db,
        obcs: db.obcs.map((x) =>
          x.id === id
            ? {
                ...x,
                services,
                ...(done
                  ? { status: "Converted" as const, convertedAt: x.convertedAt ?? now() }
                  : {}),
              }
            : x,
        ),
      }),
      async (c) => {
        await run(
          c
            .from("obc_services")
            .update({
              project_id: link.projectId,
              task_id: link.taskId,
            })
            .in("id", [...taking]),
        );
        if (done) {
          await run(c.from("obcs").update({ status: "Converted" }).eq("id", id));
        }
      },
    );
  },

  /* ---------------------------------------------------- content bank */

  createContentEntry(input: ContentInput): ContentEntry {
    const entry: ContentEntry = {
      ...input,
      id: newId(),
      // Nothing is written yet as far as the reviewer is concerned.
      status: "Not Started",
      submittedAt: null,
      reviews: [],
      stage: null,
      createdBy: me(),
      createdAt: now(),
    };
    void commit(
      ["content", "notifications"],
      (db) => ({ ...db, contentEntries: [entry, ...db.contentEntries] }),
      (c) =>
        run(c.from("content_bank").insert({ id: entry.id, ...patchColumns(input, CONTENT_COLUMNS) })),
    );
    return entry;
  },

  updateContentEntry(id: string, patch: Partial<ContentInput>) {
    void commit(
      ["content", "notifications"],
      (db) => ({
        ...db,
        contentEntries: db.contentEntries.map((x) => (x.id === id ? { ...x, ...patch } : x)),
      }),
      (c) => run(c.from("content_bank").update(patchColumns(patch, CONTENT_COLUMNS)).eq("id", id)),
    );
  },

  deleteContentEntry(id: string) {
    void commit(
      ["content"],
      (db) => ({ ...db, contentEntries: db.contentEntries.filter((x) => x.id !== id) }),
      (c) => run(c.from("content_bank").delete().eq("id", id)),
    );
  },

  /* ------------------------------------------------ comments & minutes */

  /**
   * Submitting and reviewing a piece both go through SECURITY DEFINER
   * functions, for the same reason the task workflow does: the rule about who
   * may do it is re-checked in the database rather than trusted from here.
   * `review_content` also settles the parent content task - all pieces
   * approved and the task approves itself - so the two can never disagree.
   */
  submitContent(entryId: string) {
    void commit(
      ["content", "tasks", "notifications"],
      (db) => ({
        ...db,
        contentEntries: db.contentEntries.map((e) =>
          e.id === entryId
            ? { ...e, status: "Submitted" as const, submittedAt: now() }
            : e,
        ),
      }),
      (c) => run(c.rpc("submit_content", { p_content_id: entryId })),
    );
  },

  reviewContent(entryId: string, decision: ContentDecision, remarks: string) {
    const review: ContentReview = {
      id: newId(),
      contentId: entryId,
      byUserId: me(),
      at: now(),
      decision,
      remarks,
    };
    void commit(
      ["content", "tasks", "notifications"],
      (db) => ({
        ...db,
        contentEntries: db.contentEntries.map((e) =>
          e.id === entryId
            ? { ...e, status: decision, reviews: [...e.reviews, review] }
            : e,
        ),
      }),
      (c) =>
        run(
          c.rpc("review_content", {
            p_content_id: entryId,
            p_decision: decision,
            p_remarks: remarks,
          }),
        ),
    );
  },

  /*
   * Allotting and staging are narrower than editing, and held by more people
   * than the writer, so they go through their own functions rather than the
   * writer-only update policy (0022).
   */
  allotContent(entryId: string, userId: string | null) {
    void commit(
      ["content", "notifications"],
      (db) => ({
        ...db,
        contentEntries: db.contentEntries.map((e) =>
          e.id === entryId ? { ...e, allottedTo: userId } : e,
        ),
      }),
      (c) => run(c.rpc("allot_content", { p_content_id: entryId, p_profile_id: userId })),
    );
  },

  setContentStage(entryId: string, stage: ContentStage | null) {
    void commit(
      ["content"],
      (db) => ({
        ...db,
        contentEntries: db.contentEntries.map((e) => (e.id === entryId ? { ...e, stage } : e)),
      }),
      (c) => run(c.rpc("set_content_stage", { p_content_id: entryId, p_stage: stage })),
    );
  },

  addComment(entityType: CollabEntity, entityId: string, body: string) {
    const trimmed = body.trim();
    if (!trimmed) return;
    const comment: Comment = {
      id: newId(),
      entityType,
      entityId,
      body: trimmed,
      createdBy: me(),
      createdAt: now(),
    };
    void commit(
      ["collab"],
      (db) => ({ ...db, comments: [...db.comments, comment] }),
      (c) =>
        run(
          c.from("comments").insert({
            id: comment.id,
            entity_type: entityType,
            entity_id: entityId,
            body: trimmed,
          }),
        ),
    );
  },

  deleteComment(id: string) {
    void commit(
      ["collab"],
      (db) => ({ ...db, comments: db.comments.filter((x) => x.id !== id) }),
      (c) => run(c.from("comments").delete().eq("id", id)),
    );
  },

  /** Creates a new set of minutes, or rewrites the one whose id is given. */
  saveMinutes(input: MinutesInput, id?: string) {
    const row = {
      entity_type: input.entityType,
      entity_id: input.entityId,
      title: input.title.trim(),
      meeting_date: input.meetingDate,
      attendees: input.attendees,
      body: input.body,
    };
    if (id) {
      void commit(
        ["collab"],
        (db) => ({
          ...db,
          minutes: db.minutes.map((x) => (x.id === id ? { ...x, ...input } : x)),
        }),
        (c) => run(c.from("minutes").update(row).eq("id", id)),
      );
      return;
    }
    const entry: MeetingMinutes = { ...input, id: newId(), createdBy: me(), createdAt: now() };
    void commit(
      ["collab"],
      (db) => ({ ...db, minutes: [entry, ...db.minutes] }),
      (c) => run(c.from("minutes").insert({ id: entry.id, ...row })),
    );
  },

  deleteMinutes(id: string) {
    void commit(
      ["collab"],
      (db) => ({ ...db, minutes: db.minutes.filter((x) => x.id !== id) }),
      (c) => run(c.from("minutes").delete().eq("id", id)),
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

  const userById = useCallback(
    (id: string | null | undefined) => (id ? db.users.find((u) => u.id === id) : undefined),
    [db.users],
  );
  const projectById = useCallback((id: string) => db.projects.find((p) => p.id === id), [db.projects]);
  const taskById = useCallback((id: string) => db.tasks.find((t) => t.id === id), [db.tasks]);
  const vendorById = useCallback((id: string) => db.vendors.find((v) => v.id === id), [db.vendors]);
  const companyById = useCallback(
    (id: string | null | undefined) => (id ? db.companies.find((x) => x.id === id) : undefined),
    [db.companies],
  );
  const clientById = useCallback(
    (id: string | null | undefined) => (id ? db.clients.find((x) => x.id === id) : undefined),
    [db.clients],
  );
  const propertyById = useCallback(
    (id: string | null | undefined) => (id ? db.properties.find((x) => x.id === id) : undefined),
    [db.properties],
  );
  const obcById = useCallback(
    (id: string | null | undefined) => (id ? db.obcs.find((x) => x.id === id) : undefined),
    [db.obcs],
  );

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
      companyById,
      clientById,
      propertyById,
      obcById,
      ...actions,
      ...linkActions,
      ...masterActions,
      ...crmActions,
    }),
    [
      db,
      auth,
      currentUser,
      toasts,
      userById,
      projectById,
      taskById,
      vendorById,
      companyById,
      clientById,
      propertyById,
      obcById,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}
