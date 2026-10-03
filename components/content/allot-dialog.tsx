"use client";

import { useMemo, useState } from "react";
import { DatePicker, dateUnavailableReason } from "@/components/ui/date-picker";
import { DurationField } from "@/components/ui/duration-field";
import { IconPlus, IconTasks } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { Badge, Button, Field, Input, Select, cx } from "@/components/ui/primitives";
import { SearchSelect } from "@/components/ui/selects";
import { addWorkingDays, formatDate, nextWorkingDay, todayISO } from "@/lib/calendar";
import { PRIORITIES, TASK_STATUS_STYLE, WORKDAY_HOURS } from "@/lib/master-data";
import { useStore } from "@/lib/store";
import type { ContentEntry, Priority, Project } from "@/lib/types";

/*
 * Allotting a piece: who builds it, and on which of their tasks (0025).
 *
 * Every allotment lands on a task the allottee holds on this project, so the
 * piece shows up where they actually work. If they already have exactly one
 * task here it is picked for them; with several they choose; with none - they
 * are new to the project - a task has to be created for them, which is how
 * they are brought on to it.
 */

/** Marks the "create a new task" choice in the task list. */
const NEW = "__new__";

interface NewTaskDraft {
  title: string;
  department: string;
  priority: Priority;
  startDate: string;
  dueDate: string;
  estimatedHours: number;
}

