"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ProjectFormModal } from "@/components/project/project-form";
import { TaskFormModal } from "@/components/task/task-form";
import { ConfirmDialog, Drawer } from "@/components/ui/modal";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SearchInput,
  StatTile,
  Tabs,
  cx,
} from "@/components/ui/primitives";
import {
  IconContent,
  IconEdit,
  IconExternal,
  IconPlus,
  IconRepeat,
  IconTrash,
} from "@/components/ui/icons";
import { formatDate, snapToWorkingDay } from "@/lib/calendar";
import { canSetRecurrence, visibleProjects, visibleTasks } from "@/lib/permissions";
import { describeRule, upcomingOccurrences } from "@/lib/recurrence";
import { useStore } from "@/lib/store";
import type { Project, RecurrenceSeries, Task } from "@/lib/types";

type Kind = "all" | "project" | "task";

interface SeriesRow {
  kind: "project" | "task";
  id: string;
  title: string;
  series: RecurrenceSeries;
  /** Projects / tasks this blueprint has created so far, newest first. */
  copies: { id: string; name: string; href: string; date: string }[];
  next: string | null;
  /** Tasks on the blueprint, i.e. what every occurrence copies. Projects only. */
  taskCount: number;
}

/**
 * The Recurrence module: where repeating projects and individual tasks are set
 * up. Each one here is a *blueprint* (0009) - the plan, never worked on itself
 * and kept out of every other page. On each date its rule hits, the database
 * creates a real project (with its tasks and content tasks) or a real task,
 * named for the month it is for. A blueprint whose first date is today is
 * created as soon as it is saved.
 */
