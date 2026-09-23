"use client";

import { useMemo, useState } from "react";
import { DatePicker, dateUnavailableReason } from "@/components/ui/date-picker";
import { DurationField } from "@/components/ui/duration-field";
import { IconEdit, IconPlus, IconTemplate, IconTrash } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { Avatar, Button, Field, Input, Select, cx } from "@/components/ui/primitives";
import { RecurrencePicker } from "@/components/ui/recurrence-picker";
import { RichTextEditor } from "@/components/ui/rich-text";
import { ColorPicker, MultiSelect, SearchSelect } from "@/components/ui/selects";
import { addDays, addWorkingDays, formatDate, nextWorkingDay, todayISO } from "@/lib/calendar";
import {
  PRIORITIES,
  PROJECT_COLORS,
  PROJECT_STATUSES,
  WORKDAY_HOURS,
} from "@/lib/master-data";
import { canSetRecurrence } from "@/lib/permissions";
import { ruleError, seriesFor } from "@/lib/recurrence";
import { useStore, type NewProjectTaskInput } from "@/lib/store";
import type {
  CalendarConfig,
  Priority,
  Project,
  ProjectStatus,
  RecurrenceRule,
  TaskKind,
} from "@/lib/types";

/**
 * A task typed straight into the create-project form. For a repeating project
 * these are what every occurrence copies, so it matters that they can be set up
 * with the project rather than afterwards.
 */
interface TaskDraft {
  key: string;
  title: string;
  description: string;
  department: string;
  assigneeId: string;
  priority: Priority;
  estimatedHours: number;
  startDate: string;
  dueDate: string;
  /*
   * A content task is a batch: "five reels" is one task carrying five pieces,
   * each written, allotted and approved on its own. It is fixed once the task
   * exists - pieces hang off it - but freely changeable here, where nothing
   * has been created yet.
   */
  kind: TaskKind;
  /** Content tasks only: how many pieces were asked for. */
  contentCount: number;
}

/**
 * A template's task on this form. A template is a starting point, not a
 * contract — this project's brief is nearly always a little different — so
 * every field stays editable, and a row can be dropped altogether.
 *
 * `startOffsetDays` / `durationDays` are kept so the dates go on tracking the
 * project window as the start date moves (§13). Touching either date by hand
 * pins the row and stops that, because a hand-set date should not be quietly
 * recalculated underneath whoever set it.
 */
interface TemplateDraft extends TaskDraft {
  startOffsetDays: number;
  durationDays: number;
  tags: string[];
  datesPinned: boolean;
}

/** Where a template row sits in the project window, in working days. */
function templateDates(
  item: { startOffsetDays: number; durationDays: number },
  projectStart: string,
  projectDeadline: string,
  calendar: CalendarConfig,
) {
  let startDate = addWorkingDays(projectStart, item.startOffsetDays, calendar);
  if (startDate > projectDeadline) startDate = projectDeadline;
  let dueDate = addWorkingDays(startDate, item.durationDays, calendar);
  if (dueDate > projectDeadline) dueDate = projectDeadline;
  return { startDate, dueDate };
}

/** Both kinds of draft become the same thing once the project exists. */
const toTaskInput = (d: TaskDraft, tags: string[] = []): NewProjectTaskInput => ({
  title: d.title.trim(),
  description: d.description,
  department: d.department,
  assigneeId: d.assigneeId || null,
  priority: d.priority,
  estimatedHours: d.estimatedHours,
  startDate: d.startDate,
  dueDate: d.dueDate,
  tags,
  kind: d.kind,
  contentCount: d.kind === "content" ? d.contentCount : 0,
});

interface FormState {
  name: string;
  color: string;
  clientName: string;
  services: string[];
  startDate: string;
  deadline: string;
  description: string;
  status: ProjectStatus;
  priority: Priority;
  leaderId: string;
  memberIds: string[];
}

