"use client";

import { useMemo, useState } from "react";
import { DatePicker, dateUnavailableReason } from "@/components/ui/date-picker";
import { IconTemplate } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { Avatar, Button, Field, Input, Select, cx } from "@/components/ui/primitives";
import { RichTextEditor } from "@/components/ui/rich-text";
import { ColorPicker, MultiSelect, SearchSelect } from "@/components/ui/selects";
import { addDays, addWorkingDays, formatDate, nextWorkingDay, todayISO } from "@/lib/calendar";
import {
  PRIORITIES,
  PROJECT_COLORS,
  PROJECT_STATUSES,
  SERVICES,
} from "@/lib/master-data";
import { useStore } from "@/lib/store";
import type { Priority, Project, ProjectStatus } from "@/lib/types";

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
  const { db, createProject, createProjectFromTemplate, updateProject } = useStore();

  const defaultStart = nextWorkingDay(todayISO(), db.calendar);
  const [templateId, setTemplateId] = useState("");
  const [assignments, setAssignments] = useState<Record<string, string>>({});

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
  const [touched, setTouched] = useState(false);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

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
    const t = db.projectTemplates.find((x) => x.id === id);
    if (!t) {
      setAssignments({});
      return;
    }
    setForm((f) => ({
      ...f,
      color: t.color,
      services: t.services,
      priority: t.priority,
      description: t.description,
      deadline: addWorkingDays(f.startDate, t.durationDays, db.calendar),
    }));
    setAssignments({});
  };

  const startBlocked = dateUnavailableReason(form.startDate, {
    config: db.calendar,
    allowPast: !!project,
  });

  const errors = {
    name: !form.name.trim() ? "A project name is required." : undefined,
    clientName: !form.clientName.trim() ? "A client name is required." : undefined,
    services: form.services.length === 0 ? "Pick at least one service." : undefined,
    leaderId: !form.leaderId ? "Every project needs a leader." : undefined,
    startDate: startBlocked ?? undefined,
    deadline:
      form.deadline < form.startDate
        ? "The deadline must be on or after the start date."
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
      leaderId: form.leaderId,
      memberIds: form.memberIds,
    };

    if (project) {
      updateProject(project.id, payload);
      onClose();
      return;
    }

    const created = template
      ? createProjectFromTemplate({ templateId: template.id, project: payload, assignments })
      : createProject(payload);
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
            options={SERVICES.map((s) => ({ value: s, label: s }))}
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
          required
          hint="Any user, from Super Admin to Team Member."
          error={touched ? errors.leaderId : undefined}
        >
          <SearchSelect
            options={userOptions}
            value={form.leaderId}
            onChange={(v) => set("leaderId", v)}
            placeholder="Who owns this project?"
          />
        </Field>

        <Field label="Team Members" hint="Optional — they see every task in the project.">
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

        {/* Template tasks get their assignee at creation time (§13). */}
        {template && !project ? (
          <div className="rounded-xl border border-brand-bright/25 bg-brand/8 p-4">
            <div className="mb-3 flex items-center gap-2">
              <IconTemplate size={15} className="text-[#c9b6f2]" />
              <span className="text-[13px] font-semibold text-ink">
                Tasks from “{template.name}”
              </span>
              <span className="ml-auto text-[11px] text-ink-faint">
                {Object.values(assignments).filter(Boolean).length}/{template.tasks.length}{" "}
                assigned
              </span>
            </div>
            <p className="mb-3 text-[11px] leading-relaxed text-ink-faint">
              Dates are calculated from the project start using working days only.
              Tasks left unassigned are skipped.
            </p>

            <ul className="flex flex-col gap-2.5">
              {template.tasks.map((item) => {
                const start = addWorkingDays(
                  form.startDate,
                  item.startOffsetDays,
                  db.calendar,
                );
                const due = addWorkingDays(start, item.durationDays, db.calendar);
                const options = db.users
                  .filter((u) => u.active && u.departments.includes(item.department))
                  .map((u) => ({
                    value: u.id,
                    label: u.fullName,
                    avatarName: u.fullName,
                  }));
                return (
                  <li
                    key={item.id}
                    className="grid gap-2.5 rounded-lg border border-line bg-surface-2 p-3 sm:grid-cols-[1.4fr_1fr]"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-medium text-ink">
                        {item.title}
                      </div>
                      <div className="mt-0.5 text-[10px] text-ink-faint">
                        {item.department} · {item.estimatedHours}h ·{" "}
                        {formatDate(start)} → {formatDate(due > form.deadline ? form.deadline : due)}
                      </div>
                    </div>
                    <SearchSelect
                      options={options}
                      value={assignments[item.id] ?? ""}
                      onChange={(v) =>
                        setAssignments((a) => ({ ...a, [item.id]: v }))
                      }
                      placeholder={
                        options.length ? "Assign to…" : "Nobody in this department"
                      }
                      allowClear
                    />
                  </li>
                );
              })}
            </ul>
          </div>
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
