"use client";

import { useMemo, useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import {
  IconChart,
  IconCheck,
  IconClock,
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
  Select,
  StatTile,
  Tabs,
  cx,
} from "@/components/ui/primitives";
import {
  completionStats,
  estimateAccuracy,
  expensesByMonth,
  expensesByProject,
  expensesByVendor,
  filterTasksForReport,
  formatINR,
  reworkStats,
  timeByDepartment,
  timeByProject,
  timeByUser,
  type Bucket,
  type ExpenseBucket,
} from "@/lib/analytics";
import { addDays, todayISO } from "@/lib/calendar";

import { canViewReports, scopedDepartments } from "@/lib/permissions";
import { useStore } from "@/lib/store";
import { formatHours } from "@/lib/time";

type TabId = "time" | "delivery" | "rework" | "spend";

export default function ReportsPage() {
  const { db, currentUser, userById } = useStore();
  const user = currentUser!;
  const allowed = scopedDepartments(user);

  const [tab, setTab] = useState<TabId>("time");
  const [from, setFrom] = useState(addDays(todayISO(), -60));
  const [to, setTo] = useState(addDays(todayISO(), 30));
  const [projectId, setProjectId] = useState("all");
  const [department, setDepartment] = useState("all");
  const [userId, setUserId] = useState("all");

  const baseTasks = useMemo(
    () => (allowed ? db.tasks.filter((t) => allowed.includes(t.department)) : db.tasks),
    [db.tasks, allowed],
  );

  const tasks = useMemo(
    () => filterTasksForReport(baseTasks, { from, to, projectId, department, userId }),
    [baseTasks, from, to, projectId, department, userId],
  );

  const expenses = useMemo(
    () =>
      db.expenses.filter(
        (e) =>
          e.expenseDate >= from &&
          e.expenseDate <= to &&
          (projectId === "all" || e.projectId === projectId),
      ),
    [db.expenses, from, to, projectId],
  );

  const accuracy = useMemo(() => estimateAccuracy(tasks), [tasks]);
  const completion = useMemo(() => completionStats(tasks), [tasks]);
  const rework = useMemo(() => reworkStats(tasks), [tasks]);

  if (!canViewReports(user)) {
    return (
      <Card>
        <EmptyState
          icon={<IconChart size={30} />}
          title="Reports aren't available for your role"
          body="Super Admins, Admins and Managers see every department; Team Leaders see their own."
        />
      </Card>
    );
  }

  const totalHours = tasks.reduce(
    (s, t) => s + t.sessions.reduce((a, x) => a + sessionHours(x), 0),
    0,
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Reports & Analytics"
        icon={<IconChart size={20} />}
        subtitle={
          allowed
            ? `Scoped to your departments: ${allowed.join(", ")}`
            : "Across every department"
        }
      />

      {/* Filters (§18) */}
      <Card className="flex flex-wrap items-end gap-2.5 p-3.5">
        <div className="w-40">
          <label className="mb-1 block text-[10px] tracking-wide text-ink-faint uppercase">
            From
          </label>
          <DatePicker
            value={from}
            onChange={setFrom}
            config={db.calendar}
            ignoreWorkingRules
            allowPast
          />
        </div>
        <div className="w-40">
          <label className="mb-1 block text-[10px] tracking-wide text-ink-faint uppercase">
            To
          </label>
          <DatePicker
            value={to}
            onChange={setTo}
            config={db.calendar}
            ignoreWorkingRules
            allowPast
            min={from}
          />
        </div>
        <Select
          className="w-auto min-w-44"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          aria-label="Project"
        >
          <option value="all">All projects</option>
          {db.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto min-w-40"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          aria-label="Department"
        >
          <option value="all">All departments</option>
          {(allowed ?? db.departments).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto min-w-36"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          aria-label="User"
        >
          <option value="all">Everyone</option>
          {db.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName}
            </option>
          ))}
        </Select>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={<IconClock size={17} />}
          label="Hours logged"
          value={formatHours(totalHours)}
          hint={`${tasks.length} tasks in range`}
          tone="brand"
        />
        <StatTile
          icon={<IconCheck size={17} />}
          label="On-time completion"
          value={`${completion.onTime + completion.late === 0 ? 0 : Math.round((completion.onTime / (completion.onTime + completion.late)) * 100)}%`}
          hint={`${completion.onTime} on time · ${completion.late} late`}
          tone={completion.late > completion.onTime ? "red" : "green"}
        />
        <StatTile
          icon={<IconWarning size={17} />}
          label="Estimate variance"
          value={`${accuracy.variance > 0 ? "+" : ""}${accuracy.variance}%`}
          hint={`${formatHours(accuracy.actual)} actual vs ${formatHours(accuracy.estimated)} est.`}
          tone={accuracy.variance > 15 ? "red" : accuracy.variance < -15 ? "amber" : "green"}
        />
        <StatTile
          icon={<IconWallet size={17} />}
          label="Approved spend"
          value={formatINR(
            expenses.filter((e) => e.status === "Approved").reduce((s, e) => s + e.amount, 0),
          )}
          hint={`${expenses.length} entries`}
          tone="neutral"
        />
      </div>

      <Tabs<TabId>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "time", label: "Time" },
          { id: "delivery", label: "Delivery" },
          { id: "rework", label: "Rework" },
          { id: "spend", label: "Spend" },
        ]}
      />

      {tab === "time" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <BarCard
            title="Time by project"
            subtitle="Hours logged per project"
            buckets={timeByProject(tasks, db.projects)}
          />
          <BarCard
            title="Time by user"
            subtitle="Hours logged per person"
            buckets={timeByUser(tasks, db.users)}
            avatars
          />
          <BarCard
            title="Time by department"
            subtitle="Hours logged per department"
            buckets={timeByDepartment(tasks)}
          />
        </div>
      ) : null}

      {tab === "delivery" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Estimated vs actual"
              subtitle="Where the estimates are drifting"
            />
            <div className="px-5 py-4">
              <div className="grid grid-cols-3 gap-4">
                <Metric label="Estimated" value={formatHours(accuracy.estimated)} />
                <Metric label="Actual" value={formatHours(accuracy.actual)} />
                <Metric
                  label="Overrun tasks"
                  value={String(accuracy.overrunTasks)}
                  tone={accuracy.overrunTasks ? "text-st-rejected" : "text-st-approved"}
                />
              </div>

              <ul className="mt-5 space-y-2.5">
                {tasks
                  .filter((t) => t.estimatedHours > 0)
                  .map((t) => ({
                    task: t,
                    actual: t.sessions.reduce((a, x) => a + sessionHours(x), 0),
                  }))
                  .filter((r) => r.actual > 0)
                  .sort((a, b) => b.actual / b.task.estimatedHours - a.actual / a.task.estimatedHours)
                  .slice(0, 8)
                  .map(({ task, actual }) => {
                    const pct = Math.round((actual / task.estimatedHours) * 100);
                    return (
                      <li key={task.id}>
                        <div className="mb-1 flex items-baseline justify-between gap-3 text-[11px]">
                          <span className="min-w-0 truncate text-ink-muted">{task.title}</span>
                          <span
                            className={cx(
                              "shrink-0 font-mono",
                              pct > 110 ? "text-st-rejected" : "text-ink",
                            )}
                          >
                            {formatHours(actual)} / {task.estimatedHours}h
                          </span>
                        </div>
                        <ProgressBar
                          value={Math.min(100, pct)}
                          barClassName={pct > 110 ? "bg-st-rejected" : "bg-brand-bright"}
                        />
                      </li>
                    );
                  })}
              </ul>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="On-time vs overdue"
              subtitle="Completion against the due date"
            />
            <div className="px-5 py-4">
              <div className="grid grid-cols-3 gap-4">
                <Metric
                  label="On time"
                  value={String(completion.onTime)}
                  tone="text-st-approved"
                />
                <Metric label="Late" value={String(completion.late)} tone="text-st-changes" />
                <Metric
                  label="Open & overdue"
                  value={String(completion.openOverdue)}
                  tone="text-st-rejected"
                />
              </div>

              <div className="mt-5">
                <div className="mb-1.5 flex items-baseline justify-between text-[11px]">
                  <span className="text-ink-muted">Completion rate</span>
                  <span className="font-mono text-ink">{completion.completionRate}%</span>
                </div>
                <ProgressBar value={completion.completionRate} className="h-2" />
              </div>

              <div className="mt-5 flex h-6 overflow-hidden rounded-lg">
                {[
                  { n: completion.onTime, c: "bg-st-approved", l: "On time" },
                  { n: completion.late, c: "bg-st-changes", l: "Late" },
                  { n: completion.openOverdue, c: "bg-st-rejected", l: "Overdue" },
                  {
                    n: Math.max(
                      0,
                      tasks.length - completion.onTime - completion.late - completion.openOverdue,
                    ),
                    c: "bg-surface-3",
                    l: "In flight",
                  },
                ]
                  .filter((s) => s.n > 0)
                  .map((s) => (
                    <div
                      key={s.l}
                      className={cx(s.c, "flex items-center justify-center")}
                      style={{ width: `${(s.n / Math.max(1, tasks.length)) * 100}%` }}
                      title={`${s.l}: ${s.n}`}
                    />
                  ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-faint">
                {[
                  ["On time", "bg-st-approved"],
                  ["Late", "bg-st-changes"],
                  ["Overdue", "bg-st-rejected"],
                  ["In flight", "bg-surface-3"],
                ].map(([l, c]) => (
                  <span key={l} className="inline-flex items-center gap-1.5">
                    <span className={cx("h-2 w-2 rounded-full", c)} /> {l}
                  </span>
                ))}
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "rework" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Changes Required & Rejections"
              subtitle="Split by where the feedback came from"
            />
            <div className="px-5 py-4">
              <div className="grid grid-cols-2 gap-4">
                <Metric
                  label="Changes required"
                  value={String(rework.changesRequired)}
                  tone="text-st-changes"
                />
                <Metric label="Rejected" value={String(rework.rejected)} tone="text-st-rejected" />
                <Metric label="From client" value={String(rework.fromClient)} />
                <Metric label="From project leader" value={String(rework.fromProjectLeader)} />
              </div>

              {rework.fromClient + rework.fromProjectLeader > 0 ? (
                <div className="mt-5">
                  <div className="mb-1.5 text-[11px] text-ink-muted">Source split</div>
                  <div className="flex h-6 overflow-hidden rounded-lg">
                    <div
                      className="bg-st-submitted"
                      style={{
                        width: `${(rework.fromClient / (rework.fromClient + rework.fromProjectLeader)) * 100}%`,
                      }}
                      title={`Client: ${rework.fromClient}`}
                    />
                    <div
                      className="bg-brand"
                      style={{
                        width: `${(rework.fromProjectLeader / (rework.fromClient + rework.fromProjectLeader)) * 100}%`,
                      }}
                      title={`Project Leader: ${rework.fromProjectLeader}`}
                    />
                  </div>
                  <div className="mt-2 flex gap-3 text-[10px] text-ink-faint">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-st-submitted" /> Client (
                      {rework.fromClient})
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-brand" /> Project Leader (
                      {rework.fromProjectLeader})
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Reassignments"
              subtitle="Rejections that moved a task to someone else"
            />
            {rework.reassignments === 0 ? (
              <EmptyState
                icon={<IconCheck size={26} />}
                title="No reassignments in this range"
                body="Nothing had to change hands."
              />
            ) : (
              <div className="px-5 py-4">
                <Metric label="Total reassignments" value={String(rework.reassignments)} />

                <h4 className="mt-5 mb-2 text-[10px] font-semibold tracking-wide text-ink-faint uppercase">
                  Per task
                </h4>
                <ul className="space-y-1.5">
                  {rework.perTask.slice(0, 6).map(({ task, count }) => (
                    <li
                      key={task.id}
                      className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-[12px] text-ink-muted">
                        {task.title}
                      </span>
                      <Badge className="border-st-rejected/30 bg-st-rejected/15 text-st-rejected">
                        {count}×
                      </Badge>
                    </li>
                  ))}
                </ul>

                {rework.perUser.length ? (
                  <>
                    <h4 className="mt-5 mb-2 text-[10px] font-semibold tracking-wide text-ink-faint uppercase">
                      Per user (moved away from)
                    </h4>
                    <ul className="space-y-1.5">
                      {rework.perUser.slice(0, 6).map(({ userId: uid, count }) => {
                        const u = userById(uid);
                        return (
                          <li
                            key={uid}
                            className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-2"
                          >
                            <Avatar name={u?.fullName ?? "?"} size={20} />
                            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-muted">
                              {u?.fullName ?? "Unknown"}
                            </span>
                            <Badge>{count}×</Badge>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                ) : null}
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {tab === "spend" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <ExpenseCard
            title="By project"
            buckets={expensesByProject(expenses, db.projects)}
          />
          <ExpenseCard title="By vendor" buckets={expensesByVendor(expenses, db)} />
          <ExpenseCard title="By month" buckets={expensesByMonth(expenses)} />
        </div>
      ) : null}
    </div>
  );
}

function sessionHours(s: { startedAt: string; endedAt: string | null }) {
  const end = s.endedAt ? new Date(s.endedAt).getTime() : Date.now();
  return Math.max(0, end - new Date(s.startedAt).getTime()) / 3_600_000;
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <div className="text-[10px] tracking-wide text-ink-faint uppercase">{label}</div>
      <div className={cx("mt-0.5 text-xl font-semibold", tone ?? "text-ink")}>{value}</div>
    </div>
  );
}

function BarCard({
  title,
  subtitle,
  buckets,
  avatars,
}: {
  title: string;
  subtitle: string;
  buckets: Bucket[];
  avatars?: boolean;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.hours));
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      {buckets.length === 0 ? (
        <EmptyState icon={<IconClock size={24} />} title="No time logged in this range" />
      ) : (
        <ul className="space-y-3 px-5 py-4">
          {buckets.slice(0, 10).map((b) => (
            <li key={b.key}>
              <div className="mb-1 flex items-baseline gap-2 text-[11px]">
                {avatars ? <Avatar name={b.label} size={18} /> : null}
                <span className="min-w-0 flex-1 truncate text-ink-muted">{b.label}</span>
                <span className="shrink-0 font-mono text-ink">{formatHours(b.hours)}</span>
                <span className="shrink-0 text-ink-faint">({b.count})</span>
              </div>
              <ProgressBar value={(b.hours / max) * 100} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ExpenseCard({ title, buckets }: { title: string; buckets: ExpenseBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.total));
  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={`${formatINR(buckets.reduce((s, b) => s + b.total, 0))} total`}
      />
      {buckets.length === 0 ? (
        <EmptyState icon={<IconWallet size={24} />} title="No expenses in this range" />
      ) : (
        <ul className="space-y-3 px-5 py-4">
          {buckets.slice(0, 10).map((b) => (
            <li key={b.key}>
              <div className="mb-1 flex items-baseline gap-2 text-[11px]">
                <span className="min-w-0 flex-1 truncate text-ink-muted">{b.label}</span>
                <span className="shrink-0 font-mono text-ink">{formatINR(b.total)}</span>
              </div>
              <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-3">
                {(
                  [
                    [b.approved, "bg-st-approved"],
                    [b.pending, "bg-st-submitted"],
                    [b.rejected, "bg-st-rejected"],
                  ] as const
                ).map(([n, c], i) =>
                  n > 0 ? (
                    <div key={i} className={c} style={{ width: `${(n / max) * 100}%` }} />
                  ) : null,
                )}
              </div>
              <div className="mt-1 flex gap-2.5 text-[10px] text-ink-faint">
                {b.approved > 0 ? (
                  <span className="text-st-approved">{formatINR(b.approved)} approved</span>
                ) : null}
                {b.pending > 0 ? (
                  <span className="text-st-submitted">{formatINR(b.pending)} pending</span>
                ) : null}
                {b.rejected > 0 ? (
                  <span className="text-st-rejected">{formatINR(b.rejected)} rejected</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
