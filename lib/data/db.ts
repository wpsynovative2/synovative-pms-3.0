import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AppNotification,
  Database,
  Expense,
  Holiday,
  LinkGroup,
  OperationalLink,
  Project,
  ProjectTemplate,
  RecurrenceRule,
  RecurrenceSeries,
  Review,
  Remark,
  Role,
  SeriesLink,
  Submission,
  Task,
  TaskTemplate,
  TaskTemplateItem,
  TimeSession,
  User,
  Vendor,
} from "@/lib/types";

/**
 * The bridge between Supabase tables (snake_case, normalised) and the nested
 * shapes the screens use. Every read runs as the signed-in user, so each list
 * only ever contains rows Row Level Security allows.
 *
 * Data is loaded in scopes — groups of tables that change together — so a save
 * refetches only what it touched instead of the whole database.
 */

export type Scope =
  | "users"
  | "projects"
  | "tasks"
  | "expenses"
  | "vendors"
  | "templates"
  | "calendar"
  | "notifications"
  | "links";

export const ALL_SCOPES: Scope[] = [
  "users",
  "projects",
  "tasks",
  "expenses",
  "vendors",
  "templates",
  "calendar",
  "notifications",
  "links",
];

export const EMPTY_DB: Database = {
  users: [],
  projects: [],
  tasks: [],
  expenses: [],
  vendors: [],
  projectTemplates: [],
  taskTemplates: [],
  calendar: { holidays: [], workingOverrides: [] },
  notifications: [],
  linkGroups: [],
  operationalLinks: [],
};

/** How many of the newest notifications the bell and inbox keep in memory. */
const NOTIFICATION_LIMIT = 300;
/** PostgREST's default max rows per request. */
const PAGE = 1000;

type Row = Record<string, unknown>;

/**
 * Reads a whole table (as far as RLS allows), a page at a time. `orders` must
 * together be unique per row, or rows could repeat or go missing across pages.
 */
async function fetchAll(sb: SupabaseClient, table: string, ...orders: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = sb.from(table).select("*");
    for (const column of orders) query = query.order(column, { ascending: true });
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as Row[]));
    if (!data || data.length < PAGE) return out;
  }
}

function groupBy<T>(rows: Row[], key: string, map: (r: Row) => T): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = r[key] as string;
    const list = out.get(k);
    if (list) list.push(map(r));
    else out.set(k, [map(r)]);
  }
  return out;
}

const str = (v: unknown) => (v ?? "") as string;
const opt = (v: unknown) => (v === null || v === undefined ? undefined : (v as string));
/** For columns that are genuinely nullable: an unled project, an unassigned task. */
const nullable = (v: unknown) => (v === null || v === undefined ? null : (v as string));
const num = (v: unknown) => Number(v ?? 0);
const dateOnly = (v: unknown) => str(v).slice(0, 10);

/* ------------------------------------------------------------ recurrence */

function readSeries(r: Row): RecurrenceSeries | null {
  if (!r.recurrence) return null;
  return {
    rule: r.recurrence as RecurrenceRule,
    anchor: dateOnly(r.recurrence_anchor),
    cursor: dateOnly(r.recurrence_cursor),
    paused: Boolean(r.recurrence_paused),
  };
}

function readLink(r: Row): SeriesLink | null {
  if (!r.series_source_id) return null;
  return {
    sourceId: str(r.series_source_id),
    index: num(r.series_index),
    date: dateOnly(r.series_date),
  };
}

/**
 * Only the rule and the pause flag are written; the database sets anchor
 * (= start date) and owns the cursor (0004_recurrence.sql), so a client can
 * never rewind a series.
 */
export const seriesColumns = (series: RecurrenceSeries | null | undefined) => ({
  recurrence: series ? series.rule : null,
  recurrence_paused: series ? series.paused : false,
});

/* ----------------------------------------------------------------- scopes */

async function loadUsers(sb: SupabaseClient): Promise<Partial<Database>> {
  const [profiles, depts] = await Promise.all([
    fetchAll(sb, "profiles", "created_at", "id"),
    fetchAll(sb, "profile_departments", "profile_id", "department"),
  ]);
  const byProfile = groupBy(depts, "profile_id", (r) => str(r.department));
  const users: User[] = profiles.map((r) => ({
    id: str(r.id),
    fullName: str(r.full_name),
    email: str(r.email),
    role: r.role as Role,
    departments: byProfile.get(str(r.id)) ?? [],
    active: Boolean(r.active),
    mustChangePassword: Boolean(r.must_change_password),
    capacityHoursPerDay: num(r.capacity_hours_per_day),
    createdAt: str(r.created_at),
  }));
  return { users };
}