export function ProjectFormModal({
  open,
  onClose,
  project,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  project?: Project;
  onCreated?: (p: Project) => void;
}) {
  const { db, currentUser, createProjectWithTasks, updateProject } = useStore();

  const defaultStart = nextWorkingDay(todayISO(), db.calendar);
  const [templateId, setTemplateId] = useState("");
  const [templateDrafts, setTemplateDrafts] = useState<TemplateDraft[]>([]);
  /** Template rows open for editing; collapsed they read as the old summary. */
  const [openRows, setOpenRows] = useState<string[]>([]);

  const [form, setForm] = useState<FormState>({
    name: project?.name ?? "",
    color: project?.color ?? PROJECT_COLORS[0],
    clientName: project?.clientName ?? "",
    services: project?.services ?? [],
    startDate: project?.startDate ?? defaultStart,
    deadline: project?.deadline ?? addDays(defaultStart, 30),
    description: project?.description ?? "",
    status: project?.status ?? "Planning",
    priority: project?.priority ?? "Medium",
    leaderId: project?.leaderId ?? "",
    memberIds: project?.memberIds ?? [],
  });
  const [repeat, setRepeat] = useState<RecurrenceRule | null>(
    project?.recurrence?.rule ?? null,
  );
  const [drafts, setDrafts] = useState<TaskDraft[]>([]);
  const [touched, setTouched] = useState(false);

  // Only the source of a series carries the rule; generated copies don't repeat.
  const mayRepeat = !!currentUser && canSetRecurrence(currentUser) && !project?.series;
  const seriesSource = project?.series
    ? db.projects.find((p) => p.id === project.series!.sourceId)
    : undefined;

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const setDraft = (key: string, patch: Partial<TaskDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  /** A new row starts inside the project window, so its dates are always valid. */
  const addDraft = (kind: TaskKind = "standard") =>
    setDrafts((ds) => [
      ...ds,
      {
        key: crypto.randomUUID(),
        title: "",
        description: "",
        department: "",
        assigneeId: "",
        priority: form.priority,
        estimatedHours: WORKDAY_HOURS / 2,
        startDate: form.startDate,
        dueDate: form.deadline,
        kind,
        // One piece is the smallest batch that means anything; whoever raises
        // it is expected to set the count actually being written.
        contentCount: kind === "content" ? 1 : 0,
      },
    ]);

  const template = db.projectTemplates.find((t) => t.id === templateId);

  const userOptions = useMemo(
    () =>
      db.users
        .filter((u) => u.active)
        .map((u) => ({
          value: u.id,
          label: u.fullName,
          hint: u.departments[0],
          avatarName: u.fullName,
        })),
    [db.users],
  );

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    setOpenRows([]);
    const t = db.projectTemplates.find((x) => x.id === id);
    if (!t) {
      setTemplateDrafts([]);
      return;
    }
    // The template's own length decides the deadline, and its tasks are laid
    // out inside that window before anyone touches them.
    const deadline = addWorkingDays(form.startDate, t.durationDays, db.calendar);
    setForm((f) => ({
      ...f,
      color: t.color,
      services: t.services,
      priority: t.priority,
      description: t.description,
      deadline,
    }));
    setTemplateDrafts(
      t.tasks.map((item) => ({
        key: crypto.randomUUID(),
        title: item.title,
        description: item.description,
        department: item.department,
        assigneeId: "",
        priority: item.priority,
        estimatedHours: item.estimatedHours,
        // A project template lays out ordinary tasks; a batch of content is
        // raised by hand, where its count can be said.
        kind: "standard" as const,
        contentCount: 0,
        ...templateDates(item, form.startDate, deadline, db.calendar),
        startOffsetDays: item.startOffsetDays,
        durationDays: item.durationDays,
        tags: item.tags,
        datesPinned: false,
      })),
    );
  };

  const setTemplateDraft = (key: string, patch: Partial<TemplateDraft>) =>
    setTemplateDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  /*
   * The template's rows as they currently stand. An unpinned row's dates are
   * worked out from the project window on every render rather than stored, so
   * moving the project start moves them with it - the behaviour the read-only
   * list had - while a row whose dates were set by hand keeps them.
   */
  const resolvedTemplateDrafts = useMemo(
    () =>
      templateDrafts.map((d) =>
        d.datesPinned
          ? d
          : { ...d, ...templateDates(d, form.startDate, form.deadline, db.calendar) },
      ),
    [templateDrafts, form.startDate, form.deadline, db.calendar],
  );

  const startBlocked = dateUnavailableReason(form.startDate, {
    config: db.calendar,
    allowPast: !!project,
  });

  const errors = {
    name: !form.name.trim() ? "A project name is required." : undefined,
    clientName: !form.clientName.trim() ? "A client name is required." : undefined,
    services: form.services.length === 0 ? "Pick at least one service." : undefined,
    startDate: startBlocked ?? undefined,
    deadline:
      form.deadline < form.startDate
        ? "The deadline must be on or after the start date."
        : undefined,
    repeat: mayRepeat ? ruleError(repeat, form.startDate) : undefined,
    tasks: drafts.some(
      (d) => !d.title.trim() || !d.department || (d.kind === "content" && d.contentCount < 1),
    )
      ? "Every task needs a title and a department, and a content task at least one piece."
      : undefined,
    templateTasks: templateDrafts.some((d) => !d.title.trim() || !d.department)
      ? "Every task needs a title and a department."
      : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);

  const save = () => {
    setTouched(true);
    if (!valid) return;

    const payload = {
      name: form.name.trim(),
      color: form.color,
      clientName: form.clientName.trim(),
      services: form.services,
      startDate: form.startDate,
      deadline: form.deadline,
      description: form.description,
      status: form.status,
      priority: form.priority,
      leaderId: form.leaderId || null,
      memberIds: form.memberIds,
      ...(mayRepeat
        ? { recurrence: seriesFor(project?.recurrence, repeat, form.startDate) }
        : {}),
    };

    if (project) {
      updateProject(project.id, payload);
      onClose();
      return;
    }

    // The template's tasks as they now stand, then anything typed in on top.
    // The store clamps every date to the project window.
    const created = createProjectWithTasks({
      project: payload,
      tasks: [
        ...resolvedTemplateDrafts.map((d) => toTaskInput(d, d.tags)),
        ...drafts.map((d) => toTaskInput(d)),
      ],
    });

    onClose();
    onCreated?.(created);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? "Edit project" : "Create project"}
      subtitle={
        project
          ? undefined
          : "Start blank, or pick a template to create the project and its tasks together."
      }
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            {project ? "Save changes" : "Create project"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {!project && db.projectTemplates.length ? (
          <Field
            label="Project template"
            hint="Pre-fills this form; its tasks are created with the project."
          >
            <SearchSelect
              options={db.projectTemplates.map((t) => ({
                value: t.id,
                label: t.name,
                hint: `${t.tasks.length} task${t.tasks.length === 1 ? "" : "s"} · ${t.durationDays} days`,
              }))}
              value={templateId}
              onChange={applyTemplate}
              placeholder="Blank project"
              allowClear
            />
          </Field>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project name" required error={touched ? errors.name : undefined}>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Lodha Amara — Launch Campaign"
            />
          </Field>

          <Field label="Client name" required error={touched ? errors.clientName : undefined}>
            <Input
              value={form.clientName}
              onChange={(e) => set("clientName", e.target.value)}
              placeholder="e.g. Lodha Group"
            />
          </Field>
        </div>

        <Field label="Project colour" required>
          <ColorPicker
            value={form.color}
            onChange={(v) => set("color", v)}
            presets={PROJECT_COLORS}
          />
        </Field>

        <Field
          label="Requirements / Services"
          required
          hint={`${form.services.length} selected`}
          error={touched ? errors.services : undefined}
        >
          <MultiSelect
            options={db.services.map((s) => ({ value: s, label: s }))}
            value={form.services}
            onChange={(v) => set("services", v)}
            placeholder="Search services…"
            emptyLabel="No services selected yet"
            maxVisibleChips={8}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date" required error={touched ? errors.startDate : undefined}>
            <DatePicker
              value={form.startDate}
              onChange={(v) => {
                set("startDate", v);
                if (form.deadline < v) set("deadline", v);
              }}
              config={db.calendar}
              allowPast={!!project}
            />
          </Field>

          <Field
            label="Deadline"
            required
            hint="Task dates are constrained to this window."
            error={touched ? errors.deadline : undefined}
          >
            <DatePicker
              value={form.deadline}
              onChange={(v) => set("deadline", v)}
              config={db.calendar}
              min={form.startDate}
              allowPast={!!project}
            />
          </Field>
        </div>

        {mayRepeat ? (
          <Field
            label="Repeat"
            hint={
              repeat
                ? "Each repeat creates a copy of this project and its tasks on that date — tasks start fresh as Not Started, with the same assignees."
                : undefined
            }
          >
            <RecurrencePicker
              value={repeat}
              onChange={setRepeat}
              anchor={form.startDate}
              config={db.calendar}
              error={touched ? errors.repeat : undefined}
            />
          </Field>
        ) : project?.series ? (
          <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-ink-faint">
            Repeat #{project.series.index} of{" "}
            <span className="text-ink-muted">{seriesSource?.name ?? "a deleted series"}</span>.
            The repeat rule is edited on the original project.
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status" required>
            <Select
              value={form.status}
              onChange={(e) => set("status", e.target.value as ProjectStatus)}
            >
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
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

        <Field
          label="Project Leader"
          hint="Optional — leave it empty until someone takes it on. The leader reviews the project's work and files its expenses."
        >
          <SearchSelect
            options={userOptions}
            value={form.leaderId}
            onChange={(v) => set("leaderId", v)}
            placeholder="Nobody yet"
          />
        </Field>

        <Field
          label="Team Members"
          hint="Optional — for reference. Members see the project once they hold a task in it."
        >
          <MultiSelect
            options={userOptions.filter((o) => o.value !== form.leaderId)}
            value={form.memberIds}
            onChange={(v) => set("memberIds", v)}
            placeholder="Search team members…"
            emptyLabel="No team members added"
          />
        </Field>

        <Field label="Description">
          <RichTextEditor
            value={form.description}
            onChange={(v) => set("description", v)}
            placeholder="Scope, deliverables, anything the team should know…"
          />
        </Field>

        {/*
          * Template tasks get their assignee at creation time (§13) — and now
          * anything else that needs changing for this project. Rows read as the
          * plain summary until one is opened, so a template that needs no edits
          * is still a glance and a dropdown.
          */}
        {template && !project ? (
          <div className="rounded-xl border border-brand-bright/25 bg-brand/8 p-4">
            <div className="mb-3 flex items-center gap-2">
              <IconTemplate size={15} className="text-brand-ink" />
              <span className="text-[13px] font-semibold text-ink">
                Tasks from “{template.name}”
              </span>
              <span className="ml-auto text-[11px] text-ink-faint">
                {templateDrafts.filter((d) => d.assigneeId).length}/{templateDrafts.length}{" "}
                assigned
              </span>
            </div>
            <p className="mb-3 text-[11px] leading-relaxed text-ink-faint">
              Dates are calculated from the project start using working days only, and
              follow it if you move it. Edit any task to change it for this project — the
              template itself is left alone. Tasks you leave unassigned are still created.
            </p>

            {templateDrafts.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[11px] text-ink-faint">
                Every task from this template has been removed. The project will be created
                on its own.
              </p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {resolvedTemplateDrafts.map((d, i) => {
                  const open = openRows.includes(d.key);
                  const label = d.title.trim() || `Task ${i + 1}`;
                  const options = db.users
                    .filter((u) => u.active && u.departments.includes(d.department))
                    .map((u) => ({
                      value: u.id,
                      label: u.fullName,
                      avatarName: u.fullName,
                    }));
                  return (
                    <li key={d.key} className="rounded-lg border border-line bg-surface-2 p-3">
                      <div className="grid gap-2.5 sm:grid-cols-[1.4fr_1fr]">
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-medium text-ink">
                            {label}
                          </div>
                          <div className="mt-0.5 text-[10px] text-ink-faint">
                            {d.department || "No department"} · {d.estimatedHours}h ·{" "}
                            {formatDate(d.startDate)} → {formatDate(d.dueDate)}
                            {d.datesPinned ? " · dates set by hand" : ""}
                          </div>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <div className="min-w-0 flex-1">
                            <SearchSelect
                              options={options}
                              value={d.assigneeId}
                              onChange={(v) => setTemplateDraft(d.key, { assigneeId: v })}
                              placeholder={
                                !d.department
                                  ? "Pick a department first"
                                  : options.length
                                    ? "Assign to…"
                                    : "Nobody in this department"
                              }
                              allowClear
                            />
                          </div>
                          <Button
                            size="sm"
                            variant={open ? "primary" : "secondary"}
                            aria-label={`${open ? "Done editing" : "Edit"} ${label}`}
                            aria-expanded={open}
                            onClick={() =>
                              setOpenRows((keys) =>
                                open ? keys.filter((k) => k !== d.key) : [...keys, d.key],
                              )
                            }
                          >
                            <IconEdit size={13} />
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            aria-label={`Remove ${label}`}
                            onClick={() => {
                              setTemplateDrafts((ds) => ds.filter((x) => x.key !== d.key));
                              setOpenRows((keys) => keys.filter((k) => k !== d.key));
                            }}
                          >
                            <IconTrash size={13} />
                          </Button>
                        </div>
                      </div>

                      {open ? (
                        <div className="mt-3 flex flex-col gap-2.5 border-t border-line-soft pt-3">
                          <Input
                            value={d.title}
                            onChange={(e) => setTemplateDraft(d.key, { title: e.target.value })}
                            placeholder="What needs doing?"
                            aria-label="Task title"
                          />

                          <RichTextEditor
                            value={d.description}
                            onChange={(v) => setTemplateDraft(d.key, { description: v })}
                            minHeight={72}
                            placeholder="Brief, references, deliverable format…"
                          />

                          <div className="grid gap-2.5 sm:grid-cols-2">
                            <SearchSelect
                              options={db.departments.map((x) => ({ value: x, label: x }))}
                              value={d.department}
                              onChange={(v) =>
                                // The assignee comes from the department, so it
                                // can't survive the department changing under it.
                                setTemplateDraft(d.key, { department: v, assigneeId: "" })
                              }
                              placeholder="Department"
                            />
                            <Select
                              value={d.priority}
                              onChange={(e) =>
                                setTemplateDraft(d.key, {
                                  priority: e.target.value as Priority,
                                })
                              }
                              aria-label="Priority"
                            >
                              {PRIORITIES.map((x) => (
                                <option key={x} value={x}>
                                  {x}
                                </option>
                              ))}
                            </Select>
                          </div>

                          <div className="grid gap-2.5 sm:grid-cols-2">
                            <DatePicker
                              value={d.startDate}
                              onChange={(v) =>
                                setTemplateDraft(d.key, {
                                  startDate: v,
                                  dueDate: d.dueDate < v ? v : d.dueDate,
                                  datesPinned: true,
                                })
                              }
                              config={db.calendar}
                              min={form.startDate}
                              max={form.deadline}
                              allowPast
                            />
                            <DatePicker
                              value={d.dueDate}
                              onChange={(v) =>
                                setTemplateDraft(d.key, { dueDate: v, datesPinned: true })
                              }
                              config={db.calendar}
                              min={d.startDate > form.startDate ? d.startDate : form.startDate}
                              max={form.deadline}
                              allowPast
                            />
                          </div>

                          <DurationField
                            valueHours={d.estimatedHours}
                            onChange={(h: number | null) =>
                              setTemplateDraft(d.key, {
                                estimatedHours: h ?? WORKDAY_HOURS / 2,
                              })
                            }
                          />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            {touched && errors.templateTasks ? (
              <p className="mt-2 text-[11px] text-st-rejected">{errors.templateTasks}</p>
            ) : null}
          </div>
        ) : null}

        {!project ? (
          <Field
            label="Tasks"
            hint={
              repeat
                ? "These are the tasks every occurrence of this repeating project will copy."
                : "Optional — add the project's tasks now, or later from the project itself."
            }
            error={touched ? errors.tasks : undefined}
          >
            <div className="flex flex-col gap-2.5">
              {drafts.map((d, i) => (
                <div
                  key={d.key}
                  className="rounded-xl border border-line bg-surface-2 p-3"
                >
                  <div className="mb-2.5 flex items-center gap-2">
                    <span className="text-[11px] font-medium text-ink-faint">
                      {d.kind === "content" ? "Content task" : "Task"} {i + 1}
                    </span>
                    <Button
                      size="sm"
                      variant="danger"
                      className="ml-auto"
                      onClick={() =>
                        setDrafts((ds) => ds.filter((x) => x.key !== d.key))
                      }
                      aria-label={`Remove task ${i + 1}`}
                    >
                      <IconTrash size={13} />
                    </Button>
                  </div>

                  <div className="flex flex-col gap-2.5">
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      <Select
                        value={d.kind}
                        onChange={(e) => {
                          const kind = e.target.value as TaskKind;
                          setDraft(d.key, {
                            kind,
                            contentCount: kind === "content" ? Math.max(1, d.contentCount) : 0,
                          });
                        }}
                        aria-label={`Type of task ${i + 1}`}
                      >
                        <option value="standard">Standard task</option>
                        <option value="content">Content task</option>
                      </Select>
                      {d.kind === "content" ? (
                        <Input
                          type="number"
                          min="1"
                          value={d.contentCount ? String(d.contentCount) : ""}
                          onChange={(e) =>
                            setDraft(d.key, {
                              contentCount: Math.max(0, Math.trunc(Number(e.target.value)) || 0),
                            })
                          }
                          placeholder="How many pieces? e.g. 5"
                          aria-label={`Pieces in task ${i + 1}`}
                        />
                      ) : null}
                    </div>

                    {d.kind === "content" ? (
                      <p className="-mt-1 text-[11px] text-ink-faint">
                        The writer drafts each piece in the Content Bank and may hand any
                        of them to someone else. Each is approved on its own, and the task
                        closes itself once they all are.
                      </p>
                    ) : null}

                    <Input
                      value={d.title}
                      onChange={(e) => setDraft(d.key, { title: e.target.value })}
                      placeholder="What needs doing?"
                    />

                    <RichTextEditor
                      value={d.description}
                      onChange={(v) => setDraft(d.key, { description: v })}
                      placeholder="Brief, references, deliverable format…"
                    />

                    <div className="grid gap-2.5 sm:grid-cols-2">
                      <SearchSelect
                        options={db.departments.map((x) => ({ value: x, label: x }))}
                        value={d.department}
                        onChange={(v) =>
                          // The assignee comes from the department, so it can't
                          // survive the department changing under it.
                          setDraft(d.key, { department: v, assigneeId: "" })
                        }
                        placeholder="Department"
                      />
                      <SearchSelect
                        options={db.users
                          .filter((u) => u.active && u.departments.includes(d.department))
                          .map((u) => ({
                            value: u.id,
                            label: u.fullName,
                            avatarName: u.fullName,
                          }))}
                        value={d.assigneeId}
                        onChange={(v) => setDraft(d.key, { assigneeId: v })}
                        placeholder="Nobody yet"
                      />
                    </div>

                    <div className="grid gap-2.5 sm:grid-cols-2">
                      <DatePicker
                        value={d.startDate}
                        onChange={(v) => setDraft(d.key, { startDate: v })}
                        config={db.calendar}
                        min={form.startDate}
                        max={form.deadline}
                        allowPast
                      />
                      <DatePicker
                        value={d.dueDate}
                        onChange={(v) => setDraft(d.key, { dueDate: v })}
                        config={db.calendar}
                        min={d.startDate > form.startDate ? d.startDate : form.startDate}
                        max={form.deadline}
                        allowPast
                      />
                    </div>

                    <div className="grid gap-2.5 sm:grid-cols-2">
                      <Select
                        value={d.priority}
                        onChange={(e) =>
                          setDraft(d.key, { priority: e.target.value as Priority })
                        }
                        aria-label="Priority"
                      >
                        {PRIORITIES.map((x) => (
                          <option key={x} value={x}>
                            {x}
                          </option>
                        ))}
                      </Select>
                      <DurationField
                        valueHours={d.estimatedHours}
                        onChange={(h: number | null) =>
                          setDraft(d.key, { estimatedHours: h ?? WORKDAY_HOURS / 2 })
                        }
                      />
                    </div>
                  </div>
                </div>
              ))}

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => addDraft()}>
                  <IconPlus size={14} /> Add task
                </Button>
                <Button onClick={() => addDraft("content")}>
                  <IconPlus size={14} /> Add content task
                </Button>
              </div>
            </div>
          </Field>
        ) : null}

        {form.leaderId ? (
          <p
            className={cx(
              "flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11px] text-ink-faint",
            )}
          >
            <Avatar
              name={db.users.find((u) => u.id === form.leaderId)?.fullName ?? "?"}
              size={18}
            />
            The Project Leader can create tasks in this project, review submissions and
            add expenses — regardless of their global role.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
