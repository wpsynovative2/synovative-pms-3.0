import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AppNotification,
  Client,
  CollabEntity,
  Comment,
  Company,
  ContentEntry,
  Database,
  DriveFolder,
  Expense,
  Holiday,
  LinkGroup,
  MeetingMinutes,
  Obc,
  ObcItem,
  ObcService,
  OperationalLink,
  Project,
  ProjectTemplate,
  Property,
  PropertyConfig,
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
  Website,
  WebsiteCredential,
  WebsiteRenewal,
  Workstation,
  InventoryItem,
  InventoryEvent,
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
  | "master"
  | "users"
  | "projects"
  | "tasks"
  | "expenses"
  | "vendors"
  | "templates"
  | "calendar"
  | "notifications"
  | "links"
  | "crm"
  | "content"
  | "collab"
  | "websites"
  | "inventory";

export const ALL_SCOPES: Scope[] = [
  "master",
  "users",
  "projects",
  "tasks",
  "expenses",
  "vendors",
  "templates",
  "calendar",
  "notifications",
  "links",
  "crm",
  "content",
  "collab",
  "websites",
  "inventory",
];

export const EMPTY_DB: Database = {
  departments: [],
  services: [],
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
  companies: [],
  clients: [],
  properties: [],
  obcs: [],
  contentEntries: [],
  comments: [],
  minutes: [],
  websites: [],
  websiteCredentials: [],
  websiteRenewals: [],
  workstations: [],
  inventoryItems: [],
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
  return fetchColumns(sb, table, "*", ...orders);
}

/** Every readable column of companies / clients - all but the phone numbers (0009). */
const COMPANY_READ_COLUMNS =
  "id, name, legal_name, gstin, pan, rera_promoter_id, address, city, website, email, logo_url, account_owner_id, status, created_by, created_at, updated_at, nature";
const CLIENT_READ_COLUMNS =
  "id, company_id, full_name, designation, email, role, status, created_by, created_at, updated_at";

/** fetchAll for a table whose rows cannot be read whole (a password, a phone number). */
async function fetchColumns(
  sb: SupabaseClient,
  table: string,
  columns: string,
  ...orders: string[]
): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = sb.from(table).select(columns);
    for (const column of orders) query = query.order(column, { ascending: true });
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as unknown as Row[]));
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

/**
 * The two name lists every picker in the app is built from. Loaded with the
 * core scopes so no screen ever renders an empty department dropdown.
 */
async function loadMaster(sb: SupabaseClient): Promise<Partial<Database>> {
  const [departments, services] = await Promise.all([
    fetchAll(sb, "departments", "name"),
    fetchAll(sb, "services", "name"),
  ]);
  return {
    departments: departments.map((r) => str(r.name)),
    services: services.map((r) => str(r.name)),
  };
}

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
      titleMonth: (r.title_month === "upcoming" ? "upcoming" : "current") as Project["titleMonth"],
      stepByStep: r.step_by_step === true,
      companyId: nullable(r.company_id),
      clientId: nullable(r.client_id),
      clientIds: Array.isArray(r.client_ids)
        ? (r.client_ids as string[])
        : r.client_id
          ? [str(r.client_id)]
          : [],
      propertyId: nullable(r.property_id),
      obcId: nullable(r.obc_id),
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
    links: (r.links as string[] | null) ?? [],
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
      kind: (r.kind as Task["kind"]) ?? "standard",
      contentCount: num(r.content_count),
      contentTypes: (r.content_types as Task["contentTypes"] | null) ?? [],
      dependsOnTaskId: nullable(r.depends_on_task_id),
      durationDays: r.duration_days === null || r.duration_days === undefined ? null : num(r.duration_days),
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
    kind: (r.kind as TaskTemplateItem["kind"]) ?? "standard",
    contentCount: num(r.content_count),
    contentTypes: (r.content_types as TaskTemplateItem["contentTypes"] | null) ?? [],
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

/* -------------------------------------------------------------- CRM */

