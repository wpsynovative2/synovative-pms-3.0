"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { use, useMemo, useState } from "react";
import {
  AttachmentLink,
  ExpenseFormModal,
  ExpenseReviewModal,
} from "@/components/expense/expense-dialogs";
import { CollabPanel } from "@/components/collab/collab-panel";
import { ContentDetail, ContentLinkRow } from "@/components/content/content-view";
import { ProjectFormModal } from "@/components/project/project-form";
import { TaskDetailDrawer } from "@/components/task/task-detail";
import { RecurrenceBadge } from "@/components/task/task-bits";
import { TaskFormModal } from "@/components/task/task-form";
import {
  TaskFilters,
  TaskListCard,
  TaskTimeline,
  applyTaskFilters,
  emptyTaskFilters,
} from "@/components/task/task-list";
import {
  IconArrowLeft,
  IconCheck,
  IconChart,
  IconClock,
  IconBuilding,
  IconComment,
  IconContact,
  IconContent,
  IconProperty,
  IconQuote,
  IconEdit,
  IconPlus,
  IconTasks,
  IconTrash,
  IconUsers,
  IconWallet,
} from "@/components/ui/icons";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ProgressBar,
  StatTile,
  Tabs,
  cx,
} from "@/components/ui/primitives";
import { RichText, isRichTextEmpty } from "@/components/ui/rich-text";
import { formatINR, projectStats } from "@/lib/analytics";
import { formatDate, formatDateTime, snapToWorkingDay } from "@/lib/calendar";
import { describeRule, upcomingOccurrences } from "@/lib/recurrence";
import {
  EXPENSE_STATUS_STYLE,
  PRIORITY_STYLE,
  PROJECT_STATUS_STYLE,
  TASK_STATUS_STYLE,
} from "@/lib/master-data";
import {
  canAddExpense,
  canCreateTaskInProject,
  canDeleteProject,
  canEditProject,
  canReviewExpense,
  canViewProject,
  isMyReviewQueue,
} from "@/lib/permissions";
import { useStore } from "@/lib/store";
import { formatDuration, taskElapsedMs } from "@/lib/time";
import type { Expense, TaskStatus } from "@/lib/types";

/** One hop of the Company → Client → Property → OBC chain behind a project. */
interface CrmLink {
  kind: string;
  label: string;
  href: string;
  icon: React.ReactNode;
}

type TabId =
  | "overview"
  | "tasks"
  | "content"
  | "time"
  | "expenses"
  | "team"
  | "collab"
  | "activity";
type TaskScope = "all" | "review" | "under-review";

/** Work handed in and waiting on a reviewer or the client. */
const UNDER_REVIEW: TaskStatus[] = ["Submitted", "Waiting for Client Response"];

