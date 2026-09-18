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
  | "timer_autostop";

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
}
