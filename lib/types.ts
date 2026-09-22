/** Domain model for the Agency PMS. Mirrors the PRD sections noted per type. */

/* ---------------------------------------------------------------- Roles */

/** PRD §4.1. Project Leader is *not* a stored role — it is per-project. */
export type Role =
  | "super_admin"
  | "admin"
  | "manager"
  | "hr_admin"
  | "team_leader"
  | "team_member";

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  hr_admin: "HR Admin",
  team_leader: "Team Leader",
  team_member: "Team Member",
};

/* ---------------------------------------------------------------- Users */

export interface User {
  id: string;
  fullName: string;
  /** Login ID; the password itself lives only in Supabase Auth (§6). */
  email: string;
  role: Role;
  /** Department names from §5.1. Multi-valued for Team Leaders. */
  departments: string[];
  active: boolean;
  mustChangePassword: boolean;
  /** Hours this person can take on per working day; drives Workload (§14). */
  capacityHoursPerDay: number;
  createdAt: string;
}

/* ----------------------------------------------------------- Recurrence */

export type RecurrenceFreq = "daily" | "weekly" | "monthly" | "yearly";

/** How a monthly rule picks its day — modelled on Google Calendar's options. */
export type MonthlyMode = "monthday" | "nthWeekday" | "lastWeekday";

export type RecurrenceEnd =
  | { type: "never" }
  | { type: "on"; date: string }
  | { type: "after"; count: number };

export interface RecurrenceRule {
  freq: RecurrenceFreq;
  /** Every N days / weeks / months / years. */
  interval: number;
  /** Weekly only: 0 = Sunday … 6 = Saturday. Absent → the anchor's weekday. */
  weekdays?: number[];
  /** Monthly only. Absent → "monthday". */
  monthlyMode?: MonthlyMode;
  ends: RecurrenceEnd;
}

/**
 * Stored on the *source* project or individual task. The source is occurrence
 * #1 and doubles as the template every later occurrence is copied from.
 */
export interface RecurrenceSeries {
  rule: RecurrenceRule;
  /** First occurrence (the source's start date) — the rule is evaluated from here. */
  anchor: string;
  /** Last date already materialised; occurrences after it are still to come. */
  cursor: string;
  /**
   * Paused series keep their rule and their history but produce nothing. The
   * dates that pass while paused are skipped, not banked (0012).
   */
  paused: boolean;
}

/** Stored on each generated occurrence, pointing back at its source. */
export interface SeriesLink {
  sourceId: string;
  /** 1-based position in the series (the source itself is #1). */
  index: number;
  /** The date the rule produced, before snapping to a working day. */
  date: string;
}

/* ------------------------------------------------------------- Projects */

export type ProjectStatus =
  | "Planning"
  | "Active"
  | "On Hold"
  | "Completed"
  | "Cancelled"
  | "Archived";

export type Priority = "Low" | "Medium" | "High" | "Critical";

export interface Project {
  id: string;
  name: string;
  color: string;
  clientName: string;
  services: string[];
  startDate: string;
  deadline: string;
  description: string;
  status: ProjectStatus;
  priority: Priority;
  /** null — nobody leads it yet (§7.1). */
  leaderId: string | null;
  memberIds: string[];
  createdBy: string;
  createdAt: string;
  /** Set on a repeating project's source. */
  recurrence?: RecurrenceSeries | null;
  /** Set on a project generated from a repeating source. */
  series?: SeriesLink | null;
  /**
   * The CRM chain this project came from. All null for work raised by hand;
   * filled in when a New OBC is converted (§CRM).
   */
  companyId: string | null;
  clientId: string | null;
  propertyId: string | null;
  obcId: string | null;
}

/* ---------------------------------------------------------------- Tasks */

export type TaskStatus =
  | "Not Started"
  | "In Progress"
  | "Submitted"
  /** Reviewed, passed to the client, and waiting on their answer. */
  | "Waiting for Client Response"
  | "Changes Required"
  | "Rejected"
  | "Approved";

export type SessionEndReason =
  | "End of day"
  | "Switched"
  | "Submitted"
  | "Auto-stopped";

