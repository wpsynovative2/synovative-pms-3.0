import { todayISO, workingDaysInRange } from "./calendar";
import { hoursFromMs, taskElapsedMs } from "./time";
import type {
  CalendarConfig,
  Database,
  Expense,
  Project,
  Task,
  User,
} from "./types";

/** Derived figures for the project header, workload and reports (§7.2, §14, §16). */

/**
 * A task is late only while the delay is still ours. Approved work is done,
 * work parked with the client is waiting on them, and work submitted on or
 * before its due date is waiting on a reviewer — none of those are the
 * assignee's to answer for. Mirrors task_is_overdue() in the database.
 */
export function isOverdue(t: Task): boolean {
  if (t.status === "Approved" || t.status === "Waiting for Client Response") return false;
  if (t.dueDate >= todayISO()) return false;
  if (t.status === "Submitted") {
    const latest = t.submissions.reduce((at, s) => (s.at > at ? s.at : at), "");
    if (latest && latest.slice(0, 10) <= t.dueDate) return false;
  }
  return true;
}

export const isOpen = (t: Task) => t.status !== "Approved";

export interface ProjectStats {
  totalTasks: number;
  approvedTasks: number;
  progress: number;
  totalTimeMs: number;
  estimatedHours: number;
  overdueTasks: number;
  byStatus: Record<Task["status"], number>;
  approvedExpenses: number;
  pendingExpenses: number;
  rejectedExpenses: number;
}

export function projectStats(
  project: Project,
  tasks: Task[],
  expenses: Expense[],
): ProjectStats {
  const own = tasks.filter((t) => t.projectId === project.id);
  const approved = own.filter((t) => t.status === "Approved").length;
  const byStatus = {
    "Not Started": 0,
    "In Progress": 0,
    Submitted: 0,
    "Changes Required": 0,
    Rejected: 0,
    Approved: 0,
  } as Record<Task["status"], number>;
  for (const t of own) byStatus[t.status] += 1;

  const ownExpenses = expenses.filter((e) => e.projectId === project.id);
  const sum = (status: Expense["status"]) =>
    ownExpenses
      .filter((e) => e.status === status)
      .reduce((acc, e) => acc + e.amount, 0);

  return {
    totalTasks: own.length,
    approvedTasks: approved,
    progress: own.length === 0 ? 0 : Math.round((approved / own.length) * 100),
    totalTimeMs: own.reduce((acc, t) => acc + taskElapsedMs(t), 0),
    estimatedHours: own.reduce((acc, t) => acc + t.estimatedHours, 0),
    overdueTasks: own.filter(isOverdue).length,
    byStatus,
    approvedExpenses: sum("Approved"),
    pendingExpenses: sum("Pending"),
    rejectedExpenses: sum("Rejected"),
  };
}

/* -------------------------------------------------------------- workload */

export interface WorkloadRow {
  user: User;
  openTasks: Task[];
  notStarted: number;
  inProgress: number;
  submitted: number;
  done: number;
  overdue: number;
  dueThisWeek: number;
  /** Estimated hours of open tasks overlapping the window. */
  allocatedHours: number;
  /** Working days in the window × 8h. */
  capacityHours: number;
  utilisation: number;
  overAllocated: boolean;
}