export default function RecurrencePage() {
  const { db, blueprints, currentUser, updateProject, updateTask, deleteProject, deleteTask, showToast } =
    useStore();
  const user = currentUser!;
  const mayManage = canSetRecurrence(user);
  const searchParams = useSearchParams();
  const highlight = searchParams.get("series");

  const [kind, setKind] = useState<Kind>("all");
  const [query, setQuery] = useState("");
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [creating, setCreating] = useState<"project" | "task" | null>(null);
  const [deleting, setDeleting] = useState<SeriesRow | null>(null);
  // Held by id so the drawer shows edits made while it is open.
  const [openId, setOpenId] = useState<string | null>(highlight);

  const rows = useMemo<SeriesRow[]>(() => {
    const next = (s: RecurrenceSeries) =>
      upcomingOccurrences(s.rule, s.anchor, s.cursor, 1)[0]?.date ?? null;

    const projects = (
      mayManage
        ? blueprints.projects
        : visibleProjects(user, blueprints.projects, blueprints.tasks)
    ).map<SeriesRow>((p) => ({
      kind: "project",
      id: p.id,
      title: p.name,
      series: p.recurrence!,
      copies: db.projects
        .filter((x) => x.series?.sourceId === p.id)
        .sort((a, b) => b.startDate.localeCompare(a.startDate))
        .map((x) => ({ id: x.id, name: x.name, href: `/projects/${x.id}`, date: x.startDate })),
      next: next(p.recurrence!),
      taskCount: blueprints.tasks.filter((t) => t.projectId === p.id).length,
    }));

    const tasks = (
      mayManage ? blueprints.tasks : visibleTasks(user, blueprints.tasks, blueprints.projects)
    )
      .filter((t) => t.projectId === null && t.recurrence)
      .map<SeriesRow>((t) => ({
        kind: "task",
        id: t.id,
        title: t.title,
        series: t.recurrence!,
        copies: db.tasks
          .filter((x) => x.series?.sourceId === t.id)
          .sort((a, b) => b.startDate.localeCompare(a.startDate))
          .map((x) => ({
            id: x.id,
            name: x.title,
            href: `/tasks?type=individual&task=${x.id}`,
            date: x.startDate,
          })),
        next: next(t.recurrence!),
        taskCount: 0,
      }));

    return [...projects, ...tasks].sort(
      (a, b) => (a.next ?? "9999").localeCompare(b.next ?? "9999") || a.title.localeCompare(b.title),
    );
  }, [blueprints, db.projects, db.tasks, mayManage, user]);

  const q = query.trim().toLowerCase();
  const filtered = rows.filter(
    (r) => (kind === "all" || r.kind === kind) && (!q || r.title.toLowerCase().includes(q)),
  );

  const paused = rows.filter((r) => r.series.paused).length;
  const finished = rows.filter((r) => !r.series.paused && r.next === null).length;
  const open = openId ? rows.find((r) => r.id === openId) : undefined;

  const setPaused = (row: SeriesRow, value: boolean) => {
    const series = { ...row.series, paused: value };
    if (row.kind === "project") updateProject(row.id, { recurrence: series });
    else updateTask(row.id, { recurrence: series });
    showToast(value ? `Paused “${row.title}”.` : `Resumed “${row.title}”.`, "success");
  };

  const edit = (row: SeriesRow) => {
    if (row.kind === "project") {
      setEditingProject(blueprints.projects.find((p) => p.id === row.id) ?? null);
    } else {
      setEditingTask(blueprints.tasks.find((t) => t.id === row.id) ?? null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Recurrence"
        icon={<IconRepeat size={20} />}
        subtitle="Repeating projects and tasks — set up here, created in Projects and Tasks on each date"
        actions={
          mayManage ? (
            <>
              <Button onClick={() => setCreating("task")}>
                <IconPlus size={15} /> Repeating task
              </Button>
              <Button variant="primary" onClick={() => setCreating("project")}>
                <IconPlus size={15} /> Repeating project
              </Button>
            </>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Repeating" value={rows.length} tone="brand" icon={<IconRepeat size={17} />} />
        <StatTile label="Active" value={rows.length - paused - finished} tone="green" />
        <StatTile label="Paused" value={paused} tone="amber" />
        <StatTile
          label="Created so far"
          value={rows.reduce((n, r) => n + r.copies.length, 0)}
          hint="projects and tasks made on their dates"
          tone="blue"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs<Kind>
          active={kind}
          onChange={setKind}
          tabs={[
            { id: "all", label: "All", count: rows.length },
            { id: "project", label: "Projects", count: rows.filter((r) => r.kind === "project").length },
            { id: "task", label: "Individual tasks", count: rows.filter((r) => r.kind === "task").length },
          ]}
        />
        <SearchInput
          className="min-w-52"
          placeholder="Search repeats…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {!mayManage ? (
        <Card className="px-4 py-3 text-[12px] leading-relaxed text-ink-faint">
          Repeats are set up by Super Admins, Admins and Managers. You can see what repeats
          and when it next runs.
        </Card>
      ) : null}

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconRepeat size={30} />}
            title={rows.length === 0 ? "Nothing repeats yet" : "No repeats match this search"}
            body={
              rows.length === 0
                ? "Set up a repeating project with its tasks, and a project is created from it on every date it repeats."
                : undefined
            }
          />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-left text-[12px]">
            <thead className="bg-surface-2 text-[10px] tracking-wide text-ink-faint uppercase">
              <tr>
                <th className="px-4 py-2.5 font-medium">What repeats</th>
                <th className="px-4 py-2.5 font-medium">Rule</th>
                <th className="px-4 py-2.5 font-medium">Next</th>
                <th className="px-4 py-2.5 font-medium">Created</th>
                <th className="px-4 py-2.5 font-medium">State</th>
                <th className="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={`${r.kind}:${r.id}`}
                  className={cx(
                    "border-t border-line-soft hover:bg-surface-2",
                    highlight === r.id && "bg-brand/10",
                  )}
                >
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setOpenId(r.id)}
                      className="text-left text-[13px] text-ink hover:text-brand-bright hover:underline"
                    >
                      {r.title}
                    </button>
                    <div className="mt-0.5 text-[10px] text-ink-faint">
                      {r.kind === "project"
                        ? `Project · ${r.taskCount} task${r.taskCount === 1 ? "" : "s"} each time`
                        : "Individual task"}
                    </div>
                  </td>
                  <td className="max-w-64 px-4 py-3 text-ink-muted">
                    {describeRule(r.series.rule, r.series.anchor)}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {r.series.paused
                      ? "—"
                      : r.next
                        ? formatDate(snapToWorkingDay(r.next, db.calendar))
                        : "No more"}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {r.copies.length ? (
                      <Link href={r.copies[0].href} className="hover:text-ink hover:underline">
                        {r.copies.length} · latest {formatDate(r.copies[0].date)}
                      </Link>
                    ) : (
                      "None yet"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {r.series.paused ? (
                      <Badge className="border-st-submitted/30 bg-st-submitted/15 text-st-submitted">
                        Paused
                      </Badge>
                    ) : r.next === null ? (
                      <Badge className="border-line bg-surface-3 text-ink-faint">Finished</Badge>
                    ) : (
                      <Badge className="border-st-approved/30 bg-st-approved/15 text-st-approved">
                        Active
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button size="sm" onClick={() => setOpenId(r.id)}>
                        {r.kind === "project" ? "Tasks" : "Open"}
                      </Button>
                      {mayManage ? (
                        <>
                          <Button size="sm" onClick={() => setPaused(r, !r.series.paused)}>
                            {r.series.paused ? "Resume" : "Pause"}
                          </Button>
                          <Button size="sm" aria-label="Edit" onClick={() => edit(r)}>
                            <IconEdit size={13} />
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            aria-label="Delete"
                            onClick={() => setDeleting(r)}
                          >
                            <IconTrash size={13} />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="px-4 py-3 text-[11px] leading-relaxed text-ink-faint">
        A repeating project is a <strong>blueprint</strong>: it never appears in Projects
        itself. At 00:05 IST on each date it repeats — and straight away if the first date
        is today — a project is created from it in Projects, named “name – Month Year”, with
        its tasks and content tasks, dates moved to that date and snapped to working days.
        Changing the blueprint affects only projects created after the change.{" "}
        <strong>Pausing skips</strong> the dates it covers rather than saving them up.{" "}
        <strong>Deleting</strong> ends the repeat; everything it already created stays.
      </Card>

      {open ? (
        <BlueprintDrawer
          row={open}
          mayManage={mayManage}
          onEdit={() => edit(open)}
          onClose={() => setOpenId(null)}
        />
      ) : null}

      {creating === "project" ? (
        <ProjectFormModal open recurring onClose={() => setCreating(null)} />
      ) : null}
      {creating === "task" ? (
        <TaskFormModal
          open
          recurring
          onClose={() => setCreating(null)}
          project={null}
          mode="individual"
        />
      ) : null}
      {editingProject ? (
        <ProjectFormModal
          open
          recurring
          onClose={() => setEditingProject(null)}
          project={editingProject}
        />
      ) : null}
      {editingTask ? (
        <TaskFormModal
          open
          recurring
          onClose={() => setEditingTask(null)}
          task={editingTask}
          project={null}
          mode="individual"
        />
      ) : null}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          if (deleting.kind === "project") deleteProject(deleting.id);
          else deleteTask(deleting.id);
          if (openId === deleting.id) setOpenId(null);
          showToast(`“${deleting.title}” no longer repeats.`, "success");
        }}
        title={`Delete “${deleting?.title ?? ""}”?`}
        body="The blueprint and its rule are removed, so nothing more is created. Every project and task it has already created stays as it is."
        confirmLabel="Delete blueprint"
      />
    </div>
  );
}

/* ---------------------------------------------------------------- drawer */

/**
 * One blueprint: its rule, the tasks every occurrence will carry (editable
 * here, because the blueprint has no project page of its own), and what it
 * has created so far.
 */
function BlueprintDrawer({
  row,
  mayManage,
  onEdit,
  onClose,
}: {
  row: SeriesRow;
  mayManage: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { db, blueprints, userById, deleteTask } = useStore();
  const [taskForm, setTaskForm] = useState<{ task?: Task } | null>(null);
  const [deletingTask, setDeletingTask] = useState<Task | null>(null);

  const project = row.kind === "project" ? blueprints.projects.find((p) => p.id === row.id) : undefined;
  const task = row.kind === "task" ? blueprints.tasks.find((t) => t.id === row.id) : undefined;
  const tasks = blueprints.tasks
    .filter((t) => t.projectId === row.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const upcoming = upcomingOccurrences(row.series.rule, row.series.anchor, row.series.cursor, 3);

  return (
    <Drawer
      open
      onClose={onClose}
      title={row.title}
      subtitle={describeRule(row.series.rule, row.series.anchor)}
      headerExtra={
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge>{row.kind === "project" ? "Repeating project" : "Repeating task"}</Badge>
          {row.series.paused ? <Badge>Paused</Badge> : null}
          {mayManage ? (
            <Button size="sm" onClick={onEdit}>
              <IconEdit size={13} /> Edit blueprint
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <section>
          <h3 className="mb-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
            Next dates
          </h3>
          {row.series.paused ? (
            <p className="text-[12px] text-ink-faint">Paused — nothing is created until it resumes.</p>
          ) : upcoming.length === 0 ? (
            <p className="text-[12px] text-ink-faint">No more dates to come.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {upcoming.map((o) => (
                <li key={o.date}>
                  <Badge>{formatDate(snapToWorkingDay(o.date, db.calendar))}</Badge>
                </li>
              ))}
            </ul>
          )}
          {project ? (
            <p className="mt-2 text-[11px] text-ink-faint">
              Each project runs{" "}
              {Math.round(
                (new Date(project.deadline).getTime() - new Date(project.startDate).getTime()) /
                  86_400_000,
              ) + 1}{" "}
              days from its date, like the first: {formatDate(project.startDate)} →{" "}
              {formatDate(project.deadline)}.
            </p>
          ) : task ? (
            <p className="mt-2 text-[11px] text-ink-faint">
              For {userById(task.assigneeId)?.fullName ?? "nobody yet"} · {task.department}
            </p>
          ) : null}
        </section>

        {project ? (
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                Tasks each time ({tasks.length})
              </h3>
              {mayManage ? (
                <Button size="sm" variant="primary" onClick={() => setTaskForm({})}>
                  <IconPlus size={13} /> Add task
                </Button>
              ) : null}
            </div>
            {tasks.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[12px] text-ink-faint">
                No tasks yet. Every project created from this blueprint copies the tasks listed
                here.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {tasks.map((t) => {
                  const assignee = userById(t.assigneeId);
                  return (
                    <li
                      key={t.id}
                      className="flex items-center gap-2.5 rounded-card border border-line-soft bg-surface-2 px-3 py-2"
                    >
                      {assignee ? (
                        <Avatar name={assignee.fullName} size={24} />
                      ) : (
                        <span className="h-6 w-6 shrink-0 rounded-full bg-surface-3" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate text-[13px] font-medium text-ink">
                          {t.kind === "content" ? (
                            <IconContent size={13} className="shrink-0 text-brand-ink" />
                          ) : null}
                          <span className="truncate">{t.title}</span>
                          {t.kind === "content" ? (
                            <Badge className="shrink-0">{t.contentCount} pieces</Badge>
                          ) : null}
                        </p>
                        <p className="truncate text-[11px] text-ink-faint">
                          {t.department} · {assignee?.fullName ?? "Unassigned"} ·{" "}
                          {formatDate(t.startDate)} → {formatDate(t.dueDate)}
                        </p>
                      </div>
                      {mayManage ? (
                        <>
                          <Button size="sm" aria-label="Edit task" onClick={() => setTaskForm({ task: t })}>
                            <IconEdit size={13} />
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            aria-label="Remove task"
                            onClick={() => setDeletingTask(t)}
                          >
                            <IconTrash size={13} />
                          </Button>
                        </>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}

        <section>
          <h3 className="mb-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
            Created so far ({row.copies.length})
          </h3>
          {row.copies.length === 0 ? (
            <p className="text-[12px] text-ink-faint">Nothing yet — the first is made on its date.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {row.copies.map((c) => (
                <li key={c.id}>
                  <Link
                    href={c.href}
                    className="flex items-center gap-2 rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-[12px] text-ink hover:border-brand-bright/40"
                  >
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="text-[11px] text-ink-faint">{formatDate(c.date)}</span>
                    <IconExternal size={12} className="text-ink-faint" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {taskForm && project ? (
        <TaskFormModal
          open
          onClose={() => setTaskForm(null)}
          task={taskForm.task}
          project={project}
          mode="project"
        />
      ) : null}

      <ConfirmDialog
        open={!!deletingTask}
        onClose={() => setDeletingTask(null)}
        onConfirm={() => deletingTask && deleteTask(deletingTask.id)}
        title={`Remove “${deletingTask?.title ?? ""}” from the blueprint?`}
        body="Projects created from now on will not include it. Projects already created keep their copy."
        confirmLabel="Remove task"
      />
    </Drawer>
  );
}