async function loadCrm(sb: SupabaseClient): Promise<Partial<Database>> {
  const [
    companyRows,
    clientRows,
    propertyRows,
    configRows,
    folderRows,
    contactRows,
    obcRows,
    itemRows,
    serviceRows,
  ] = await Promise.all([
    // Phone numbers are not selectable (0009); they come from crm_phone_numbers().
    fetchColumns(sb, "companies", COMPANY_READ_COLUMNS, "name", "id"),
    fetchColumns(sb, "clients", CLIENT_READ_COLUMNS, "full_name", "id"),
    fetchAll(sb, "properties", "name", "id"),
    fetchAll(sb, "property_configs", "property_id", "position", "id"),
    fetchAll(sb, "property_drive_folders", "property_id", "name"),
    // Until 0023 has run there is no list; each property falls back to the one
    // contact on its row rather than taking the whole CRM scope down with it.
    fetchAll(sb, "property_clients", "property_id", "position", "client_id").catch(
      () => null,
    ),
    fetchAll(sb, "obcs", "created_at", "id"),
    fetchAll(sb, "obc_items", "obc_id", "position", "id"),
    fetchAll(sb, "obc_services", "obc_id", "position", "id"),
  ]);

  // Only Super Admin, Admin and Managers get rows back; everyone else sees none.
  const phones = new Map<string, { phone: string; whatsapp: string }>();
  {
    const { data } = await sb.rpc("crm_phone_numbers");
    for (const r of (data ?? []) as { kind: string; id: string; phone: string; whatsapp: string }[]) {
      phones.set(`${r.kind}:${r.id}`, { phone: r.phone ?? "", whatsapp: r.whatsapp ?? "" });
    }
  }

  const companies: Company[] = companyRows.map((r) => ({
    id: str(r.id),
    name: str(r.name),
    nature: str(r.nature),
    legalName: str(r.legal_name),
    gstin: str(r.gstin),
    pan: str(r.pan),
    reraPromoterId: str(r.rera_promoter_id),
    address: str(r.address),
    city: str(r.city),
    website: str(r.website),
    phone: phones.get(`company:${str(r.id)}`)?.phone ?? "",
    email: str(r.email),
    logoUrl: str(r.logo_url),
    accountOwnerId: nullable(r.account_owner_id),
    status: r.status as Company["status"],
    createdBy: str(r.created_by),
    createdAt: str(r.created_at),
  }));

  const clients: Client[] = clientRows.map((r) => ({
    id: str(r.id),
    companyId: str(r.company_id),
    fullName: str(r.full_name),
    designation: str(r.designation),
    mobile: phones.get(`client:${str(r.id)}`)?.phone ?? "",
    whatsapp: phones.get(`client:${str(r.id)}`)?.whatsapp ?? "",
    email: str(r.email),
    role: (r.role as Client["role"]) ?? null,
    status: r.status as Client["status"],
    createdBy: str(r.created_by),
    createdAt: str(r.created_at),
  }));

  const configs = groupBy<PropertyConfig>(configRows, "property_id", (r) => ({
    id: str(r.id),
    config: str(r.config),
    sqFt: num(r.sq_ft),
    price: num(r.price),
    status: r.status as PropertyConfig["status"],
  }));
  const folders = groupBy<DriveFolder>(folderRows, "property_id", (r) => ({
    id: str(r.id),
    name: str(r.name),
    folderId: str(r.folder_id),
    url: str(r.url),
  }));

  const contacts = contactRows
    ? groupBy<string>(contactRows, "property_id", (r) => str(r.client_id))
    : null;

  const properties: Property[] = propertyRows.map((r) => {
    const id = str(r.id);
    const clientId = nullable(r.client_id);
    return {
      id,
      companyId: str(r.company_id),
      clientId,
      clientIds: contacts ? (contacts.get(id) ?? []) : clientId ? [clientId] : [],
      name: str(r.name),
      description: str(r.description),
      address: str(r.address),
      mapsUrl: str(r.maps_url),
      maharera: str(r.maharera_number),
      driveFolderId: str(r.drive_folder_id),
      driveFolderUrl: str(r.drive_folder_url),
      configs: configs.get(id) ?? [],
      folders: folders.get(id) ?? [],
      createdBy: str(r.created_by),
      createdAt: str(r.created_at),
    };
  });

  // The estimate, as it came from Zoho — reference, never allotted.
  const items = groupBy<ObcItem>(itemRows, "obc_id", (r) => ({
    id: str(r.id),
    service: str(r.service),
    quantity: num(r.quantity),
    description: str(r.description),
    briefDescription: str(r.brief_description),
  }));

  // What we will deliver, and where each piece of it was sent.
  const services = groupBy<ObcService>(serviceRows, "obc_id", (r) => ({
    id: str(r.id),
    service: str(r.service),
    quantity: num(r.quantity),
    description: str(r.description),
    projectId: nullable(r.project_id),
    taskId: nullable(r.task_id),
  }));

  const obcs: Obc[] = obcRows
    .map((r) => ({
      id: str(r.id),
      code: str(r.code),
      companyId: str(r.company_id),
      clientId: nullable(r.client_id),
      propertyId: nullable(r.property_id),
      zohoQuoteId: str(r.zoho_quote_id),
      zohoQuoteNumber: str(r.zoho_quote_number),
      zohoQuoteName: str(r.zoho_quote_name),
      notes: str(r.notes),
      status: r.status as Obc["status"],
      submittedAt: opt(r.submitted_at),
      convertedAt: opt(r.converted_at),
      projectId: nullable(r.project_id),
      items: items.get(str(r.id)) ?? [],
      services: services.get(str(r.id)) ?? [],
      createdBy: str(r.created_by),
      createdAt: str(r.created_at),
    }))
    // Newest first, as the lists expect.
    .reverse();

  return { companies, clients, properties, obcs };
}

