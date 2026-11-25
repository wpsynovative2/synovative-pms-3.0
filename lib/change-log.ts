import { formatDate, formatMonth } from "./calendar";
import type { Database } from "./types";

/*
 * Recent changes on a project, a task or a piece of content (0047). The
 * database records each action as the columns it changed, old and new; this
 * turns a column into a label and a stored value into something a person reads.
 */

export type ChangeEntityType = "project" | "task" | "content";

export interface ChangeEntry {
  id: string;
  action: "created" | "updated";
  /** Column → [before, after]. Long text is [null, null]: edited, not shown. */
  changes: Record<string, [unknown, unknown]>;
  /** Null for a scheduled job or a change made outside the app. */
  changedBy: string | null;
  changedAt: string;
}

/** How many entries each record keeps (change_log_keep(), 0047). */
export const CHANGE_LOG_KEEP = 5;

type Kind =
  | "text"
  | "body"
  | "date"
  | "month"
  | "stamp"
  | "user"
  | "project"
  | "task"
  | "company"
  | "client"
  | "clients"
  | "property"
  | "obc"
  | "group"
  | "short"
  | "files"
  | "fileGroups"
  | "list"
  | "bool"
  | "hours"
  | "days"
  | "rule";

type FieldMap = Record<string, [label: string, kind: Kind]>;

const SHARED: FieldMap = {
  project_id: ["Project", "project"],
  title: ["Title", "text"],
  name: ["Name", "text"],
  description: ["Description", "body"],
  status: ["Status", "text"],
  priority: ["Priority", "text"],
  start_date: ["Start date", "date"],
  company_id: ["Company", "company"],
  client_id: ["Client", "client"],
  client_ids: ["Clients", "clients"],
  property_id: ["Property", "property"],
  recurrence: ["Repeat rule", "rule"],
  recurrence_paused: ["Repeat paused", "bool"],
};

const FIELDS: Record<ChangeEntityType, FieldMap> = {
  project: {
    ...SHARED,
    color: ["Colour", "text"],
    client_name: ["Client name", "text"],
    deadline: ["Deadline", "date"],
    leader_id: ["Project leader", "user"],
    obc_id: ["OBC", "obc"],
    title_month: ["Repeats named for", "text"],
    step_by_step: ["Step by step", "bool"],
    is_3d: ["3D project", "bool"],
  },
  task: {
    ...SHARED,
    department: ["Department", "text"],
    assignee_id: ["Assigned to", "user"],
    due_date: ["Due date", "date"],
    estimated_hours: ["Estimate", "hours"],
    tags: ["Tags", "list"],
    kind: ["Task type", "text"],
    content_count: ["Pieces", "text"],
    content_types: ["CB types", "list"],
    content_placements: ["Placements", "list"],
    duration_days: ["Days to complete", "days"],
    file_item_ids: ["Waits on files", "files"],
    // Before 0018 a task waited on whole groups; older entries still say so.
    file_group_ids: ["Waits on files", "fileGroups"],
    group_id: ["Sub-group", "group"],
    short_id: ["Short", "short"],
    frames: ["Frames", "text"],
    three_d_categories: ["Task categories", "list"],
    three_d_software: ["Software", "list"],
    render_group_ids: ["Render sub-groups", "list"],
    render_task_ids: ["Render tasks", "list"],
    thumbnail_name: ["Thumbnail", "text"],
    client_supe_notes: ["Client / supervisor notes", "body"],
    shots_brief: ["Shots brief", "body"],
    camera_angles: ["Camera angles", "body"],
    lead_note: ["Lead note", "body"],
    general_notes: ["General notes", "body"],
  },
  content: {
    ...SHARED,
    task_id: ["Content task", "task"],
    entry_date: ["Date", "date"],
    type: ["CB type", "text"],
    on_pic: ["On pic", "body"],
    caption: ["Caption", "body"],
    reference_links: ["Reference links", "body"],
    billing_type: ["Billing", "text"],
    allotted_to: ["Allotted to", "user"],
    allotted_task_id: ["Design task", "task"],
    motion_allotted_to: ["Reel allotted to", "user"],
    motion_allotted_task_id: ["Reel task", "task"],
    stage: ["Status", "text"],
    for_month: ["Content for", "month"],
    carry_month: ["Carried forward to", "month"],
    started_at: ["Writing", "stamp"],
    placement: ["Placement", "text"],
    delivery_date: ["Delivery date", "date"],
  },
};

/** "due_date" → "Due date", for a column this file does not know yet. */
const humanize = (key: string) =>
  key.replace(/_id$/, "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** The label and kind of one changed column. */
export function changeField(type: ChangeEntityType, key: string): { label: string; body: boolean } {
  const field = FIELDS[type][key];
  return { label: field?.[0] ?? humanize(key), body: field?.[1] === "body" };
}

const NONE = "—";

/** One stored value, as a person reads it. */
export function changeValue(
  type: ChangeEntityType,
  key: string,
  value: unknown,
  db: Database,
): string {
  const kind = FIELDS[type][key]?.[1] ?? "text";
  if (value === null || value === undefined || value === "") return NONE;
  const id = String(value);
  switch (kind) {
    case "date":
      return formatDate(id);
    case "month":
      return formatMonth(id);
    case "stamp":
      return "Started";
    case "bool":
      return value ? "Yes" : "No";
    case "hours":
      return `${Number(value)} h`;
    case "days":
      return `${Number(value)} working day${Number(value) === 1 ? "" : "s"}`;
    case "rule":
      return "Set";
    case "user":
      return db.users.find((u) => u.id === id)?.fullName ?? "Someone no longer here";
    case "project":
      return db.projects.find((p) => p.id === id)?.name ?? "Another project";
    case "task":
      return db.tasks.find((t) => t.id === id)?.title ?? "Another task";
    case "company":
      return db.companies.find((c) => c.id === id)?.name ?? "A company";
    case "client":
      return db.clients.find((c) => c.id === id)?.fullName ?? "A client";
    case "property":
      return db.properties.find((p) => p.id === id)?.name ?? "A property";
    case "obc":
      return db.obcs.find((o) => o.id === id)?.code ?? "An OBC";
    case "group":
      return db.taskGroups.find((g) => g.id === id)?.name ?? "A sub-group";
    case "short":
      return db.shorts.find((s) => s.id === id)?.title ?? "A short";
    case "files":
    case "fileGroups": {
      const ids = Array.isArray(value) ? value : [value];
      if (ids.length === 0) return NONE;
      return ids
        .map((x) =>
          kind === "files"
            ? (db.fileItems.find((f) => f.id === x)?.name ?? "A file")
            : (db.fileGroups.find((g) => g.id === x)?.name ?? "A file group"),
        )
        .join(", ");
    }
    case "clients":
    case "list": {
      const items = Array.isArray(value) ? value : [value];
      if (items.length === 0) return NONE;
      if (kind === "clients")
        return items
          .map((x) => db.clients.find((c) => c.id === x)?.fullName ?? "A client")
          .join(", ");
      // Render picks are ids; their count says enough.
      if (key.startsWith("render_")) return `${items.length} picked`;
      return items.map((x) => (x === null ? "Not set" : String(x))).join(", ");
    }
    default:
      return typeof value === "object" ? JSON.stringify(value) : String(value);
  }
}

export const CHANGE_NOUN: Record<ChangeEntityType, string> = {
  project: "project",
  task: "task",
  content: "piece",
};
