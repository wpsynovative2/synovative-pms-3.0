"use client";

import { useState } from "react";
import {
  IconEdit,
  IconPlus,
  IconTasks,
  IconTemplate,
  IconTrash,
} from "@/components/ui/icons";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  StatTile,
  Tabs,
} from "@/components/ui/primitives";
import { RichTextEditor } from "@/components/ui/rich-text";
import { ColorPicker, MultiSelect, SearchSelect, TagsInput } from "@/components/ui/selects";
import {
  DEPARTMENTS,
  PRIORITIES,
  PROJECT_COLORS,
  SERVICES,
} from "@/lib/master-data";
import { canManageTemplates } from "@/lib/permissions";
import { useStore } from "@/lib/store";
import type {
  Priority,
  ProjectTemplate,
  TaskTemplate,
  TaskTemplateItem,
} from "@/lib/types";

type TabId = "project" | "task";

/** §13 — reusable project scaffolds and standalone task templates. */
export default function TemplatesPage() {
  const {
    db,
    currentUser,
    saveProjectTemplate,
    deleteProjectTemplate,
    saveTaskTemplate,
    deleteTaskTemplate,
  } = useStore();
  const user = currentUser!;

  const [tab, setTab] = useState<TabId>("project");
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectTemplate | null>(null);
  const [editingTask, setEditingTask] = useState<TaskTemplate | null>(null);
  const [deleting, setDeleting] = useState<{ kind: TabId; id: string; name: string } | null>(
    null,
  );

  if (!canManageTemplates(user)) {
    return (
      <Card>
        <EmptyState
          icon={<IconTemplate size={30} />}
          title="Templates are managed by Super Admins and Admins"
          body="You'll still see them offered when creating a project or task."
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Project & Task Templates"
        icon={<IconTemplate size={20} />}
        subtitle="Scaffolds that make repeat work a two-minute job"
        actions={
          <Button
            variant="primary"
            onClick={() => {
              if (tab === "project") {
                setEditingProject(null);
                setProjectFormOpen(true);
              } else {
                setEditingTask(null);
                setTaskFormOpen(true);
              }
            }}
          >
            <IconPlus size={15} /> New {tab === "project" ? "project" : "task"} template
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Project templates"
          value={db.projectTemplates.length}
          tone="brand"
          icon={<IconTemplate size={17} />}
        />
        <StatTile
          label="Task templates"
          value={db.taskTemplates.length}
          tone="blue"
          icon={<IconTasks size={17} />}
        />
        <StatTile
          label="Templated tasks total"
          value={db.projectTemplates.reduce((s, t) => s + t.tasks.length, 0)}
          tone="neutral"
        />
      </div>

      <Tabs<TabId>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "project", label: "Project templates", count: db.projectTemplates.length },
          { id: "task", label: "Task templates", count: db.taskTemplates.length },
        ]}
      />

      {tab === "project" ? (
        db.projectTemplates.length === 0 ? (
          <Card>
            <EmptyState
              icon={<IconTemplate size={30} />}
              title="No project templates yet"
              body="A project template holds project defaults plus an ordered list of tasks — it can also be saved without tasks."
            />
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {db.projectTemplates.map((t) => (
              <Card key={t.id} className="p-4">
                <div className="flex items-start gap-2.5">
                  <span
                    className="mt-1 h-3 w-3 shrink-0 rounded-[4px]"
                    style={{ background: t.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[14px] font-semibold text-ink">{t.name}</h3>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                      {t.description}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      onClick={() => {
                        setEditingProject(t);
                        setProjectFormOpen(true);
                      }}
                    >
                      <IconEdit size={13} />
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() =>
                        setDeleting({ kind: "project", id: t.id, name: t.name })
                      }
                    >
                      <IconTrash size={13} />
                    </Button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge>{t.priority}</Badge>
                  <Badge>{t.durationDays} days</Badge>
                  <Badge>
                    {t.tasks.length} task{t.tasks.length === 1 ? "" : "s"}
                  </Badge>
                  <Badge>
                    {t.tasks.reduce((s, x) => s + x.estimatedHours, 0)}h estimated
                  </Badge>
                </div>

                <div className="mt-3 flex flex-wrap gap-1">
                  {t.services.slice(0, 4).map((s) => (
                    <span
                      key={s}
                      className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-ink-muted"
                    >
                      {s}
                    </span>
                  ))}
                  {t.services.length > 4 ? (
                    <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-ink-faint">
                      +{t.services.length - 4}
                    </span>
                  ) : null}
                </div>

                {t.tasks.length ? (
                  <ol className="mt-4 space-y-1 border-t border-line-soft pt-3">
                    {t.tasks.map((item, i) => (
                      <li key={item.id} className="flex items-center gap-2 text-[11px]">
                        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-surface-3 text-[9px] text-ink-faint">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-ink-muted">
                          {item.title}
                        </span>
                        <span className="shrink-0 text-ink-faint">
                          d{item.startOffsetDays}–{item.startOffsetDays + item.durationDays}
                        </span>
                        <span className="shrink-0 font-mono text-ink-faint">
                          {item.estimatedHours}h
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-4 border-t border-line-soft pt-3 text-[11px] text-ink-faint">
                    No tasks — this template only pre-fills the project form.
                  </p>
                )}
              </Card>
            ))}
          </div>
        )
      ) : db.taskTemplates.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconTasks size={30} />}
            title="No task templates yet"
            body="Standalone reusable tasks — offered when creating any task."
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {db.taskTemplates.map((t) => (
            <Card key={t.id} className="p-4">
              <div className="flex items-start gap-2.5">
                <div className="min-w-0 flex-1">
                  <h3 className="text-[13px] font-semibold text-ink">{t.title}</h3>
                  <p className="mt-0.5 text-[11px] text-ink-faint">{t.department}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditingTask(t);
                      setTaskFormOpen(true);
                    }}
                  >
                    <IconEdit size={13} />
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setDeleting({ kind: "task", id: t.id, name: t.title })}
                  >
                    <IconTrash size={13} />
                  </Button>
                </div>
              </div>

              <p className="mt-2.5 text-[11px] leading-relaxed text-ink-muted">
                {t.description}
              </p>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge>{t.priority}</Badge>
                <Badge>{t.estimatedHours}h</Badge>
                {t.tags.map((tag) => (
                  <Badge key={tag}>#{tag}</Badge>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {projectFormOpen ? (
        <ProjectTemplateModal
          open
          onClose={() => {
            setProjectFormOpen(false);
            setEditingProject(null);
          }}
          template={editingProject ?? undefined}
          onSave={saveProjectTemplate}
        />
      ) : null}

      {taskFormOpen ? (
        <TaskTemplateModal
          open
          onClose={() => {
            setTaskFormOpen(false);
            setEditingTask(null);
          }}
          template={editingTask ?? undefined}
          onSave={saveTaskTemplate}
        />
      ) : null}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          if (deleting.kind === "project") deleteProjectTemplate(deleting.id);
          else deleteTaskTemplate(deleting.id);
        }}
        title={`Delete “${deleting?.name ?? ""}”?`}
        body="Projects and tasks already created from this template are unaffected."
      />
    </div>
  );
}