async function loadContent(sb: SupabaseClient): Promise<Partial<Database>> {
  const rows = await fetchAll(sb, "content_bank", "created_at", "id");
  const contentEntries: ContentEntry[] = rows
    .map((r) => ({
      id: str(r.id),
      projectId: str(r.project_id),
      taskId: nullable(r.task_id),
      title: str(r.title),
      slot: r.slot === null || r.slot === undefined ? null : num(r.slot),
      date: dateOnly(r.entry_date),
      type: r.type as ContentEntry["type"],
      onPic: str(r.on_pic),
      caption: str(r.caption),
      description: str(r.description),
      referenceLinks: (r.reference_links as string[]) ?? [],
      billingType: r.billing_type as ContentEntry["billingType"],
      placement: nullable(r.placement) as ContentEntry["placement"],
      stage: nullable(r.stage) as ContentEntry["stage"],
      scheduledOn: nullable(r.scheduled_on) ? dateOnly(r.scheduled_on) : null,
      carryMonth: nullable(r.carry_month) ? dateOnly(r.carry_month) : null,
      forMonth: r.for_month ? dateOnly(r.for_month) : `${dateOnly(r.entry_date).slice(0, 7)}-01`,
      allottedTo: nullable(r.allotted_to),
      allottedTaskId: nullable(r.allotted_task_id),
      motionAllottedTo: nullable(r.motion_allotted_to),
      motionAllottedTaskId: nullable(r.motion_allotted_task_id),
      deliveryDate: nullable(r.delivery_date) ? dateOnly(r.delivery_date) : null,
      startedAt: nullable(r.started_at),
      startedBy: nullable(r.started_by),
      readyAt: nullable(r.ready_at),
      allottedAt: nullable(r.allotted_at),
      completedAt: nullable(r.completed_at),
      createdBy: str(r.created_by),
      createdAt: str(r.created_at),
    }))
    .reverse();
  return { contentEntries };
}

async function loadCollab(sb: SupabaseClient): Promise<Partial<Database>> {
  const [commentRows, minuteRows] = await Promise.all([
    fetchAll(sb, "comments", "created_at", "id"),
    fetchAll(sb, "minutes", "meeting_date", "id"),
  ]);
  const comments: Comment[] = commentRows.map((r) => ({
    id: str(r.id),
    entityType: r.entity_type as CollabEntity,
    entityId: str(r.entity_id),
    body: str(r.body),
    createdBy: str(r.created_by),
    createdAt: str(r.created_at),
  }));
  const minutes: MeetingMinutes[] = minuteRows
    .map((r) => ({
      id: str(r.id),
      entityType: r.entity_type as CollabEntity,
      entityId: str(r.entity_id),
      title: str(r.title),
      meetingDate: dateOnly(r.meeting_date),
      attendees: str(r.attendees),
      body: str(r.body),
      createdBy: str(r.created_by),
      createdAt: str(r.created_at),
    }))
    // Most recent meeting first.
    .reverse();
  return { comments, minutes };
}

/*
 * Websites (0020). Each table is read only as far as RLS allows: people who
 * may not see logins get none back, and nobody gets the password column - it
 * is not granted, so it is never asked for.
 */
