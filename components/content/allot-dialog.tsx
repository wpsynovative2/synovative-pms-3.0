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
import { useStore, type ContentAllotment } from "@/lib/store";
import {
  contentLabel,
  isStmType,
  type CalendarConfig,
  type ContentEntry,
  type Priority,
  type Project,
  type Task,
  type User,
} from "@/lib/types";

/*
 * Allotting a piece: who builds it, and on which of their tasks (0025).
 *
 * Every allotment lands on a task the allottee holds on this project, so the
 * piece shows up where they actually work. If they already have exactly one
 * task here it is picked for them; with several they choose; with none - they
 * are new to the project - a task has to be created for them, which is how
 * they are brought on to it.
 *
 * A Static to Motion piece (0022) is allotted twice, both at once: the static
 * design, then the reel editing - whose task may not start before the static
 * task is due.
 */

/** Marks the "create a new task" choice in the task list. */
const NEW = "__new__";

type PartKind = "static" | "reel";

interface NewTaskDraft {
  title: string;
  department: string;
  priority: Priority;
  startDate: string;
  dueDate: string;
  estimatedHours: number;
}

/** One person-and-task choice: the whole allotment, or one part of an STM one. */
interface Part {
  userId: string;
  taskChoice: string;
  draft: NewTaskDraft;
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
  const stm = isStmType(entry.type);

  const [design, setDesign] = useState<Part>(() => ({
    userId: entry.allottedTo ?? "",
    taskChoice: entry.allottedTaskId ?? "",
    draft: blankTask(entry, project, db.calendar, db.departments, null, "static", null),
  }));
  const [reel, setReel] = useState<Part>(() => ({
    userId: entry.motionAllottedTo ?? "",
    taskChoice: entry.motionAllottedTaskId ?? "",
    draft: blankTask(entry, project, db.calendar, db.departments, null, "reel", null),
  }));
  const [touched, setTouched] = useState(false);

  // The day the static is due: the reel task may start no earlier.
  const staticDue =
    design.taskChoice === NEW
      ? design.draft.dueDate
      : (db.tasks.find((t) => t.id === design.taskChoice)?.dueDate ?? null);

  const designErrors = partErrors(design, db.calendar, project, null);
  const reelErrors = stm ? partErrors(reel, db.calendar, project, staticDue, db.tasks) : {};
  const valid = [designErrors, reelErrors].every((e) => Object.values(e).every((x) => !x));

  const allotmentOf = (part: Part): ContentAllotment =>
    part.taskChoice === NEW
      ? {
          userId: part.userId,
          newTask: {
            projectId: project.id,
            title: part.draft.title.trim(),
            description: "",
            department: part.draft.department,
            assigneeId: part.userId,
            status: "Not Started",
            priority: part.draft.priority,
            startDate: part.draft.startDate,
            dueDate: part.draft.dueDate,
            estimatedHours: part.draft.estimatedHours,
            tags: [],
          },
        }
      : { userId: part.userId, taskId: part.taskChoice };

  const save = () => {
    setTouched(true);
    if (!valid) return;
    allotContent(entry.id, allotmentOf(design), stm ? allotmentOf(reel) : null);
    onClose();
  };

  const creating = design.taskChoice === NEW || (stm && reel.taskChoice === NEW);

  return (
    <Modal
      open
      onClose={onClose}
      size={stm ? "lg" : "md"}
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
      {stm ? (
        <div className="flex flex-col gap-5">
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-ink-muted">
            A <span className="font-medium text-ink">{entry.type}</span> piece is made in two
            steps: the static design first, then the reel editing once the static is done. Allot
            both now.
          </p>
          <PartPicker
            step={1}
            heading="Static Design"
            kind="static"
            part={design}
            setPart={setDesign}
            entry={entry}
            project={project}
            errors={touched ? designErrors : {}}
          />
          <PartPicker
            step={2}
            heading="Reel Editing"
            kind="reel"
            part={reel}
            setPart={setReel}
            entry={entry}
            project={project}
            staticDue={staticDue}
            errors={touched ? reelErrors : {}}
          />
        </div>
      ) : (
        <PartPicker
          kind="static"
          part={design}
          setPart={setDesign}
          entry={entry}
          project={project}
          errors={touched ? designErrors : {}}
        />
      )}
    </Modal>
  );
}

