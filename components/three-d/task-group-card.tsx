"use client";

import { useMemo, useState } from "react";
import { DueDate, OverdueBadge, StatusBadge } from "@/components/task/task-bits";
import { ThreeDDetailsPanel } from "@/components/three-d/notes";
import { ThreeDThumbnailHover } from "@/components/three-d/thumbnail";
import {
  IconChevronDown,
  IconChevronRight,
  IconEdit,
  IconPlus,
  IconTrash,
} from "@/components/ui/icons";
import { Avatar, Badge, Button, Card, IconButton, ProgressBar, cx } from "@/components/ui/primitives";
import { groupProgress, type GroupState } from "@/lib/analytics";
import { formatShortDate } from "@/lib/calendar";
import { threeDSummary } from "@/lib/master-data";
import { useStore } from "@/lib/store";
import { isTaskWaiting, type Project, type Task, type TaskGroup } from "@/lib/types";

const STATE_STYLE: Record<GroupState, string> = {
  "Not Started": "border-line bg-surface-2 text-ink-muted",
  Waiting: "border-line bg-surface-2 text-ink-faint",
  "In Progress": "border-st-inprogress/40 bg-st-inprogress/15 text-st-inprogress",
  Done: "border-st-approved/40 bg-st-approved/15 text-st-approved",
};

const byNumber = (a: Task, b: Task) => (a.groupNumber ?? 0) - (b.groupNumber ?? 0);

/*
 * Each level has its own colour so they are told apart at a glance: a group is
 * violet, a sub-group a light sky, and a task plain surface inside it.
 */
export const LEVEL_STYLE = {
  group: {
    card: "overflow-hidden border-l-4 border-l-tint-violet",
    header: "bg-brand-dim/70",
    chip: "bg-brand text-on-brand",
    label: "text-tint-violet",
  },
  subGroup: {
    panel: "border border-tint-blue/30 border-l-4 border-l-tint-blue bg-tint-blue/6",
    chip: "bg-tint-blue/15 text-tint-blue",
    label: "text-tint-blue",
  },
} as const;

/** "T1 GROUP": the code in its level's colour, and what the level is. */
export function LevelCode({ code, level }: { code: string; level: "group" | "subGroup" }) {
  const style = LEVEL_STYLE[level];
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span className={`rounded-md px-1.5 py-0.5 text-[12px] font-semibold ${style.chip}`}>
        {code}
      </span>
      <span className={`text-[10px] font-semibold tracking-wide uppercase ${style.label}`}>
        {level === "group" ? "Group" : "Sub-group"}
      </span>
    </span>
  );
}

/**
 * One group of a 3D project, opening onto its sub-groups, each opening onto its
 * tasks: T1, then T1.1, then T1.1.1 (Archi-3d.md §1). Both levels show a progress
 * bar over every task under them. With no group it is the Ungrouped section, for
 * tasks that reached the project another way, such as from an OBC or a template.
 */