async function loadWebsites(sb: SupabaseClient): Promise<Partial<Database>> {
  const [sites, creds, renewals] = await Promise.all([
    fetchAll(sb, "websites", "name", "id"),
    fetchColumns(
      sb,
      "website_credentials",
      "id, website_id, label, login_url, username, recovery, notes, position, created_at",
      "website_id",
      "position",
      "id",
    ),
    fetchAll(sb, "website_renewals", "renewed_on", "id"),
  ]);
  const websites: Website[] = sites.map((r) => ({
    id: str(r.id),
    name: str(r.name),
    url: str(r.url),
    companyId: nullable(r.company_id),
    clientId: nullable(r.client_id),
    projectId: nullable(r.project_id),
    builtWith: (r.built_with as Website["builtWith"]) ?? "WordPress",
    hostingPlan: str(r.hosting_plan),
    synovativeDomain: !!r.synovative_domain,
    synovativeHosting: !!r.synovative_hosting,
    status: (r.status as Website["status"]) ?? "Active",
    startDate: nullable(r.start_date) ? dateOnly(r.start_date) : null,
    renewalDue: nullable(r.renewal_due) ? dateOnly(r.renewal_due) : null,
    renewalFee: num(r.renewal_fee),
    clientEmail: str(r.client_email),
    notes: str(r.notes),
    createdBy: str(r.created_by),
    createdAt: str(r.created_at),
  }));
  const websiteCredentials: WebsiteCredential[] = creds.map((r) => ({
    id: str(r.id),
    websiteId: str(r.website_id),
    label: str(r.label),
    loginUrl: str(r.login_url),
    username: str(r.username),
    recovery: str(r.recovery),
    notes: str(r.notes),
    position: num(r.position),
    createdAt: str(r.created_at),
  }));
  const websiteRenewals: WebsiteRenewal[] = renewals
    .map((r) => ({
      id: str(r.id),
      websiteId: str(r.website_id),
      renewedOn: dateOnly(r.renewed_on),
      periodFrom: dateOnly(r.period_from),
      periodTo: dateOnly(r.period_to),
      amount: r.amount === null || r.amount === undefined ? null : num(r.amount),
      note: str(r.note),
      createdBy: str(r.created_by),
      createdAt: str(r.created_at),
    }))
    // Most recent first.
    .reverse();
  return { websites, websiteCredentials, websiteRenewals };
}

async function loadInventory(sb: SupabaseClient): Promise<Partial<Database>> {
  const [desks, items] = await Promise.all([
    fetchAll(sb, "workstations", "code", "id"),
    fetchAll(sb, "inventory_items", "asset_tag", "id"),
  ]);
  const workstations: Workstation[] = desks.map((r) => ({
    id: str(r.id),
    code: str(r.code),
    name: str(r.name),
    location: str(r.location),
    assignedTo: nullable(r.assigned_to),
    assignedAt: nullable(r.assigned_at),
    notes: str(r.notes),
    createdBy: str(r.created_by),
    createdAt: str(r.created_at),
  }));
  const inventoryItems: InventoryItem[] = items.map((r) => ({
    id: str(r.id),
    assetTag: str(r.asset_tag),
    category: r.category as InventoryItem["category"],
    brand: str(r.brand),
    model: str(r.model),
    serialNumber: str(r.serial_number),
    specs: (r.specs as InventoryItem["specs"]) ?? {},
    status: (r.status as InventoryItem["status"]) ?? "Spare",
    cabinetId: nullable(r.cabinet_id),
    workstationId: nullable(r.workstation_id),
    purchaseDate: nullable(r.purchase_date) ? dateOnly(r.purchase_date) : null,
    price: r.price === null || r.price === undefined ? null : num(r.price),
    vendorId: nullable(r.vendor_id),
    warrantyUntil: nullable(r.warranty_until) ? dateOnly(r.warranty_until) : null,
    notes: str(r.notes),
    createdBy: str(r.created_by),
    createdAt: str(r.created_at),
  }));
  return { workstations, inventoryItems };
}