async function loadProjects(sb: SupabaseClient): Promise<Partial<Database>> {
  const [rows, services, members] = await Promise.all([
    fetchAll(sb, "projects", "created_at", "id"),
    fetchAll(sb, "project_services", "project_id", "service"),
    fetchAll(sb, "project_members", "project_id", "profile_id"),
  ]);
  const svc = groupBy(services, "project_id", (r) => str(r.service));
  const mem = groupBy(members, "project_id", (r) => str(r.profile_id));
  const projects: Project[] = rows
    .map((r) => ({
      id: str(r.id),
      name: str(r.name),
      color: str(r.color),
      clientName: str(r.client_name),
      services: svc.get(str(r.id)) ?? [],
      startDate: dateOnly(r.start_date),
      deadline: dateOnly(r.deadline),
      description: str(r.description),
      status: r.status as Project["status"],
      priority: r.priority as Project["priority"],
      leaderId: nullable(r.leader_id),
      memberIds: mem.get(str(r.id)) ?? [],
      createdBy: str(r.created_by),
      createdAt: str(r.created_at),
      recurrence: readSeries(r),
      series: readLink(r),
    }))
    // Newest first, as the lists expect.
    .reverse();
  return { projects };
}

async function loadTasks(sb: SupabaseClient): Promise<Partial<Database>> {
  const [rows, sessions, submissions, reviews, remarks] = await Promise.all([
    fetchAll(sb, "tasks", "created_at", "id"),
    fetchAll(sb, "time_sessions", "started_at", "id"),
    fetchAll(sb, "submissions", "submitted_at", "id"),
    fetchAll(sb, "reviews", "reviewed_at", "id"),
    fetchAll(sb, "remarks", "created_at", "id"),
  ]);

  const ses = groupBy<TimeSession>(sessions, "task_id", (r) => ({
    id: str(r.id),
    userId: str(r.profile_id),
    startedAt: str(r.started_at),
    endedAt: (r.ended_at as string | null) ?? null,
    endReason: (r.end_reason as TimeSession["endReason"]) ?? null,
    endNote: opt(r.end_note),
  }));
  const sub = groupBy<Submission>(submissions, "task_id", (r) => ({
    id: str(r.id),
    byUserId: str(r.by_profile_id),
    at: str(r.submitted_at),
    outputLocation: r.output_location as Submission["outputLocation"],
    driveLink: opt(r.drive_link),
    description: str(r.description),
  }));
  const rev = groupBy<Review>(reviews, "task_id", (r) => ({
    id: str(r.id),
    submissionId: str(r.submission_id),
    byUserId: str(r.by_profile_id),
    at: str(r.reviewed_at),
    decision: r.decision as Review["decision"],
    source: (r.source as Review["source"]) ?? undefined,
    remarks: str(r.remarks),
    newAssigneeId: opt(r.new_assignee_id),
    newDueDate: r.new_due_date ? dateOnly(r.new_due_date) : undefined,
  }));
  const rem = groupBy<Remark>(remarks, "task_id", (r) => ({
    id: str(r.id),
    byUserId: str(r.by_profile_id),
    at: str(r.created_at),
    text: str(r.body),
  }));

  // Creation order is display order (§9.2).
  const tasks: Task[] = rows.map((r) => {
    const id = str(r.id);
    return {
      id,
      projectId: (r.project_id as string | null) ?? null,
      title: str(r.title),
      description: str(r.description),
      department: str(r.department),
      assigneeId: nullable(r.assignee_id),
      status: r.status as Task["status"],
      priority: r.priority as Task["priority"],
      startDate: dateOnly(r.start_date),
      dueDate: dateOnly(r.due_date),
      estimatedHours: num(r.estimated_hours),
      tags: (r.tags as string[]) ?? [],
      createdBy: str(r.created_by),
      createdAt: str(r.created_at),
      sessions: ses.get(id) ?? [],
      submissions: sub.get(id) ?? [],
      reviews: rev.get(id) ?? [],
      remarks: rem.get(id) ?? [],
      recurrence: readSeries(r),
      series: readLink(r),
    };
  });
  return { tasks };
}

