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
import { IconInbox, IconPlus } from "@/components/ui/icons";
import { Button, Card, PageHeader, StatTile, Tabs } from "@/components/ui/primitives";
import { isOverdue } from "@/lib/analytics";
import { canManageIndividualTasks, isGlobalManager, visibleTasks } from "@/lib/permissions";
import { useStore } from "@/lib/store";

type Scope = "mine" | "all" | "review";

/** §10 — same lifecycle as project tasks, without a parent project. */
export default function IndividualTasksPage() {
  const { db, currentUser } = useStore();
  const user = currentUser!;
  const searchParams = useSearchParams();

  const [scope, setScope] = useState<Scope>("all");
  const [openTaskId, setOpenTaskId] = useState<string | null>(searchParams.get("task"));
  const [createOpen, setCreateOpen] = useState(false);
  const [filters, setFilters] = useState(emptyTaskFilters);

  const scoped = useMemo(
    () => visibleTasks(user, db.tasks, db.projects).filter((t) => t.projectId === null),
    [user, db.tasks, db.projects],
  );

  // Individual tasks are reviewed by Super Admin, Admin or Manager (§12.2).
  const forReview = useMemo(
    () => (isGlobalManager(user) ? scoped.filter((t) => t.status === "Submitted") : []),
    [scoped, user],
  );

  const base =
    scope === "mine"
      ? scoped.filter((t) => t.assigneeId === user.id)
      : scope === "review"
        ? forReview
        : scoped;

  const filtered = applyTaskFilters(base, filters);
  const mayCreate = canManageIndividualTasks(user);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Individual Tasks"
        icon={<IconInbox size={20} />}
        subtitle="Work that isn't tied to a client project — internal, admin and one-offs"
        actions={
          mayCreate ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <IconPlus size={15} /> New individual task
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="In your scope"
          value={scoped.length}
          hint={`${scoped.filter((t) => t.status !== "Approved").length} open`}
          tone="brand"
          icon={<IconInbox size={17} />}
        />
        <StatTile
          label="Assigned to you"
          value={scoped.filter((t) => t.assigneeId === user.id).length}
          tone="blue"
        />
        <StatTile label="Overdue" value={scoped.filter(isOverdue).length} tone="red" />
      </div>

      {!mayCreate ? (
        <Card className="px-4 py-3 text-[12px] leading-relaxed text-ink-faint">
          Individual tasks are created by Super Admins, Admins, Managers and Team
          Leaders. Project Leaders create tasks inside their own projects instead.
        </Card>
      ) : null}

      <Tabs<Scope>
        active={scope}
        onChange={setScope}
        tabs={[
          { id: "all", label: "All", count: scoped.length },
          {
            id: "mine",
            label: "Assigned to me",
            count: scoped.filter((t) => t.assigneeId === user.id).length,
          },
          ...(isGlobalManager(user)
            ? [{ id: "review" as const, label: "Awaiting my review", count: forReview.length }]
            : []),
        ]}
      />

      <TaskFilters
        value={filters}
        onChange={setFilters}
        users={db.users}
        showTags={false}
      />

      <TaskListCard
        tasks={filtered}
        onOpen={setOpenTaskId}
        showProject={false}
        emptyTitle="No individual tasks match these filters"
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
