"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { ProjectDriveControls } from "@/components/project/project-drive";
import { GroupFormModal } from "@/components/three-d/group-form";
import { ShortsTab } from "@/components/three-d/shorts-tab";
import { TaskGroupCard } from "@/components/three-d/task-group-card";
import {
  ThreeDTaskFilters,
  applyThreeDFilters,
  emptyThreeDFilters,
  isFilteringThreeD,
} from "@/components/three-d/task-filters";
import { TaskDetailDrawer } from "@/components/task/task-detail";
import { TaskFormModal } from "@/components/task/task-form";
import { IconArrowLeft, IconCube, IconPlay, IconPlus, IconTasks } from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/modal";
import { Badge, Button, Card, EmptyState, PageHeader, Tabs } from "@/components/ui/primitives";
import { formatDate } from "@/lib/calendar";
import {
  canCreateTaskInProject,
  canManageTaskGroups,
  canViewProject,
  canViewThreeD,
} from "@/lib/permissions";
import { useStore } from "@/lib/store";
import { groupTree } from "@/lib/task-groups";
import type { TaskGroup } from "@/lib/types";

type Tab = "tasks" | "shorts";

/*
 * One 3D project, in two tabs. Tasks: its numbered groups, each holding
 * sub-groups, each holding its tasks: T1, T1.1, T1.1.1 (Archi-3d.md §6). Shorts:
 * the films it renders, SH1 and their cams Cam1.1 (0035).
 * Opening a task uses the same drawer as everywhere else, and everything else about
 * the project (team, expenses, activity) is on its ordinary project page.
 */