export interface TimeSession {
  id: string;
  userId: string;
  startedAt: string;
  endedAt: string | null;
  /** Free text so "Switched to <project>" can carry the target name (§11.2). */
  endReason: SessionEndReason | null;
  endNote?: string;
}

export type OutputLocation = "Google Drive" | "WhatsApp";

export interface Submission {
  id: string;
  byUserId: string;
  at: string;
  outputLocation: OutputLocation;
  driveLink?: string;
  description: string;
}

export type ReviewDecision =
  | "Approved"
  | "Changes Required"
  | "Rejected"
  /** Parked with the client; the reviewer settles it once they answer. */
  | "Waiting for Client Response";
export type ReviewSource = "Client" | "Project Leader";

export interface Review {
  id: string;
  submissionId: string;
  byUserId: string;
  at: string;
  decision: ReviewDecision;
  source?: ReviewSource;
  remarks: string;
  /** Rejections reassign the task (§12.2). */
  newAssigneeId?: string;
  newDueDate?: string;
}

export interface Remark {
  id: string;
  byUserId: string;
  at: string;
  text: string;
}

export interface Task {
  id: string;
  /** null → individual task (§10). */
  projectId: string | null;
  title: string;
  description: string;
  department: string;
  /** null — planned but not handed to anyone yet. */
  assigneeId: string | null;
  status: TaskStatus;
  priority: Priority;
  startDate: string;
  dueDate: string;
  estimatedHours: number;
  tags: string[];
  createdBy: string;
  createdAt: string;
  sessions: TimeSession[];
  submissions: Submission[];
  reviews: Review[];
  remarks: Remark[];
  /** Set on a repeating individual task's source (§10 tasks only). */
  recurrence?: RecurrenceSeries | null;
  /** Set on an individual task generated from a repeating source. */
  series?: SeriesLink | null;
}

/* ------------------------------------------------------------- Expenses */

export type ExpenseStatus = "Pending" | "Approved" | "Rejected";

export interface Expense {
  id: string;
  projectId: string;
  vendorId: string;
  description: string;
  amount: number;
  expenseDate: string;
  attachmentName?: string;
  attachmentUrl?: string;
  status: ExpenseStatus;
  financeRemarks?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdBy: string;
  createdAt: string;
}

/* -------------------------------------------------------------- Vendors */

export interface Vendor {
  id: string;
  name: string;
  serviceType: string;
  contactPerson: string;
  phone: string;
  email: string;
  rate: number;
  notes?: string;
}

/* ------------------------------------------------------------ Templates */

export interface TaskTemplateItem {
  id: string;
  title: string;
  description: string;
  department: string;
  priority: Priority;
  estimatedHours: number;
  tags: string[];
  /** Offsets in working days from the project start, used to pre-fill dates. */
  startOffsetDays: number;
  durationDays: number;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  color: string;
  services: string[];
  priority: Priority;
  durationDays: number;
  tasks: TaskTemplateItem[];
  createdAt: string;
}

export interface TaskTemplate extends TaskTemplateItem {
  createdAt: string;
}

/* -------------------------------------------------------------- Calendar */

export interface Holiday {
  date: string;
  name: string;
}

export interface CalendarConfig {
  holidays: Holiday[];
  /** Non-working days forced back to working by HR Admin (§5.4.5). */
  workingOverrides: string[];
}

/* ---------------------------------------------------- Operational links */

/** A named folder of links, e.g. "Brand assets" or "Client onboarding". */
export interface LinkGroup {
  id: string;
  name: string;
  createdAt: string;
}