async function loadExpenses(sb: SupabaseClient): Promise<Partial<Database>> {
  const rows = await fetchAll(sb, "expenses", "created_at", "id");
  const expenses: Expense[] = rows
    .map((r) => ({
      id: str(r.id),
      projectId: str(r.project_id),
      vendorId: str(r.vendor_id),
      description: str(r.description),
      amount: num(r.amount),
      expenseDate: dateOnly(r.expense_date),
      attachmentName: opt(r.attachment_name),
      attachmentUrl: opt(r.attachment_url),
      status: r.status as Expense["status"],
      financeRemarks: opt(r.finance_remarks),
      reviewedBy: opt(r.reviewed_by),
      reviewedAt: opt(r.reviewed_at),
      createdBy: str(r.created_by),
      createdAt: str(r.created_at),
    }))
    .reverse();
  return { expenses };
}

async function loadVendors(sb: SupabaseClient): Promise<Partial<Database>> {
  const rows = await fetchAll(sb, "vendors", "name", "id");
  const vendors: Vendor[] = rows.map((r) => ({
    id: str(r.id),
    name: str(r.name),
    serviceType: str(r.service_type),
    contactPerson: str(r.contact_person),
    phone: str(r.phone),
    email: str(r.email),
    rate: num(r.rate),
    notes: opt(r.notes),
  }));
  return { vendors };
}

function templateItem(r: Row): TaskTemplateItem {
  return {
    id: str(r.id),
    title: str(r.title),
    description: str(r.description),
    department: str(r.department),
    priority: r.priority as TaskTemplateItem["priority"],
    estimatedHours: num(r.estimated_hours),
    tags: (r.tags as string[]) ?? [],
    startOffsetDays: num(r.start_offset_days),
    durationDays: num(r.duration_days),
  };
}

async function loadTemplates(sb: SupabaseClient): Promise<Partial<Database>> {
  const [projects, services, items, tasks] = await Promise.all([
    fetchAll(sb, "project_templates", "created_at", "id"),
    fetchAll(sb, "project_template_services", "template_id", "service"),
    fetchAll(sb, "project_template_tasks", "template_id", "position", "id"),
    fetchAll(sb, "task_templates", "created_at", "id"),
  ]);
  const svc = groupBy(services, "template_id", (r) => str(r.service));
  const its = groupBy(items, "template_id", templateItem);
  const projectTemplates: ProjectTemplate[] = projects.map((r) => ({
    id: str(r.id),
    name: str(r.name),
    description: str(r.description),
    color: str(r.color),
    services: svc.get(str(r.id)) ?? [],
    priority: r.priority as ProjectTemplate["priority"],
    durationDays: num(r.duration_days),
    tasks: its.get(str(r.id)) ?? [],
    createdAt: str(r.created_at),
  }));
  const taskTemplates: TaskTemplate[] = tasks.map((r) => ({
    ...templateItem(r),
    createdAt: str(r.created_at),
  }));
  return { projectTemplates, taskTemplates };
}

async function loadCalendar(sb: SupabaseClient): Promise<Partial<Database>> {
  const [holidays, overrides] = await Promise.all([
    fetchAll(sb, "holidays", "holiday_date"),
    fetchAll(sb, "working_overrides", "override_date"),
  ]);
  return {
    calendar: {
      holidays: holidays.map<Holiday>((r) => ({
        date: dateOnly(r.holiday_date),
        name: str(r.name),
      })),
      workingOverrides: overrides.map((r) => dateOnly(r.override_date)),
    },
  };
}

export function toNotification(r: Row): AppNotification {
  return {
    id: str(r.id),
    userId: str(r.profile_id),
    type: r.type as AppNotification["type"],
    title: str(r.title),
    body: str(r.body),
    href: str(r.href),
    read: Boolean(r.read),
    createdAt: str(r.created_at),
  };
}

async function loadNotifications(sb: SupabaseClient): Promise<Partial<Database>> {
  const { data, error } = await sb
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(NOTIFICATION_LIMIT);
  if (error) throw new Error(`notifications: ${error.message}`);
  return { notifications: (data as Row[]).map(toNotification) };
}

