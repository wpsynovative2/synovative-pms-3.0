"use client";

import { useMemo, useState } from "react";
import { DatePicker, dateUnavailableReason } from "@/components/ui/date-picker";
import { DurationField } from "@/components/ui/duration-field";
import { IconPlus, IconTasks } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { Avatar, Badge, Button, Field, Input, Select, cx } from "@/components/ui/primitives";
import { SearchSelect } from "@/components/ui/selects";
import { addWorkingDays, formatDate, nextWorkingDay, todayISO } from "@/lib/calendar";
import { PRIORITIES, TASK_STATUS_STYLE, WORKDAY_HOURS } from "@/lib/master-data";
import { useStore } from "@/lib/store";
import { contentLabel, type ContentEntry, type Priority, type Project } from "@/lib/types";

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

  /*
   * The project's own people and everyone else are shown apart, so nobody
   * mistakes an outsider for a teammate: insiders as cards with their task
   * count, outsiders in a searchable picker of their own.
   */
  const people = useMemo(() => {
    const taskCount = new Map<string, number>();
    for (const t of db.tasks) {
      if (t.projectId === project.id && t.assigneeId) {
        taskCount.set(t.assigneeId, (taskCount.get(t.assigneeId) ?? 0) + 1);
      }
    }
    const active = db.users
      .filter((u) => u.active)
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    const inside = active.filter((u) => taskCount.has(u.id));
    return {
      inside: inside.map((u) => ({ user: u, tasks: taskCount.get(u.id) ?? 0 })),
      outside: active
        .filter((u) => !taskCount.has(u.id))
        .map((u) => ({
          value: u.id,
          label: u.fullName,
          hint: u.departments[0],
          avatarName: u.fullName,
        })),
    };
  }, [db.tasks, db.users, project.id]);
  const pickedOutsider = people.outside.some((o) => o.value === userId);

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
      subtitle={`${contentLabel(entry)} · ${project.name}`}
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
          <div className="flex flex-col gap-3">
            <div className="rounded-card border border-brand-bright/30 bg-brand/5 p-3">
              <p className="mb-2 text-[11px] font-medium tracking-wide text-brand-ink uppercase">
                On this project ({people.inside.length})
              </p>
              {people.inside.length === 0 ? (
                <p className="text-[12px] text-ink-faint">Nobody holds a task here yet.</p>
              ) : (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {people.inside.map(({ user: u, tasks }) => (
                    <button
                      key={u.id}
                      type="button"
                      aria-pressed={userId === u.id}
                      onClick={() => pickUser(u.id)}
                      className={cx(
                        "flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                        userId === u.id
                          ? "border-brand-bright/60 bg-brand/15"
                          : "border-line-soft bg-surface hover:border-brand-bright/40",
                      )}
                    >
                      <Avatar name={u.fullName} size={24} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">
                          {u.fullName}
                        </span>
                        <span className="block truncate text-[11px] text-ink-faint">
                          {tasks} {tasks === 1 ? "task" : "tasks"} here · {u.departments[0] ?? ""}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div
              className={cx(
                "rounded-card border border-dashed p-3",
                pickedOutsider ? "border-st-submitted/50 bg-st-submitted/5" : "border-line",
              )}
            >
              <p className="mb-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                Someone outside the project
              </p>
              <SearchSelect
                allowClear
                options={people.outside}
                value={pickedOutsider ? userId : ""}
                onChange={(v) => (v ? pickUser(v) : pickUser(""))}
                placeholder="Search everyone else…"
              />
              <p className="mt-1.5 text-[11px] text-ink-faint">
                They have no task here, so a new task is created for them on this project.
              </p>
            </div>
          </div>
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
    title: `Design — ${contentLabel(entry)}`,
    department:
      userDepartments?.find((d) => departments.includes(d)) ?? userDepartments?.[0] ?? "",
    priority: "Medium",
    startDate: start > project.deadline ? project.deadline : start,
    dueDate: due > project.deadline ? project.deadline : due,
    estimatedHours: WORKDAY_HOURS / 2,
  };
}