export function workloadRows(
  users: User[],
  tasks: Task[],
  calendar: CalendarConfig,
  range: { from: string; to: string },
): WorkloadRow[] {
  const workingDays = workingDaysInRange(range.from, range.to, calendar);
  const weekEnd = range.to;

  return users.map((user) => {
    // Capacity belongs to the person, not the calendar: part-timers and
    // shared resources carry a smaller day than everyone else.
    const capacityHours = workingDays.length * user.capacityHoursPerDay;
    const mine = tasks.filter((t) => t.assigneeId === user.id);
    // A task loads the window when its [start, due] span overlaps it.
    const overlapping = mine.filter(
      (t) => isOpen(t) && t.startDate <= range.to && t.dueDate >= range.from,
    );
    const allocatedHours = overlapping.reduce((acc, t) => {
      const span = workingDaysInRange(
        t.startDate < range.from ? range.from : t.startDate,
        t.dueDate > range.to ? range.to : t.dueDate,
        calendar,
      ).length;
      const fullSpan = Math.max(
        1,
        workingDaysInRange(t.startDate, t.dueDate, calendar).length,
      );
      return acc + (t.estimatedHours * Math.max(span, 0)) / fullSpan;
    }, 0);

    const utilisation =
      capacityHours === 0 ? 0 : Math.round((allocatedHours / capacityHours) * 100);

    return {
      user,
      openTasks: overlapping,
      notStarted: mine.filter((t) => t.status === "Not Started").length,
      inProgress: mine.filter((t) => t.status === "In Progress").length,
      submitted: mine.filter(
        (t) => t.status === "Submitted" || t.status === "Changes Required",
      ).length,
      done: mine.filter((t) => t.status === "Approved").length,
      overdue: mine.filter(isOverdue).length,
      dueThisWeek: mine.filter(
        (t) => isOpen(t) && t.dueDate >= todayISO() && t.dueDate <= weekEnd,
      ).length,
      allocatedHours,
      capacityHours,
      utilisation,
      overAllocated: allocatedHours > capacityHours,
    };
  });
}

/* --------------------------------------------------------------- reports */

export interface ReportFilters {
  from: string;
  to: string;
  projectId: string;
  department: string;
  userId: string;
}

export function filterTasksForReport(
  tasks: Task[],
  f: ReportFilters,
): Task[] {
  return tasks.filter((t) => {
    if (f.projectId !== "all" && t.projectId !== f.projectId) return false;
    if (f.department !== "all" && t.department !== f.department) return false;
    if (f.userId !== "all" && t.assigneeId !== f.userId) return false;
    // Overlap with the reporting window.
    return t.startDate <= f.to && t.dueDate >= f.from;
  });
}

export interface Bucket {
  key: string;
  label: string;
  hours: number;
  count: number;
}

export function timeByProject(
  tasks: Task[],
  projects: Project[],
): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const t of tasks) {
    const key = t.projectId ?? "individual";
    const label =
      projects.find((p) => p.id === t.projectId)?.name ?? "Individual tasks";
    const b = map.get(key) ?? { key, label, hours: 0, count: 0 };
    b.hours += hoursFromMs(taskElapsedMs(t));
    b.count += 1;
    map.set(key, b);
  }
  return [...map.values()].sort((a, b) => b.hours - a.hours);
}

export function timeByUser(tasks: Task[], users: User[]): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const t of tasks) {
    // Work that has not been handed out yet still has to show up somewhere.
    const key = t.assigneeId ?? "unassigned";
    const label = t.assigneeId
      ? (users.find((u) => u.id === t.assigneeId)?.fullName ?? "Unknown")
      : "Unassigned";
    const b = map.get(key) ?? { key, label, hours: 0, count: 0 };
    b.hours += hoursFromMs(taskElapsedMs(t));
    b.count += 1;
    map.set(key, b);
  }
  return [...map.values()].sort((a, b) => b.hours - a.hours);
}

export function timeByDepartment(tasks: Task[]): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const t of tasks) {
    const b = map.get(t.department) ?? {
      key: t.department,
      label: t.department,
      hours: 0,
      count: 0,
    };
    b.hours += hoursFromMs(taskElapsedMs(t));
    b.count += 1;
    map.set(t.department, b);
  }
  return [...map.values()].sort((a, b) => b.hours - a.hours);
}

export interface EstimateAccuracy {
  estimated: number;
  actual: number;
  variance: number;
  overrunTasks: number;
}

export function estimateAccuracy(tasks: Task[]): EstimateAccuracy {
  const estimated = tasks.reduce((a, t) => a + t.estimatedHours, 0);
  const actual = tasks.reduce((a, t) => a + hoursFromMs(taskElapsedMs(t)), 0);
  return {
    estimated,
    actual,
    variance: estimated === 0 ? 0 : Math.round(((actual - estimated) / estimated) * 100),
    overrunTasks: tasks.filter(
      (t) => hoursFromMs(taskElapsedMs(t)) > t.estimatedHours && t.estimatedHours > 0,
    ).length,
  };
}

export interface CompletionStats {
  onTime: number;
  late: number;
  openOverdue: number;
  completionRate: number;
}

