"use client";

import { useMemo, useState } from "react";
import {
  DEFAULT_CONTENT_TYPE,
  PieceTypesPicker,
  pieceTypes,
} from "@/components/content/piece-types";
import { DatePicker, dateUnavailableReason } from "@/components/ui/date-picker";
import { DurationField } from "@/components/ui/duration-field";
import { IconWarning } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { Button, Field, Input, Select, Switch, cx } from "@/components/ui/primitives";
import { RecurrencePicker } from "@/components/ui/recurrence-picker";
import { RichTextEditor } from "@/components/ui/rich-text";
import { MultiSelect, SearchSelect, TagsInput } from "@/components/ui/selects";
import { formatDate, nextWorkingDay, todayISO } from "@/lib/calendar";
import {
  chainPredecessor,
  chainTail,
  dependencyCandidates,
  dependentDates,
  workingDaysOn,
} from "@/lib/dependencies";
import {
  CONTENT_WRITER_DEPARTMENT,
  PRIORITIES,
  REVIEWER_ONLY_STATUSES,
  TASK_STATUSES,
  WORKDAY_HOURS,
} from "@/lib/master-data";
import { canReviewTask, canSeeClients, canSetRecurrence } from "@/lib/permissions";
import { ruleError, seriesFor } from "@/lib/recurrence";
import { useStore } from "@/lib/store";
import {
  type ContentType,
  type Priority,
  type Project,
  type RecurrenceRule,
  type Task,
  type TaskKind,
  type TaskStatus,
  type TaskTemplate,
  taskLabel,
} from "@/lib/types";

interface FormState {
  title: string;
  description: string;
  department: string;
  assigneeId: string;
  status: TaskStatus;
  priority: Priority;
  startDate: string;
  dueDate: string;
  estimatedHours: string;
  tags: string[];
  /** Individual tasks only; a project task shows its project's (0019). */
  companyId: string;
  propertyId: string;
  clientIds: string[];
}

