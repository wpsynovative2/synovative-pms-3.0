"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Avatar, Button, EmptyState, cx } from "@/components/ui/primitives";
import { formatDate } from "@/lib/calendar";
import { TASK_STATUS_STYLE } from "@/lib/master-data";
import { canAssignTask } from "@/lib/permissions";
import { useStore } from "@/lib/store";
import type { Project, Task, User } from "@/lib/types";
import { IconTasks } from "@/components/ui/icons";

/**
 * The tasks of a project `member` could be given: ones in a department they
 * belong to (§9.1), not theirs already, and that the signed-in person may
 * assign (canAssignTask). Shared by the Team tab's button and its dialog.
 */
export function assignableTo(
  member: User,
  user: User,
  project: Project,
  tasks: Task[],
): Task[] {
  return tasks.filter(
    (t) =>
      t.assigneeId !== member.id &&
      member.departments.includes(t.department) &&
      canAssignTask(user, t, project),
  );
}

/**
 * Tick tasks of the project and hand them all to one person - the Team tab's
 * way in for a Team Leader (0016). Each goes through assign_task, so it starts
 * again at Not Started and the change is recorded.
 */
export function AssignTasksDialog({
  member,
  project,
  tasks,
  onClose,
}: {
  member: User;
  project: Project;
  tasks: Task[];
  onClose: () => void;
}) {
  const { currentUser, userById, assignTask } = useStore();
  const [picked, setPicked] = useState<string[]>([]);
  if (!currentUser) return null;

  // Unassigned work first - that is what needs a person - then by due date.
  const options = assignableTo(member, currentUser, project, tasks).sort(
    (a, b) =>
      Number(!!a.assigneeId) - Number(!!b.assigneeId) || a.dueDate.localeCompare(b.dueDate),
  );

  const toggle = (id: string) =>
    setPicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const assign = () => {
    for (const id of picked) assignTask(id, member.id);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Assign tasks to ${member.fullName}`}
      subtitle={`${project.name} · tasks in ${member.departments.join(", ") || "their department"}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={assign} disabled={!picked.length}>
            Assign {picked.length || ""} task{picked.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      {options.length === 0 ? (
        <EmptyState
          icon={<IconTasks size={24} />}
          title="Nothing to assign"
          body="Every task in their department here is already theirs, with a reviewer, or approved."
        />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[11px] leading-relaxed text-ink-faint">
            A task taken off someone starts again at Not Started, and their running timer
            stops. Every change shows in the task&apos;s assignment history.
          </p>
          <ul className="flex flex-col gap-2">
            {options.map((t) => {
              const on = picked.includes(t.id);
              const current = userById(t.assigneeId);
              return (
                <li key={t.id}>
                  <label
                    className={cx(
                      "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                      on
                        ? "border-brand-bright/50 bg-brand/10"
                        : "border-line bg-surface-2 hover:bg-surface-3",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(t.id)}
                      className="h-4 w-4 shrink-0 accent-brand-bright"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-ink">{t.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-faint">
                        <span>{t.department}</span>
                        <span>· due {formatDate(t.dueDate)}</span>
                        <span className={cx("rounded px-1", TASK_STATUS_STYLE[t.status].chip)}>
                          {t.status}
                        </span>
                      </div>
                    </div>
                    <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-muted">
                      {current ? (
                        <>
                          <Avatar name={current.fullName} size={18} />
                          {current.fullName}
                        </>
                      ) : (
                        <span className="text-ink-faint italic">Unassigned</span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Modal>
  );
}