export default function ThreeDProjectPage({ params }: PageProps<"/3d-projects/[id]">) {
  const { id } = use(params);
  const { db, currentUser, projectById, deleteTaskGroup } = useStore();
  const project = projectById(id);

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  /** The group a new sub-group goes in, while adding one. */
  const [addingSubGroupTo, setAddingSubGroupTo] = useState<TaskGroup | null>(null);
  const [editing, setEditing] = useState<TaskGroup | null>(null);
  const [deleting, setDeleting] = useState<TaskGroup | null>(null);
  /** A sub-group's id. Undefined: adding is closed. Null: adding a task outside any group. */
  const [addingTaskTo, setAddingTaskTo] = useState<string | null | undefined>(undefined);
  const [filters, setFilters] = useState(emptyThreeDFilters);
  const [tab, setTab] = useState<Tab>("tasks");

  const tree = useMemo(() => groupTree(db.taskGroups, id), [db.taskGroups, id]);
  const projectGroups = useMemo(
    () => db.taskGroups.filter((g) => g.projectId === id),
    [db.taskGroups, id],
  );
  // Content tasks are not part of this module (0023). An older project marked 3D
  // keeps any it had, on its ordinary project page.
  const projectTasks = useMemo(
    () => db.tasks.filter((t) => t.projectId === id && t.kind === "standard"),
    [db.tasks, id],
  );
  // Cams are tasks too, but they belong to the Shorts tab (0035). The full list
  // stays for naming what a task waits on.
  const groupTasks = useMemo(() => projectTasks.filter((t) => !t.shortId), [projectTasks]);
  const camCount = projectTasks.length - groupTasks.length;
  const ungrouped = useMemo(() => groupTasks.filter((t) => !t.groupId), [groupTasks]);
  const shownTasks = useMemo(
    () => applyThreeDFilters(groupTasks, filters, projectGroups),
    [groupTasks, filters, projectGroups],
  );
  const shownTaskIds = useMemo(() => new Set(shownTasks.map((t) => t.id)), [shownTasks]);

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
  // While filtering, a group with nothing left to show gets out of the way.
  const filtering = isFilteringThreeD(filters);
  const shownTree = filtering
    ? tree.filter(({ subGroups }) =>
        shownTasks.some((t) => subGroups.some((s) => s.id === t.groupId)),
      )
    : tree;
  /** What goes with a group or sub-group (0034), said before it goes. */
  const deleteWarning = (g: TaskGroup) => {
    const subs = projectGroups.filter((x) => x.parentId === g.id);
    const ids = new Set([g.id, ...subs.map((x) => x.id)]);
    const tasks = projectTasks.filter((t) => !!t.groupId && ids.has(t.groupId)).length;
    const parts = [
      ...(g.parentId ? [] : [`${subs.length} sub-group${subs.length === 1 ? "" : "s"}`]),
      `${tasks} task${tasks === 1 ? "" : "s"}`,
    ];
    const contents =
      subs.length || tasks
        ? `This also deletes its ${parts.join(" and ")}, with their time logs, submissions, reviews and remarks. This cannot be undone. `
        : "";
    return `${contents}Its number will not be used again.`;
  };
  /** "T1" or "T1.2", for the titles of the dialogs. */
  const codeOf = (g: TaskGroup) => {
    const parent = g.parentId ? projectGroups.find((x) => x.id === g.parentId) : undefined;
    return parent ? `T${parent.number}.${g.number}` : `T${g.number}`;
  };
  const showUngrouped = filtering ? shownTasks.some((t) => !t.groupId) : ungrouped.length > 0;

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
            {mayManage && tab === "tasks" ? (
              <Button variant="primary" onClick={() => setAddingGroup(true)}>
                <IconPlus size={15} /> Add group
              </Button>
            ) : null}
          </>
        }
      />

      <Tabs<Tab>
        className="self-start"
        tabs={[
          { id: "tasks", label: "Tasks", icon: <IconTasks size={14} />, count: groupTasks.length },
          { id: "shorts", label: "Shorts", icon: <IconPlay size={14} />, count: camCount },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "shorts" ? (
        <ShortsTab
          project={project}
          groups={projectGroups}
          tasks={projectTasks}
          mayManage={mayManage}
          onOpenTask={setOpenTaskId}
        />
      ) : (
        <>
          {groupTasks.length > 0 ? (
            <ThreeDTaskFilters
              value={filters}
              onChange={setFilters}
              tasks={groupTasks}
              groups={projectGroups}
              shown={shownTasks.length}
            />
          ) : null}

          {filtering && shownTasks.length === 0 ? (
            <Card>
              <EmptyState
                icon={<IconCube size={30} />}
                title="No tasks match these filters"
                action={<Button onClick={() => setFilters(emptyThreeDFilters)}>Clear filters</Button>}
              />
            </Card>
          ) : null}

          {tree.length === 0 && ungrouped.length === 0 ? (
            <Card>
              <EmptyState
                icon={<IconCube size={30} />}
                title="No groups yet"
                body={
                  mayManage
                    ? "Add the first group, T1, then its sub-groups T1.1, T1.2, and their tasks: T1.1.1, T1.1.2 and so on."
                    : "The work in this project hasn't been laid out yet."
                }
              />
            </Card>
          ) : null}

          <div className="flex flex-col gap-3">
            {shownTree.map(({ group, subGroups }) => (
              <TaskGroupCard
                key={group.id}
                group={group}
                subGroups={subGroups}
                project={project}
                allTasks={projectTasks}
                shownTaskIds={filtering ? shownTaskIds : undefined}
                onOpenTask={setOpenTaskId}
                onAddTask={mayAddTask ? (subGroupId) => setAddingTaskTo(subGroupId) : undefined}
                onAddSubGroup={mayManage ? () => setAddingSubGroupTo(group) : undefined}
                onEdit={mayManage ? setEditing : undefined}
                onDelete={mayManage ? setDeleting : undefined}
              />
            ))}
            {showUngrouped ? (
              <TaskGroupCard
                group={null}
                project={project}
                allTasks={projectTasks}
                shownTaskIds={filtering ? shownTaskIds : undefined}
                onOpenTask={setOpenTaskId}
                onAddTask={mayAddTask ? setAddingTaskTo : undefined}
              />
            ) : null}
          </div>
        </>
      )}

      {addingGroup ? (
        <GroupFormModal
          projectId={project.id}
          nextNumber={Math.max(0, ...tree.map(({ group }) => group.number)) + 1}
          onClose={() => setAddingGroup(false)}
        />
      ) : null}
      {addingSubGroupTo ? (
        <GroupFormModal
          projectId={project.id}
          parent={addingSubGroupTo}
          nextNumber={
            Math.max(
              0,
              ...projectGroups
                .filter((g) => g.parentId === addingSubGroupTo.id)
                .map((g) => g.number),
            ) + 1
          }
          onClose={() => setAddingSubGroupTo(null)}
        />
      ) : null}
      {editing ? (
        <GroupFormModal
          projectId={project.id}
          group={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {addingTaskTo !== undefined ? (
        <TaskFormModal
          open
          mode="project"
          project={project}
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
        title={deleting ? `Delete ${codeOf(deleting)} ${deleting.name}?` : "Delete group?"}
        body={deleting ? deleteWarning(deleting) : ""}
      />
    </div>
  );
}
