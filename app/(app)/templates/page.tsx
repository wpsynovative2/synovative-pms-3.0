"use client";

import { useEffect, useState } from "react";
import {
  IconCopy,
  IconEdit,
  IconPlus,
  IconTasks,
  IconTemplate,
  IconTrash,
} from "@/components/ui/icons";
import { PieceTypesPicker, pieceTypes } from "@/components/content/piece-types";
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
import { RichText, RichTextEditor, isRichTextEmpty } from "@/components/ui/rich-text";
import { MultiSelect, SearchSelect, TagsInput } from "@/components/ui/selects";
import {
  CONTENT_WRITER_DEPARTMENT,
  DEFAULT_PROJECT_COLOR,
  PRIORITIES,
} from "@/lib/master-data";
import { canManageTemplates } from "@/lib/permissions";
import { useStore } from "@/lib/store";
import type {
  Priority,
  ProjectTemplate,
  TaskKind,
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
  // The form is filling in a copy, not editing the template it came from.
  const [copying, setCopying] = useState(false);
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
              setCopying(false);
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
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[14px] font-semibold text-ink">{t.name}</h3>
                    <RichText
                      html={t.description}
                      className="mt-0.5 text-[11px] text-ink-faint"
                    />
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      onClick={() => {
                        setCopying(false);
                        setEditingProject(t);
                        setProjectFormOpen(true);
                      }}
                    >
                      <IconEdit size={13} />
                    </Button>
                    <Button
                      size="sm"
                      title="Duplicate this template"
                      aria-label={`Duplicate ${t.name}`}
                      onClick={() => {
                        setCopying(true);
                        setEditingProject(copyProjectTemplate(t));
                        setProjectFormOpen(true);
                      }}
                    >
                      <IconCopy size={13} />
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
                    {/* Rounded: 0.1h steps add up to 14.799999999999999 in floating point. */}
                    {Math.round(t.tasks.reduce((s, x) => s + x.estimatedHours, 0) * 100) / 100}h estimated
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
                        {item.kind === "content" ? (
                          <span className="shrink-0 text-brand-ink">
                            {item.contentCount} piece{item.contentCount === 1 ? "" : "s"}
                          </span>
                        ) : null}
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
                      setCopying(false);
                      setEditingTask(t);
                      setTaskFormOpen(true);
                    }}
                  >
                    <IconEdit size={13} />
                  </Button>
                  <Button
                    size="sm"
                    title="Duplicate this template"
                    aria-label={`Duplicate ${t.title}`}
                    onClick={() => {
                      setCopying(true);
                      setEditingTask({
                        ...t,
                        id: crypto.randomUUID(),
                        title: `${t.title} (copy)`,
                        createdAt: new Date().toISOString(),
                      });
                      setTaskFormOpen(true);
                    }}
                  >
                    <IconCopy size={13} />
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

              <RichText html={t.description} className="mt-2.5 text-[11px]" />

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
          copying={copying}
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
          copying={copying}
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

/**
 * A project template's copy, with ids of its own so saving it adds a template
 * rather than overwriting the original.
 */