/** One item's or one workstation's history, newest first - read when a drawer opens. */
export async function loadInventoryEvents(
  sb: SupabaseClient,
  target: { itemId: string } | { workstationId: string },
): Promise<InventoryEvent[]> {
  const query = sb.from("inventory_events").select("*").order("at", { ascending: false }).limit(200);
  const { data, error } = await ("itemId" in target
    ? query.eq("item_id", target.itemId)
    : query.eq("workstation_id", target.workstationId));
  if (error) throw new Error(`inventory_events: ${error.message}`);
  return ((data ?? []) as Row[]).map((r) => ({
    id: str(r.id),
    at: str(r.at),
    actor: nullable(r.actor),
    itemId: nullable(r.item_id),
    workstationId: nullable(r.workstation_id),
    kind: r.kind as InventoryEvent["kind"],
    subject: str(r.subject),
    fromLabel: nullable(r.from_label),
    toLabel: nullable(r.to_label),
    note: str(r.note),
  }));
}

const LOADERS: Record<Scope, (sb: SupabaseClient) => Promise<Partial<Database>>> = {
  master: loadMaster,
  users: loadUsers,
  projects: loadProjects,
  tasks: loadTasks,
  expenses: loadExpenses,
  vendors: loadVendors,
  templates: loadTemplates,
  calendar: loadCalendar,
  notifications: loadNotifications,
  links: loadLinks,
  crm: loadCrm,
  content: loadContent,
  collab: loadCollab,
  websites: loadWebsites,
  inventory: loadInventory,
};

export interface ScopeFailure {
  scope: Scope;
  message: string;
}

export interface ScopeLoad {
  /** Everything that did load, ready to merge in. */
  data: Partial<Database>;
  /** Scopes that did not. Their slice is simply absent rather than empty. */
  failures: ScopeFailure[];
}

/**
 * Fetch the given scopes in parallel, each standing or falling on its own.
 *
 * This used to be a plain `Promise.all`, which meant one unreadable table
 * discarded the whole batch: a migration not yet run against one content table
 * emptied Companies, Clients, Properties, OBCs, Expenses, Vendors and
 * Templates too, because a refresh asks for all of them at once. A reader
 * cannot tell that from real data loss.
 *
 * Failures are returned rather than thrown so the caller can show what broke
 * *and* keep everything that did not.
 */