async function loadLinks(sb: SupabaseClient): Promise<Partial<Database>> {
  const [groups, links] = await Promise.all([
    fetchAll(sb, "link_groups", "name", "id"),
    fetchAll(sb, "operational_links", "name", "id"),
  ]);
  return {
    linkGroups: groups.map<LinkGroup>((r) => ({
      id: str(r.id),
      name: str(r.name),
      createdAt: str(r.created_at),
    })),
    operationalLinks: links.map<OperationalLink>((r) => ({
      id: str(r.id),
      groupId: str(r.group_id),
      name: str(r.name),
      url: str(r.url),
      createdBy: str(r.created_by),
      createdAt: str(r.created_at),
    })),
  };
}

const LOADERS: Record<Scope, (sb: SupabaseClient) => Promise<Partial<Database>>> = {
  users: loadUsers,
  projects: loadProjects,
  tasks: loadTasks,
  expenses: loadExpenses,
  vendors: loadVendors,
  templates: loadTemplates,
  calendar: loadCalendar,
  notifications: loadNotifications,
  links: loadLinks,
};

/** Fetch the given scopes in parallel and return the slices to merge in. */
export async function loadScopes(
  sb: SupabaseClient,
  scopes: Iterable<Scope>,
): Promise<Partial<Database>> {
  const parts = await Promise.all(Array.from(new Set(scopes), (s) => LOADERS[s](sb)));
  return Object.assign({}, ...parts);
}

/* ------------------------------------------------------------ row writers */

export function projectRow(p: Omit<Project, "services" | "memberIds" | "recurrence" | "series">) {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    client_name: p.clientName,
    start_date: p.startDate,
    deadline: p.deadline,
    description: p.description,
    status: p.status,
    priority: p.priority,
    leader_id: p.leaderId,
  };
}

export function taskRow(
  t: Pick<
    Task,
    | "id"
    | "projectId"
    | "title"
    | "description"
    | "department"
    | "assigneeId"
    | "status"
    | "priority"
    | "startDate"
    | "dueDate"
    | "estimatedHours"
    | "tags"
  >,
) {
  return {
    id: t.id,
    project_id: t.projectId,
    title: t.title,
    description: t.description,
    department: t.department,
    assignee_id: t.assigneeId,
    status: t.status,
    priority: t.priority,
    start_date: t.startDate,
    due_date: t.dueDate,
    estimated_hours: t.estimatedHours,
    tags: t.tags,
  };
}

/** Maps a partial app-side patch onto the columns it touches. */
export function patchColumns(patch: object, map: Record<string, string>) {
  const source = patch as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(map)) {
    if (key in source) out[column] = source[key] ?? null;
  }
  return out;
}

export const PROJECT_COLUMNS: Record<string, string> = {
  name: "name",
  color: "color",
  clientName: "client_name",
  startDate: "start_date",
  deadline: "deadline",
  description: "description",
  status: "status",
  priority: "priority",
  leaderId: "leader_id",
};

export const TASK_COLUMNS: Record<string, string> = {
  projectId: "project_id",
  title: "title",
  description: "description",
  department: "department",
  assigneeId: "assignee_id",
  status: "status",
  priority: "priority",
  startDate: "start_date",
  dueDate: "due_date",
  estimatedHours: "estimated_hours",
  tags: "tags",
};

export const EXPENSE_COLUMNS: Record<string, string> = {
  projectId: "project_id",
  vendorId: "vendor_id",
  description: "description",
  amount: "amount",
  expenseDate: "expense_date",
  attachmentName: "attachment_name",
  attachmentUrl: "attachment_url",
};

export const VENDOR_COLUMNS: Record<string, string> = {
  name: "name",
  serviceType: "service_type",
  contactPerson: "contact_person",
  phone: "phone",
  email: "email",
  rate: "rate",
  notes: "notes",
};

export function templateItemRow(item: TaskTemplateItem) {
  return {
    title: item.title,
    description: item.description,
    department: item.department,
    priority: item.priority,
    estimated_hours: item.estimatedHours,
    tags: item.tags,
    start_offset_days: item.startOffsetDays,
    duration_days: item.durationDays,
  };
}
