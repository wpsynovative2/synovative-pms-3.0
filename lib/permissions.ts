import { FINANCE_DEPARTMENT } from "./master-data";
import type { Project, Role, Task, User } from "./types";

/**
 * Permission matrix from PRD §4.2.
 *
 * The UI uses these helpers to hide/disable actions. In production the same
 * rules must also exist as Supabase Row Level Security policies (§19) — the
 * client checks are convenience, not security.
 */

const GLOBAL_MANAGERS: Role[] = ["super_admin", "admin", "manager"];

export const isSuperAdmin = (u: User) => u.role === "super_admin";
export const isGlobalManager = (u: User) => GLOBAL_MANAGERS.includes(u.role);
export const isTeamLeader = (u: User) => u.role === "team_leader";
export const isFinance = (u: User) => u.departments.includes(FINANCE_DEPARTMENT);

/* ------------------------------------------------------- user management */

export const canAddUsers = (u: User) =>
  ["super_admin", "admin", "hr_admin"].includes(u.role);

export const canEditUsers = canAddUsers;

export const canDeleteUsers = (u: User) => isSuperAdmin(u);

/** Only a Super Admin can grant the Admin role (§4.2). */
export const canAssignAdminRole = (u: User) => isSuperAdmin(u);

export function assignableRoles(u: User): Role[] {
  const base: Role[] = ["manager", "hr_admin", "team_leader", "team_member"];
  return canAssignAdminRole(u) ? ["admin", ...base] : base;
}

/**
 * Seniority for account management (§4.2). Someone may only edit accounts at or
 * below their own level: an HR Admin cannot touch an Admin or a Super Admin,
 * and an Admin cannot touch a Super Admin. Everyone else manages no accounts at
 * all, so their rank never comes into play.
 */
const ACCOUNT_RANK: Record<Role, number> = {
  super_admin: 3,
  admin: 2,
  hr_admin: 1,
  manager: 0,
  team_leader: 0,
  team_member: 0,
};

export const outranksAccount = (actor: Role, target: Role) =>
  ACCOUNT_RANK[actor] >= ACCOUNT_RANK[target];

/** Whether this user may edit that account — name, email, role, password or status. */
export const canEditUser = (u: User, target: User) =>
  canEditUsers(u) && outranksAccount(u.role, target.role);

/** Hard delete stays Super Admin only, and never your own account. */
export const canDeleteUser = (u: User, target: User) =>
  canDeleteUsers(u) && target.id !== u.id;

/* --------------------------------------------------------------- calendar */

export const canManageCalendar = (u: User) =>
  u.role === "super_admin" || u.role === "hr_admin";

/* --------------------------------------------------------------- projects */

export const canCreateProjects = (u: User) => isGlobalManager(u);

export const isProjectLeader = (u: User, p: Project) => p.leaderId === u.id;

/** Global managers edit any project; a Project Leader edits only their own. */
export const canEditProject = (u: User, p: Project) =>
  isGlobalManager(u) || isProjectLeader(u, p);

export const canDeleteProject = (u: User, p: Project) =>
  isGlobalManager(u) || isProjectLeader(u, p);

export const canViewAllProjects = (u: User) =>
  isGlobalManager(u) || isTeamLeader(u);

/**
 * A user can open a project when they can see everything, lead it, or hold at
 * least one task in it — in which case they see *all* of that project's tasks
 * (§4.2, "View projects where user has ≥ 1 task"). Being listed as a team
 * member grants nothing on its own. A Team Leader additionally sees every
 * project their department is working on.
 */
export function canViewProject(u: User, p: Project, tasks: Task[]): boolean {
  if (isGlobalManager(u)) return true;
  if (isProjectLeader(u, p)) return true;
  if (tasks.some((t) => t.projectId === p.id && t.assigneeId === u.id)) return true;
  // A Team Leader follows every project their department is working on, even
  // when none of its tasks is theirs. Seeing it does not make them its
  // reviewer - see canReviewTask.
  return (
    isTeamLeader(u) &&
    tasks.some((t) => t.projectId === p.id && u.departments.includes(t.department))
  );
}

/**
 * The narrower set behind the "My projects" tab: projects this person is
 * personally on, rather than every project their department touches.
 */
export function myProjects(u: User, projects: Project[], tasks: Task[]): Project[] {
  return projects.filter(
    (p) =>
      isProjectLeader(u, p) ||
      tasks.some((t) => t.projectId === p.id && t.assigneeId === u.id),
  );
}

export function visibleProjects(
  u: User,
  projects: Project[],
  tasks: Task[],
): Project[] {
  return projects.filter((p) => canViewProject(u, p, tasks));
}

/* ------------------------------------------------------------ task create */

/** §4.2 "Create tasks in a project" — Team Leaders may create in any project. */
export function canCreateTaskInProject(u: User, p: Project): boolean {
  return isGlobalManager(u) || isProjectLeader(u, p) || isTeamLeader(u);
}

/**
 * Repeating projects and individual tasks are set up by Super Admin, Admin and
 * Manager only — a Project Leader or Team Leader can edit the work but not the
 * repeat rule.
 */
export const canSetRecurrence = (u: User) => isGlobalManager(u);

/** §10 — Project Leaders explicitly cannot create individual tasks. */
export const canManageIndividualTasks = (u: User) =>
  isGlobalManager(u) || isTeamLeader(u);

/* -------------------------------------------------------------- task edit */

/**
 * Full edit (title, dates, assignee, …). Team Leaders may fully edit only the
 * tasks they created themselves (§4.2).
 */
