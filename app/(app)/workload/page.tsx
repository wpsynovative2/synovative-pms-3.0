"use client";

import { useMemo, useState } from "react";
import { TaskDetailDrawer } from "@/components/task/task-detail";
import { DueDate, StatusBadge } from "@/components/task/task-bits";
import { DatePicker } from "@/components/ui/date-picker";
import { IconChart, IconTasks, IconUsers, IconWarning } from "@/components/ui/icons";
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  ProgressBar,
  Select,
  StatTile,
  cx,
} from "@/components/ui/primitives";
import { workloadRows } from "@/lib/analytics";
import { addDays, todayISO } from "@/lib/calendar";
import { DEPARTMENTS } from "@/lib/master-data";
import { canViewWorkload, scopedDepartments } from "@/lib/permissions";
import { useStore } from "@/lib/store";
import { formatHours } from "@/lib/time";

/** §14 — per-user allocation across a date window, filterable by department. */
export default function WorkloadPage() {
  const { db, currentUser } = useStore();
  const user = currentUser!;

  const allowed = scopedDepartments(user);
  const [department, setDepartment] = useState<string>("all");
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(addDays(todayISO(), 6));
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const departmentOptions = allowed ?? [];

  const people = useMemo(() => {
    let list = db.users.filter((u) => u.active);
    if (allowed) {
      list = list.filter((u) => u.departments.some((d) => allowed.includes(d)));
    }
    if (department !== "all") {
      list = list.filter((u) => u.departments.includes(department));
    }
    return list;
  }, [db.users, allowed, department]);

  const rows = useMemo(() => {
    const scopedTasks = allowed
      ? db.tasks.filter((t) => allowed.includes(t.department))
      : db.tasks;
    return workloadRows(people, scopedTasks, db.calendar, { from, to }).sort(
      (a, b) => b.utilisation - a.utilisation,
    );
  }, [people, db.tasks, db.calendar, from, to, allowed]);

  if (!canViewWorkload(user)) {
    return (
      <Card>
        <EmptyState
          icon={<IconUsers size={30} />}
          title="Workload isn't available for your role"
          body="Super Admins, Admins and Managers see every department; Team Leaders see their own."
        />
      </Card>
    );
  }

  const totalTasks = rows.reduce((s, r) => s + r.openTasks.length, 0);
  const overAllocated = rows.filter((r) => r.overAllocated).length;
  const avgTasks = rows.length ? Math.round((totalTasks / rows.length) * 10) / 10 : 0;

  const presets: { label: string; from: string; to: string }[] = [
    { label: "This week", from: todayISO(), to: addDays(todayISO(), 6) },
    { label: "Next 14 days", from: todayISO(), to: addDays(todayISO(), 13) },
    { label: "Next 30 days", from: todayISO(), to: addDays(todayISO(), 29) },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Team Workload"
        icon={<IconUsers size={20} />}
        subtitle="Monitor team capacity and task distribution"
        actions={
          <Select
            className="w-auto min-w-44"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            aria-label="Department"
          >
            <option value="all">
              {allowed ? "My departments" : "All departments"}
            </option>
            {(allowed ? departmentOptions : DEPARTMENTS).map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={<IconUsers size={17} />}
          label="Team members"
          value={rows.length}
          tone="brand"
        />
        <StatTile
          icon={<IconTasks size={17} />}
          label="Open tasks in window"
          value={totalTasks}
          tone="blue"
        />
        <StatTile
          icon={<IconChart size={17} />}
          label="Avg tasks per person"
          value={avgTasks}
          tone="neutral"
        />
        <StatTile
          icon={<IconWarning size={17} />}
          label="Over-allocated"
          value={overAllocated}
          hint="Above an 8h/working-day capacity"
          tone={overAllocated ? "red" : "green"}
        />
      </div>

      <Card className="flex flex-wrap items-end gap-2.5 p-3.5">
        <div className="flex items-end gap-2">
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
        </div>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.label}
              onClick={() => {
                setFrom(p.from);
                setTo(p.to);
              }}
              className={cx(
                "h-9.5 rounded-[10px] border px-3 text-[12px] transition-colors",
                from === p.from && to === p.to
                  ? "border-brand-bright bg-brand/20 text-ink"
                  : "border-line bg-surface-2 text-ink-muted hover:text-ink",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconUsers size={30} />}
            title="Nobody in this scope"
            body="Try a different department."
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <Card
              key={r.user.id}
              className={cx("p-4", r.overAllocated && "border-st-rejected/40")}
            >
              <div className="flex items-start gap-3">
                <Avatar name={r.user.fullName} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-ink">
                    {r.user.fullName}
                  </div>
                  <div className="truncate text-[11px] text-ink-faint">
                    {r.user.departments.join(" · ")}
                  </div>
                </div>
                <Badge
                  className={cx(
                    r.openTasks.length === 0
                      ? "border-line bg-surface-2 text-ink-faint"
                      : "border-brand-bright/30 bg-brand/20 text-brand-ink",
                  )}
                >
                  {r.openTasks.length} active
                </Badge>
              </div>

              <div className="mt-4">
                <div className="mb-1.5 flex items-baseline justify-between text-[11px]">
                  <span className="text-ink-muted">
                    {formatHours(r.allocatedHours)} of {formatHours(r.capacityHours)}{" "}
                    capacity
                  </span>
                  <span
                    className={cx(
                      "font-mono",
                      r.overAllocated ? "text-st-rejected" : "text-ink",
                    )}
                  >
                    {r.utilisation}%
                  </span>
                </div>
                <ProgressBar
                  value={Math.min(100, r.utilisation)}
                  barClassName={cx(
                    r.overAllocated
                      ? "bg-st-rejected"
                      : r.utilisation > 80
                        ? "bg-st-submitted"
                        : "bg-st-approved",
                  )}
                />
                {r.overAllocated ? (
                  <p className="mt-1.5 inline-flex items-center gap-1.5 text-[10px] text-st-rejected">
                    <IconWarning size={11} /> Over-allocated for this window
                  </p>
                ) : null}
              </div>

              <dl className="mt-4 grid grid-cols-4 gap-2 border-t border-line-soft pt-3 text-[11px]">
                <div>
                  <dt className="text-ink-faint">To do</dt>
                  <dd className="mt-0.5 text-[14px] text-ink">{r.notStarted}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Active</dt>
                  <dd className="mt-0.5 text-[14px] text-st-inprogress">{r.inProgress}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Review</dt>
                  <dd className="mt-0.5 text-[14px] text-st-submitted">{r.submitted}</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Done</dt>
                  <dd className="mt-0.5 text-[14px] text-st-approved">{r.done}</dd>
                </div>
              </dl>

              {r.overdue > 0 || r.dueThisWeek > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {r.overdue > 0 ? (
                    <Badge className="border-st-rejected/40 bg-st-rejected/20 text-st-rejected">
                      {r.overdue} overdue
                    </Badge>
                  ) : null}
                  {r.dueThisWeek > 0 ? (
                    <Badge className="border-st-submitted/30 bg-st-submitted/15 text-st-submitted">
                      {r.dueThisWeek} due in window
                    </Badge>
                  ) : null}
                </div>
              ) : null}

              {r.openTasks.length ? (
                <ul className="mt-3 space-y-1 border-t border-line-soft pt-3">
                  {r.openTasks.slice(0, 4).map((t) => (
                    <li key={t.id}>
                      <button
                        onClick={() => setOpenTaskId(t.id)}
                        className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-surface-2"
                      >
                        <span className="min-w-0 flex-1 truncate text-[11px] text-ink-muted">
                          {t.title}
                        </span>
                        <DueDate task={t} />
                        <StatusBadge status={t.status} task={t} />
                      </button>
                    </li>
                  ))}
                  {r.openTasks.length > 4 ? (
                    <li className="px-1.5 pt-0.5 text-[10px] text-ink-faint">
                      +{r.openTasks.length - 4} more
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      {openTaskId ? (
        <TaskDetailDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
      ) : null}
    </div>
  );
}