function copyProjectTemplate(t: ProjectTemplate): ProjectTemplate {
  return {
    ...t,
    id: crypto.randomUUID(),
    name: `${t.name} (copy)`,
    tasks: t.tasks.map((x) => ({ ...x, id: crypto.randomUUID() })),
    createdAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------- project template form */

function ProjectTemplateModal({
  open,
  onClose,
  template,
  copying = false,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  template?: ProjectTemplate;
  /** `template` is a fresh copy to be saved as a new one. */
  copying?: boolean;
  onSave: (t: ProjectTemplate) => void;
}) {
  const { db } = useStore();
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [services, setServices] = useState<string[]>(template?.services ?? []);
  const [priority, setPriority] = useState<Priority>(template?.priority ?? "Medium");
  const [durationDays, setDurationDays] = useState(
    template ? String(template.durationDays) : "30",
  );
  const [tasks, setTasks] = useState<TaskTemplateItem[]>(template?.tasks ?? []);
  const [touched, setTouched] = useState(false);

  const tasksValid = tasks.every((t) => t.kind !== "content" || t.contentCount >= 1);
  const valid = name.trim() && services.length > 0 && Number(durationDays) > 0 && tasksValid;

  /*
   * The task just added or duplicated. It is brought into view and its title
   * selected, so a long list never needs scrolling back to find it.
   */
  const [newTaskId, setNewTaskId] = useState<string | null>(null);
  useEffect(() => {
    if (!newTaskId) return;
    const row = document.querySelector<HTMLElement>(`[data-template-task="${newTaskId}"]`);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
    row?.querySelector<HTMLInputElement>("input")?.select();
  }, [newTaskId]);

  const addTask = () => {
    const id = crypto.randomUUID();
    setNewTaskId(id);
    setTasks((t) => [
      ...t,
      {
        id,
        title: "",
        description: "",
        department: db.departments[0] ?? "",
        priority: "Medium",
        estimatedHours: 4,
        tags: [],
        startOffsetDays: t.length === 0 ? 0 : t[t.length - 1].startOffsetDays + 2,
        durationDays: 3,
        kind: "standard",
        contentCount: 0,
        contentTypes: [],
      },
    ]);
  };

  /** A copy of a task, straight after it, with an id of its own. */
  const duplicateTask = (index: number) => {
    const id = crypto.randomUUID();
    setNewTaskId(id);
    setTasks((list) => {
      const original = list[index];
      if (!original) return list;
      const copy = {
        ...original,
        id,
        title: original.title.trim() ? `${original.title} (copy)` : "",
      };
      return [...list.slice(0, index + 1), copy, ...list.slice(index + 1)];
    });
  };

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
      title={
        copying ? "Duplicate project template" : template ? "Edit project template" : "New project template"
      }
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
                id: template?.id ?? crypto.randomUUID(),
                name: name.trim(),
                description: isRichTextEmpty(description) ? "" : description,
                // Colour is no longer chosen; the column keeps whatever it had.
                color: template?.color ?? DEFAULT_PROJECT_COLOR,
                services,
                priority,
                durationDays: Number(durationDays),
                tasks: tasks
                  .filter((t) => t.title.trim())
                  .map((t) => ({
                    ...t,
                    contentCount: t.kind === "content" ? t.contentCount : 0,
                    // One type per piece, no more and no fewer.
                    contentTypes:
                      t.kind === "content" ? pieceTypes(t.contentCount, t.contentTypes) : [],
                  })),
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
          <RichTextEditor
            value={description}
            onChange={setDescription}
            placeholder="What this template is for"
            minHeight={72}
          />
        </Field>

        <Field
          label="Default services"
          required
          error={touched && services.length === 0 ? "Pick at least one." : undefined}
        >
          <MultiSelect
            options={db.services.map((s) => ({ value: s, label: s }))}
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
          {/* Stays in view while the list scrolls, so Add task is always at hand.
              -top-5 cancels the dialog body's padding, which a sticky box sticks inside. */}
          <div className="sticky -top-5 z-10 -mx-4 -mt-4 mb-3 flex items-center justify-between rounded-t-xl border-b border-line-soft bg-surface-2 px-4 py-3">
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
                <li
                  key={item.id}
                  data-template-task={item.id}
                  className="scroll-mt-16 rounded-lg border border-line bg-surface p-3"
                >
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
                      onClick={() => duplicateTask(i)}
                      aria-label="Duplicate task"
                      title="Duplicate task"
                      className="rounded p-1 text-ink-faint hover:text-ink"
                    >
                      <IconCopy size={14} />
                    </button>
                    <button
                      onClick={() => setTasks((l) => l.filter((x) => x.id !== item.id))}
                      aria-label="Remove task"
                      className="rounded p-1 text-ink-faint hover:text-st-rejected"
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>

                  <div className="mb-2.5 grid gap-2.5 sm:grid-cols-2">
                    <Select
                      value={item.kind}
                      onChange={(e) => {
                        const kind = e.target.value as TaskKind;
                        patchTask(item.id, {
                          kind,
                          contentCount: kind === "content" ? Math.max(1, item.contentCount) : 0,
                          // Content is written by the writers' desk; still changeable.
                          ...(kind === "content" &&
                          db.departments.includes(CONTENT_WRITER_DEPARTMENT)
                            ? { department: CONTENT_WRITER_DEPARTMENT }
                            : {}),
                        });
                      }}
                      aria-label={`Type of task ${i + 1}`}
                    >
                      <option value="standard">Standard task</option>
                      <option value="content">Content task</option>
                    </Select>
                    {item.kind === "content" ? (
                      <Input
                        type="number"
                        min="1"
                        value={item.contentCount ? String(item.contentCount) : ""}
                        onChange={(e) =>
                          patchTask(item.id, {
                            contentCount: Math.max(0, Math.trunc(Number(e.target.value)) || 0),
                          })
                        }
                        placeholder="How many pieces? e.g. 5"
                        aria-label={`Pieces in task ${i + 1}`}
                      />
                    ) : null}
                  </div>

                  {item.kind === "content" && item.contentCount > 0 ? (
                    <div className="mb-2.5">
                      <p className="mb-1.5 text-[10px] tracking-wide text-ink-faint uppercase">
                        CB type of each piece
                      </p>
                      <PieceTypesPicker
                        count={item.contentCount}
                        types={item.contentTypes}
                        onChange={(contentTypes) => patchTask(item.id, { contentTypes })}
                      />
                    </div>
                  ) : null}
                  {touched && item.kind === "content" && item.contentCount < 1 ? (
                    <p className="mb-2.5 text-[11px] text-st-rejected">
                      How many pieces? At least one.
                    </p>
                  ) : null}

                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <SearchSelect
                      options={db.departments.map((d) => ({ value: d, label: d }))}
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

          {/* Where the last task was just filled in, the next is added from. */}
          {tasks.length ? (
            <button
              type="button"
              onClick={addTask}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line py-2.5 text-[12px] font-medium text-ink-muted transition-colors hover:border-brand-bright/50 hover:bg-surface hover:text-ink"
            >
              <IconPlus size={13} /> Add task
            </button>
          ) : null}
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
  copying = false,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  template?: TaskTemplate;
  /** `template` is a fresh copy to be saved as a new one. */
  copying?: boolean;
  onSave: (t: TaskTemplate) => void;
}) {
  const { db } = useStore();
  const [title, setTitle] = useState(template?.title ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [department, setDepartment] = useState(
    template?.department ?? db.departments[0] ?? "",
  );
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
      title={copying ? "Duplicate task template" : template ? "Edit task template" : "New task template"}
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
                id: template?.id ?? crypto.randomUUID(),
                title: title.trim(),
                description: isRichTextEmpty(description) ? "" : description,
                department,
                priority,
                estimatedHours: Number(estimatedHours),
                durationDays: Number(durationDays),
                startOffsetDays: 0,
                tags,
                kind: "standard",
                contentCount: 0,
                contentTypes: [],
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
              options={db.departments.map((d) => ({ value: d, label: d }))}
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