/* ------------------------------------------------- project template form */

function ProjectTemplateModal({
  open,
  onClose,
  template,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  template?: ProjectTemplate;
  onSave: (t: ProjectTemplate) => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [color, setColor] = useState(template?.color ?? PROJECT_COLORS[0]);
  const [services, setServices] = useState<string[]>(template?.services ?? []);
  const [priority, setPriority] = useState<Priority>(template?.priority ?? "Medium");
  const [durationDays, setDurationDays] = useState(
    template ? String(template.durationDays) : "30",
  );
  const [tasks, setTasks] = useState<TaskTemplateItem[]>(template?.tasks ?? []);
  const [touched, setTouched] = useState(false);

  const valid = name.trim() && services.length > 0 && Number(durationDays) > 0;

  const addTask = () =>
    setTasks((t) => [
      ...t,
      {
        id: `pti-${Date.now()}-${t.length}`,
        title: "",
        description: "",
        department: DEPARTMENTS[0],
        priority: "Medium",
        estimatedHours: 4,
        tags: [],
        startOffsetDays: t.length === 0 ? 0 : t[t.length - 1].startOffsetDays + 2,
        durationDays: 3,
      },
    ]);

  const patchTask = (id: string, patch: Partial<TaskTemplateItem>) =>
    setTasks((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const move = (index: number, delta: number) => {
    setTasks((list) => {
      const next = [...list];
      const target = index + delta;
      if (target < 0 || target >= next.length) return next;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={template ? "Edit project template" : "New project template"}
      subtitle="Project defaults plus an ordered task list. Saving without tasks is fine."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              onSave({
                id: template?.id ?? `pt-${Date.now()}`,
                name: name.trim(),
                description: description.trim(),
                color,
                services,
                priority,
                durationDays: Number(durationDays),
                tasks: tasks.filter((t) => t.title.trim()),
                createdAt: template?.createdAt ?? new Date().toISOString(),
              });
              onClose();
            }}
          >
            {template ? "Save changes" : "Create template"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Template name"
          required
          error={touched && !name.trim() ? "Required." : undefined}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Residential Project Launch"
          />
        </Field>

        <Field label="Description">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this template is for"
          />
        </Field>

        <Field label="Default colour">
          <ColorPicker value={color} onChange={setColor} presets={PROJECT_COLORS} />
        </Field>

        <Field
          label="Default services"
          required
          error={touched && services.length === 0 ? "Pick at least one." : undefined}
        >
          <MultiSelect
            options={SERVICES.map((s) => ({ value: s, label: s }))}
            value={services}
            onChange={setServices}
            placeholder="Search services…"
            emptyLabel="No services selected"
            maxVisibleChips={8}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Default priority">
            <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Typical duration (working days)"
            required
            hint="Used to suggest the project deadline."
          >
            <Input
              type="number"
              min="1"
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
            />
          </Field>
        </div>

        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-ink">
              Tasks ({tasks.length})
            </span>
            <Button size="sm" onClick={addTask}>
              <IconPlus size={13} /> Add task
            </Button>
          </div>

          {tasks.length === 0 ? (
            <p className="py-4 text-center text-[12px] text-ink-faint">
              No tasks yet — this template will only pre-fill the project form.
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {tasks.map((item, i) => (
                <li key={item.id} className="rounded-lg border border-line bg-surface p-3">
                  <div className="mb-2.5 flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-surface-3 text-[10px] text-ink-muted">
                      {i + 1}
                    </span>
                    <Input
                      value={item.title}
                      onChange={(e) => patchTask(item.id, { title: e.target.value })}
                      placeholder="Task title"
                      className="flex-1"
                    />
                    <button
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label="Move up"
                      className="rounded px-1.5 py-1 text-[11px] text-ink-faint hover:text-ink disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => move(i, 1)}
                      disabled={i === tasks.length - 1}
                      aria-label="Move down"
                      className="rounded px-1.5 py-1 text-[11px] text-ink-faint hover:text-ink disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => setTasks((l) => l.filter((x) => x.id !== item.id))}
                      aria-label="Remove task"
                      className="rounded p-1 text-ink-faint hover:text-st-rejected"
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>

                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <SearchSelect
                      options={DEPARTMENTS.map((d) => ({ value: d, label: d }))}
                      value={item.department}
                      onChange={(v) => patchTask(item.id, { department: v })}
                    />
                    <Select
                      value={item.priority}
                      onChange={(e) =>
                        patchTask(item.id, { priority: e.target.value as Priority })
                      }
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="mt-2.5 grid grid-cols-3 gap-2.5">
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] tracking-wide text-ink-faint uppercase">
                        Starts day
                      </span>
                      <Input
                        type="number"
                        min="0"
                        value={item.startOffsetDays}
                        onChange={(e) =>
                          patchTask(item.id, { startOffsetDays: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] tracking-wide text-ink-faint uppercase">
                        Duration
                      </span>
                      <Input
                        type="number"
                        min="1"
                        value={item.durationDays}
                        onChange={(e) =>
                          patchTask(item.id, { durationDays: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] tracking-wide text-ink-faint uppercase">
                        Est. hours
                      </span>
                      <Input
                        type="number"
                        min="0.5"
                        step="0.5"
                        value={item.estimatedHours}
                        onChange={(e) =>
                          patchTask(item.id, { estimatedHours: Number(e.target.value) })
                        }
                      />
                    </label>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------- task template form */

function TaskTemplateModal({
  open,
  onClose,
  template,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  template?: TaskTemplate;
  onSave: (t: TaskTemplate) => void;
}) {
  const [title, setTitle] = useState(template?.title ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [department, setDepartment] = useState(template?.department ?? DEPARTMENTS[0]);
  const [priority, setPriority] = useState<Priority>(template?.priority ?? "Medium");
  const [estimatedHours, setEstimatedHours] = useState(
    template ? String(template.estimatedHours) : "4",
  );
  const [durationDays, setDurationDays] = useState(
    template ? String(template.durationDays) : "2",
  );
  const [tags, setTags] = useState<string[]>(template?.tags ?? []);
  const [touched, setTouched] = useState(false);

  const valid = title.trim() && Number(estimatedHours) > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={template ? "Edit task template" : "New task template"}
      subtitle="A standalone reusable task, offered whenever a task is created."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              onSave({
                id: template?.id ?? `tt-${Date.now()}`,
                title: title.trim(),
                description: description.trim(),
                department,
                priority,
                estimatedHours: Number(estimatedHours),
                durationDays: Number(durationDays),
                startOffsetDays: 0,
                tags,
                createdAt: template?.createdAt ?? new Date().toISOString(),
              });
              onClose();
            }}
          >
            {template ? "Save changes" : "Create template"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Task title"
          required
          error={touched && !title.trim() ? "Required." : undefined}
        >
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Festival creative"
          />
        </Field>

        <Field label="Description">
          <RichTextEditor
            value={description}
            onChange={setDescription}
            placeholder="Standing brief for this kind of task…"
            minHeight={72}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Department" required>
            <SearchSelect
              options={DEPARTMENTS.map((d) => ({ value: d, label: d }))}
              value={department}
              onChange={setDepartment}
            />
          </Field>
          <Field label="Priority" required>
            <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Estimated hours"
            required
            error={touched && !(Number(estimatedHours) > 0) ? "Required." : undefined}
          >
            <Input
              type="number"
              min="0.5"
              step="0.5"
              value={estimatedHours}
              onChange={(e) => setEstimatedHours(e.target.value)}
            />
          </Field>
          <Field label="Typical duration (working days)">
            <Input
              type="number"
              min="1"
              value={durationDays}
              onChange={(e) => setDurationDays(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Tags">
          <TagsInput value={tags} onChange={setTags} />
        </Field>
      </div>
    </Modal>
  );
}
