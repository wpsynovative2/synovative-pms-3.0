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
  /**
   * Monthly "monthday" only: the day of the month it falls on, 1–31, chosen
   * freely rather than taken from the start date (0016). A month too short
   * for it uses its last day. Absent → the start date's day.
   */
  monthDay?: number;
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

/** How a repeating project's copies are named (0029). */
export type TitleMonth = "current" | "upcoming";

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
   * On a blueprint: which month its copies are named for - the one they are
   * created in, or the one after (0029). "current" when not given.
   */
  titleMonth?: TitleMonth;
  /**
   * Step by step (SBS, 0014): the standard tasks run one after another, each
   * starting the day the one before it is approved. False when not given.
   */
  stepByStep?: boolean;
  /**
   * Its Drive folder and the two areas inside it, for a project selling a 3D
   * walkthrough (0015). Empty until "Create Drive folder" is pressed.
   */
  driveFolderId?: string;
  driveCsfFolderId?: string;
  driveTeam3dFolderId?: string;
  /**
   * The CRM chain this project came from. All null for work raised by hand;
   * filled in when a New OBC is converted (§CRM).
   */
  companyId: string | null;
  /** The first of `clientIds`, kept for everything that reads one contact. */
  clientId: string | null;
  /** Every contact the project is for, in order (0026). */
  clientIds: string[];
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

/**
 * What a task is. A standard task is one piece of work with one submit/review
 * cycle. A *content* task is a batch: "five reels" is one task carrying five
 * pieces of content, each written, allotted and approved on its own, with the
 * task tracking how far through the batch we are.
 */
export type TaskKind = "standard" | "content";

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

/** "Content Bank" is a content task's only output (0013). */
export type OutputLocation = "Google Drive" | "WhatsApp" | "Content Bank";