export function TaskFormModal({
  open,
  onClose,
  task,
  project,
  mode,
  defaultDepartment,
  defaultGroupId,
  defaultTitle,
  defaultDescription,
  onCreated,
  recurring = false,
}: {
  open: boolean;
  onClose: () => void;
  /** Present → edit, absent → create. */
  task?: Task;
  /** The parent project for `mode === "project"`. */
  project: Project | null;
  mode: "project" | "individual";
  defaultDepartment?: string;
  /** The group a new task goes in, when added from a group in a 3D project. */
  defaultGroupId?: string;
  /** Seeds a new task, e.g. from the OBC line it delivers. */
  defaultTitle?: string;
  /** Rich text, seeded the same way — the brief that was sold. */
  defaultDescription?: string;
  /**
   * The task that was just created. Lets the caller file it against whatever it
   * was raised from, which is how an OBC's quoted lines find their task.
   */
  onCreated?: (created: Task) => void;
  /** Opened from the Recurrence page: a repeating blueprint, rule required. */
  recurring?: boolean;
}) {
  const { db, blueprints, currentUser, createTask, updateTask } = useStore();
  const calendar = db.calendar;

  // The project's other tasks, which this one may wait on (0014). A
  // blueprint's tasks live outside `db`.
  const projectTasks = useMemo(
    () =>
      project && mode === "project"
        ? [...db.tasks, ...blueprints.tasks].filter((t) => t.projectId === project.id)
        : [],
    [db.tasks, blueprints.tasks, project, mode],
  );
  // 3D projects file their tasks in numbered groups (0022). Once in a group a
  // task stays there, but an ungrouped one can still be filed.
  const is3d = mode === "project" && !!project?.is3d;
  const groups = useMemo(
    () =>
      is3d
        ? db.taskGroups
            .filter((g) => g.projectId === project?.id)
            .sort((a, b) => a.number - b.number)
        : [],
    [is3d, db.taskGroups, project?.id],
  );
  const [groupId, setGroupId] = useState(task?.groupId ?? defaultGroupId ?? "");
  const defaultWaitsOn = (group: string, among: Task[]) =>
    is3d ? chainPredecessor(among, groups, group) : chainTail(among);
  // A new task in a step-by-step project waits on the one before it by default:
  // the last created, or in a 3D project the one before it in number order.
  const sbsTail =
    !task && project?.stepByStep ? defaultWaitsOn(groupId, projectTasks) : undefined;
  const [dependsOn, setDependsOn] = useState(
    task ? !!task.dependsOnTaskIds?.length : !!sbsTail,
  );
  const [waitsOnIds, setWaitsOnIds] = useState<string[]>(
    task?.dependsOnTaskIds ?? (sbsTail ? [sbsTail.id] : []),
  );
  const [durationDays, setDurationDays] = useState(String(task?.durationDays ?? 1));

  const initialDepartment =
    task?.department ?? defaultDepartment ?? db.departments[0] ?? "";
  const firstStart =
    task?.startDate ??
    nextWorkingDay(
      project && project.startDate > todayISO() ? project.startDate : todayISO(),
      calendar,
    );

  const [form, setForm] = useState<FormState>({
    title: task?.title ?? defaultTitle ?? "",
    description: task?.description ?? defaultDescription ?? "",
    department: initialDepartment,
    assigneeId: task?.assigneeId ?? "",
    status: task?.status ?? "Not Started",
    priority: task?.priority ?? "Medium",
    startDate: firstStart,
    dueDate: task?.dueDate ?? firstStart,
    estimatedHours: task ? String(task.estimatedHours) : "",
    tags: task?.tags ?? [],
    companyId: task?.companyId ?? "",
    propertyId: task?.propertyId ?? "",
    clientIds: task?.clientIds ?? [],
  });
  const [templateId, setTemplateId] = useState("");
  /*
   * A content task is a batch: "five reels" is one task carrying five pieces,
   * each written and given a status on its own. The kind is fixed once
   * the task exists - pieces already hang off it - but the count is a target
   * and stays editable.
   */
  const [kind, setKind] = useState<TaskKind>(task?.kind ?? "standard");
  const [contentCount, setContentCount] = useState(String(task?.contentCount ?? 1));
  /*
   * The CB type of each piece, by slot. Editing starts from what the pieces
   * are now - the writer may have changed one - so saving the task without
   * touching these leaves every piece as it is.
   */
  const [contentTypes, setContentTypes] = useState<ContentType[]>(() => {
    if (!task) return [];
    const bySlot = new Map(
      db.contentEntries
        .filter((e) => e.taskId === task.id && e.slot !== null)
        .map((e) => [e.slot as number, e.type]),
    );
    return Array.from(
      { length: task.contentCount },
      (_, i) => bySlot.get(i + 1) ?? task.contentTypes[i] ?? DEFAULT_CONTENT_TYPE,
    );
  });
  // A 3D project has no content tasks (0023). One already there, in an older
  // project marked 3D, still opens as what it is.
  const mayBeContentTask = mode === "project" && (!is3d || task?.kind === "content");
  const isContent = mayBeContentTask && kind === "content";
  const pieces = Number(contentCount);
  const pieceCount = isContent && Number.isFinite(pieces) ? Math.max(Math.trunc(pieces), 0) : 0;
  const [repeat, setRepeat] = useState<RecurrenceRule | null>(task?.recurrence?.rule ?? null);
  const [touched, setTouched] = useState(false);

  // Individual tasks repeat on their own (project tasks repeat with their
  // project); only the series source carries the rule.
  const mayRepeat =
    recurring &&
    mode === "individual" &&
    !!currentUser &&
    canSetRecurrence(currentUser) &&
    !task?.series;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Someone who may not see clients gets company and property only; a client
  // already on the task stays there, unseen.
  const showClients = !!currentUser && canSeeClients(currentUser);

  const companyOptions = useMemo(
    () =>
      [...db.companies]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ value: c.id, label: c.name, hint: c.city || undefined })),
    [db.companies],
  );
  const propertyOptions = useMemo(
    () =>
      db.properties
        .filter((p) => !form.companyId || p.companyId === form.companyId)
        .map((p) => ({ value: p.id, label: p.name })),
    [db.properties, form.companyId],
  );
  const clientOptions = useMemo(
    () =>
      db.clients
        .filter((c) => c.companyId === form.companyId)
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
        .map((c) => ({
          value: c.id,
          label: c.fullName,
          hint: c.designation || undefined,
          avatarName: c.fullName,
        })),
    [db.clients, form.companyId],
  );

  const companyOfClient = (id: string) => db.clients.find((c) => c.id === id)?.companyId;

  /** A property and its contacts belong to one company; changing it drops a mismatch. */
  const pickCompany = (id: string) =>
    setForm((f) => {
      const property = db.properties.find((p) => p.id === f.propertyId);
      return {
        ...f,
        companyId: id,
        propertyId: property && property.companyId !== id ? "" : f.propertyId,
        clientIds: f.clientIds.filter((c) => companyOfClient(c) === id),
      };
    });

  /** A property implies its company, and offers its contacts when none are picked. */
  const pickProperty = (id: string) =>
    setForm((f) => {
      const property = db.properties.find((p) => p.id === id);
      if (!property) return { ...f, propertyId: "" };
      const kept = f.clientIds.filter((c) => companyOfClient(c) === property.companyId);
      return {
        ...f,
        propertyId: id,
        companyId: property.companyId,
        // Without the client list there is nothing to check them against, so
        // they stay unless the company changed under them.
        clientIds: showClients
          ? kept.length
            ? kept
            : property.clientIds
          : property.companyId === f.companyId
            ? f.clientIds
            : [],
      };
    });

  /** §9.1 — assignee list is limited to the chosen department. */
  const assigneeOptions = useMemo(
    () =>
      db.users
        .filter((u) => u.active && u.departments.includes(form.department))
        .map((u) => ({
          value: u.id,
          label: u.fullName,
          hint: u.email,
          avatarName: u.fullName,
        })),
    [db.users, form.department],
  );

  const bounds = mode === "project" && project
    ? { min: project.startDate, max: project.deadline }
    : {};

  /*
   * A standard project task may wait on others in the project: it starts the
   * day the last of them is approved and runs `durationDays` working days. Its
   * dates are worked out, not picked - the database recomputes them the same way
   * (0014, 0021). Only a 3D project's form offers more than one.
   */
  const mayDepend = mode === "project" && !!project && !isContent;
  const dependent = mayDepend && dependsOn;
  const candidates = useMemo(
    () => dependencyCandidates(task?.id ?? null, projectTasks),
    [task?.id, projectTasks],
  );
  const waitsOn = dependent ? candidates.filter((t) => waitsOnIds.includes(t.id)) : [];
  const days = Number(durationDays);
  const daysValid = durationDays.trim() !== "" && Number.isInteger(days) && days >= 0;
  const linksUnchanged =
    !!task &&
    waitsOn.length === (task.dependsOnTaskIds?.length ?? 0) &&
    waitsOn.every((t) => task.dependsOnTaskIds?.includes(t.id));
  const allApproved = waitsOn.every((t) => t.status === "Approved");
  const planned =
    waitsOn.length && daysValid
      ? task && linksUnchanged && allApproved
        ? // Already under way: a new length moves the due date, never the start.
          {
            startDate: task.startDate,
            dueDate:
              days === task.durationDays
                ? task.dueDate
                : workingDaysOn(task.startDate, days, calendar),
          }
        : dependentDates(waitsOn, days, calendar)
      : null;
  const plannedPastDeadline = !!planned && !!project && planned.dueDate > project.deadline;

  const startBlocked = dateUnavailableReason(form.startDate, {
    config: calendar,
    ...bounds,
    allowPast: !!task,
  });
  const dueBlocked = dateUnavailableReason(form.dueDate, {
    config: calendar,
    ...bounds,
    allowPast: !!task,
  });

  const hours = Number(form.estimatedHours);
  const errors = {
    title: !form.title.trim() ? "A title is required." : undefined,
    estimatedHours:
      !form.estimatedHours || Number.isNaN(hours) || hours <= 0
        ? "Enter the estimated hours."
        : undefined,
    // A dependent task's dates are worked out, so there is nothing to check.
    startDate: dependent ? undefined : (startBlocked ?? undefined),
    dueDate: dependent
      ? undefined
      : (dueBlocked ??
        (form.dueDate < form.startDate
          ? "The due date must be on or after the start date."
          : undefined)),
    waitsOn: dependent && !waitsOn.length ? "Pick the task this one waits on." : undefined,
    durationDays:
      dependent && !daysValid ? "Enter the working days it takes — 0 or more." : undefined,
    repeat: mayRepeat
      ? repeat
        ? ruleError(repeat, form.startDate)
        : "Pick how often it repeats."
      : undefined,
    contentCount:
      isContent && (!contentCount || Number.isNaN(pieces) || pieces < 1)
        ? "How many pieces? At least one."
        : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);

  // Only reviewers may set Approved / Changes Required / Rejected (§9.4).
  const mayUseReviewStatuses =
    !!currentUser && !!task && canReviewTask(currentUser, task, project);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t: TaskTemplate | undefined = db.taskTemplates.find((x) => x.id === id);
    if (!t) return;
    setForm((f) => ({
      ...f,
      title: t.title,
      description: t.description,
      department: t.department,
      assigneeId: "",
      priority: t.priority,
      estimatedHours: String(t.estimatedHours),
      tags: t.tags,
    }));
  };

  const save = () => {
    setTouched(true);
    if (!valid) return;
    const payload = {
      projectId: mode === "project" ? (project?.id ?? null) : null,
      title: form.title.trim(),
      description: form.description,
      department: form.department,
      assigneeId: form.assigneeId || null,
      status: form.status,
      priority: form.priority,
      startDate: planned?.startDate ?? form.startDate,
      dueDate: planned?.dueDate ?? form.dueDate,
      estimatedHours: hours,
      tags: form.tags,
      kind: isContent ? ("content" as const) : ("standard" as const),
      contentCount: isContent ? pieces : 0,
      contentTypes: isContent ? pieceTypes(pieces, contentTypes) : [],
      dependsOnTaskIds: dependent ? waitsOn.map((t) => t.id) : [],
      durationDays: dependent ? days : null,
      // Content tasks stay outside the groups, and so does anything not in 3D.
      groupId: is3d && !isContent && groupId ? groupId : null,
      ...(mode === "individual"
        ? {
            companyId: form.companyId || null,
            propertyId: form.propertyId || null,
            clientIds: form.clientIds,
          }
        : {}),
      ...(mayRepeat
        ? { recurrence: seriesFor(task?.recurrence, repeat, form.startDate) }
        : {}),
    };
    if (task) {
      updateTask(task.id, payload);
    } else {
      // Not `onCreated?.(createTask(...))` - an optional call skips its
      // arguments as well, so the task would never be created for the callers
      // that do not pass onCreated, which is nearly all of them.
      const created = createTask(payload);
      onCreated?.(created);
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        recurring
          ? task
            ? "Edit repeating task"
            : "New repeating task"
          : task
          ? isContent
            ? "Edit content task"
            : "Edit task"
          : isContent
            ? "Create content task"
            : mode === "project"
              ? "Create task"
              : "Create individual task"
      }
      subtitle={
        mode === "project" && project
          ? `${project.name} · ${formatDate(project.startDate)} – ${formatDate(project.deadline)}`
          : "No parent project — only the working calendar applies."
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            {task ? "Save changes" : "Create task"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!task && db.taskTemplates.length ? (
          <Field label="Start from a task template" hint="Optional — pre-fills the form.">
            <SearchSelect
              options={db.taskTemplates.map((t) => ({
                value: t.id,
                label: t.title,
                hint: t.department,
              }))}
              value={templateId}
              onChange={applyTemplate}
              placeholder="Blank task"
              allowClear
            />
          </Field>
        ) : null}

        {mayBeContentTask ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Task type"
              hint={
                task
                  ? "Fixed once the task exists."
                  : "A content task carries several pieces, written in the Content Bank."
              }
            >
              <Select
                value={kind}
                disabled={!!task}
                onChange={(e) => {
                  const next = e.target.value as TaskKind;
                  setKind(next);
                  // Content is written by the writers' desk, so that is the
                  // department a content task starts in. Still changeable.
                  if (next === "content" && form.department !== CONTENT_WRITER_DEPARTMENT) {
                    set("department", CONTENT_WRITER_DEPARTMENT);
                    set("assigneeId", "");
                  }
                }}
              >
                <option value="standard">Standard task</option>
                <option value="content">Content task</option>
              </Select>
            </Field>

            {isContent ? (
              <Field
                label="How many pieces?"
                required
                hint="A target, not a ceiling — the writer can add more."
                error={touched ? errors.contentCount : undefined}
              >
                <Input
                  type="number"
                  min="1"
                  value={contentCount}
                  onChange={(e) => setContentCount(e.target.value)}
                  placeholder="e.g. 5"
                />
              </Field>
            ) : null}
          </div>
        ) : null}

        {pieceCount > 0 ? (
          <Field
            label="CB type of each piece"
            required
            hint="Each piece is created as this type. The writer can still change it."
          >
            <PieceTypesPicker count={pieceCount} types={contentTypes} onChange={setContentTypes} />
          </Field>
        ) : null}

        <Field
          label="Task title"
          required
          error={touched ? errors.title : undefined}
          htmlFor="task-title"
        >
          <Input
            id="task-title"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="e.g. Launch key visual — master creative"
          />
        </Field>

        <Field label="Description">
          <RichTextEditor
            value={form.description}
            onChange={(v) => set("description", v)}
            placeholder="Brief, references, deliverable format…"
          />
        </Field>

        {mode === "individual" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company" hint="Optional — leave empty for internal work.">
              <SearchSelect
                allowClear
                options={companyOptions}
                value={form.companyId}
                onChange={pickCompany}
                placeholder="No company"
              />
            </Field>
            <Field label="Property" hint="Optional.">
              <SearchSelect
                allowClear
                options={propertyOptions}
                value={form.propertyId}
                onChange={pickProperty}
                placeholder="No property"
              />
            </Field>
            {showClients ? (
              <Field
                label="Clients"
                className="sm:col-span-2"
                hint={
                  !form.companyId
                    ? "Pick the company first."
                    : clientOptions.length === 0
                      ? "This company has no clients yet."
                      : `Optional — ${form.clientIds.length} selected`
                }
              >
                <MultiSelect
                  disabled={!form.companyId}
                  options={clientOptions}
                  value={form.clientIds}
                  onChange={(v) => set("clientIds", v)}
                  placeholder="Search clients…"
                  emptyLabel="No clients selected"
                  maxVisibleChips={3}
                />
              </Field>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Department" required>
            <SearchSelect
              options={db.departments.map((d) => ({ value: d, label: d }))}
              value={form.department}
              onChange={(v) => {
                set("department", v);
                set("assigneeId", "");
              }}
            />
          </Field>

          <Field
            label="Assigned to"
            hint={
              assigneeOptions.length === 0
                ? "Nobody is in this department yet."
                : `Optional — ${assigneeOptions.length} available`
            }
          >
            <SearchSelect
              options={assigneeOptions}
              value={form.assigneeId}
              onChange={(v) => set("assigneeId", v)}
              placeholder="Nobody yet"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Status"
            required
            hint={
              !mayUseReviewStatuses
                ? "Review outcomes are set through the review dialog."
                : undefined
            }
          >
            <Select
              value={form.status}
              onChange={(e) => set("status", e.target.value as TaskStatus)}
            >
              {TASK_STATUSES.map((s) => (
                <option
                  key={s}
                  value={s}
                  disabled={!mayUseReviewStatuses && REVIEWER_ONLY_STATUSES.includes(s)}
                >
                  {s}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Priority" required>
            <Select
              value={form.priority}
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

        {is3d && !isContent ? (
          <Field
            label="Group"
            hint={
              task?.groupId
                ? "A task stays in its group."
                : groups.length
                  ? "Its number comes from the group: the next one in T1 is T1.4."
                  : "This project has no groups yet."
            }
          >
            <Select
              value={groupId}
              disabled={!!task?.groupId}
              onChange={(e) => {
                const next = e.target.value;
                setGroupId(next);
                // A new task's place in the chain follows its group.
                if (!task && project?.stepByStep) {
                  const before = defaultWaitsOn(next, projectTasks);
                  setDependsOn(!!before);
                  setWaitsOnIds(before ? [before.id] : []);
                }
              }}
            >
              <option value="">Ungrouped</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  T{g.number} {g.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {mayDepend ? (
          <div className="flex flex-col gap-1.5">
            <Switch
              on={dependsOn}
              onChange={(on) => {
                setDependsOn(on);
                if (on && !waitsOnIds.length) {
                  const before = defaultWaitsOn(groupId, candidates);
                  setWaitsOnIds(before ? [before.id] : []);
                }
              }}
              label="Waits on another task"
              className="self-start"
            />
            <p className="text-[11px] text-ink-faint">
              {project?.stepByStep && !task
                ? is3d
                  ? "Step-by-step project: a new task waits on the one before it by default."
                  : "Step-by-step project: a new task waits on the last one by default."
                : is3d
                  ? "Starts the day the last task it waits on is approved, and runs for the days you give it."
                  : "Starts the day the task it waits on is approved, and runs for the days you give it."}
            </p>
          </div>
        ) : null}

        {dependent ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Waits on"
              required
              className="sm:col-span-2"
              hint={candidates.length ? undefined : "This project has no other tasks yet."}
              error={touched ? errors.waitsOn : undefined}
            >
              {is3d ? (
                <MultiSelect
                  options={candidates.map((t) => ({
                    value: t.id,
                    label: taskLabel(t),
                    hint: `${t.status} · due ${formatDate(t.dueDate)}`,
                  }))}
                  value={waitsOnIds}
                  onChange={setWaitsOnIds}
                  placeholder="Search tasks in this project…"
                  emptyLabel="No tasks selected"
                  maxVisibleChips={4}
                />
              ) : (
                <SearchSelect
                  options={candidates.map((t) => ({
                    value: t.id,
                    label: t.title,
                    hint: `${t.status} · due ${formatDate(t.dueDate)}`,
                  }))}
                  value={waitsOnIds[0] ?? ""}
                  onChange={(v) => setWaitsOnIds([v])}
                  placeholder="Pick a task in this project"
                />
              )}
            </Field>
            <Field
              label="Days to complete"
              required
              hint="Working days from its start to its due date."
              error={touched ? errors.durationDays : undefined}
            >
              <Input
                type="number"
                min="0"
                step="1"
                value={durationDays}
                onChange={(e) => setDurationDays(e.target.value)}
                placeholder="e.g. 4"
              />
            </Field>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          {dependent ? (
            <div
              className={cx(
                "flex flex-col justify-center gap-1 rounded-lg border px-3 py-2 text-[11px] leading-relaxed sm:col-span-2",
                plannedPastDeadline
                  ? "border-st-rejected/30 bg-st-rejected/10 text-st-rejected"
                  : "border-line bg-surface-2 text-ink-faint",
              )}
            >
              {waitsOn.length && planned ? (
                <>
                  <span>
                    {allApproved
                      ? waitsOn.length === 1
                        ? `“${taskLabel(waitsOn[0])}” is already approved, so this starts straight away.`
                        : "Those tasks are already approved, so this starts straight away."
                      : waitsOn.length === 1
                        ? `Starts the day “${taskLabel(waitsOn[0])}” is approved. Until then these dates are projected from its due date.`
                        : "Starts the day the last of these is approved. Until then these dates are projected from the latest due date among those still open."}
                  </span>
                  <span className="font-medium text-ink">
                    {formatDate(planned.startDate)} → {formatDate(planned.dueDate)}
                  </span>
                  {plannedPastDeadline && project ? (
                    <span>
                      Runs past the project deadline ({formatDate(project.deadline)}).
                    </span>
                  ) : null}
                </>
              ) : (
                <span>Pick the task it waits on and how many days it takes to see its dates.</span>
              )}
            </div>
          ) : (
            <>
              <Field
                label="Start date"
                required
                error={touched ? errors.startDate : undefined}
              >
                <DatePicker
                  value={form.startDate}
                  onChange={(v) => {
                    set("startDate", v);
                    if (form.dueDate < v) set("dueDate", v);
                  }}
                  config={calendar}
                  min={bounds.min}
                  max={bounds.max}
                  allowPast={!!task}
                />
              </Field>

              <Field label="Due date" required error={touched ? errors.dueDate : undefined}>
                <DatePicker
                  value={form.dueDate}
                  onChange={(v) => set("dueDate", v)}
                  config={calendar}
                  min={bounds.min && form.startDate > bounds.min ? form.startDate : (bounds.min ?? form.startDate)}
                  max={bounds.max}
                  allowPast={!!task}
                />
              </Field>
            </>
          )}

          <Field
            label="Estimated effort"
            required
            hint={`A day counts as ${WORKDAY_HOURS}h, a week as ${WORKDAY_HOURS * 5}h.`}
            error={touched ? errors.estimatedHours : undefined}
          >
            <DurationField
              valueHours={form.estimatedHours ? Number(form.estimatedHours) : null}
              onChange={(h: number | null) =>
                set("estimatedHours", h === null ? "" : String(h))
              }
            />
          </Field>
        </div>

        {mayRepeat ? (
          <Field
            label="Repeat"
            hint={
              repeat
                ? "On each date a task named “<title> – <Month> <Year>” is created for the same assignee, with the due date moved by the same amount."
                : undefined
            }
          >
            <RecurrencePicker
              value={repeat}
              onChange={setRepeat}
              anchor={form.startDate}
              config={calendar}
              error={touched ? errors.repeat : undefined}
            />
          </Field>
        ) : task?.series ? (
          <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-ink-faint">
            Repeat #{task.series.index} of a repeating task. The repeat rule is edited on
            the Recurrence page.
          </p>
        ) : null}

        <Field label="Tags" hint="Comma separated — stored as a list.">
          <TagsInput value={form.tags} onChange={(v) => set("tags", v)} />
        </Field>

        {mode === "project" && project && !dependent ? (
          <p
            className={cx(
              "flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed",
              errors.startDate || errors.dueDate
                ? "border-st-rejected/30 bg-st-rejected/10 text-st-rejected"
                : "border-line bg-surface-2 text-ink-faint",
            )}
          >
            <IconWarning size={13} className="mt-px shrink-0" />
            <span>
              Task dates must sit inside the project window (
              {formatDate(project.startDate)} – {formatDate(project.deadline)}) and land
              on a working day. Sundays and company holidays
              are disabled in the picker.
            </span>
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