type PartErrors = Partial<Record<"user" | "task" | "title" | "department" | "startDate" | "dueDate", string>>;

function partErrors(
  part: Part,
  calendar: CalendarConfig,
  project: Project,
  /** Reel only: the static task's due date, which the reel may not start before. */
  staticDue: string | null,
  tasks: Task[] = [],
): PartErrors {
  const creating = !!part.userId && part.taskChoice === NEW;
  const bounds = { config: calendar, min: project.startDate, max: project.deadline };
  const picked = tasks.find((t) => t.id === part.taskChoice);
  const tooEarly = (start: string) =>
    staticDue && start < staticDue
      ? `Starts before the static design is due (${formatDate(staticDue)}).`
      : undefined;
  return {
    user: !part.userId ? "Pick who this is for." : undefined,
    task:
      part.userId && !part.taskChoice
        ? "Pick the task this is for."
        : picked
          ? tooEarly(picked.startDate)
          : undefined,
    title: creating && !part.draft.title.trim() ? "The task needs a title." : undefined,
    department: creating && !part.draft.department ? "Pick a department." : undefined,
    startDate: creating
      ? (dateUnavailableReason(part.draft.startDate, bounds) ?? tooEarly(part.draft.startDate))
      : undefined,
    dueDate: creating
      ? part.draft.dueDate < part.draft.startDate
        ? "The due date must be on or after the start date."
        : (dateUnavailableReason(part.draft.dueDate, bounds) ?? undefined)
      : undefined,
  };
}

/* ------------------------------------------------------------ one part */

function PartPicker({
  step,
  heading,
  kind,
  part,
  setPart,
  entry,
  project,
  staticDue = null,
  errors,
}: {
  step?: number;
  heading?: string;
  kind: PartKind;
  part: Part;
  setPart: (next: Part) => void;
  entry: ContentEntry;
  project: Project;
  staticDue?: string | null;
  errors: PartErrors;
}) {
  const { db } = useStore();
  const { userId, taskChoice, draft } = part;

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
  // The reel can only go on a task that starts once the static is due.
  const fits = (t: Task) => !staticDue || t.startDate >= staticDue;

  /** Picking a person settles the task choice where there is only one answer. */
  const pickUser = (id: string) => {
    const user: User | null = db.users.find((u) => u.id === id) ?? null;
    const usable = db.tasks.filter(
      (t) => t.projectId === project.id && t.assigneeId === id && fits(t),
    );
    const any = db.tasks.some((t) => t.projectId === project.id && t.assigneeId === id);
    setPart({
      userId: id,
      taskChoice: usable.length === 1 ? usable[0].id : !any ? NEW : "",
      draft: blankTask(
        entry,
        project,
        db.calendar,
        db.departments,
        user?.departments ?? null,
        kind,
        staticDue,
      ),
    });
  };

  const creating = !!userId && taskChoice === NEW;
  const bounds = { min: project.startDate, max: project.deadline };
  const setDraft = (patch: Partial<NewTaskDraft>) =>
    setPart({ ...part, draft: { ...draft, ...patch } });
  const newcomer = !!userId && theirTasks.length === 0;
  const who = kind === "reel" ? "the reel editing" : "this piece";

  const body = (
    <div className="flex flex-col gap-4">
      <Field
        label={heading ? "Allot to" : "Allotment to"}
        required
        error={errors.user}
      >
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
              onChange={(v) => pickUser(v ?? "")}
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
            kind === "reel" && staticDue
              ? `Only a task starting on or after ${formatDate(staticDue)}, when the static is due.`
              : newcomer
                ? `They have no task on this project yet, so one has to be created for ${who}.`
                : theirTasks.length === 1
                  ? "Their only task on this project is picked; or create a new one."
                  : undefined
          }
          error={errors.task}
        >
          <ul className="flex flex-col gap-1.5">
            {theirTasks.map((t) => {
              const ok = fits(t);
              return (
                <li key={t.id}>
                  <TaskOption
                    selected={taskChoice === t.id}
                    disabled={!ok}
                    onSelect={() => setPart({ ...part, taskChoice: t.id })}
                    icon={<IconTasks size={14} />}
                    title={t.title}
                    meta={
                      ok
                        ? `${t.department} · ${formatDate(t.startDate)} → ${formatDate(t.dueDate)}`
                        : `Starts ${formatDate(t.startDate)}, before the static is due`
                    }
                    badge={<Badge className={TASK_STATUS_STYLE[t.status].chip}>{t.status}</Badge>}
                  />
                </li>
              );
            })}
            <li>
              <TaskOption
                selected={taskChoice === NEW}
                onSelect={() =>
                  setPart({
                    ...part,
                    taskChoice: NEW,
                    // Re-seed the dates against the static as it stands now.
                    draft:
                      kind === "reel"
                        ? {
                            ...draft,
                            ...blankDates(project, db.calendar, staticDue),
                          }
                        : draft,
                  })
                }
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
          <Field label="Task title" required error={errors.title}>
            <Input
              value={draft.title}
              onChange={(e) => setDraft({ title: e.target.value })}
              placeholder={kind === "reel" ? "e.g. Reel — Navratri static" : "e.g. Design — Navratri static"}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Department" required error={errors.department}>
              <SearchSelect
                options={db.departments.map((d) => ({ value: d, label: d }))}
                value={draft.department}
                onChange={(v) => setDraft({ department: v })}
                placeholder="Select"
              />
            </Field>
            <Field label="Priority" required>
              <Select
                value={draft.priority}
                onChange={(e) => setDraft({ priority: e.target.value as Priority })}
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
            <Field label="Start date" required error={errors.startDate}>
              <DatePicker
                value={draft.startDate}
                onChange={(v) =>
                  setDraft({ startDate: v, dueDate: draft.dueDate < v ? v : draft.dueDate })
                }
                config={db.calendar}
                min={kind === "reel" && staticDue && staticDue > bounds.min ? staticDue : bounds.min}
                max={bounds.max}
              />
            </Field>
            <Field label="Due date" required error={errors.dueDate}>
              <DatePicker
                value={draft.dueDate}
                onChange={(v) => setDraft({ dueDate: v })}
                config={db.calendar}
                min={draft.startDate > bounds.min ? draft.startDate : bounds.min}
                max={bounds.max}
              />
            </Field>
          </div>
          <Field label="Estimated time">
            <DurationField
              valueHours={draft.estimatedHours}
              onChange={(h) => setDraft({ estimatedHours: h ?? 0 })}
            />
          </Field>
        </div>
      ) : null}
    </div>
  );

  if (!heading) return body;
  return (
    <section className="rounded-card border border-line p-3.5">
      <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand/15 text-[11px] text-brand-ink">
          {step}
        </span>
        {heading}
        {kind === "reel" ? (
          <span className="text-[11px] font-normal text-ink-faint">
            · starts once the static is done
          </span>
        ) : null}
      </h3>
      {body}
    </section>
  );
}

