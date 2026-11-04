"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { ProjectDriveControls } from "@/components/project/project-drive";
import { GroupFormModal } from "@/components/three-d/group-form";
import { TaskGroupCard } from "@/components/three-d/task-group-card";
import { TaskDetailDrawer } from "@/components/task/task-detail";
import { TaskFormModal } from "@/components/task/task-form";
import { IconArrowLeft, IconCube, IconPlus } from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/modal";
import { Badge, Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatDate } from "@/lib/calendar";
import { THREE_D_DEPARTMENT } from "@/lib/master-data";
import {
  canCreateTaskInProject,
  canManageTaskGroups,
  canViewProject,
  canViewThreeD,
} from "@/lib/permissions";
import { useStore } from "@/lib/store";
import type { TaskGroup } from "@/lib/types";

/*
 * One 3D project: its numbered groups, each holding its tasks (Archi-3d.md §6).
 * Opening a task uses the same drawer as everywhere else, and everything else about
 * the project (team, expenses, activity) is on its ordinary project page.
 */
export default function ThreeDProjectPage({ params }: PageProps<"/3d-projects/[id]">) {
  const { id } = use(params);
  const { db, currentUser, projectById, deleteTaskGroup } = useStore();
  const project = projectById(id);

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  const [renaming, setRenaming] = useState<TaskGroup | null>(null);
  const [deleting, setDeleting] = useState<TaskGroup | null>(null);
  /** Undefined: adding is closed. Null: adding a task outside any group. */
  const [addingTaskTo, setAddingTaskTo] = useState<string | null | undefined>(undefined);

  const groups = useMemo(
    () =>
      db.taskGroups.filter((g) => g.projectId === id).sort((a, b) => a.number - b.number),
    [db.taskGroups, id],
  );
  // Content tasks are not part of this module (0023). An older project marked 3D
  // keeps any it had, on its ordinary project page.
  const projectTasks = useMemo(
    () => db.tasks.filter((t) => t.projectId === id && t.kind === "standard"),
    [db.tasks, id],
  );
  const ungrouped = useMemo(() => projectTasks.filter((t) => !t.groupId), [projectTasks]);

  const user = currentUser!;
  const allowed =
    canViewThreeD(user) && !!project?.is3d && canViewProject(user, project, db.tasks);

  if (!project || !allowed) {
    return (
      <Card>
        <EmptyState
          icon={<IconCube size={30} />}
          title="This 3D project isn't available"
          body="It may have been deleted, or you may not have access to it."
          action={
            canViewThreeD(user) ? (
              <Link href="/3d-projects">
                <Button>Back to 3D Projects</Button>
              </Link>
            ) : undefined
          }
        />
      </Card>
    );
  }

  const mayManage = canManageTaskGroups(user, project);
  const mayAddTask = canCreateTaskInProject(user, project);

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/3d-projects"
        className="inline-flex items-center gap-1.5 self-start text-[13px] text-ink-muted hover:text-ink"
      >
        <IconArrowLeft size={14} /> 3D Projects
      </Link>

      <PageHeader
        title={project.name}
        icon={<IconCube size={20} />}
        subtitle={`${formatDate(project.startDate)} – ${formatDate(project.deadline)} · ${project.status}`}
        actions={
          <>
            {project.stepByStep ? <Badge>SBS — step by step</Badge> : null}
            <ProjectDriveControls project={project} />
            <Link href={`/projects/${project.id}`}>
              <Button>Project page</Button>
            </Link>
            {mayManage ? (
              <Button variant="primary" onClick={() => setAddingGroup(true)}>
                <IconPlus size={15} /> Add group
              </Button>
            ) : null}
          </>
        }
      />

      {groups.length === 0 && ungrouped.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconCube size={30} />}
            title="No groups yet"
            body={
              mayManage
                ? "Add the first group, T1, then add its tasks: T1.1, T1.2 and so on."
                : "The work in this project hasn't been laid out yet."
            }
          />
        </Card>
      ) : null}

      <div className="flex flex-col gap-3">
        {groups.map((g) => (
          <TaskGroupCard
            key={g.id}
            group={g}
            project={project}
            allTasks={projectTasks}
            onOpenTask={setOpenTaskId}
            onAddTask={mayAddTask ? () => setAddingTaskTo(g.id) : undefined}
            onRename={mayManage ? () => setRenaming(g) : undefined}
            onDelete={mayManage ? () => setDeleting(g) : undefined}
          />
        ))}
        {ungrouped.length > 0 ? (
          <TaskGroupCard
            group={null}
            project={project}
            allTasks={projectTasks}
            onOpenTask={setOpenTaskId}
            onAddTask={mayAddTask ? () => setAddingTaskTo(null) : undefined}
          />
        ) : null}
      </div>

      {addingGroup ? (
        <GroupFormModal
          projectId={project.id}
          nextNumber={Math.max(0, ...groups.map((g) => g.number)) + 1}
          onClose={() => setAddingGroup(false)}
        />
      ) : null}
      {renaming ? (
        <GroupFormModal
          projectId={project.id}
          group={renaming}
          onClose={() => setRenaming(null)}
        />
      ) : null}

      {addingTaskTo !== undefined ? (
        <TaskFormModal
          open
          mode="project"
          project={project}
          defaultDepartment={THREE_D_DEPARTMENT}
          defaultGroupId={addingTaskTo ?? undefined}
          onClose={() => setAddingTaskTo(undefined)}
        />
      ) : null}

      {openTaskId ? (
        <TaskDetailDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
      ) : null}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) deleteTaskGroup(deleting.id);
          setDeleting(null);
        }}
        title={deleting ? `Delete T${deleting.number} ${deleting.name}?` : "Delete group?"}
        body="Its number will not be used again in this project."
      />
    </div>
  );
}
