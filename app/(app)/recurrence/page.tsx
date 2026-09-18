"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ProjectFormModal } from "@/components/project/project-form";
import { TaskFormModal } from "@/components/task/task-form";
import { ConfirmDialog } from "@/components/ui/modal";
import {
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
import { IconExternal, IconEdit, IconPlus, IconRepeat, IconTrash } from "@/components/ui/icons";
import { formatDate } from "@/lib/calendar";
import {
  canCreateTaskInProject,
  canSetRecurrence,
  visibleProjects,
  visibleTasks,
} from "@/lib/permissions";
import { describeRule, upcomingOccurrences } from "@/lib/recurrence";
import { useStore } from "@/lib/store";
import type { Project, RecurrenceSeries, Task } from "@/lib/types";

type Kind = "all" | "project" | "task";

interface SeriesRow {
  kind: "project" | "task";
  id: string;
  title: string;
  series: RecurrenceSeries;
  /** The source project / individual task this series repeats. */
  href: string;
  /** Copies the generator has produced so far, not counting the source. */
  created: number;
  next: string | null;
  /** Tasks on the source, i.e. what every occurrence will copy. Projects only. */
  taskCount: number;
}

/**
 * Every repeating project and individual task in one place: what the rule is,
 * when it next fires, how many copies it has made, and the controls to pause,
 * edit or stop it. The generator itself runs nightly in the database
 * (0004_recurrence.sql); nothing here creates occurrences directly.
 */
export default function RecurrencePage() {
  const { db, currentUser, updateProject, updateTask, deleteProject, deleteTask, showToast } =
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
  const [addingTaskTo, setAddingTaskTo] = useState<Project | null>(null);
  const [stopping, setStopping] = useState<SeriesRow | null>(null);

  const rows = useMemo<SeriesRow[]>(() => {
    const next = (s: RecurrenceSeries) =>
      upcomingOccurrences(s.rule, s.anchor, s.cursor, 1)[0]?.date ?? null;

    const projects = visibleProjects(user, db.projects, db.tasks)
      .filter((p) => p.recurrence)
      .map<SeriesRow>((p) => ({
        kind: "project",
        id: p.id,
        title: p.name,
        series: p.recurrence!,
        href: `/projects/${p.id}`,
        created: db.projects.filter((x) => x.series?.sourceId === p.id).length,
        next: next(p.recurrence!),
        taskCount: db.tasks.filter((t) => t.projectId === p.id).length,
      }));

    const tasks = visibleTasks(user, db.tasks, db.projects)
      .filter((t) => t.projectId === null && t.recurrence)
      .map<SeriesRow>((t) => ({
        kind: "task",
        id: t.id,
        title: t.title,
        series: t.recurrence!,
        href: `/tasks?type=individual&task=${t.id}`,
        created: db.tasks.filter((x) => x.series?.sourceId === t.id).length,
        next: next(t.recurrence!),
        taskCount: 0,
      }));

    return [...projects, ...tasks].sort(
      (a, b) => (a.next ?? "9999").localeCompare(b.next ?? "9999") || a.title.localeCompare(b.title),
    );
  }, [db.projects, db.tasks, user]);

  const q = query.trim().toLowerCase();
  const filtered = rows.filter(
    (r) => (kind === "all" || r.kind === kind) && (!q || r.title.toLowerCase().includes(q)),
  );

  const paused = rows.filter((r) => r.series.paused).length;
  const finished = rows.filter((r) => !r.series.paused && r.next === null).length;

  const setPaused = async (row: SeriesRow, value: boolean) => {
    const series = { ...row.series, paused: value };
    if (row.kind === "project") updateProject(row.id, { recurrence: series });
    else updateTask(row.id, { recurrence: series });
    showToast(value ? `Paused “${row.title}”.` : `Resumed “${row.title}”.`, "success");
  };

  const stopRepeating = (row: SeriesRow) => {
    if (row.kind === "project") updateProject(row.id, { recurrence: null });
    else updateTask(row.id, { recurrence: null });
    showToast(`“${row.title}” no longer repeats. Everything it created stays.`, "success");
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Recurrence"
        icon={<IconRepeat size={20} />}
        subtitle="Repeating projects and individual tasks, and what they produce"
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
        <StatTile
          label="Repeating series"
          value={rows.length}
          tone="brand"
          icon={<IconRepeat size={17} />}
        />
        <StatTile label="Active" value={rows.length - paused - finished} tone="green" />
        <StatTile label="Paused" value={paused} tone="amber" />
        <StatTile
          label="Copies created"
          value={rows.reduce((n, r) => n + r.created, 0)}
          hint="by the nightly generator"
          tone="blue"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs<Kind>
          active={kind}
          onChange={setKind}
          tabs={[
            { id: "all", label: "All", count: rows.length },
            {
              id: "project",
              label: "Projects",
              count: rows.filter((r) => r.kind === "project").length,
            },
            {
              id: "task",
              label: "Individual tasks",
              count: rows.filter((r) => r.kind === "task").length,
            },
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
          Repeats are set up by Super Admins, Admins and Managers. You can see what
          repeats and when it next runs.
        </Card>
      ) : null}

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconRepeat size={30} />}
            title={rows.length === 0 ? "Nothing repeats yet" : "No repeats match this search"}
            body={
              rows.length === 0
                ? "Turn on Repeat while creating a project or an individual task, and it will appear here."
                : undefined
            }
          />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-[12px]">
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
                    <Link
                      href={r.href}
                      className="inline-flex items-center gap-1.5 text-[13px] text-ink hover:underline"
                    >
                      {r.title}
                      <IconExternal size={12} className="text-ink-faint" />
                    </Link>
                    <div className="mt-0.5 text-[10px] text-ink-faint">
                      {r.kind === "project"
                        ? `Project · ${r.taskCount} task${r.taskCount === 1 ? "" : "s"} copied each time`
                        : "Individual task"}
                    </div>
                  </td>
                  <td className="max-w-64 px-4 py-3 text-ink-muted">
                    {describeRule(r.series.rule, r.series.anchor)}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {r.series.paused ? "—" : r.next ? formatDate(r.next) : "No more"}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {r.created} cop{r.created === 1 ? "y" : "ies"}
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
                    {mayManage ? (
                      <div className="flex items-center justify-end gap-1.5">
                        {r.kind === "project" ? (
                          <Button
                            size="sm"
                            title="Add a task to this repeating project — every future occurrence will include it"
                            onClick={() =>
                              setAddingTaskTo(db.projects.find((p) => p.id === r.id) ?? null)
                            }
                          >
                            <IconPlus size={13} /> Task
                          </Button>
                        ) : null}
                        <Button size="sm" onClick={() => void setPaused(r, !r.series.paused)}>
                          {r.series.paused ? "Resume" : "Pause"}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            if (r.kind === "project") {
                              setEditingProject(db.projects.find((p) => p.id === r.id) ?? null);
                            } else {
                              setEditingTask(db.tasks.find((t) => t.id === r.id) ?? null);
                            }
                          }}
                        >
                          <IconEdit size={13} />
                        </Button>
                        <Button size="sm" onClick={() => setStopping(r)}>
                          Stop
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setDeleting(r)}>
                          <IconTrash size={13} />
                        </Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="px-4 py-3 text-[11px] leading-relaxed text-ink-faint">
        Each occurrence is created by a job that runs at 00:05 IST on the day it falls
        due — a fresh copy of the project and its tasks (or of the task), with dates
        moved and snapped to working days. <strong>Pausing skips</strong> the dates it
        covers rather than saving them up, so resuming after a break does not create the
        ones that were missed. <strong>Stop</strong> ends the repeat and keeps everything
        already created; <strong>delete</strong> removes the original itself. Adding a
        task to a repeating project adds it to the original, so every occurrence from
        the next one on will include it — copies already made are left alone.
      </Card>

      {creating === "project" ? (
        <ProjectFormModal open onClose={() => setCreating(null)} />
      ) : null}
      {creating === "task" ? (
        <TaskFormModal open onClose={() => setCreating(null)} project={null} mode="individual" />
      ) : null}
      {addingTaskTo && canCreateTaskInProject(user, addingTaskTo) ? (
        <TaskFormModal
          open
          onClose={() => setAddingTaskTo(null)}
          project={addingTaskTo}
          mode="project"
        />
      ) : null}
      {editingProject ? (
        <ProjectFormModal
          open
          onClose={() => setEditingProject(null)}
          project={editingProject}
        />
      ) : null}
      {editingTask ? (
        <TaskFormModal
          open
          onClose={() => setEditingTask(null)}
          task={editingTask}
          project={null}
          mode="individual"
        />
      ) : null}

      <ConfirmDialog
        open={!!stopping}
        onClose={() => setStopping(null)}
        onConfirm={() => stopping && stopRepeating(stopping)}
        title={`Stop repeating “${stopping?.title ?? ""}”?`}
        body="The rule is removed and no further copies are made. Everything it has already created stays exactly as it is, including this original."
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          if (deleting.kind === "project") deleteProject(deleting.id);
          else deleteTask(deleting.id);
          showToast(`Deleted “${deleting.title}”.`, "success");
        }}
        title={`Delete “${deleting?.title ?? ""}”?`}
        body={
          deleting?.kind === "project"
            ? "Deletes this original project and its tasks. Copies already generated from it are kept, but they stop pointing back at a series."
            : "Deletes this original task. Copies already generated from it are kept."
        }
      />
    </div>
  );
}