function TaskOption({
  selected,
  disabled,
  onSelect,
  icon,
  title,
  meta,
  badge,
}: {
  selected: boolean;
  disabled?: boolean;
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
      disabled={disabled}
      aria-pressed={selected}
      className={cx(
        "flex w-full items-center gap-2.5 rounded-card border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
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
 * When a new task runs: from the next working day inside the project window,
 * or - for the reel - from the day the static is due.
 */
function blankDates(
  project: Project,
  calendar: CalendarConfig,
  notBefore: string | null,
): Pick<NewTaskDraft, "startDate" | "dueDate"> {
  let from = project.startDate > todayISO() ? project.startDate : todayISO();
  if (notBefore && notBefore > from) from = notBefore;
  const start = notBefore && from === notBefore ? from : nextWorkingDay(from, calendar);
  const due = addWorkingDays(start, 2, calendar);
  return {
    startDate: start > project.deadline ? project.deadline : start,
    dueDate: due > project.deadline ? project.deadline : due,
  };
}

/**
 * A sensible first draft of the task: named after the piece, in the person's
 * own department, starting on the next working day inside the project window.
 */
function blankTask(
  entry: ContentEntry,
  project: Project,
  calendar: CalendarConfig,
  departments: string[],
  userDepartments: string[] | null,
  kind: PartKind,
  staticDue: string | null,
): NewTaskDraft {
  return {
    title: `${kind === "reel" ? "Reel" : "Design"} — ${contentLabel(entry)}`,
    department:
      userDepartments?.find((d) => departments.includes(d)) ?? userDepartments?.[0] ?? "",
    priority: "Medium",
    ...blankDates(project, calendar, kind === "reel" ? staticDue : null),
    estimatedHours: WORKDAY_HOURS / 2,
  };
}
