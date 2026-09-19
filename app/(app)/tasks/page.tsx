"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { TaskDetailDrawer } from "@/components/task/task-detail";
import { TaskFormModal } from "@/components/task/task-form";
import {
  TaskFilters,
  TaskListCard,
  applyTaskFilters,
  emptyTaskFilters,
} from "@/components/task/task-list";
import { IconPlus, IconTasks } from "@/components/ui/icons";
import { Button, PageHeader, Select, StatTile, Tabs } from "@/components/ui/primitives";
import { isOverdue } from "@/lib/analytics";
import { addDays, todayISO } from "@/lib/calendar";
import {
  assignedTaskScope,
  canManageIndividualTasks,
  isGlobalManager,
  isMyReviewQueue,
  visibleTasks,
} from "@/lib/permissions";
import { useStore } from "@/lib/store";
import { formatDuration, taskElapsedMs } from "@/lib/time";
import type { Task, TaskStatus } from "@/lib/types";

type Scope = "mine" | "all" | "review" | "under-review";
/** §10 — individual tasks live here too now, behind this filter. */
type TaskType = "all" | "project" | "individual";

/** Work that has been handed in and is waiting on a reviewer or the client. */
const UNDER_REVIEW: TaskStatus[] = ["Submitted", "Waiting for Client Response"];

const ofType = (tasks: Task[], type: TaskType) =>
  type === "all"
    ? tasks
    : tasks.filter((t) => (type === "individual" ? t.projectId === null : t.projectId !== null));

export default function TasksPage() {
  const { db, currentUser, projectById } = useStore();
  const user = currentUser!;
  const searchParams = useSearchParams();

  const [scope, setScope] = useState<Scope>(
    searchParams.get("view") === "mine" ? "mine" : "all",
  );
  // Notifications about an individual task link straight to ?type=individual.
  const [taskType, setTaskType] = useState<TaskType>(
    searchParams.get("type") === "individual"
      ? "individual"
      : searchParams.get("type") === "project"
        ? "project"
        : "all",
  );
  const [openTaskId, setOpenTaskId] = useState<string | null>(searchParams.get("task"));
  const [createOpen, setCreateOpen] = useState(false);
  const [filters, setFilters] = useState(emptyTaskFilters);

  /** What this page lists: your own tasks, unless you are a global manager. */
  const scoped = useMemo(
    () => ofType(assignedTaskScope(user, db.tasks, db.projects), taskType),
    [user, db.tasks, db.projects, taskType],
  );

  /**
   * The review queues are drawn from everything the user may see, and they
   * deliberately ignore the type filter: a reviewer wants one queue, not one
   * per kind of task.
   */
  const reviewable = useMemo(
    () => visibleTasks(user, db.tasks, db.projects),
    [user, db.tasks, db.projects],
  );

  const underReview = useMemo(
    () => reviewable.filter((t) => UNDER_REVIEW.includes(t.status)),
    [reviewable],
  );

  const forReview = useMemo(
    () =>
      underReview.filter((t) =>
        isMyReviewQueue(user, t, t.projectId ? (projectById(t.projectId) ?? null) : null),
      ),
    [underReview, user, projectById],
  );

  const reviewing = scope === "review" || scope === "under-review";
  const base =
    scope === "mine"
      ? scoped.filter((t) => t.assigneeId === user.id)
      : scope === "review"
        ? forReview
        : scope === "under-review"
          ? underReview
          : scoped;

  const filtered = applyTaskFilters(base, filters, db.projects);
  const today = todayISO();
  const mayCreateIndividual = canManageIndividualTasks(user);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Tasks"
        icon={<IconTasks size={20} />}
        subtitle={
          isGlobalManager(user)
            ? "Project and individual work, soonest due first"
            : "Your tasks, soonest due first"
        }
        actions={
          mayCreateIndividual ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <IconPlus size={15} /> New individual task
            </Button>
          ) : null
        }
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
        <StatTile label="Overdue" value={scoped.filter(isOverdue).length} tone="red" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs<Scope>
          active={scope}
          onChange={setScope}
          tabs={[
            // For everyone but a global manager the list is already just their
            // own tasks, so a separate "All tasks" tab would only repeat it.
            ...(isGlobalManager(user)
              ? [
                  { id: "all" as const, label: "All tasks", count: scoped.length },
                  {
                    id: "mine" as const,
                    label: "Assigned to me",
                    count: scoped.filter((t) => t.assigneeId === user.id).length,
                  },
                ]
              : [{ id: "all" as const, label: "My tasks", count: scoped.length }]),
            { id: "review", label: "Awaiting my review", count: forReview.length },
            { id: "under-review", label: "All under review", count: underReview.length },
          ]}
        />

        {/* The review queues cover every kind of task, so the type filter has
            nothing to say there. */}
        {reviewing ? null : (
          <Select
            className="w-auto min-w-40"
            value={taskType}
            onChange={(e) => setTaskType(e.target.value as TaskType)}
            aria-label="Kind of task"
          >
            <option value="all">All tasks</option>
            <option value="project">Project tasks</option>
            <option value="individual">Individual tasks</option>
          </Select>
        )}
      </div>

      <TaskFilters
        value={filters}
        onChange={setFilters}
        users={db.users}
        projects={db.projects}
      />

      <TaskListCard
        tasks={filtered}
        onOpen={setOpenTaskId}
        emptyTitle={
          scope === "review"
            ? "Nothing waiting on your review"
            : scope === "under-review"
              ? "Nothing is under review"
              : taskType === "individual"
                ? "No individual tasks match these filters"
                : "No tasks match these filters"
        }
        emptyBody={
          scope === "review"
            ? "Submissions you can review will queue up here."
            : "Try widening the filters, or switch tabs."
        }
      />

      {createOpen ? (
        <TaskFormModal
          open
          onClose={() => setCreateOpen(false)}
          project={null}
          mode="individual"
        />
      ) : null}

      {openTaskId ? (
        <TaskDetailDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
      ) : null}
    </div>
  );
}
