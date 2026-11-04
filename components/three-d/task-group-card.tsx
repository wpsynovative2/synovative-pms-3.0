"use client";

import { useMemo, useState } from "react";
import { DueDate, OverdueBadge, StatusBadge } from "@/components/task/task-bits";
import { ThreeDNotesView } from "@/components/three-d/notes";
import { ThreeDThumbnail } from "@/components/three-d/thumbnail";
import {
  IconChevronDown,
  IconChevronRight,
  IconEdit,
  IconPlus,
  IconTrash,
} from "@/components/ui/icons";
import { Avatar, Badge, Button, Card, IconButton, ProgressBar } from "@/components/ui/primitives";
import { groupProgress, type GroupState } from "@/lib/analytics";
import { formatShortDate } from "@/lib/calendar";
import { useStore } from "@/lib/store";
import { isTaskWaiting, type Project, type Task, type TaskGroup } from "@/lib/types";

const STATE_STYLE: Record<GroupState, string> = {
  "Not Started": "border-line bg-surface-2 text-ink-muted",
  Waiting: "border-line bg-surface-2 text-ink-faint",
  "In Progress": "border-st-inprogress/40 bg-st-inprogress/15 text-st-inprogress",
  Done: "border-st-approved/40 bg-st-approved/15 text-st-approved",
};

/**
 * One group of a 3D project, opening onto its tasks: T1, then T1.1, T1.2. With no
 * group it is the Ungrouped section, for tasks that reached the project another way,
 * such as from an OBC or a template (Archi-3d.md §3).
 */
export function TaskGroupCard({
  group,
  project,
  allTasks,
  shownTaskIds,
  onOpenTask,
  onAddTask,
  onEdit,
  onDelete,
}: {
  group: TaskGroup | null;
  project: Project;
  /** Every task of the project, so a waiting task can name what it waits on. */
  allTasks: Task[];
  /** What the page's filters leave. The progress still counts the whole group. */
  shownTaskIds?: Set<string>;
  onOpenTask: (id: string) => void;
  onAddTask?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const { userById } = useStore();
  const [open, setOpen] = useState(true);

  const tasks = useMemo(
    () =>
      allTasks
        .filter((t) => (t.groupId ?? null) === (group?.id ?? null))
        // Grouped tasks by number; ungrouped ones have none and keep creation order.
        .sort((a, b) => (a.groupNumber ?? 0) - (b.groupNumber ?? 0)),
    [allTasks, group?.id],
  );
  const rows = useMemo(
    () => (shownTaskIds ? tasks.filter((t) => shownTaskIds.has(t.id)) : tasks),
    [tasks, shownTaskIds],
  );
  const progress = useMemo(() => groupProgress(tasks), [tasks]);
  const pastDeadline = progress.dueDate > project.deadline;

  /** "T1.3, T2.2", or the titles of anything without a number. */
  const waitingOn = (t: Task) =>
    (t.waitingOnTaskIds ?? [])
      .map((id) => allTasks.find((x) => x.id === id))
      .filter((x) => !!x)
      .map((x) => x.code ?? x.title)
      .join(", ");

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-48 flex-1 items-center gap-2 text-left"
        >
          {open ? (
            <IconChevronDown size={15} className="shrink-0 text-ink-faint" />
          ) : (
            <IconChevronRight size={15} className="shrink-0 text-ink-faint" />
          )}
          {group ? (
            <span className="shrink-0 text-sm font-semibold text-brand-ink">T{group.number}</span>
          ) : null}
          <span className="truncate text-sm font-medium text-ink">
            {group ? group.name : "Ungrouped"}
          </span>
        </button>

        {group ? (
          <>
            <span className="flex w-32 items-center gap-2">
              <ProgressBar
                value={progress.total ? (progress.approved / progress.total) * 100 : 0}
              />
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
        ) : null}

        {onEdit ? (
          <IconButton label={`Edit T${group?.number}`} onClick={onEdit}>
            <IconEdit size={14} />
          </IconButton>
        ) : null}
        {/* The database refuses to delete a group that still has tasks. */}
        {onDelete && tasks.length === 0 ? (
          <IconButton label={`Delete T${group?.number}`} onClick={onDelete}>
            <IconTrash size={14} />
          </IconButton>
        ) : null}
      </div>

      {open ? (
        <div className="flex flex-col gap-1 border-t border-line-soft px-3 py-2.5">
          {group ? (
            <div className="px-2 pb-1 empty:hidden">
              <ThreeDNotesView notes={group} />
            </div>
          ) : null}
          {rows.map((t) => {
            const assignee = userById(t.assigneeId);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onOpenTask(t.id)}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-2"
              >
                {t.code ? (
                  <span className="w-11 shrink-0 text-[12px] font-medium text-ink-muted">
                    {t.code}
                  </span>
                ) : null}
                {t.thumbnailFileId ? (
                  <ThreeDThumbnail
                    key={t.thumbnailFileId}
                    fileId={t.thumbnailFileId}
                    alt=""
                    className="h-8 w-12 shrink-0 rounded border border-line object-cover"
                  />
                ) : null}
                <span className="flex min-w-40 flex-1 flex-col">
                  <span className="truncate text-[13px] text-ink">{t.title}</span>
                  {t.threeDCategory || t.threeDSoftware ? (
                    <span className="truncate text-[11px] text-ink-faint">
                      {[t.threeDCategory, t.threeDSoftware].filter(Boolean).join(" · ")}
                    </span>
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

          {tasks.length === 0 ? (
            <p className="px-2 py-2 text-[12px] text-ink-faint">No tasks in this group yet.</p>
          ) : null}

          {onAddTask ? (
            <Button size="sm" className="mt-1 self-start" onClick={onAddTask}>
              <IconPlus size={13} />
              {group ? ` Add task to T${group.number}` : " Add task"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
