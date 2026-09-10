"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { TaskDetailDrawer } from "@/components/task/task-detail";
import {
  TaskFilters,
  TaskListCard,
  applyTaskFilters,
  emptyTaskFilters,
} from "@/components/task/task-list";
import { IconTasks } from "@/components/ui/icons";
import { PageHeader, StatTile, Tabs } from "@/components/ui/primitives";
import { isOverdue } from "@/lib/analytics";
import { addDays, todayISO } from "@/lib/calendar";
import { visibleTasks } from "@/lib/permissions";
import { useStore } from "@/lib/store";
import { formatDuration, taskElapsedMs } from "@/lib/time";

type Scope = "mine" | "all" | "review";

export default function TasksPage() {
  const { db, currentUser, projectById } = useStore();
  const user = currentUser!;
  const searchParams = useSearchParams();

  const [scope, setScope] = useState<Scope>(
    searchParams.get("view") === "mine" ? "mine" : "all",
  );
  const [openTaskId, setOpenTaskId] = useState<string | null>(searchParams.get("task"));
  const [filters, setFilters] = useState(emptyTaskFilters);

  /** Project tasks only — individual tasks have their own page (§10). */
  const scoped = useMemo(
    () => visibleTasks(user, db.tasks, db.projects).filter((t) => t.projectId !== null),
    [user, db.tasks, db.projects],
  );

  const forReview = useMemo(
    () =>
      scoped.filter((t) => {
        if (t.status !== "Submitted") return false;
        const p = t.projectId ? projectById(t.projectId) : null;
        if (!p) return false;
        return (
          p.leaderId === user.id || ["super_admin", "admin", "manager"].includes(user.role)
        );
      }),
    [scoped, user, projectById],
  );

  const base =
    scope === "mine"
      ? scoped.filter((t) => t.assigneeId === user.id)
      : scope === "review"
        ? forReview
        : scoped;

  const tags = useMemo(
    () => Array.from(new Set(scoped.flatMap((t) => t.tags))).sort(),
    [scoped],
  );

  const filtered = applyTaskFilters(base, filters);
  const today = todayISO();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Tasks"
        icon={<IconTasks size={20} />}
        subtitle="Every project task you can see, across all projects"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="In your scope"
          value={scoped.length}
          hint={`${scoped.filter((t) => t.status !== "Approved").length} open`}
          tone="brand"
          icon={<IconTasks size={17} />}
        />
        <StatTile
          label="Assigned to you"
          value={scoped.filter((t) => t.assigneeId === user.id).length}
          hint={`${formatDuration(
            scoped
              .filter((t) => t.assigneeId === user.id)
              .reduce((s, t) => s + taskElapsedMs(t), 0),
          )} logged`}
          tone="blue"
        />
        <StatTile
          label="Due in 7 days"
          value={
            scoped.filter(
              (t) =>
                t.status !== "Approved" &&
                t.dueDate >= today &&
                t.dueDate <= addDays(today, 7),
            ).length
          }
          tone="amber"
        />
        <StatTile
          label="Overdue"
          value={scoped.filter(isOverdue).length}
          tone="red"
        />
      </div>

      <Tabs<Scope>
        active={scope}
        onChange={setScope}
        tabs={[
          { id: "all", label: "All tasks", count: scoped.length },
          {
            id: "mine",
            label: "Assigned to me",
            count: scoped.filter((t) => t.assigneeId === user.id).length,
          },
          { id: "review", label: "Awaiting my review", count: forReview.length },
        ]}
      />

      <TaskFilters value={filters} onChange={setFilters} users={db.users} tags={tags} />

      <TaskListCard
        tasks={filtered}
        onOpen={setOpenTaskId}
        emptyTitle={
          scope === "review"
            ? "Nothing waiting on your review"
            : "No tasks match these filters"
        }
        emptyBody={
          scope === "review"
            ? "Submissions you can review will queue up here."
            : "Try widening the filters, or switch tabs."
        }
      />

      {openTaskId ? (
        <TaskDetailDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
      ) : null}
    </div>
  );
}