export default function ProjectDetailPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    db,
    currentUser,
    projectById,
    userById,
    vendorById,
    companyById,
    clientById,
    propertyById,
    obcById,
    deleteProject,
  } = useStore();
  const user = currentUser!;

  const project = projectById(id);
  const [tab, setTab] = useState<TabId>("overview");
  const [openContentId, setOpenContentId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(
    searchParams.get("task"),
  );
  const [editOpen, setEditOpen] = useState(false);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [expenseFormOpen, setExpenseFormOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [reviewingExpense, setReviewingExpense] = useState<Expense | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [filters, setFilters] = useState(emptyTaskFilters);
  const [taskScope, setTaskScope] = useState<TaskScope>("all");

  const tasks = useMemo(
    () => db.tasks.filter((t) => t.projectId === id),
    [db.tasks, id],
  );
  const expenses = useMemo(
    () => db.expenses.filter((e) => e.projectId === id),
    [db.expenses, id],
  );
  const content = useMemo(
    () => db.contentEntries.filter((e) => e.projectId === id),
    [db.contentEntries, id],
  );

  const stats = useMemo(
    () => (project ? projectStats(project, db.tasks, db.expenses) : null),
    [project, db.tasks, db.expenses],
  );

  const tags = useMemo(
    () => Array.from(new Set(tasks.flatMap((t) => t.tags))).sort(),
    [tasks],
  );

  if (!project || !stats) {
    return (
      <Card>
        <EmptyState
          title="Project not found"
          body="It may have been deleted."
          action={
            <Button onClick={() => router.push("/projects")}>Back to projects</Button>
          }
        />
      </Card>
    );
  }

  if (!canViewProject(user, project, db.tasks)) {
    return (
      <Card>
        <EmptyState
          title="You don't have access to this project"
          body="You can open a project when you lead it or hold at least one task in it."
          action={<Button onClick={() => router.push("/projects")}>Back to projects</Button>}
        />
      </Card>
    );
  }

  const company = companyById(project.companyId);
  const client = clientById(project.clientId);
  const property = propertyById(project.propertyId);
  const obc = obcById(project.obcId);

  // Only a project converted from an OBC carries a chain; anything raised by
  // hand shows nothing here rather than a row of blanks.
  const crmChain: CrmLink[] = [];
  if (company) {
    crmChain.push({
      kind: "Company",
      label: company.name,
      href: `/companies?company=${company.id}`,
      icon: <IconBuilding size={14} />,
    });
  }
  if (client) {
    crmChain.push({
      kind: "Client",
      label: client.fullName,
      href: `/clients?client=${client.id}`,
      icon: <IconContact size={14} />,
    });
  }
  if (property) {
    crmChain.push({
      kind: "Property",
      label: property.name,
      href: `/properties?property=${property.id}`,
      icon: <IconProperty size={14} />,
    });
  }
  if (obc) {
    crmChain.push({
      kind: "OBC",
      label: obc.code,
      href: `/obcs?obc=${obc.id}`,
      icon: <IconQuote size={14} />,
    });
  }

  const leader = userById(project.leaderId);
  const members = project.memberIds.map((mid) => userById(mid)).filter(Boolean);
  const mayEdit = canEditProject(user, project);
  const mayDelete = canDeleteProject(user, project);
  const mayCreateTask = canCreateTaskInProject(user, project);
  const mayAddExpense = canAddExpense(user, project);
  const mayReviewExpense = canReviewExpense(user);

  // Repeating series (source) or one of its generated copies.
  const series = project.recurrence;
  const nextOccurrence = series
    ? upcomingOccurrences(series.rule, series.anchor, series.cursor, 1)[0]
    : undefined;
  const seriesSource = project.series
    ? db.projects.find((p) => p.id === project.series!.sourceId)
    : undefined;

  const underReview = tasks.filter((t) => UNDER_REVIEW.includes(t.status));
  const forReview = underReview.filter((t) => isMyReviewQueue(user, t, project));
  const scopedTasks =
    taskScope === "review" ? forReview : taskScope === "under-review" ? underReview : tasks;
  const filteredTasks = applyTaskFilters(scopedTasks, filters);

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/projects"
        className="inline-flex w-fit items-center gap-1.5 text-[12px] text-ink-muted transition-colors hover:text-ink"
      >
        <IconArrowLeft size={14} /> Back to Projects
      </Link>

      {/* Header (§7.2) */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start gap-4">
          <span
            className="h-12 w-12 shrink-0 rounded-xl"
            style={{ background: project.color }}
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">
              {project.name}
            </h1>
            <p className="mt-0.5 text-[13px] text-ink-muted">{project.clientName}</p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Badge className={PROJECT_STATUS_STYLE[project.status]}>{project.status}</Badge>
              <Badge className={PRIORITY_STYLE[project.priority]}>{project.priority}</Badge>
              <RecurrenceBadge item={project} />
              {stats.overdueTasks > 0 ? (
                <Badge className="border-st-rejected/40 bg-st-rejected/20 text-st-rejected">
                  {stats.overdueTasks} overdue
                </Badge>
              ) : null}
              <Badge>
                {formatDate(project.startDate)} → {formatDate(project.deadline)}
              </Badge>
            </div>
            {series ? (
              <p className="mt-2.5 text-[12px] text-ink-muted">
                Repeats {describeRule(series.rule, series.anchor).replace(/^./, (c) => c.toLowerCase())}.{" "}
                {nextOccurrence ? (
                  <span className="text-ink-faint">
                    Next copy on {formatDate(snapToWorkingDay(nextOccurrence.date, db.calendar))}{" "}
                    (repeat #{nextOccurrence.index}).
                  </span>
                ) : (
                  <span className="text-ink-faint">No more repeats to come.</span>
                )}
              </p>
            ) : project.series ? (
              <p className="mt-2.5 text-[12px] text-ink-muted">
                Repeat #{project.series.index} of{" "}
                {seriesSource ? (
                  <Link
                    href={`/projects/${seriesSource.id}`}
                    className="text-brand-ink hover:underline"
                  >
                    {seriesSource.name}
                  </Link>
                ) : (
                  "a series whose original was deleted"
                )}
                .
              </p>
            ) : null}
          </div>

          <div className="flex flex-col items-end gap-3">
            <div className="flex items-center gap-2">
              {mayEdit ? (
                <Button onClick={() => setEditOpen(true)}>
                  <IconEdit size={14} /> Edit project
                </Button>
              ) : null}
              {mayDelete ? (
                <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                  <IconTrash size={14} />
                </Button>
              ) : null}
            </div>
            {leader ? (
              <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2">
                <Avatar name={leader.fullName} size={26} />
                <div className="text-right">
                  <div className="text-[10px] tracking-wide text-ink-faint uppercase">
                    Project Leader
                  </div>
                  <div className="text-[12px] font-medium text-ink">{leader.fullName}</div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Progress + total time (§7.2) */}
        <div className="mt-5 grid gap-4 border-t border-line-soft pt-4 sm:grid-cols-[2fr_1fr]">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-[12px]">
              <span className="text-ink-muted">
                Progress — {stats.approvedTasks} of {stats.totalTasks} tasks approved
              </span>
              <span className="font-mono text-ink">{stats.progress}%</span>
            </div>
            <ProgressBar
              value={stats.progress}
              className="h-2"
              barClassName={cx(stats.progress === 100 ? "bg-st-approved" : "bg-brand-bright")}
            />
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
              {Object.entries(stats.byStatus)
                .filter(([, n]) => n > 0)
                .map(([status, n]) => (
                  <span key={status} className="inline-flex items-center gap-1.5 text-ink-muted">
                    <span
                      className={cx(
                        "h-2 w-2 rounded-full",
                        TASK_STATUS_STYLE[status as keyof typeof TASK_STATUS_STYLE].dot,
                      )}
                    />
                    {status}: {n}
                  </span>
                ))}
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3">
            <IconClock size={18} className="text-ink-faint" />
            <div>
              <div className="text-[10px] tracking-wide text-ink-faint uppercase">
                Total time spent
              </div>
              <div className="font-mono text-lg text-ink">
                {formatDuration(stats.totalTimeMs)}
              </div>
              <div className="text-[10px] text-ink-faint">
                {stats.estimatedHours}h estimated
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Tabs<TabId>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview", icon: <IconChart size={14} /> },
          { id: "tasks", label: "Tasks", icon: <IconTasks size={14} />, count: tasks.length },
          {
            id: "content",
            label: "Content Bank",
            icon: <IconContent size={14} />,
            count: content.length,
          },
          { id: "time", label: "Time", icon: <IconClock size={14} /> },
          {
            id: "expenses",
            label: "Expenses",
            icon: <IconWallet size={14} />,
            count: expenses.length,
          },
          {
            id: "team",
            label: "Team",
            icon: <IconUsers size={14} />,
            count: members.length + 1,
          },
          { id: "collab", label: "Comments & MOM", icon: <IconComment size={14} /> },
          { id: "activity", label: "Activity", icon: <IconCheck size={14} /> },
        ]}
      />

      {/* ---------------------------------------------------------- Overview */}
      {tab === "overview" ? (
        <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
          <div className="flex flex-col gap-5">
            <Card>
              <CardHeader title="Description" />
              <div className="px-5 py-4">
                {isRichTextEmpty(project.description) ? (
                  <p className="text-[13px] text-ink-faint">No description added.</p>
                ) : (
                  <RichText html={project.description} />
                )}
              </div>
            </Card>

            {crmChain.length ? (
              <Card>
                <CardHeader
                  title="Where this came from"
                  subtitle="The CRM record behind the work"
                />
                <ul className="flex flex-col gap-1.5 px-5 py-4">
                  {crmChain.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="flex items-center gap-2.5 rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-[12px] hover:border-brand-bright/40"
                      >
                        {link.icon}
                        <span className="min-w-0 flex-1 truncate text-ink">{link.label}</span>
                        <span className="shrink-0 text-ink-faint">{link.kind}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            <Card>
              <CardHeader
                title="Requirements / Services"
                subtitle={`${project.services.length} selected`}
              />
              <div className="flex flex-wrap gap-1.5 px-5 py-4">
                {project.services.map((s) => (
                  <Badge key={s}>{s}</Badge>
                ))}
              </div>
            </Card>

            <Card>
              <CardHeader
                title="Task timeline"
                subtitle="Creation order — first created, first shown"
                action={
                  mayCreateTask ? (
                    <Button size="sm" variant="primary" onClick={() => setTaskFormOpen(true)}>
                      <IconPlus size={13} /> Create task
                    </Button>
                  ) : null
                }
              />
              <div className="px-5 pb-3">
                <TaskTimeline tasks={tasks} onOpen={setOpenTaskId} />
              </div>
            </Card>
          </div>

          <div className="flex flex-col gap-3">
            <StatTile
              icon={<IconTasks size={17} />}
              label="Tasks"
              value={stats.totalTasks}
              hint={`${stats.approvedTasks} approved · ${stats.overdueTasks} overdue`}
              tone="brand"
            />
            <StatTile
              icon={<IconClock size={17} />}
              label="Time spent"
              value={formatDuration(stats.totalTimeMs)}
              hint={`vs ${stats.estimatedHours}h estimated`}
              tone="blue"
            />
            <StatTile
              icon={<IconWallet size={17} />}
              label="Approved spend"
              value={formatINR(stats.approvedExpenses)}
              hint={`${formatINR(stats.pendingExpenses)} pending verification`}
              tone="green"
            />
            <StatTile
              icon={<IconUsers size={17} />}
              label="Team size"
              value={members.length + 1}
              hint="Leader + members"
              tone="neutral"
            />

            <Card>
              <CardHeader title="Team members" />
              <ul className="divide-y divide-line-soft">
                {leader ? (
                  <li className="flex items-center gap-2.5 px-4 py-3">
                    <Avatar name={leader.fullName} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-ink">{leader.fullName}</div>
                      <div className="text-[11px] text-ink-faint">{leader.email}</div>
                    </div>
                    <Badge className="border-brand-bright/30 bg-brand/20 text-brand-ink">
                      Leader
                    </Badge>
                  </li>
                ) : null}
                {members.map((m) => (
                  <li key={m!.id} className="flex items-center gap-2.5 px-4 py-3">
                    <Avatar name={m!.fullName} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-ink">{m!.fullName}</div>
                      <div className="truncate text-[11px] text-ink-faint">
                        {m!.departments[0]}
                      </div>
                    </div>
                  </li>
                ))}
                {members.length === 0 ? (
                  <li className="px-4 py-6 text-center text-[12px] text-ink-faint">
                    No additional members.
                  </li>
                ) : null}
              </ul>
            </Card>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------------- Tasks */}
      {tab === "tasks" ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-ink-muted">
              {filteredTasks.length} of {scopedTasks.length} task
              {scopedTasks.length === 1 ? "" : "s"}
            </p>
            {mayCreateTask ? (
              <Button variant="primary" onClick={() => setTaskFormOpen(true)}>
                <IconPlus size={15} /> Create task
              </Button>
            ) : null}
          </div>

          <Tabs<TaskScope>
            active={taskScope}
            onChange={setTaskScope}
            tabs={[
              { id: "all", label: "All tasks", count: tasks.length },
              { id: "review", label: "Awaiting my review", count: forReview.length },
              { id: "under-review", label: "All under review", count: underReview.length },
            ]}
          />

          <TaskFilters
            value={filters}
            onChange={setFilters}
            users={db.users}
            tags={tags}
          />

          <TaskListCard
            tasks={filteredTasks}
            onOpen={setOpenTaskId}
            showProject={false}
            emptyTitle={tasks.length === 0 ? "No tasks yet" : "No tasks match these filters"}
            emptyBody={
              tasks.length === 0
                ? "Tasks will appear here once they're added to this project."
                : undefined
            }
          />
        </div>
      ) : null}

      {/* -------------------------------------------------------------- Time */}
      {tab === "time" ? (
        <Card>
          <CardHeader
            title="Time by task"
            subtitle={`${formatDuration(stats.totalTimeMs)} logged across ${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
          />
          {tasks.length === 0 ? (
            <EmptyState icon={<IconClock size={28} />} title="Nothing logged yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-[12px]">
                <thead className="bg-surface-2 text-[10px] tracking-wide text-ink-faint uppercase">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Task</th>
                    <th className="px-4 py-2.5 font-medium">Assignee</th>
                    <th className="px-4 py-2.5 font-medium">Estimated</th>
                    <th className="px-4 py-2.5 font-medium">Actual</th>
                    <th className="px-4 py-2.5 font-medium">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {[...tasks]
                    .sort((a, b) => taskElapsedMs(b) - taskElapsedMs(a))
                    .map((t) => {
                      const ms = taskElapsedMs(t);
                      const actual = ms / 3_600_000;
                      const variance = actual - t.estimatedHours;
                      return (
                        <tr
                          key={t.id}
                          className="cursor-pointer border-t border-line-soft hover:bg-surface-2"
                          onClick={() => setOpenTaskId(t.id)}
                        >
                          <td className="max-w-72 truncate px-4 py-2.5 text-ink">
                            {t.title}
                          </td>
                          <td className="px-4 py-2.5 text-ink-muted">
                            {userById(t.assigneeId)?.fullName ?? "—"}
                          </td>
                          <td className="px-4 py-2.5 text-ink-muted">
                            {t.estimatedHours}h
                          </td>
                          <td className="px-4 py-2.5 font-mono text-ink">
                            {formatDuration(ms)}
                          </td>
                          <td
                            className={cx(
                              "px-4 py-2.5 font-mono",
                              variance > 0 ? "text-st-rejected" : "text-st-approved",
                            )}
                          >
                            {variance > 0 ? "+" : ""}
                            {Math.round(variance * 10) / 10}h
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {/* ---------------------------------------------------------- Expenses */}
      {tab === "expenses" ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile
              label="Approved"
              value={formatINR(stats.approvedExpenses)}
              tone="green"
              icon={<IconCheck size={17} />}
            />
            <StatTile
              label="Pending verification"
              value={formatINR(stats.pendingExpenses)}
              tone="amber"
              icon={<IconWallet size={17} />}
            />
            <StatTile
              label="Rejected"
              value={formatINR(stats.rejectedExpenses)}
              tone="red"
              icon={<IconWallet size={17} />}
            />
          </div>

          <Card>
            <CardHeader
              title="Project expenses"
              subtitle="Added by the Project Leader, verified by Accounts & Finance"
              action={
                mayAddExpense ? (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      setEditingExpense(null);
                      setExpenseFormOpen(true);
                    }}
                  >
                    <IconPlus size={13} /> Add expense
                  </Button>
                ) : null
              }
            />
            {expenses.length === 0 ? (
              <EmptyState
                icon={<IconWallet size={28} />}
                title="No expenses recorded"
                body={
                  mayAddExpense
                    ? "Add outside vendor costs — drone shoots, models, printing — here."
                    : "Only the Project Leader can add expenses to this project."
                }
              />
            ) : (
              <ul className="divide-y divide-line-soft">
                {expenses.map((e) => {
                  const vendor = vendorById(e.vendorId);
                  const reviewer = e.reviewedBy ? userById(e.reviewedBy) : null;
                  return (
                    <li key={e.id} className="px-4 py-3.5">
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[13px] font-medium text-ink">
                              {e.description}
                            </span>
                            <Badge className={EXPENSE_STATUS_STYLE[e.status]}>
                              {e.status}
                            </Badge>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-faint">
                            <span>{vendor?.name ?? "Unknown vendor"}</span>
                            <span>{formatDate(e.expenseDate)}</span>
                            {e.attachmentName ? (
                              <AttachmentLink name={e.attachmentName} url={e.attachmentUrl} />
                            ) : null}
                            {reviewer && e.reviewedAt ? (
                              <span>
                                {e.status} by {reviewer.fullName} on{" "}
                                {formatDate(e.reviewedAt.slice(0, 10))}
                              </span>
                            ) : null}
                          </div>
                          {e.financeRemarks ? (
                            <p className="mt-2 rounded-lg border border-st-rejected/25 bg-st-rejected/10 px-2.5 py-1.5 text-[11px] text-st-rejected">
                              {e.financeRemarks}
                            </p>
                          ) : null}
                        </div>

                        <span className="shrink-0 font-mono text-[14px] text-ink">
                          {formatINR(e.amount)}
                        </span>

                        <div className="flex shrink-0 items-center gap-1.5">
                          {mayReviewExpense && e.status === "Pending" ? (
                            <Button size="sm" variant="primary" onClick={() => setReviewingExpense(e)}>
                              Verify
                            </Button>
                          ) : null}
                          {mayAddExpense && e.status === "Pending" ? (
                            <Button
                              size="sm"
                              onClick={() => {
                                setEditingExpense(e);
                                setExpenseFormOpen(true);
                              }}
                            >
                              <IconEdit size={13} />
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      ) : null}

      {/* --------------------------------------------------------------- Team */}
      {tab === "team" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[leader, ...members].filter(Boolean).map((m) => {
            const theirTasks = tasks.filter((t) => t.assigneeId === m!.id);
            const done = theirTasks.filter((t) => t.status === "Approved").length;
            return (
              <Card key={m!.id} className="p-4">
                <div className="flex items-center gap-3">
                  <Avatar name={m!.fullName} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-ink">
                      {m!.fullName}
                    </div>
                    <div className="truncate text-[11px] text-ink-faint">{m!.email}</div>
                  </div>
                  {m!.id === project.leaderId ? (
                    <Badge className="border-brand-bright/30 bg-brand/20 text-brand-ink">
                      Leader
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {m!.departments.map((d) => (
                    <Badge key={d}>{d}</Badge>
                  ))}
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line-soft pt-3 text-[11px]">
                  <div>
                    <dt className="text-ink-faint">Tasks</dt>
                    <dd className="mt-0.5 text-[13px] text-ink">{theirTasks.length}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">Approved</dt>
                    <dd className="mt-0.5 text-[13px] text-st-approved">{done}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">Time</dt>
                    <dd className="mt-0.5 font-mono text-[13px] text-ink">
                      {formatDuration(
                        theirTasks.reduce((s, t) => s + taskElapsedMs(t), 0),
                      )}
                    </dd>
                  </div>
                </dl>
              </Card>
            );
          })}
        </div>
      ) : null}

      {/* ------------------------------------------------------ Content Bank */}
      {tab === "content" ? (
        <Card>
          <CardHeader
            title="Content Bank"
            subtitle="Written by the Content Writers on this project; everyone here can read it"
          />
          <div className="px-5 py-4">
            {content.length === 0 ? (
              <EmptyState
                icon={<IconContent size={28} />}
                title="No content written yet"
                body="Pieces filed against this project's tasks appear here."
              />
            ) : (
              <ul className="grid gap-2 md:grid-cols-2">
                {content.map((entry) => (
                  <li key={entry.id}>
                    <ContentLinkRow entry={entry} onOpen={() => setOpenContentId(entry.id)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      ) : null}

      {/* -------------------------------------------------- Comments & MOM */}
      {tab === "collab" ? <CollabPanel entityType="project" entityId={project.id} /> : null}

      {/* ----------------------------------------------------------- Activity */}
      {tab === "activity" ? (
        <Card>
          <CardHeader title="Activity" subtitle="Every submission and review on this project" />
          <ProjectActivity projectId={project.id} onOpen={setOpenTaskId} />
        </Card>
      ) : null}

      {/* Modals */}
      {openContentId && content.some((e) => e.id === openContentId) ? (
        <Modal
          open
          onClose={() => setOpenContentId(null)}
          size="lg"
          title={(() => {
            const entry = content.find((e) => e.id === openContentId)!;
            return entry.caption.trim() || entry.type;
          })()}
          subtitle="From the Content Bank"
        >
          <ContentDetail entry={content.find((e) => e.id === openContentId)!} />
        </Modal>
      ) : null}

      {editOpen ? (
        <ProjectFormModal open onClose={() => setEditOpen(false)} project={project} />
      ) : null}

      {taskFormOpen ? (
        <TaskFormModal
          open
          onClose={() => setTaskFormOpen(false)}
          project={project}
          mode="project"
        />
      ) : null}

      {expenseFormOpen ? (
        <ExpenseFormModal
          open
          onClose={() => {
            setExpenseFormOpen(false);
            setEditingExpense(null);
          }}
          project={project}
          expense={editingExpense ?? undefined}
        />
      ) : null}

      {reviewingExpense ? (
        <ExpenseReviewModal
          open
          onClose={() => setReviewingExpense(null)}
          expense={reviewingExpense}
        />
      ) : null}

      {openTaskId ? (
        <TaskDetailDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          deleteProject(project.id);
          router.push("/projects");
        }}
        title="Delete this project?"
        body={
          series
            ? "Its tasks, time logs and expenses are removed too, and the series stops repeating. Copies already created are kept. This cannot be undone."
            : "Its tasks, time logs and expenses are removed too. This cannot be undone."
        }
      />
    </div>
  );
}

function ProjectActivity({
  projectId,
  onOpen,
}: {
  projectId: string;
  onOpen: (id: string) => void;
}) {
  const { db, userById } = useStore();

  const events = useMemo(() => {
    const list: {
      id: string;
      taskId: string;
      taskTitle: string;
      label: string;
      tone: string;
      at: string;
      who: string;
      detail?: string;
    }[] = [];
    for (const t of db.tasks.filter((x) => x.projectId === projectId)) {
      for (const s of t.submissions) {
        list.push({
          id: s.id,
          taskId: t.id,
          taskTitle: t.title,
          label: "Submitted",
          tone: "text-st-submitted",
          at: s.at,
          who: userById(s.byUserId)?.fullName ?? "Someone",
          detail: s.outputLocation,
        });
      }
      for (const r of t.reviews) {
        list.push({
          id: r.id,
          taskId: t.id,
          taskTitle: t.title,
          label: r.decision,
          tone:
            r.decision === "Approved"
              ? "text-st-approved"
              : r.decision === "Rejected"
                ? "text-st-rejected"
                : "text-st-changes",
          at: r.at,
          who: userById(r.byUserId)?.fullName ?? "Someone",
          detail: r.source ? `Source: ${r.source}` : undefined,
        });
      }
    }
    return list.sort((a, b) => b.at.localeCompare(a.at));
  }, [db.tasks, projectId, userById]);

  if (events.length === 0) {
    return <EmptyState icon={<IconCheck size={28} />} title="No activity yet" />;
  }

  return (
    <ol className="relative space-y-3 px-5 py-5 pl-12">
      <span className="absolute top-6 bottom-6 left-[27px] w-px bg-line" />
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute top-3 -left-7 h-3 w-3 rounded-full border-2 border-surface bg-surface-3" />
          <button
            onClick={() => onOpen(e.taskId)}
            className="w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-3"
          >
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className={cx("text-[12px] font-semibold", e.tone)}>{e.label}</span>
              <span className="text-[11px] text-ink-muted">by {e.who}</span>
              <span className="ml-auto text-[10px] text-ink-faint">
                {formatDateTime(e.at)}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[12px] text-ink">{e.taskTitle}</div>
            {e.detail ? (
              <div className="mt-0.5 text-[10px] text-ink-faint">{e.detail}</div>
            ) : null}
          </button>
        </li>
      ))}
    </ol>
  );
}