export async function loadScopes(
  sb: SupabaseClient,
  scopes: Iterable<Scope>,
): Promise<ScopeLoad> {
  const wanted = Array.from(new Set(scopes));
  const settled = await Promise.allSettled(wanted.map((s) => LOADERS[s](sb)));

  const data: Partial<Database> = {};
  const failures: ScopeFailure[] = [];
  settled.forEach((result, at) => {
    if (result.status === "fulfilled") {
      Object.assign(data, result.value);
      return;
    }
    const reason = result.reason as { message?: string } | undefined;
    failures.push({ scope: wanted[at], message: reason?.message ?? String(result.reason) });
  });
  return { data, failures };
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
    title_month: p.titleMonth ?? "current",
    step_by_step: p.stepByStep ?? false,
    company_id: p.companyId,
    client_id: p.clientId,
    client_ids: p.clientIds,
    property_id: p.propertyId,
    obc_id: p.obcId,
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
    | "kind"
    | "contentCount"
    | "contentTypes"
    | "dependsOnTaskId"
    | "durationDays"
  >,
) {
  return {
    id: t.id,
    project_id: t.projectId,
    title: t.title,
    description: t.description,
    department: t.department,
    kind: t.kind,
    content_count: t.contentCount,
    content_types: t.contentTypes,
    depends_on_task_id: t.dependsOnTaskId ?? null,
    duration_days: t.dependsOnTaskId ? (t.durationDays ?? 0) : null,
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
  titleMonth: "title_month",
  stepByStep: "step_by_step",
  companyId: "company_id",
  clientId: "client_id",
  clientIds: "client_ids",
  propertyId: "property_id",
  obcId: "obc_id",
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
  contentCount: "content_count",
  contentTypes: "content_types",
  dependsOnTaskId: "depends_on_task_id",
  durationDays: "duration_days",
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

export const WORKSTATION_COLUMNS: Record<string, string> = {
  name: "name",
  location: "location",
  notes: "notes",
};

/** Placement and status move only through the inventory_* functions (0011). */
export const INVENTORY_ITEM_COLUMNS: Record<string, string> = {
  category: "category",
  brand: "brand",
  model: "model",
  serialNumber: "serial_number",
  specs: "specs",
  purchaseDate: "purchase_date",
  price: "price",
  vendorId: "vendor_id",
  warrantyUntil: "warranty_until",
  notes: "notes",
};

export const WEBSITE_COLUMNS: Record<string, string> = {
  name: "name",
  url: "url",
  companyId: "company_id",
  clientId: "client_id",
  projectId: "project_id",
  builtWith: "built_with",
  hostingPlan: "hosting_plan",
  synovativeDomain: "synovative_domain",
  synovativeHosting: "synovative_hosting",
  status: "status",
  startDate: "start_date",
  renewalDue: "renewal_due",
  renewalFee: "renewal_fee",
  clientEmail: "client_email",
  notes: "notes",
};

export const WEBSITE_CREDENTIAL_COLUMNS: Record<string, string> = {
  websiteId: "website_id",
  label: "label",
  loginUrl: "login_url",
  username: "username",
  recovery: "recovery",
  notes: "notes",
  position: "position",
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

export const COMPANY_COLUMNS: Record<string, string> = {
  name: "name",
  nature: "nature",
  legalName: "legal_name",
  gstin: "gstin",
  pan: "pan",
  reraPromoterId: "rera_promoter_id",
  address: "address",
  city: "city",
  website: "website",
  phone: "phone",
  email: "email",
  logoUrl: "logo_url",
  accountOwnerId: "account_owner_id",
  status: "status",
};

export const CLIENT_COLUMNS: Record<string, string> = {
  companyId: "company_id",
  fullName: "full_name",
  designation: "designation",
  mobile: "mobile",
  whatsapp: "whatsapp",
  email: "email",
  role: "role",
  status: "status",
};

export const PROPERTY_COLUMNS: Record<string, string> = {
  companyId: "company_id",
  clientId: "client_id",
  name: "name",
  description: "description",
  address: "address",
  mapsUrl: "maps_url",
  maharera: "maharera_number",
};

export const OBC_COLUMNS: Record<string, string> = {
  companyId: "company_id",
  clientId: "client_id",
  propertyId: "property_id",
  zohoQuoteId: "zoho_quote_id",
  zohoQuoteNumber: "zoho_quote_number",
  zohoQuoteName: "zoho_quote_name",
  notes: "notes",
  status: "status",
  projectId: "project_id",
};

export const CONTENT_COLUMNS: Record<string, string> = {
  projectId: "project_id",
  taskId: "task_id",
  date: "entry_date",
  type: "type",
  title: "title",
  forMonth: "for_month",
  onPic: "on_pic",
  caption: "caption",
  description: "description",
  referenceLinks: "reference_links",
  billingType: "billing_type",
  placement: "placement",
};

/** Line items are rewritten wholesale whenever their parent is saved. */
export const configRow = (propertyId: string, c: PropertyConfig, position: number) => ({
  id: c.id,
  property_id: propertyId,
  position,
  config: c.config,
  sq_ft: c.sqFt,
  price: c.price,
  status: c.status,
});

/**
 * Deliberately without `project_id` / `task_id`. Editing a quote must never
 * disturb where its lines were already allotted, and this row is written as an
 * upsert — columns it leaves out keep whatever the existing row holds, and
 * start null on a line that is genuinely new. Allotment is written only by
 * `allotObcItems`, which is the one path a manager is checked on.
 */
export const obcItemRow = (obcId: string, i: ObcItem, position: number) => ({
  id: i.id,
  obc_id: obcId,
  position,
  service: i.service,
  quantity: i.quantity,
  description: i.description,
  brief_description: i.briefDescription,
});

/**
 * Deliberately without `project_id` / `task_id`. Editing the delivery list must
 * never disturb where a service was already allotted, and this row is written
 * as an upsert — columns it leaves out keep whatever the existing row holds,
 * and start null on a service that is genuinely new. Allotment is written only
 * by `allotObcServices`, which is the one path a manager is checked on.
 */
export const obcServiceRow = (obcId: string, x: ObcService, position: number) => ({
  id: x.id,
  obc_id: obcId,
  position,
  service: x.service,
  quantity: x.quantity,
  description: x.description,
});

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
    kind: item.kind,
    content_count: item.kind === "content" ? item.contentCount : 0,
    content_types: item.kind === "content" ? item.contentTypes : [],
  };
}