export interface Submission {
  id: string;
  byUserId: string;
  at: string;
  outputLocation: OutputLocation;
  driveLink?: string;
  description: string;
  /** A Content Bank submission: a link to every piece on the task. */
  links: string[];
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

/** One change of hands on a task, recorded by the database (0016). */
export interface TaskAssignment {
  id: string;
  /** null - it had nobody before (the first assignment). */
  fromUserId: string | null;
  /** null - it was taken off someone and left unassigned. */
  toUserId: string | null;
  /** null - done by the system, e.g. a recurring copy being made. */
  byUserId: string | null;
  at: string;
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
  kind: TaskKind;
  /**
   * Content tasks only: how many pieces were asked for. A starting target
   * rather than a ceiling — the writer may add more, and the progress bar
   * follows whichever is larger. Always 0 on a standard task.
   */
  contentCount: number;
  /**
   * Content tasks only: the CB type of each target piece, by slot (index 0 is
   * Count 1). A missing entry means Static Design (0015).
   */
  contentTypes: ContentType[];
  /**
   * A standard project task can wait on another task in its project (0014): it
   * starts the day that task is approved and is due `durationDays` working days
   * later. Until then its dates are projected and it cannot be started.
   */
  dependsOnTaskId?: string | null;
  /** Working days from start to due; set whenever `dependsOnTaskId` is. */
  durationDays?: number | null;
  /**
   * `dependsOnTaskId` while that task is not yet approved, else null. Derived
   * by the store from what is on screen, never stored (see markWaiting).
   */
  waitingOnTaskId?: string | null;
  createdBy: string;
  createdAt: string;
  sessions: TimeSession[];
  submissions: Submission[];
  reviews: Review[];
  remarks: Remark[];
  /** Every change of assignee, oldest first (0016). */
  assignments?: TaskAssignment[];
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
  /**
   * A project template's task may be a content task (0017), carrying its
   * count and the CB type of each piece. Standalone task templates are
   * always standard.
   */
  kind: TaskKind;
  contentCount: number;
  contentTypes: ContentType[];
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

/** The listed natures; "Others" lets a name be typed instead (0011). */
export const COMPANY_NATURES = [
  "Real Estate Developer",
  "Mandate Company",
  "Channel Partner",
] as const;

export interface Company {
  id: string;
  name: string;
  /**
   * One of COMPANY_NATURES, or the name typed under "Others". Empty when
   * nobody has said yet.
   */
  nature: string;
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
  /**
   * The first of `clientIds`, kept on the row because the Drive folder tree is
   * named after it. null — the property exists before anyone is named.
   */
  clientId: string | null;
  /** Every contact who speaks for this property, in order (0023). */
  clientIds: string[];
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
  | "Brochure Content"
  | "Static to Motion"
  | "Festival STM";

export const CONTENT_TYPES: ContentType[] = [
  "Static Design",
  "Reel Editing",
  "Influencer Script",
  "Drone Script",
  "OOH",
  "Site Branding",
  "Website Content",
  "Brochure Content",
  "Static to Motion",
  "Festival STM",
];

/**
 * Static to Motion and Festival STM (0021): a static design that is then
 * edited into a reel. Such a piece is allotted twice - the static design, and
 * the reel editing that waits for it (0022). Otherwise one piece like any.
 */
export const isStmType = (type: ContentType) =>
  type === "Static to Motion" || type === "Festival STM";

/**
 * Where a piece has got to — shown as its "Status". The writer sets it, and
 * a target piece counts as done once it has one. Optional: null until then.
 */
export type ContentStage =
  | "Ready To Design"
  | "Design Completed"
  | "Scheduled"
  | "Cancelled"
  | "Carry Forwarded";

export const CONTENT_STAGES: ContentStage[] = [
  "Ready To Design",
  "Design Completed",
  "Scheduled",
  "Cancelled",
  "Carry Forwarded",
];

/** Where a piece will be used (0023): one or the other, required once written. */
export type ContentPlacement = "SMM" | "WhatsApp Share";

export const CONTENT_PLACEMENTS: ContentPlacement[] = ["SMM", "WhatsApp Share"];

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
  /** The piece's name; slots start as "<task> Count <n>" (0026). */
  title: string;
  /**
   * Which of a content task's target pieces this is, 1..contentCount. The
   * database creates and removes slots with the task; null for extras and
   * for library pieces.
   */
  slot: number | null;
  date: string;
  type: ContentType;
  /*
   * The journey (0018), stamped by the database as the piece reaches each
   * step. Null when not reached - or reached before 0018, with no date kept.
   */
  /** When the piece is to be delivered; set on its page (0012). */
  deliveryDate: string | null;
  /** Start Writing pressed, or first written in (0027). */
  startedAt: string | null;
  /** Who started it; null for pieces started before 0027. */
  startedBy: string | null;
  /** First marked Ready To Design. */
  readyAt: string | null;
  /** Put in its current holder's name. */
  allottedAt: string | null;
  /** Design Completed or Scheduled. */
  completedAt: string | null;
  /** Rich text — what appears on the creative itself. */
  onPic: string;
  caption: string;
  /** Rich text — the brief or body copy. */
  description: string;
  referenceLinks: string[];
  billingType: ContentBillingType;
  /** SMM or WhatsApp Share; null only on empty pieces and ones from before 0023. */
  placement: ContentPlacement | null;
  /** The team member the piece is for. */
  allottedTo: string | null;
  /**
   * The allottee's task on this project that the piece is for (0025). Set
   * together with `allottedTo`; null on pieces allotted before 0025.
   */
  allottedTaskId: string | null;
  /**
   * Static to Motion pieces only (0022): the reel editor and their task, which
   * starts no earlier than the static task above is due. `allottedTo` is then
   * the static designer.
   */
  motionAllottedTo: string | null;
  motionAllottedTaskId: string | null;
  /** Production stage, moved by `setContentStage`. */
  stage: ContentStage | null;
  /** With the Scheduled stage: the day it goes out (0013). */
  scheduledOn: string | null;
  /** With Carry Forwarded: the month it moves to, first of the month. */
  carryMonth: string | null;
  /** The month the piece is for, first of the month. Always set. */
  forMonth: string;
  createdBy: string;
  createdAt: string;
}

/** Rich text counts as empty once its tags are stripped. Mirrors content_is_empty() (0026). */
const richEmpty = (html: string) =>
  html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length === 0;

/** Nothing written in the piece yet — an untouched slot. */
export const isContentEmpty = (e: ContentEntry) =>
  richEmpty(e.onPic) &&
  richEmpty(e.description) &&
  !e.caption.trim() &&
  e.referenceLinks.length === 0;

/**
 * Its writer has pressed Start Writing - or something is written in it, which
 * counts the same. Until then its status is locked (0027).
 */
export const isContentStarted = (e: ContentEntry) => !!e.startedAt || !isContentEmpty(e);

/** What a piece is called wherever it is listed. */
export const contentLabel = (e: Pick<ContentEntry, "title" | "caption" | "type">) =>
  e.title.trim() || e.caption.trim() || e.type;

/** How far through a content task we are. */
export interface ContentProgress {
  /** The count asked for. */
  target: number;
  /**
   * Target pieces the writer has given a status. A status is the writer
   * saying the piece is done, so a slot with words in it but no status does
   * not count yet.
   */
  filled: number;
  /** Pieces written beyond the target. */
  extras: number;
  /** 0–100, filled against the target, for the bar. */
  percent: number;
  /** "3/5", or "3/5 + 2" once extras exist. */
  label: string;
}

export function contentProgress(task: Task, entries: ContentEntry[]): ContentProgress {
  const mine = entries.filter((e) => e.taskId === task.id);
  const slots = mine.filter((e) => e.slot !== null);
  const target = task.contentCount;
  const filled = slots.filter((e) => e.stage !== null).length;
  const extras = mine.length - slots.length;
  return {
    target,
    filled,
    extras,
    percent: target === 0 ? 0 : Math.min(100, Math.round((filled / target) * 100)),
    label: `${filled}/${target}${extras ? ` + ${extras}` : ""}`,
  };
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
  | "content_allotted"
  | "website_renewal"
  | "inventory_assigned";

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

/* ------------------------------------------------------------- Websites */

/** How a site was built: the WordPress logins only mean something for one. */
export type WebsiteBuild = "WordPress" | "Plain code" | "Other";
export const WEBSITE_BUILDS: WebsiteBuild[] = ["WordPress", "Plain code", "Other"];

export type WebsiteStatus = "Active" | "Off-boarded";
export const WEBSITE_STATUSES: WebsiteStatus[] = ["Active", "Off-boarded"];

/**
 * A client website Synovative built or looks after (0020). Its domain and
 * hosting renew every year, starting a year after `startDate`.
 */
export interface Website {
  id: string;
  name: string;
  url: string;
  companyId: string | null;
  /** The client contact the renewal email goes to. */
  clientId: string | null;
  projectId: string | null;
  builtWith: WebsiteBuild;
  /** "business hosting 1", "client's own hosting", … */
  hostingPlan: string;
  /** Whether Synovative holds - and pays for - the domain / the hosting. */
  synovativeDomain: boolean;
  synovativeHosting: boolean;
  status: WebsiteStatus;
  startDate: string | null;
  /** The next annual renewal; set by the database from the start date. */
  renewalDue: string | null;
  /** What the client is charged for a year, in rupees. 0 when not agreed. */
  renewalFee: number;
  /** Renewal email address when no client is linked, or to override theirs. */
  clientEmail: string;
  notes: string;
  createdBy: string;
  createdAt: string;
}

/**
 * One login for a website. The password is never loaded with it: it is read
 * on demand through `revealWebsitePassword`, which the database logs.
 */
export interface WebsiteCredential {
  id: string;
  websiteId: string;
  /** "WordPress admin", "Hosting", "Hostinger mail", "Gmail", … */
  label: string;
  loginUrl: string;
  username: string;
  /** Recovery email / phone, where the account has one. */
  recovery: string;
  notes: string;
  position: number;
  createdAt: string;
}

export const CREDENTIAL_LABELS = [
  "WordPress admin",
  "WordPress user",
  "Hosting",
  "Hostinger mail",
  "Domain registrar",
  "Gmail",
  "cPanel / FTP",
  "Other",
];

export interface WebsiteRenewal {
  id: string;
  websiteId: string;
  renewedOn: string;
  periodFrom: string;
  periodTo: string;
  amount: number | null;
  note: string;
  createdBy: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ DB */

/* ------------------------------------------------------- System Inventory */

/*
 * Office computer hardware (0011, Archi-inventory.md). Internal parts go
 * inside a cabinet; cabinets, monitors and peripherals go at a workstation;
 * a workstation is allotted to one person.
 */

export type InventoryCategory =
  | "Processor"
  | "Motherboard"
  | "RAM"
  | "Storage"
  | "GPU"
  | "Power supply"
  | "Cabinet"
  | "Monitor"
  | "Keyboard"
  | "Mouse"
  | "UPS"
  | "Accessory"
  | "Other";

/** Where a category goes: inside a cabinet, at a workstation, or either. */
export type InventoryPlace = "cabinet" | "workstation" | "either";

export type InventoryStatus = "In use" | "Spare" | "Under repair" | "Retired";
export const INVENTORY_STATUSES: InventoryStatus[] = ["In use", "Spare", "Under repair", "Retired"];

/** One detail a category asks for, stored under `key` in the item's specs. */
export interface SpecField {
  key: string;
  label: string;
  type: "number" | "text" | "select";
  unit?: string;
  options?: string[];
}

const FORM_FACTORS = ["ATX", "Micro-ATX", "Mini-ITX"];
const CONNECTIONS = ["Wired", "Wireless"];

/**
 * Every category: its asset ID prefix, where it goes and the details it asks
 * for. Prefix and place mirror inventory_category_prefix() and
 * inventory_category_place() in 0011 - a new category goes in both.
 */
export const INVENTORY_CATEGORIES: Record<
  InventoryCategory,
  { prefix: string; place: InventoryPlace; specs: SpecField[] }
> = {
  Processor: {
    prefix: "CPU",
    place: "cabinet",
    specs: [
      { key: "cores", label: "Cores", type: "number" },
      { key: "threads", label: "Threads", type: "number" },
      { key: "base_ghz", label: "Base clock", type: "number", unit: "GHz" },
      { key: "socket", label: "Socket", type: "text" },
    ],
  },
  Motherboard: {
    prefix: "MBD",
    place: "cabinet",
    specs: [
      { key: "chipset", label: "Chipset", type: "text" },
      { key: "socket", label: "Socket", type: "text" },
      { key: "form_factor", label: "Form factor", type: "select", options: FORM_FACTORS },
      { key: "ram_slots", label: "RAM slots", type: "number" },
      { key: "max_ram_gb", label: "Max RAM", type: "number", unit: "GB" },
    ],
  },
  RAM: {
    prefix: "RAM",
    place: "cabinet",
    specs: [
      { key: "capacity_gb", label: "Capacity", type: "number", unit: "GB" },
      { key: "ram_type", label: "Type", type: "select", options: ["DDR3", "DDR4", "DDR5"] },
      { key: "speed_mhz", label: "Speed", type: "number", unit: "MHz" },
    ],
  },
  Storage: {
    prefix: "STO",
    place: "cabinet",
    specs: [
      { key: "storage_type", label: "Type", type: "select", options: ["NVMe SSD", "SATA SSD", "HDD"] },
      { key: "capacity_gb", label: "Capacity", type: "number", unit: "GB" },
    ],
  },
  GPU: {
    prefix: "GPU",
    place: "cabinet",
    specs: [
      { key: "chipset", label: "Chipset", type: "text" },
      { key: "vram_gb", label: "VRAM", type: "number", unit: "GB" },
    ],
  },
  "Power supply": {
    prefix: "PSU",
    place: "cabinet",
    specs: [
      { key: "watts", label: "Wattage", type: "number", unit: "W" },
      {
        key: "rating",
        label: "Rating",
        type: "select",
        options: ["None", "80+", "80+ Bronze", "80+ Silver", "80+ Gold", "80+ Platinum"],
      },
    ],
  },
  Cabinet: {
    prefix: "CAB",
    place: "workstation",
    specs: [
      { key: "form_factor", label: "Form factor", type: "select", options: FORM_FACTORS },
      { key: "colour", label: "Colour", type: "text" },
    ],
  },
  Monitor: {
    prefix: "MON",
    place: "workstation",
    specs: [
      { key: "size_inch", label: "Size", type: "number", unit: "inch" },
      {
        key: "resolution",
        label: "Resolution",
        type: "select",
        options: ["1366×768", "1920×1080", "2560×1440", "3840×2160", "Other"],
      },
      { key: "panel", label: "Panel", type: "select", options: ["IPS", "VA", "TN", "OLED"] },
      { key: "refresh_hz", label: "Refresh rate", type: "number", unit: "Hz" },
    ],
  },
  Keyboard: {
    prefix: "KBD",
    place: "workstation",
    specs: [{ key: "connection", label: "Connection", type: "select", options: CONNECTIONS }],
  },
  Mouse: {
    prefix: "MOU",
    place: "workstation",
    specs: [{ key: "connection", label: "Connection", type: "select", options: CONNECTIONS }],
  },
  UPS: {
    prefix: "UPS",
    place: "workstation",
    specs: [{ key: "va", label: "Rating", type: "number", unit: "VA" }],
  },
  Accessory: {
    prefix: "ACC",
    place: "workstation",
    specs: [
      {
        key: "kind",
        label: "Kind",
        type: "select",
        options: ["Headphones", "Webcam", "Speaker", "Dock", "Other"],
      },
    ],
  },
  Other: {
    prefix: "OTH",
    place: "either",
    specs: [{ key: "description", label: "What it is", type: "text" }],
  },
};

export const INVENTORY_CATEGORY_LIST = Object.keys(INVENTORY_CATEGORIES) as InventoryCategory[];

/** A desk setup, allotted to at most one person. */
export interface Workstation {
  id: string;
  /** WS-001, generated by the database; empty until the save comes back. */
  code: string;
  name: string;
  location: string;
  assignedTo: string | null;
  assignedAt: string | null;
  notes: string;
  createdBy: string;
  createdAt: string;
}

/** One component - a cabinet is one too. */
export interface InventoryItem {
  id: string;
  /** SYN-RAM-0031, generated by the database; empty until the save comes back. */
  assetTag: string;
  category: InventoryCategory;
  brand: string;
  model: string;
  serialNumber: string;
  specs: Record<string, string | number>;
  status: InventoryStatus;
  /** Inside this cabinet; never set together with workstationId. */
  cabinetId: string | null;
  workstationId: string | null;
  purchaseDate: string | null;
  price: number | null;
  vendorId: string | null;
  warrantyUntil: string | null;
  notes: string;
  createdBy: string;
  createdAt: string;
}

/** One line of history, written only by the database. */
export interface InventoryEvent {
  id: string;
  at: string;
  actor: string | null;
  itemId: string | null;
  workstationId: string | null;
  kind:
    | "added"
    | "edited"
    | "installed"
    | "placed"
    | "removed"
    | "status"
    | "assigned"
    | "unassigned"
    | "deleted";
  /** The asset ID or workstation code at the time. */
  subject: string;
  fromLabel: string | null;
  toLabel: string | null;
  note: string;
}

const specOf = (item: InventoryItem, key: string) => item.specs[key];
const makeName = (item: InventoryItem) => [item.brand, item.model].filter(Boolean).join(" ");

/** 512 GB, 1 TB. */
export function formatCapacity(gb: number): string {
  return gb >= 1000 && gb % 1000 === 0 ? `${gb / 1000} TB` : `${gb} GB`;
}

/** The one line that says what a component is: "16 GB DDR4 3200 MHz". */
export function itemSummary(item: InventoryItem): string {
  const has = (key: string) => {
    const v = specOf(item, key);
    return v !== undefined && v !== "" && v !== "None" ? v : undefined;
  };
  const parts: (string | number | undefined)[] = [];
  switch (item.category) {
    case "RAM":
      parts.push(
        has("capacity_gb") ? `${has("capacity_gb")} GB` : undefined,
        has("ram_type"),
        has("speed_mhz") ? `${has("speed_mhz")} MHz` : undefined,
      );
      break;
    case "Storage":
      parts.push(
        has("capacity_gb") ? formatCapacity(Number(has("capacity_gb"))) : undefined,
        has("storage_type"),
      );
      break;
    case "GPU":
      parts.push(makeName(item) || has("chipset"), has("vram_gb") ? `${has("vram_gb")} GB` : undefined);
      break;
    case "Power supply":
      parts.push(has("watts") ? `${has("watts")} W` : undefined, has("rating"));
      break;
    case "Monitor":
      parts.push(has("size_inch") ? `${has("size_inch")}"` : undefined, has("resolution"));
      break;
    case "Other":
      parts.push(has("description"));
      break;
  }
  const line = parts.filter((x) => x !== undefined && x !== "").join(" ");
  return line || makeName(item) || item.category;
}

/** A cabinet in one line: "Ryzen 5 5600 · 32 GB RAM · 512 GB NVMe SSD · RTX 3060". */
export function cabinetSummary(parts: InventoryItem[]): string {
  const of = (c: InventoryCategory) => parts.filter((p) => p.category === c);
  const ram = of("RAM").reduce((sum, p) => sum + (Number(specOf(p, "capacity_gb")) || 0), 0);
  return [
    ...of("Processor").map((p) => makeName(p) || "Processor"),
    ram ? `${ram} GB RAM` : of("RAM").length ? `${of("RAM").length} × RAM` : "",
    ...of("Storage").map(itemSummary),
    ...of("GPU").map((p) => makeName(p) || itemSummary(p)),
  ]
    .filter(Boolean)
    .join(" · ");
}

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
  websites: Website[];
  websiteCredentials: WebsiteCredential[];
  websiteRenewals: WebsiteRenewal[];
  workstations: Workstation[];
  inventoryItems: InventoryItem[];
}

/**
 * The journey stamps a change would get from the database (0018), applied to
 * the optimistic copy so the steps move the moment something is done. Mirrors
 * stamp_content_journey().
 */
export function stampJourney(
  prev: ContentEntry | null,
  next: ContentEntry,
  by: string | null = null,
): ContentEntry {
  const now = new Date().toISOString();
  const out = { ...next };
  if (!out.startedAt && !isContentEmpty(out)) {
    out.startedAt = now;
    out.startedBy = out.startedBy ?? by;
  }
  if (!prev || prev.stage !== out.stage) {
    if (out.stage === "Ready To Design" && !out.readyAt) out.readyAt = now;
    if (out.stage === "Design Completed" || out.stage === "Scheduled") {
      if (!out.completedAt) out.completedAt = now;
    } else if (out.stage === null || out.stage === "Ready To Design") {
      out.completedAt = null;
    }
  }
  if (!out.allottedTo) out.allottedAt = null;
  else if (!prev || prev.allottedTo !== out.allottedTo) out.allottedAt = now;
  return out;
}

/**
 * Whether a piece is fully allotted: one holder for most, both the static
 * designer and the reel editor for a Static to Motion piece.
 */
export const isFullyAllotted = (e: ContentEntry) =>
  !!e.allottedTo && (!isStmType(e.type) || !!e.motionAllottedTo);

/** Everyone a piece is allotted to, static designer first. */
export const contentHolders = (e: ContentEntry): string[] =>
  [e.allottedTo, isStmType(e.type) ? e.motionAllottedTo : null].filter(
    (x): x is string => !!x,
  );
