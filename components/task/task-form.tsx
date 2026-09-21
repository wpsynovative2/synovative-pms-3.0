"use client";

import { useMemo, useState } from "react";
import { DatePicker, dateUnavailableReason } from "@/components/ui/date-picker";
import { DurationField } from "@/components/ui/duration-field";
import { IconWarning } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { Button, Field, Input, Select, cx } from "@/components/ui/primitives";
import { RecurrencePicker } from "@/components/ui/recurrence-picker";
import { RichTextEditor } from "@/components/ui/rich-text";
import { SearchSelect, TagsInput } from "@/components/ui/selects";
import { formatDate, nextWorkingDay, todayISO } from "@/lib/calendar";
import {
  PRIORITIES,
  REVIEWER_ONLY_STATUSES,
  TASK_STATUSES,
  WORKDAY_HOURS,
} from "@/lib/master-data";
import { canReviewTask, canSetRecurrence } from "@/lib/permissions";
import { ruleError, seriesFor } from "@/lib/recurrence";
import { useStore } from "@/lib/store";
import type {
  Priority,
  Project,
  RecurrenceRule,
  Task,
  TaskStatus,
  TaskTemplate,
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
}

export function TaskFormModal({
  open,
  onClose,
  task,
  project,
  mode,
  defaultDepartment,
  defaultTitle,
}: {
  open: boolean;
  onClose: () => void;
  /** Present → edit, absent → create. */
  task?: Task;
  /** The parent project for `mode === "project"`. */
  project: Project | null;
  mode: "project" | "individual";
  defaultDepartment?: string;
  /** Seeds a new task, e.g. from the OBC line it delivers. */
  defaultTitle?: string;
}) {
  const { db, currentUser, createTask, updateTask } = useStore();
  const calendar = db.calendar;

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
    description: task?.description ?? "",
    department: initialDepartment,
    assigneeId: task?.assigneeId ?? "",
    status: task?.status ?? "Not Started",
    priority: task?.priority ?? "Medium",
    startDate: firstStart,
    dueDate: task?.dueDate ?? firstStart,
    estimatedHours: task ? String(task.estimatedHours) : "",
    tags: task?.tags ?? [],
  });
  const [templateId, setTemplateId] = useState("");
  const [repeat, setRepeat] = useState<RecurrenceRule | null>(task?.recurrence?.rule ?? null);
  const [touched, setTouched] = useState(false);

  // Individual tasks repeat on their own (project tasks repeat with their
  // project); only the series source carries the rule.
  const mayRepeat =
    mode === "individual" &&
    !!currentUser &&
    canSetRecurrence(currentUser) &&
    !task?.series;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

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
    startDate: startBlocked ?? undefined,
    dueDate:
      dueBlocked ??
      (form.dueDate < form.startDate
        ? "The due date must be on or after the start date."
        : undefined),
    repeat: mayRepeat ? ruleError(repeat, form.startDate) : undefined,
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
      startDate: form.startDate,
      dueDate: form.dueDate,
      estimatedHours: hours,
      tags: form.tags,
      ...(mayRepeat
        ? { recurrence: seriesFor(task?.recurrence, repeat, form.startDate) }
        : {}),
    };
    if (task) updateTask(task.id, payload);
    else createTask(payload);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? "Edit task" : mode === "project" ? "Create task" : "Create individual task"}
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

        <div className="grid gap-4 sm:grid-cols-3">
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
                ? "Each repeat creates a fresh copy of this task for the same assignee, with the due date moved by the same amount."
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
            the original task.
          </p>
        ) : null}

        <Field label="Tags" hint="Comma separated — stored as a list.">
          <TagsInput value={form.tags} onChange={(v) => set("tags", v)} />
        </Field>

        {mode === "project" && project ? (
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
