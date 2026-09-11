"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { TaskDetailDrawer } from "@/components/task/task-detail";
import { TaskRow } from "@/components/task/task-list";
import { IconClock, IconLogout, IconTasks, IconUser } from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/modal";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  PageHeader,
  StatTile,
} from "@/components/ui/primitives";
import { isOverdue } from "@/lib/analytics";
import { formatDate } from "@/lib/calendar";
import { navGate } from "@/lib/permissions";
import { useStore } from "@/lib/store";
import { formatDuration, taskElapsedMs } from "@/lib/time";
import { ROLE_LABEL } from "@/lib/types";

export default function ProfilePage() {
  const { db, currentUser, changePassword, logout, resetDemoData } = useStore();
  const user = currentUser!;
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const myTasks = useMemo(
    () => db.tasks.filter((t) => t.assigneeId === user.id),
    [db.tasks, user.id],
  );
  const ledProjects = useMemo(
    () => db.projects.filter((p) => p.leaderId === user.id),
    [db.projects, user.id],
  );

  const open = myTasks.filter((t) => t.status !== "Approved");
  const totalTime = myTasks.reduce((s, t) => s + taskElapsedMs(t), 0);
  const gate = navGate(user);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setError("Use at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    changePassword(password);
    setPassword("");
    setConfirm("");
    setError(null);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="My profile" icon={<IconUser size={20} />} />

      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <div className="flex flex-col gap-5">
          <Card className="p-5">
            <div className="flex items-center gap-4">
              <Avatar name={user.fullName} size={56} />
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold text-ink">{user.fullName}</h2>
                <p className="truncate text-[12px] text-ink-muted">{user.email}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge className="border-brand-bright/30 bg-brand/20 text-brand-ink">
                    {ROLE_LABEL[user.role]}
                  </Badge>
                  {ledProjects.length ? (
                    <Badge className="border-st-approved/30 bg-st-approved/15 text-st-approved">
                      Project Leader ×{ledProjects.length}
                    </Badge>
                  ) : null}
                </div>
              </div>
            </div>

            <dl className="mt-5 space-y-2.5 border-t border-line-soft pt-4 text-[12px]">
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 text-ink-faint">Department(s)</dt>
                <dd className="min-w-0 text-ink-muted">{user.departments.join(", ")}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 text-ink-faint">Member since</dt>
                <dd className="text-ink-muted">{formatDate(user.createdAt.slice(0, 10))}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-28 shrink-0 text-ink-faint">Account</dt>
                <dd className={user.active ? "text-st-approved" : "text-st-rejected"}>
                  {user.active ? "Active" : "Deactivated"}
                </dd>
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="What you can do" subtitle="Derived from your role and departments" />
            <ul className="grid grid-cols-2 gap-px bg-line-soft">
              {(
                [
                  ["Projects", gate.projects],
                  ["Tasks", gate.tasks],
                  ["Individual tasks", gate.individualTasks],
                  ["Expenses", gate.expenses],
                  ["Workload", gate.workload],
                  ["Vendors", gate.vendors],
                  ["Templates", gate.templates],
                  ["Reports", gate.reports],
                  ["Working calendar", gate.calendar],
                  ["User management", gate.users],
                ] as const
              ).map(([label, on]) => (
                <li key={label} className="flex items-center gap-2 bg-surface px-4 py-2.5">
                  <span
                    className={
                      "h-1.5 w-1.5 rounded-full " + (on ? "bg-st-approved" : "bg-ink-faint/40")
                    }
                  />
                  <span className={"text-[12px] " + (on ? "text-ink-muted" : "text-ink-faint")}>
                    {label}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Change password" />
            <form onSubmit={submit} className="flex flex-col gap-4 px-5 py-4">
              <Field label="New password" required>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="At least 6 characters"
                />
              </Field>
              <Field label="Confirm new password" required error={error ?? undefined}>
                <Input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </Field>
              <div className="flex items-center gap-3">
                <Button type="submit" variant="primary">
                  Update password
                </Button>
                {saved ? (
                  <span className="text-[12px] text-st-approved">Password updated.</span>
                ) : null}
              </div>
            </form>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile
              icon={<IconTasks size={17} />}
              label="Open tasks"
              value={open.length}
              hint={`${myTasks.length} all-time`}
              tone="brand"
            />
            <StatTile
              icon={<IconClock size={17} />}
              label="Time logged"
              value={formatDuration(totalTime)}
              tone="blue"
            />
            <StatTile
              label="Overdue"
              value={myTasks.filter(isOverdue).length}
              tone={myTasks.filter(isOverdue).length ? "red" : "green"}
            />
          </div>

          <Card>
            <CardHeader title="Your open tasks" subtitle="Everything currently on your plate" />
            {open.length === 0 ? (
              <EmptyState
                icon={<IconTasks size={26} />}
                title="Nothing open"
                body="You're all caught up."
              />
            ) : (
              <div>
                {open
                  .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
                  .map((t) => (
                    <TaskRow key={t.id} task={t} onOpen={setOpenTaskId} />
                  ))}
              </div>
            )}
          </Card>

          {ledProjects.length ? (
            <Card>
              <CardHeader
                title="Projects you lead"
                subtitle="You can create tasks, review submissions and add expenses in these"
              />
              <ul className="divide-y divide-line-soft">
                {ledProjects.map((p) => (
                  <li key={p.id}>
                    <button
                      onClick={() => router.push(`/projects/${p.id}`)}
                      className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-surface-2"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                        style={{ background: p.color }}
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                        {p.name}
                      </span>
                      <span className="shrink-0 text-[11px] text-ink-faint">
                        {p.clientName}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Session" />
            <div className="flex flex-wrap items-center gap-2 px-5 py-4">
              <Button
                variant="danger"
                onClick={() => {
                  logout();
                  router.replace("/login");
                }}
              >
                <IconLogout size={14} /> Sign out
              </Button>
              <Button onClick={() => setConfirmReset(true)}>Reset demo data</Button>
              <p className="w-full text-[11px] leading-relaxed text-ink-faint">
                Resetting restores the seeded demo dataset and signs you out. Data lives in
                this browser only; a production deployment reads and writes Supabase.
              </p>
            </div>
          </Card>
        </div>
      </div>

      {openTaskId ? (
        <TaskDetailDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
      ) : null}

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          resetDemoData();
          router.replace("/login");
        }}
        title="Reset demo data?"
        body="Every change you've made in this browser is discarded and the seeded dataset is restored."
        confirmLabel="Reset"
      />
    </div>
  );
}
