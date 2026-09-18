"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TaskDetailDrawer } from "@/components/task/task-detail";
import { TaskRow } from "@/components/task/task-list";
import {
  IconCheck,
  IconClock,
  IconProjects,
  IconSend,
  IconTasks,
  IconWallet,
  IconWarning,
} from "@/components/ui/icons";
import {
  Avatar,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  ProgressBar,
  StatTile,
  cx,
} from "@/components/ui/primitives";
import { formatINR, isOverdue, projectStats } from "@/lib/analytics";
import { addDays, formatShortDate, todayISO } from "@/lib/calendar";
import { PROJECT_STATUS_STYLE, TASK_STATUS_STYLE } from "@/lib/master-data";
import {
  canReviewExpense,
  isFinance,
  isMyReviewQueue,
  visibleProjects,
  visibleTasks,
} from "@/lib/permissions";
import { useStore } from "@/lib/store";
import { formatDuration, taskElapsedMs } from "@/lib/time";

export default function DashboardPage() {
  const { db, currentUser, projectById } = useStore();
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const user = currentUser!;

  const today = todayISO();
  const weekEnd = addDays(today, 7);

  const myTasks = useMemo(
    () => db.tasks.filter((t) => t.assigneeId === user.id),
    [db.tasks, user.id],
  );

  const myOpen = myTasks.filter((t) => t.status !== "Approved");
  const dueSoon = myOpen
    .filter((t) => t.dueDate >= today && t.dueDate <= weekEnd)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const overdue = myOpen.filter(isOverdue).sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const scopedProjects = useMemo(
    () => visibleProjects(user, db.projects, db.tasks),
    [user, db.projects, db.tasks],
  );
  const scopedTasks = useMemo(
    () => visibleTasks(user, db.tasks, db.projects),
    [user, db.tasks, db.projects],
  );

  /**
   * Submissions this user is entitled to review (§12.2), including work parked
   * with the client that they need to come back and settle.
   */
  const awaitingMyReview = useMemo(
    () =>
      db.tasks.filter(
        (t) =>
          (t.status === "Submitted" || t.status === "Waiting for Client Response") &&
          isMyReviewQueue(user, t, t.projectId ? (projectById(t.projectId) ?? null) : null),
      ),
    [db.tasks, user, projectById],
  );

  const pendingExpenses = useMemo(
    () => (isFinance(user) ? db.expenses.filter((e) => e.status === "Pending") : []),
    [db.expenses, user],
  );

  const timeThisWeek = myTasks.reduce((sum, t) => {
    return (
      sum +
      t.sessions.reduce((acc, s) => {
        const day = s.startedAt.slice(0, 10);
        if (day < addDays(today, -7) || day > today) return acc;
        const end = s.endedAt ? new Date(s.endedAt).getTime() : Date.now();
        return acc + Math.max(0, end - new Date(s.startedAt).getTime());
      }, 0)
    );
  }, 0);

  const activeProjects = scopedProjects
    .filter((p) => p.status === "Active" || p.status === "Planning")
    .slice(0, 4);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${greeting}, ${user.fullName.split(" ")[0]}`}
        subtitle={
          myOpen.length === 0
            ? "You're all clear — nothing open on your plate."
            : `${myOpen.length} open task${myOpen.length === 1 ? "" : "s"}${
                overdue.length ? ` · ${overdue.length} overdue` : ""
              }`
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={<IconTasks size={17} />}
          label="Open tasks"
          value={myOpen.length}
          hint={`${dueSoon.length} due in the next 7 days`}
          tone="brand"
        />
        <StatTile
          icon={<IconClock size={17} />}
          label="Your time this week"
          value={formatDuration(timeThisWeek)}
          hint={`${formatDuration(myTasks.reduce((s, t) => s + taskElapsedMs(t), 0))} all-time`}
          tone="blue"
        />
        <StatTile
          icon={<IconWarning size={17} />}
          label="Overdue"
          value={overdue.length}
          hint={overdue.length ? "Needs attention today" : "Nothing overdue"}
          tone={overdue.length ? "red" : "neutral"}
        />
        {canReviewExpense(user) ? (
          <StatTile
            icon={<IconWallet size={17} />}
            label="Expenses to verify"
            value={pendingExpenses.length}
            hint={formatINR(pendingExpenses.reduce((s, e) => s + e.amount, 0))}
            tone="amber"
          />
        ) : (
          <StatTile
            icon={<IconCheck size={17} />}
            label="Awaiting your review"
            value={awaitingMyReview.length}
            hint={awaitingMyReview.length ? "Submissions in the queue" : "Queue is clear"}
            tone={awaitingMyReview.length ? "amber" : "green"}
          />
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <div className="flex flex-col gap-5">
          {overdue.length ? (
            <Card className="border-st-rejected/30">
              <CardHeader
                title={
                  <span className="flex items-center gap-2 text-st-rejected">
                    <IconWarning size={15} /> Overdue
                  </span>
                }
                subtitle="Past the due date and not yet approved"
              />
              <div>
                {overdue.slice(0, 4).map((t) => (
                  <TaskRow key={t.id} task={t} onOpen={setOpenTaskId} />
                ))}
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Your week"
              subtitle="Tasks due in the next seven days"
              action={
                <Link
                  href="/tasks"
                  className="text-[12px] text-brand-bright hover:underline"
                >
                  All tasks
                </Link>
              }
            />
            {dueSoon.length === 0 ? (
              <EmptyState
                icon={<IconCheck size={26} />}
                title="Nothing due this week"
                body="Enjoy the breathing room — or pull something forward."
              />
            ) : (
              <div>
                {dueSoon.slice(0, 6).map((t) => (
                  <TaskRow key={t.id} task={t} onOpen={setOpenTaskId} />
                ))}
              </div>
            )}
          </Card>

          {awaitingMyReview.length ? (
            <Card>
              <CardHeader
                title="Awaiting your review"
                subtitle="Submitted work waiting on a decision"
                action={<Badge className="border-st-submitted/30 bg-st-submitted/15 text-st-submitted">{awaitingMyReview.length}</Badge>}
              />
              <div>
                {awaitingMyReview.slice(0, 5).map((t) => (
                  <TaskRow key={t.id} task={t} onOpen={setOpenTaskId} />
                ))}
              </div>
            </Card>
          ) : null}

          {pendingExpenses.length ? (
            <Card>
              <CardHeader
                title="Expenses to verify"
                subtitle="Submitted by project leaders, awaiting Accounts & Finance"
                action={
                  <Link href="/expenses" className="text-[12px] text-brand-bright hover:underline">
                    Open expenses
                  </Link>
                }
              />
              <ul>
                {pendingExpenses.slice(0, 4).map((e) => {
                  const project = projectById(e.projectId);
                  return (
                    <li
                      key={e.id}
                      className="flex items-center gap-3 border-b border-line-soft px-4 py-3 last:border-0"
                    >
                      <IconWallet size={16} className="shrink-0 text-st-submitted" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] text-ink">{e.description}</div>
                        <div className="text-[11px] text-ink-faint">
                          {project?.name ?? "—"} · {formatShortDate(e.expenseDate)}
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-[13px] text-ink">
                        {formatINR(e.amount)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader
              title="Active projects"
              subtitle={`${scopedProjects.length} project${scopedProjects.length === 1 ? "" : "s"} in your scope`}
              action={
                <Link href="/projects" className="text-[12px] text-brand-bright hover:underline">
                  View all
                </Link>
              }
            />
            {activeProjects.length === 0 ? (
              <EmptyState
                icon={<IconProjects size={26} />}
                title="No active projects"
                body="Projects you lead or hold a task in will show up here."
              />
            ) : (
              <ul className="divide-y divide-line-soft">
                {activeProjects.map((p) => {
                  const stats = projectStats(p, db.tasks, db.expenses);
                  return (
                    <li key={p.id}>
                      <Link
                        href={`/projects/${p.id}`}
                        className="block px-4 py-3.5 transition-colors hover:bg-surface-2"
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-[4px]"
                            style={{ background: p.color }}
                          />
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                            {p.name}
                          </span>
                          <Badge className={PROJECT_STATUS_STYLE[p.status]}>{p.status}</Badge>
                        </div>
                        <div className="mt-2 flex items-center gap-2.5">
                          <ProgressBar
                            value={stats.progress}
                            barClassName={cx(stats.progress === 100 ? "bg-st-approved" : "bg-brand-bright")}
                          />
                          <span className="shrink-0 font-mono text-[11px] text-ink-muted">
                            {stats.progress}%
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-ink-faint">
                          <span>{p.clientName}</span>
                          <span>
                            {stats.approvedTasks}/{stats.totalTasks} approved
                          </span>
                          <span>Due {formatShortDate(p.deadline)}</span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Team snapshot" subtitle="Open work across your scope" />
            <div className="grid grid-cols-2 gap-px bg-line-soft">
              {(
                ["Not Started", "In Progress", "Submitted", "Changes Required"] as const
              ).map((status) => {
                const count = scopedTasks.filter((t) => t.status === status).length;
                return (
                  <div key={status} className="bg-surface px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={cx(
                          "h-2 w-2 rounded-full",
                          TASK_STATUS_STYLE[status].dot,
                        )}
                      />
                      <span className="text-[11px] text-ink-muted">{status}</span>
                    </div>
                    <div className="mt-1 text-xl font-semibold text-ink">{count}</div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <CardHeader title="Recent activity" subtitle="Latest submissions and reviews" />
            <RecentActivity onOpen={setOpenTaskId} />
          </Card>
        </div>
      </div>

      {openTaskId ? (
        <TaskDetailDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
      ) : null}
    </div>
  );
}

function RecentActivity({ onOpen }: { onOpen: (id: string) => void }) {
  const { db, currentUser, userById } = useStore();
  const user = currentUser!;

  const events = useMemo(() => {
    const scoped = visibleTasks(user, db.tasks, db.projects);
    const list: {
      id: string;
      taskId: string;
      title: string;
      label: string;
      tone: string;
      at: string;
      who: string;
    }[] = [];
    for (const t of scoped) {
      for (const s of t.submissions) {
        list.push({
          id: s.id,
          taskId: t.id,
          title: t.title,
          label: "Submitted",
          tone: "text-st-submitted",
          at: s.at,
          who: userById(s.byUserId)?.fullName ?? "Someone",
        });
      }
      for (const r of t.reviews) {
        list.push({
          id: r.id,
          taskId: t.id,
          title: t.title,
          label: r.decision,
          tone:
            r.decision === "Approved"
              ? "text-st-approved"
              : r.decision === "Rejected"
                ? "text-st-rejected"
                : "text-st-changes",
          at: r.at,
          who: userById(r.byUserId)?.fullName ?? "Someone",
        });
      }
    }
    return list.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 7);
  }, [db.tasks, db.projects, user, userById]);

  if (events.length === 0) {
    return <EmptyState icon={<IconSend size={24} />} title="No activity yet" />;
  }

  return (
    <ul className="divide-y divide-line-soft">
      {events.map((e) => (
        <li key={e.id}>
          <button
            onClick={() => onOpen(e.taskId)}
            className="flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-surface-2"
          >
            <Avatar name={e.who} size={24} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] text-ink-muted">
                <span className="font-medium text-ink">{e.who}</span>{" "}
                <span className={e.tone}>{e.label.toLowerCase()}</span>
              </span>
              <span className="block truncate text-[12px] text-ink">{e.title}</span>
              <span className="block text-[10px] text-ink-faint">
                {formatShortDate(e.at.slice(0, 10))}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