/** A task counts as on-time when its approving review landed on or before the due date. */
export function completionStats(tasks: Task[]): CompletionStats {
  let onTime = 0;
  let late = 0;
  for (const t of tasks) {
    if (t.status !== "Approved") continue;
    const approval = [...t.reviews].reverse().find((r) => r.decision === "Approved");
    const approvedOn = approval ? approval.at.slice(0, 10) : t.dueDate;
    if (approvedOn <= t.dueDate) onTime += 1;
    else late += 1;
  }
  const done = onTime + late;
  return {
    onTime,
    late,
    openOverdue: tasks.filter(isOverdue).length,
    completionRate: tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100),
  };
}

export interface ReworkStats {
  changesRequired: number;
  rejected: number;
  fromClient: number;
  fromProjectLeader: number;
  reassignments: number;
  /** taskId → number of reassignments */
  perTask: { task: Task; count: number }[];
  /** userId → reassignments away from that user */
  perUser: { userId: string; count: number }[];
}

export function reworkStats(tasks: Task[]): ReworkStats {
  let changesRequired = 0;
  let rejected = 0;
  let fromClient = 0;
  let fromProjectLeader = 0;
  let reassignments = 0;
  const perTask: { task: Task; count: number }[] = [];
  const perUserMap = new Map<string, number>();

  for (const t of tasks) {
    let taskReassignments = 0;
    for (const r of t.reviews) {
      if (r.decision === "Changes Required") changesRequired += 1;
      if (r.decision === "Rejected") {
        rejected += 1;
        if (r.newAssigneeId) {
          reassignments += 1;
          taskReassignments += 1;
        }
      }
      if (r.source === "Client") fromClient += 1;
      if (r.source === "Project Leader") fromProjectLeader += 1;
    }
    if (taskReassignments > 0) perTask.push({ task: t, count: taskReassignments });
    // Attribute a reassignment to whoever held the task at the time.
    for (const r of t.reviews) {
      if (r.decision === "Rejected" && r.newAssigneeId) {
        const prior = t.submissions.find((s) => s.id === r.submissionId)?.byUserId;
        if (prior) perUserMap.set(prior, (perUserMap.get(prior) ?? 0) + 1);
      }
    }
  }

  return {
    changesRequired,
    rejected,
    fromClient,
    fromProjectLeader,
    reassignments,
    perTask: perTask.sort((a, b) => b.count - a.count),
    perUser: [...perUserMap.entries()]
      .map(([userId, count]) => ({ userId, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export interface ExpenseBucket {
  key: string;
  label: string;
  approved: number;
  pending: number;
  rejected: number;
  total: number;
}

export function expensesByProject(
  expenses: Expense[],
  projects: Project[],
): ExpenseBucket[] {
  return bucketExpenses(expenses, (e) => ({
    key: e.projectId,
    label: projects.find((p) => p.id === e.projectId)?.name ?? "Unknown project",
  }));
}

export function expensesByVendor(
  expenses: Expense[],
  db: Pick<Database, "vendors">,
): ExpenseBucket[] {
  return bucketExpenses(expenses, (e) => ({
    key: e.vendorId,
    label: db.vendors.find((v) => v.id === e.vendorId)?.name ?? "Unknown vendor",
  }));
}

export function expensesByMonth(expenses: Expense[]): ExpenseBucket[] {
  const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return bucketExpenses(expenses, (e) => {
    const key = e.expenseDate.slice(0, 7);
    const [y, m] = key.split("-");
    return { key, label: `${MONTHS[Number(m) - 1]} ${y}` };
  }).sort((a, b) => a.key.localeCompare(b.key));
}

function bucketExpenses(
  expenses: Expense[],
  keyer: (e: Expense) => { key: string; label: string },
): ExpenseBucket[] {
  const map = new Map<string, ExpenseBucket>();
  for (const e of expenses) {
    const { key, label } = keyer(e);
    const b =
      map.get(key) ??
      ({ key, label, approved: 0, pending: 0, rejected: 0, total: 0 } as ExpenseBucket);
    if (e.status === "Approved") b.approved += e.amount;
    if (e.status === "Pending") b.pending += e.amount;
    if (e.status === "Rejected") b.rejected += e.amount;
    b.total += e.amount;
    map.set(key, b);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export const formatINR = (n: number) =>
  `₹${Math.round(n).toLocaleString("en-IN")}`;