export function AllotDialog({
  entry,
  project,
  onClose,
}: {
  entry: ContentEntry;
  project: Project;
  onClose: () => void;
}) {
  const { db, allotContent } = useStore();

  const [userId, setUserId] = useState(entry.allottedTo ?? "");
  const [taskChoice, setTaskChoice] = useState(entry.allottedTaskId ?? "");
  const [draft, setDraft] = useState<NewTaskDraft>(() =>
    blankTask(entry, project, db.calendar, db.departments, null),
  );
  const [touched, setTouched] = useState(false);

  // The project's own people first, then everyone else under their department.
  const people = useMemo(() => {
    const onProject = new Set<string>();
    if (project.leaderId) onProject.add(project.leaderId);
    for (const t of db.tasks) {
      if (t.projectId === project.id && t.assigneeId) onProject.add(t.assigneeId);
    }
    const active = db.users.filter((u) => u.active);
    const toOption = (u: (typeof active)[number]) => ({
      value: u.id,
      label: u.fullName,
      hint: onProject.has(u.id) ? "On this project" : u.departments[0],
      avatarName: u.fullName,
    });
    return [
      ...active.filter((u) => onProject.has(u.id)).map(toOption),
      ...active.filter((u) => !onProject.has(u.id)).map(toOption),
    ];
  }, [db.tasks, db.users, project]);

  const theirTasks = useMemo(
    () =>
      userId
        ? db.tasks
            .filter((t) => t.projectId === project.id && t.assigneeId === userId)
            .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        : [],
    [db.tasks, project.id, userId],
  );

  /** Picking a person settles the task choice where there is only one answer. */
  const pickUser = (id: string) => {
    setUserId(id);
    setTouched(false);
    const user = db.users.find((u) => u.id === id) ?? null;
    const tasks = db.tasks.filter((t) => t.projectId === project.id && t.assigneeId === id);
    setTaskChoice(tasks.length === 1 ? tasks[0].id : tasks.length === 0 ? NEW : "");
    setDraft(blankTask(entry, project, db.calendar, db.departments, user?.departments ?? null));
  };

  const creating = !!userId && taskChoice === NEW;
  const bounds = { min: project.startDate, max: project.deadline };
  const set = <K extends keyof NewTaskDraft>(k: K, v: NewTaskDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const errors = {
    user: !userId ? "Pick who this piece is for." : undefined,
    task: userId && !taskChoice ? "Pick the task this piece is for." : undefined,
    title: creating && !draft.title.trim() ? "The task needs a title." : undefined,
    department: creating && !draft.department ? "Pick a department." : undefined,
    startDate: creating
      ? (dateUnavailableReason(draft.startDate, { config: db.calendar, ...bounds }) ?? undefined)
      : undefined,
    dueDate: creating
      ? draft.dueDate < draft.startDate
        ? "The due date must be on or after the start date."
        : (dateUnavailableReason(draft.dueDate, { config: db.calendar, ...bounds }) ?? undefined)
      : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);

  const save = () => {
    setTouched(true);
    if (!valid) return;
    if (creating) {
      allotContent(entry.id, {
        userId,
        newTask: {
          projectId: project.id,
          title: draft.title.trim(),
          description: "",
          department: draft.department,
          assigneeId: userId,
          status: "Not Started",
          priority: draft.priority,
          startDate: draft.startDate,
          dueDate: draft.dueDate,
          estimatedHours: draft.estimatedHours,
          tags: [],
        },
      });
    } else {
      allotContent(entry.id, { userId, taskId: taskChoice });
    }
    onClose();
  };

  const newcomer = !!userId && theirTasks.length === 0;

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Allot this piece"
      subtitle={`${entry.caption.trim() || entry.type} · ${project.name}`}
      footer={
        <>
          {entry.allottedTo ? (
            <Button
              variant="danger"
              className="mr-auto"
              onClick={() => {
                allotContent(entry.id, null);
                onClose();
              }}
            >
              Remove allotment
            </Button>
          ) : null}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            {creating ? "Create task & allot" : "Allot"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Allotment to" required error={touched ? errors.user : undefined}>
          <SearchSelect
            options={people}
            value={userId}
            onChange={pickUser}
            placeholder="Pick a team member"
          />
        </Field>

        {userId ? (
          <Field
            label="For task"
            required
            hint={
              newcomer
                ? "They have no task on this project yet, so one has to be created for them."
                : theirTasks.length === 1
                  ? "Their only task on this project is picked; or create a new one."
                  : undefined
            }
            error={touched ? errors.task : undefined}
          >
            <ul className="flex flex-col gap-1.5">
              {theirTasks.map((t) => (
                <li key={t.id}>
                  <TaskOption
                    selected={taskChoice === t.id}
                    onSelect={() => setTaskChoice(t.id)}
                    icon={<IconTasks size={14} />}
                    title={t.title}
                    meta={`${t.department} · due ${formatDate(t.dueDate)}`}
                    badge={
                      <Badge className={TASK_STATUS_STYLE[t.status].chip}>{t.status}</Badge>
                    }
                  />
                </li>
              ))}
              <li>
                <TaskOption
                  selected={taskChoice === NEW}
                  onSelect={() => setTaskChoice(NEW)}
                  icon={<IconPlus size={14} />}
                  title="Create a new task"
                  meta={`On ${project.name}, assigned to them`}
                />
              </li>
            </ul>
          </Field>
        ) : null}

        {creating ? (
          // Keyed on the person so the duration box re-seeds with the new draft.
          <div
            key={userId}
            className="flex flex-col gap-4 rounded-card border border-line-soft bg-surface-2 p-3.5"
          >
            <Field label="Task title" required error={touched ? errors.title : undefined}>
              <Input
                value={draft.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="e.g. Design — Navratri static"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Department" required error={touched ? errors.department : undefined}>
                <SearchSelect
                  options={db.departments.map((d) => ({ value: d, label: d }))}
                  value={draft.department}
                  onChange={(v) => set("department", v)}
                  placeholder="Select"
                />
              </Field>
              <Field label="Priority" required>
                <Select
                  value={draft.priority}
                  onChange={(e) => set("priority", e.target.value as Priority)}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Start date" required error={touched ? errors.startDate : undefined}>
                <DatePicker
                  value={draft.startDate}
                  onChange={(v) =>
                    setDraft((d) => ({ ...d, startDate: v, dueDate: d.dueDate < v ? v : d.dueDate }))
                  }
                  config={db.calendar}
                  {...bounds}
                />
              </Field>
              <Field label="Due date" required error={touched ? errors.dueDate : undefined}>
                <DatePicker
                  value={draft.dueDate}
                  onChange={(v) => set("dueDate", v)}
                  config={db.calendar}
                  min={draft.startDate > bounds.min ? draft.startDate : bounds.min}
                  max={bounds.max}
                />
              </Field>
            </div>
            <Field label="Estimated time">
              <DurationField
                valueHours={draft.estimatedHours}
                onChange={(h) => set("estimatedHours", h ?? 0)}
              />
            </Field>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function TaskOption({
  selected,
  onSelect,
  icon,
  title,
  meta,
  badge,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  meta: string;
  badge?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cx(
        "flex w-full items-center gap-2.5 rounded-card border px-3 py-2 text-left transition-colors",
        selected
          ? "border-brand-bright/50 bg-brand/10"
          : "border-line-soft bg-surface-2 hover:border-brand-bright/30",
      )}
    >
      <span
        className={cx(
          "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
          selected ? "bg-brand/20 text-brand-ink" : "bg-surface-3 text-ink-muted",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{title}</span>
        <span className="block truncate text-[11px] text-ink-faint">{meta}</span>
      </span>
      {badge}
    </button>
  );
}

/**
 * A sensible first draft of the task: named after the piece, in the person's
 * own department, starting on the next working day inside the project window.
 */
function blankTask(
  entry: ContentEntry,
  project: Project,
  calendar: Parameters<typeof nextWorkingDay>[1],
  departments: string[],
  userDepartments: string[] | null,
): NewTaskDraft {
  const from = project.startDate > todayISO() ? project.startDate : todayISO();
  const start = nextWorkingDay(from, calendar);
  const due = addWorkingDays(start, 2, calendar);
  return {
    title: `Design — ${entry.caption.trim() || entry.type}`,
    department:
      userDepartments?.find((d) => departments.includes(d)) ?? userDepartments?.[0] ?? "",
    priority: "Medium",
    startDate: start > project.deadline ? project.deadline : start,
    dueDate: due > project.deadline ? project.deadline : due,
    estimatedHours: WORKDAY_HOURS / 2,
  };
}