export function TaskGroupCard({
  group,
  subGroups = [],
  project,
  allTasks,
  shownTaskIds,
  onOpenTask,
  onAddTask,
  onAddSubGroup,
  onEdit,
  onDelete,
}: {
  group: TaskGroup | null;
  /** The group's sub-groups, in number order. */
  subGroups?: TaskGroup[];
  project: Project;
  /** Every task of the project, so a waiting task can name what it waits on. */
  allTasks: Task[];
  /** What the page's filters leave. Progress still counts every task. */
  shownTaskIds?: Set<string>;
  onOpenTask: (id: string) => void;
  /** With a sub-group's id, or null for the Ungrouped section. */
  onAddTask?: (subGroupId: string | null) => void;
  onAddSubGroup?: () => void;
  /** Called with the group itself or one of its sub-groups. */
  onEdit?: (g: TaskGroup) => void;
  onDelete?: (g: TaskGroup) => void;
}) {
  // Closed until opened, so a long project reads as a list of its groups. While
  // the page is filtering, what matched is opened to show it; a click still wins.
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? !!shownTaskIds;

  const subIds = useMemo(() => new Set(subGroups.map((s) => s.id)), [subGroups]);
  // Ungrouped: tasks outside every group. A group: every task in its sub-groups.
  const tasks = useMemo(
    () =>
      group
        ? allTasks.filter((t) => !!t.groupId && subIds.has(t.groupId))
        : allTasks.filter((t) => !t.groupId && !t.shortId),
    [allTasks, group, subIds],
  );
  const filtering = !!shownTaskIds;
  // While filtering, a sub-group with nothing left to show gets out of the way.
  const shownSubGroups = filtering
    ? subGroups.filter((s) => allTasks.some((t) => t.groupId === s.id && shownTaskIds.has(t.id)))
    : subGroups;

  const code = group ? `T${group.number}` : "";

  return (
    <Card className={group ? LEVEL_STYLE.group.card : undefined}>
      <div
        className={cx(
          "flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3",
          group && LEVEL_STYLE.group.header,
        )}
      >
        <button
          type="button"
          onClick={() => setChoice(!open)}
          aria-expanded={open}
          className="flex min-w-48 flex-1 items-center gap-2 text-left"
        >
          {open ? (
            <IconChevronDown size={15} className="shrink-0 text-ink-faint" />
          ) : (
            <IconChevronRight size={15} className="shrink-0 text-ink-faint" />
          )}
          {group ? <LevelCode code={code} level="group" /> : null}
          <span className="truncate text-sm font-semibold text-ink">
            {group ? group.name : "Ungrouped"}
          </span>
          {group ? (
            <span className="shrink-0 text-[11px] text-ink-faint">
              {subGroups.length} sub-group{subGroups.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </button>

        {group ? <ProgressSummary tasks={tasks} project={project} width="w-36" /> : null}

        {group && onEdit ? (
          <IconButton label={`Edit ${code}`} onClick={() => onEdit(group)}>
            <IconEdit size={14} />
          </IconButton>
        ) : null}
        {/* Takes its sub-groups and their tasks with it (0034); the page asks first. */}
        {group && onDelete ? (
          <IconButton label={`Delete ${code}`} onClick={() => onDelete(group)}>
            <IconTrash size={14} />
          </IconButton>
        ) : null}
      </div>

      {open ? (
        <div className="flex flex-col gap-2.5 border-t border-line-soft px-3 py-3">
          {group ? (
            <>
              <ThreeDDetailsPanel description={group.description} notes={group} />
              {shownSubGroups.map((s) => (
                <SubGroupSection
                  key={s.id}
                  code={`${code}.${s.number}`}
                  subGroup={s}
                  project={project}
                  allTasks={allTasks}
                  shownTaskIds={shownTaskIds}
                  onOpenTask={onOpenTask}
                  onAddTask={onAddTask ? () => onAddTask(s.id) : undefined}
                  onEdit={onEdit ? () => onEdit(s) : undefined}
                  onDelete={onDelete ? () => onDelete(s) : undefined}
                />
              ))}
              {subGroups.length === 0 ? (
                <p className="px-2 py-2 text-[12px] text-ink-faint">
                  No sub-groups in this group yet.
                </p>
              ) : null}
              {onAddSubGroup ? (
                <Button size="sm" className="mt-1 self-start" onClick={onAddSubGroup}>
                  <IconPlus size={13} /> Add sub-group to {code}
                </Button>
              ) : null}
            </>
          ) : (
            <TaskRows
              tasks={filtering ? tasks.filter((t) => shownTaskIds.has(t.id)) : tasks}
              allTasks={allTasks}
              onOpenTask={onOpenTask}
            />
          )}
          {!group && onAddTask ? (
            <Button size="sm" className="mt-1 self-start" onClick={() => onAddTask(null)}>
              <IconPlus size={13} /> Add task
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

/** T1.2 inside its group: its description, notes and tasks, with its own progress. */
function SubGroupSection({
  code,
  subGroup,
  project,
  allTasks,
  shownTaskIds,
  onOpenTask,
  onAddTask,
  onEdit,
  onDelete,
}: {
  code: string;
  subGroup: TaskGroup;
  project: Project;
  allTasks: Task[];
  shownTaskIds?: Set<string>;
  onOpenTask: (id: string) => void;
  onAddTask?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  // Closed until opened, so a long project reads as a list of its groups. While
  // the page is filtering, what matched is opened to show it; a click still wins.
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? !!shownTaskIds;
  const tasks = useMemo(
    () => allTasks.filter((t) => t.groupId === subGroup.id).sort(byNumber),
    [allTasks, subGroup.id],
  );
  const rows = shownTaskIds ? tasks.filter((t) => shownTaskIds.has(t.id)) : tasks;

  return (
    <div className={cx("rounded-lg", LEVEL_STYLE.subGroup.panel)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setChoice(!open)}
          aria-expanded={open}
          className="flex min-w-44 flex-1 items-center gap-2 text-left"
        >
          {open ? (
            <IconChevronDown size={14} className="shrink-0 text-ink-faint" />
          ) : (
            <IconChevronRight size={14} className="shrink-0 text-ink-faint" />
          )}
          <LevelCode code={code} level="subGroup" />
          <span className="truncate text-[13px] font-medium text-ink">{subGroup.name}</span>
        </button>

        <ProgressSummary tasks={tasks} project={project} width="w-32" />

        {onEdit ? (
          <IconButton label={`Edit ${code}`} onClick={onEdit}>
            <IconEdit size={14} />
          </IconButton>
        ) : null}
        {/* Takes its tasks with it (0034); the page asks first. */}
        {onDelete ? (
          <IconButton label={`Delete ${code}`} onClick={onDelete}>
            <IconTrash size={14} />
          </IconButton>
        ) : null}
      </div>

      {open ? (
        <div className="flex flex-col gap-1 border-t border-tint-blue/20 px-2 py-2">
          <ThreeDDetailsPanel
            description={subGroup.description}
            notes={subGroup}
            className="mb-1"
          />
          {rows.length ? (
            // Tasks sit on plain surface, so they stand out from the sky behind.
            <div className="flex flex-col rounded-md border border-line-soft bg-surface">
              <TaskRows tasks={rows} allTasks={allTasks} onOpenTask={onOpenTask} />
            </div>
          ) : null}
          {tasks.length === 0 ? (
            <p className="px-2 py-2 text-[12px] text-ink-faint">
              No tasks in this sub-group yet.
            </p>
          ) : null}
          {onAddTask ? (
            <Button size="sm" className="mt-1 self-start" onClick={onAddTask}>
              <IconPlus size={13} /> Add task to {code}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Progress, dates, state and markers over every task given (Archi-3d.md §4). */
function ProgressSummary({
  tasks,
  project,
  width,
}: {
  tasks: Task[];
  project: Project;
  width: string;
}) {
  const progress = useMemo(() => groupProgress(tasks), [tasks]);
  const pastDeadline = progress.dueDate > project.deadline;
  return (
    <>
      <span className={`flex ${width} items-center gap-2`}>
        <ProgressBar value={progress.total ? (progress.approved / progress.total) * 100 : 0} />
        <span className="shrink-0 text-[12px] text-ink-muted">
          {progress.approved}/{progress.total}
        </span>
      </span>
      {progress.total ? (
        <span className="text-[12px] text-ink-muted">
          {formatShortDate(progress.startDate)} → {formatShortDate(progress.dueDate)}
        </span>
      ) : null}
      <Badge className={STATE_STYLE[progress.state]}>{progress.state}</Badge>
      {progress.overdue ? (
        <Badge className="border-st-rejected/40 bg-st-rejected/20 text-st-rejected">
          Overdue
        </Badge>
      ) : null}
      {pastDeadline ? (
        <Badge className="border-st-rejected/40 bg-st-rejected/20 text-st-rejected">
          Past deadline
        </Badge>
      ) : null}
    </>
  );
}

function TaskRows({
  tasks,
  allTasks,
  onOpenTask,
}: {
  tasks: Task[];
  allTasks: Task[];
  onOpenTask: (id: string) => void;
}) {
  const { db, userById } = useStore();

  /**
   * "T1.1.3, T2.1.2", or the titles of anything without a number, and the
   * files still to come.
   */
  const waitingOn = (t: Task) =>
    [
      ...(t.waitingOnFileGroupIds ?? [])
        .map((id) => db.fileGroups.find((g) => g.id === id)?.name)
        .filter((x) => !!x)
        .map((name) => `files: ${name}`),
      ...(t.waitingOnTaskIds ?? [])
        .map((id) => allTasks.find((x) => x.id === id))
        .filter((x) => !!x)
        .map((x) => x.code ?? x.title),
    ].join(", ");

  return (
    <>
      {tasks.map((t) => {
        const assignee = userById(t.assigneeId);
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onOpenTask(t.id)}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-2"
          >
            {t.code ? (
              <span className="w-14 shrink-0 text-[12px] font-medium text-ink-muted">
                {t.code}
              </span>
            ) : null}
            {t.thumbnailFileId ? (
              <ThreeDThumbnailHover
                key={t.thumbnailFileId}
                fileId={t.thumbnailFileId}
                alt=""
                className="block h-8 w-12 rounded border border-line object-cover"
              />
            ) : null}
            <span className="flex min-w-40 flex-1 flex-col">
              <span className="truncate text-[13px] text-ink">{t.title}</span>
              {threeDSummary(t) ? (
                <span className="truncate text-[11px] text-ink-faint">{threeDSummary(t)}</span>
              ) : null}
            </span>
            {assignee ? (
              <span className="flex items-center gap-1.5 text-[12px] text-ink-muted">
                <Avatar name={assignee.fullName} size={20} />
                {assignee.fullName}
              </span>
            ) : (
              <span className="text-[12px] text-ink-faint">Nobody yet</span>
            )}
            {isTaskWaiting(t) ? (
              <span className="text-[11px] text-ink-faint">Waiting on {waitingOn(t)}</span>
            ) : (
              <StatusBadge status={t.status} task={t} />
            )}
            <OverdueBadge task={t} />
            <DueDate task={t} />
          </button>
        );
      })}
    </>
  );
}