export function canEditTaskFully(
  u: User,
  task: Task,
  project: Project | null,
): boolean {
  if (isGlobalManager(u)) return true;
  if (task.projectId && project && isProjectLeader(u, project)) return true;
  if (isTeamLeader(u) && task.createdBy === u.id) return true;
  return false;
}

export const canDeleteTask = canEditTaskFully;

/** Timer + remarks belong to the assignee alone (§4.2, §9.4). */
export const isAssignee = (u: User, task: Task) => task.assigneeId === u.id;

export const canRunTimer = isAssignee;

/** Assignee-authored remarks for the reviewer; anyone who can see the task reads them. */
export function canAddRemark(
  u: User,
  task: Task,
  project: Project | null,
): boolean {
  return isAssignee(u, task) || canReviewTask(u, task, project);
}

/* ------------------------------------------------------------ task review */

export function canReviewTask(
  u: User,
  task: Task,
  project: Project | null,
): boolean {
  if (isGlobalManager(u)) return true;
  // A Team Leader reviews the work they allotted, wherever it sits - that is
  // the only review right the role carries. Seeing their department's other
  // projects does not extend it.
  if (isTeamLeader(u) && task.createdBy === u.id) return true;
  // Individual tasks otherwise belong to Super Admin, Admin or Manager (§12.2).
  if (task.projectId === null) return false;
  return !!project && isProjectLeader(u, project);
}

/**
 * The "Awaiting my review" queue. Being *allowed* to review something is not the
 * same as it being yours to chase: a Super Admin may review anything in the
 * company, but their queue is the work they allotted themselves plus the
 * projects they lead. Opening someone else's task and reviewing it still works.
 */
export function isMyReviewQueue(u: User, task: Task, project: Project | null): boolean {
  if (!canReviewTask(u, task, project)) return false;
  return task.createdBy === u.id || (!!project && isProjectLeader(u, project));
}

/* -------------------------------------------------------------- task view */

export function canViewTask(
  u: User,
  task: Task,
  project: Project | null,
): boolean {
  if (isGlobalManager(u)) return true;
  if (isAssignee(u, task)) return true;
  if (task.createdBy === u.id) return true;
  if (task.projectId && project) {
    if (isProjectLeader(u, project)) return true;
    // Anyone holding a task in the project sees every task in it.
    return false;
  }
  return false;
}

export function visibleTasks(u: User, tasks: Task[], projects: Project[]) {
  const byId = new Map(projects.map((p) => [p.id, p]));
  // Projects the user has at least one task in → they see all tasks there.
  const openProjectIds = new Set(
    tasks.filter((t) => t.assigneeId === u.id && t.projectId).map((t) => t.projectId!),
  );
  for (const p of projects) {
    if (isProjectLeader(u, p)) openProjectIds.add(p.id);
  }
  return tasks.filter((t) => {
    const project = t.projectId ? byId.get(t.projectId) ?? null : null;
    if (canViewTask(u, t, project)) return true;
    return !!t.projectId && openProjectIds.has(t.projectId);
  });
}

/**
 * What the Tasks page lists. Global managers keep the company-wide view;
 * everyone else — Team Leaders and Project Leaders included — sees only the
 * tasks assigned to them. Wider access still exists where the work needs it:
 * a project's own page lists all of that project's tasks, and reviewers still
 * get their review queue.
 */
export function assignedTaskScope(u: User, tasks: Task[], projects: Project[]): Task[] {
  const visible = visibleTasks(u, tasks, projects);
  return isGlobalManager(u) ? visible : visible.filter((t) => t.assigneeId === u.id);
}

/* --------------------------------------------------------------- expenses */

/** Only the Project Leader of the project adds expenses (§4.2, §8). */
export const canAddExpense = (u: User, p: Project) => isProjectLeader(u, p);

/** Accounts & Finance department members approve or reject (§4.1). */
export const canReviewExpense = (u: User) => isFinance(u);

export const canViewExpenses = (u: User, p: Project, tasks: Task[]) =>
  isFinance(u) || canViewProject(u, p, tasks);

/* -------------------------------------------------------------- templates */

export const canManageTemplates = (u: User) =>
  u.role === "super_admin" || u.role === "admin";

/* -------------------------------------------------- workload & reporting */

export const canViewWorkload = (u: User) => isGlobalManager(u) || isTeamLeader(u);

export const canViewReports = canViewWorkload;

/** Departments a user may slice workload/reports by; null → all departments. */
export function scopedDepartments(u: User): string[] | null {
  if (isGlobalManager(u)) return null;
  if (isTeamLeader(u)) return u.departments;
  return [];
}

/* ---------------------------------------------------------------- vendors */

export const canManageVendors = (u: User) => isGlobalManager(u) || isFinance(u);

/* ---------------------------------------------------- operational links */

/** Super Admin, Admin and Manager manage links; everyone else reads them. */
export const canManageLinks = (u: User) => isGlobalManager(u);

/* ------------------------------------------------------------ navigation */

export interface NavGate {
  projects: boolean;
  tasks: boolean;
  individualTasks: boolean;
  expenses: boolean;
  templates: boolean;
  workload: boolean;
  vendors: boolean;
  reports: boolean;
  users: boolean;
  calendar: boolean;
  links: boolean;
  recurrence: boolean;
}

export function navGate(u: User): NavGate {
  return {
    projects: true,
    tasks: true,
    individualTasks: true,
    expenses: true,
    templates: canManageTemplates(u),
    workload: canViewWorkload(u),
    vendors: canManageVendors(u),
    reports: canViewReports(u),
    users: canAddUsers(u),
    calendar: true,
    links: true,
    // Everyone can see what repeats; only managers can change it.
    recurrence: true,
  };
}