/** A shared Google Drive (or other) link, filed under one group. */
export interface OperationalLink {
  id: string;
  groupId: string;
  name: string;
  url: string;
  createdBy: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ CRM */

/**
 * Company → Client → Property → OBC → Project. Each record keeps the whole
 * chain above it, so a running project can always be traced back to the
 * developer who paid for it.
 */

export type PartyStatus = "active" | "inactive";

export const PARTY_STATUSES: PartyStatus[] = ["active", "inactive"];

export interface Company {
  id: string;
  name: string;
  legalName: string;
  gstin: string;
  pan: string;
  reraPromoterId: string;
  address: string;
  city: string;
  website: string;
  phone: string;
  email: string;
  logoUrl: string;
  /** Who owns the relationship on the agency side. */
  accountOwnerId: string | null;
  status: PartyStatus;
  createdBy: string;
  createdAt: string;
}

export type ClientRole = "Decision Maker" | "Influencer" | "Coordinator";

export const CLIENT_ROLES: ClientRole[] = [
  "Decision Maker",
  "Influencer",
  "Coordinator",
];

export interface Client {
  id: string;
  companyId: string;
  fullName: string;
  designation: string;
  mobile: string;
  whatsapp: string;
  email: string;
  /** null — nobody has said what part they play yet. */
  role: ClientRole | null;
  status: PartyStatus;
  createdBy: string;
  createdAt: string;
}

export type ConfigStatus = "Open" | "Sold out";

export const CONFIG_STATUSES: ConfigStatus[] = ["Open", "Sold out"];

/** One line of the unit mix: "2 BHK · 720 sq.ft · ₹1.05 Cr · Open". */
export interface PropertyConfig {
  id: string;
  config: string;
  sqFt: number;
  price: number;
  status: ConfigStatus;
}

/** A media folder created on Google Drive for a property. */
export interface DriveFolder {
  id: string;
  name: string;
  folderId: string;
  url: string;
}

export interface Property {
  id: string;
  companyId: string;
  /** null — the property exists before anyone is named as its contact. */
  clientId: string | null;
  name: string;
  description: string;
  address: string;
  mapsUrl: string;
  maharera: string;
  /** Empty until "Create Directory" has run; set once, never twice. */
  driveFolderId: string;
  driveFolderUrl: string;
  configs: PropertyConfig[];
  folders: DriveFolder[];
  createdBy: string;
  createdAt: string;
}

export type ObcStatus = "Draft" | "Submitted" | "Converted";

export const OBC_STATUSES: ObcStatus[] = ["Draft", "Submitted", "Converted"];

/**
 * One line of the estimate, as the delivery team needs to read it: what was
 * sold, how much of it, and the brief that came with it. Pricing stays in Zoho.
 *
 * This list is *reference*. An estimate is written in the client's units —
 * three lines saying what they are buying — while delivering it takes ten or
 * twelve services on our side, so work is never raised from here. See
 * `ObcService`.
 */
export interface ObcItem {
  id: string;
  service: string;
  quantity: number;
  /** Zoho's line-level "Description". */
  description: string;
  /** Zoho's line-level "Brief Description". */
  briefDescription: string;
}

/**
 * One service the agency will actually deliver for an OBC, written by hand by
 * the Business Development Executive after the estimate has been pulled in.
 *
 * This is the unit of allotment. Work is raised for the services that are
 * ready rather than for the whole order at once, so each one carries where it
 * went — a project, or a single individual task — one way or the other, never
 * both. Both are null until someone raises the work, and go back to null if
 * that project or task is later deleted, which frees the service again.
 */
export interface ObcService {
  id: string;
  service: string;
  quantity: number;
  description: string;
  projectId: string | null;
  taskId: string | null;
}

/** Where a set of services was sent. */
export type ObcAllotment =
  | { kind: "project"; projectId: string }
  | { kind: "task"; taskId: string };

export const isAllotted = (s: Pick<ObcService, "projectId" | "taskId">) =>
  !!s.projectId || !!s.taskId;

/**
 * What the OBC list reports: how much of an order has been turned into work.
 * Projects and tasks are counted distinctly, because one project usually
 * covers several of the services that were sold together.
 */
export interface ObcProgress {
  services: number;
  projects: number;
  tasks: number;
  allotted: number;
  pending: number;
}

export function obcProgress(services: ObcService[]): ObcProgress {
  const projects = new Set<string>();
  const tasks = new Set<string>();
  let allotted = 0;
  for (const s of services) {
    if (s.projectId) projects.add(s.projectId);
    else if (s.taskId) tasks.add(s.taskId);
    else continue;
    allotted += 1;
  }
  return {
    services: services.length,
    projects: projects.size,
    tasks: tasks.size,
    allotted,
    pending: services.length - allotted,
  };
}

export interface Obc {
  id: string;
  /** Human-readable handle for the sales team, e.g. "OBC-0007". */
  code: string;
  companyId: string;
  clientId: string | null;
  propertyId: string | null;
  /** What the lines were pulled from, kept for traceability. */
  zohoQuoteId: string;
  zohoQuoteNumber: string;
  /** The quote's subject in Zoho — what everyone actually calls this deal. */
  zohoQuoteName: string;
  notes: string;
  status: ObcStatus;
  submittedAt?: string;
  convertedAt?: string;
  /** Set once a manager has turned this OBC into real work. */
  projectId: string | null;
  /** The estimate, as pulled from Zoho. Reference only. */
  items: ObcItem[];
  /** What we will deliver, written by hand. Work is raised from these. */
  services: ObcService[];
  createdBy: string;
  createdAt: string;
}

/* --------------------------------------------------------- Content Bank */

export type ContentType =
  | "Static Design"
  | "Reel Editing"
  | "Influencer Script"
  | "Drone Script"
  | "OOH"
  | "Site Branding"
  | "Website Content"
  | "Brochure Content";

export const CONTENT_TYPES: ContentType[] = [
  "Static Design",
  "Reel Editing",
  "Influencer Script",
  "Drone Script",
  "OOH",
  "Site Branding",
  "Website Content",
  "Brochure Content",
];

export type ContentBillingType = "Count" | "Extra";

export const CONTENT_BILLING_TYPES: ContentBillingType[] = ["Count", "Extra"];

/**
 * One piece of content, written by a Content Writer against a project — and
 * usually against the one task they were given. A task can carry several
 * entries, which is why the link points this way.
 */
export interface ContentEntry {
  id: string;
  projectId: string;
  /** The writer's task, when the piece was written for one. */
  taskId: string | null;
  date: string;
  type: ContentType;
  /** Rich text — what appears on the creative itself. */
  onPic: string;
  caption: string;
  /** Rich text — the brief or body copy. */
  description: string;
  referenceLinks: string[];
  billingType: ContentBillingType;
  /** The team member the piece is for. */
  allottedTo: string | null;
  createdBy: string;
  createdAt: string;
}

/* ------------------------------------------------- Comments & Minutes */

/** Everything a comment or a set of minutes can be filed against. */
export type CollabEntity =
  | "company"
  | "client"
  | "property"
  | "obc"
  | "project"
  | "task";

/** A quick internal note on a record. Plain text; @mentions are highlighted. */
export interface Comment {
  id: string;
  entityType: CollabEntity;
  entityId: string;
  body: string;
  createdBy: string;
  createdAt: string;
}

/** Formal minutes of a client meeting, kept as a history log per record. */
export interface MeetingMinutes {
  id: string;
  entityType: CollabEntity;
  entityId: string;
  title: string;
  meetingDate: string;
  attendees: string;
  /** Rich text. */
  body: string;
  createdBy: string;
  createdAt: string;
}

/* --------------------------------------------------------- Notifications */

export type NotificationType =
  | "task_assigned"
  | "task_submitted"
  | "review_decision"
  | "remark_added"
  | "expense_added"
  | "expense_reviewed"
  | "due_soon"
  | "overdue"
  | "timer_autostop"
  | "content_allotted";

export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  href: string;
  read: boolean;
  createdAt: string;
}

/* ------------------------------------------------------------------ DB */

/**
 * The signed-in user's view of the database: every row Row Level Security lets
 * them read, assembled into the nested shapes the screens use.
 */
export interface Database {
  /**
   * Master data, live from the database rather than a constant: a Super Admin
   * can take on a new service line without a deploy (§5.1, §5.2).
   */
  departments: string[];
  services: string[];
  users: User[];
  projects: Project[];
  tasks: Task[];
  expenses: Expense[];
  vendors: Vendor[];
  projectTemplates: ProjectTemplate[];
  taskTemplates: TaskTemplate[];
  calendar: CalendarConfig;
  notifications: AppNotification[];
  linkGroups: LinkGroup[];
  operationalLinks: OperationalLink[];
  companies: Company[];
  clients: Client[];
  properties: Property[];
  obcs: Obc[];
  contentEntries: ContentEntry[];
  comments: Comment[];
  minutes: MeetingMinutes[];
}
