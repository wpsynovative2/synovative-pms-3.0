"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import {
  ContentCard,
  ContentDetailScreen,
  ContentTableHeader,
  PipelineSwitch,
} from "@/components/content/content-view";
import { ProjectCard } from "@/components/project/project-card";
import { TaskDetailDrawer } from "@/components/task/task-detail";
import { TaskRow, TaskTableHeader } from "@/components/task/task-list";
import {
  IconArrowLeft,
  IconContent,
  IconFilter,
  IconProjects,
  IconTasks,
  IconUser,
  IconUsers,
} from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  SearchInput,
  Select,
  Tabs,
  cx,
} from "@/components/ui/primitives";
import { SearchSelect } from "@/components/ui/selects";
import { formatDate } from "@/lib/calendar";
import { PROJECT_STATUSES } from "@/lib/master-data";
import { canAddUsers, canEditTaskFully, isGlobalManager } from "@/lib/permissions";
import { useStore } from "@/lib/store";
import {
  CONTENT_STAGES,
  ROLE_LABEL,
  contentHolders,
  contentLabel,
  type ContentEntry,
  type Project,
  type Task,
  type User,
} from "@/lib/types";

/** Finished work stays with whoever did it; everything else can be handed on. */
const isOpen = (t: Task) => t.status !== "Approved";

type View = "projects" | "tasks" | "content" | "individual";
type TaskStatusFilter = "all" | "open" | "approved";
/** A piece is theirs when they wrote it, or it is allotted to them to design. */
type ContentRole = "all" | "written" | "allotted";

const byDue = (a: Task, b: Task) => a.dueDate.localeCompare(b.dueDate);

/**
 * One person's work, opened from a row on the Users page, in four views: the
 * projects they are on (as cards, like the Projects page), their project
 * tasks, the Content Bank pieces they wrote or have been allotted, and their
 * individual tasks.
 *
 * When the account is deactivated, their open tasks can be picked and handed
 * to someone active in the same department - the task's own department, the
 * one the assignee list is drawn from when a task is created (§9.1).
 */
export default function UserWorkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { db, currentUser, userById, projectById } = useStore();
  const viewer = currentUser!;
  const person = userById(id);

  const [view, setView] = useState<View>("projects");
  const [query, setQuery] = useState("");
  const [projectStatus, setProjectStatus] = useState("all");
  const [taskStatus, setTaskStatus] = useState<TaskStatusFilter>("all");
  const [contentRole, setContentRole] = useState<ContentRole>("all");
  const [contentStage, setContentStage] = useState("all");
  const [showPipeline, setShowPipeline] = useState(true);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [reassigning, setReassigning] = useState(false);

  const q = query.trim().toLowerCase();

  const theirTasks = useMemo(() => db.tasks.filter((t) => t.assigneeId === id), [db.tasks, id]);
  const projectTasks = useMemo(() => theirTasks.filter((t) => t.projectId), [theirTasks]);
  const individualTasks = useMemo(() => theirTasks.filter((t) => !t.projectId), [theirTasks]);

  // Projects they are on: holding a task there, leading it, or listed on it.
  const theirProjects = useMemo(() => {
    const ids = new Set(projectTasks.map((t) => t.projectId!));
    return db.projects
      .filter((p) => ids.has(p.id) || p.leaderId === id || p.memberIds.includes(id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [db.projects, projectTasks, id]);

  const theirContent = useMemo(
    () =>
      db.contentEntries
        .filter((e) => e.createdBy === id || contentHolders(e).includes(id))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [db.contentEntries, id],
  );

  const taskMatches = (t: Task) => {
    if (taskStatus === "open" && !isOpen(t)) return false;
    if (taskStatus === "approved" && isOpen(t)) return false;
    if (!q) return true;
    const project = t.projectId ? projectById(t.projectId) : null;
    return [t.title, t.department, project?.name ?? "", ...t.tags].some((s) =>
      s.toLowerCase().includes(q),
    );
  };

  const shownProjects = theirProjects.filter(
    (p) =>
      (projectStatus === "all" || p.status === projectStatus) &&
      (!q || p.name.toLowerCase().includes(q) || p.clientName.toLowerCase().includes(q)),
  );
  const shownProjectTasks = projectTasks.filter(taskMatches);
  const shownIndividual = individualTasks.filter(taskMatches).sort(byDue);
  const shownContent = theirContent.filter((e) => {
    const wrote = e.createdBy === id;
    const holds = contentHolders(e).includes(id);
    if (contentRole === "written" && !wrote) return false;
    if (contentRole === "allotted" && !holds) return false;
    if (contentStage === "none" ? e.stage !== null : contentStage !== "all" && e.stage !== contentStage)
      return false;
    if (!q) return true;
    const project = projectById(e.projectId);
    return [contentLabel(e), e.type, project?.name ?? ""].some((s) => s.toLowerCase().includes(q));
  });

  // Project tasks, one group per project (by name), due date order inside.
  const taskGroups = (() => {
    const byProject = new Map<string, Task[]>();
    for (const t of shownProjectTasks)
      byProject.set(t.projectId!, [...(byProject.get(t.projectId!) ?? []), t]);
    return [...byProject.entries()]
      .map(([pid, tasks]) => ({ pid, project: projectById(pid) ?? null, tasks: tasks.sort(byDue) }))
      .sort((a, b) => (a.project?.name ?? "").localeCompare(b.project?.name ?? ""));
  })();

  // Content pieces, one group per project.
  const contentGroups = (() => {
    const byProject = new Map<string, ContentEntry[]>();
    for (const e of shownContent)
      byProject.set(e.projectId ?? "", [...(byProject.get(e.projectId ?? "") ?? []), e]);
    return [...byProject.entries()]
      .map(([pid, entries]) => ({ pid, project: projectById(pid) ?? null, entries }))
      .sort((a, b) => (a.project?.name ?? "").localeCompare(b.project?.name ?? ""));
  })();

  if (!canAddUsers(viewer) && !isGlobalManager(viewer)) {
    return (
      <Card>
        <EmptyState
          icon={<IconUsers size={30} />}
          title="This page isn't available for your role"
          body="Super Admins, Admins, Managers and HR Admins see a person's work here."
        />
      </Card>
    );
  }
  if (!person) {
    return (
      <Card>
        <EmptyState
          icon={<IconUser size={30} />}
          title="That user doesn't exist"
          body="They may have been deleted."
        />
      </Card>
    );
  }

  /** Only a deactivated person's open tasks are handed on, and only by someone who may edit them. */
  const mayHandOn = (t: Task) =>
    !person.active &&
    isOpen(t) &&
    canEditTaskFully(viewer, t, t.projectId ? (projectById(t.projectId) ?? null) : null);
  const taskView = view === "tasks" || view === "individual";
  const handable = (view === "tasks" ? shownProjectTasks : view === "individual" ? shownIndividual : []).filter(
    mayHandOn,
  );
  const anyHandable = theirTasks.some(mayHandOn);
  const pickedTasks = theirTasks.filter((t) => picked.includes(t.id) && mayHandOn(t));
  const openCount = theirTasks.filter(isOpen).length;

  const toggle = (ids: string[], on: boolean) =>
    setPicked((p) => (on ? [...new Set([...p, ...ids])] : p.filter((x) => !ids.includes(x))));

  const openEntry = openEntryId ? theirContent.find((e) => e.id === openEntryId) : undefined;
  const dirty =
    !!q || projectStatus !== "all" || taskStatus !== "all" || contentRole !== "all" || contentStage !== "all";

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/users"
        className="flex items-center gap-1.5 self-start text-[12px] text-ink-muted hover:text-ink"
      >
        <IconArrowLeft size={14} /> All users
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={person.fullName} size={44} />
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-ink">
              {person.fullName}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-muted">
              <Badge>{ROLE_LABEL[person.role]}</Badge>
              {person.active ? (
                <Badge className="border-st-approved/30 bg-st-approved/15 text-st-approved">
                  Active
                </Badge>
              ) : (
                <Badge className="border-line bg-surface-3 text-ink-faint">Deactivated</Badge>
              )}
              {person.departments.map((d) => (
                <span key={d} className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-ink-muted">
                  {d}
                </span>
              ))}
              <span className="text-[11px] text-ink-faint">{person.email}</span>
            </div>
          </div>
        </div>
        {anyHandable ? (
          <Button
            variant="primary"
            disabled={pickedTasks.length === 0}
            onClick={() => setReassigning(true)}
          >
            Reassign {pickedTasks.length || ""} task{pickedTasks.length === 1 ? "" : "s"}
          </Button>
        ) : null}
      </header>

      {!person.active && openCount > 0 ? (
        <Card className="border-st-submitted/30 bg-st-submitted/10 px-4 py-3 text-[12px] leading-relaxed text-st-submitted">
          {person.fullName} is deactivated and still holds {openCount} open task
          {openCount === 1 ? "" : "s"}.{" "}
          {anyHandable
            ? "Open Tasks or Individual tasks, tick the ones to hand on and press Reassign - each goes to someone active in that task's department."
            : "Only someone who may edit these tasks can reassign them."}
        </Card>
      ) : null}

      <Tabs<View>
        className="self-start"
        active={view}
        onChange={setView}
        tabs={[
          { id: "projects", label: "Projects", count: theirProjects.length },
          { id: "tasks", label: "Tasks", count: projectTasks.length },
          { id: "content", label: "Pieces of content", count: theirContent.length },
          { id: "individual", label: "Individual tasks", count: individualTasks.length },
        ]}
      />

      <Card className="flex flex-wrap items-end gap-2.5 p-3.5">
        <SearchInput
          className="min-w-52 flex-1"
          placeholder={
            view === "projects"
              ? "Search projects or companies…"
              : view === "content"
                ? "Search pieces, CB types or projects…"
                : "Search by task, project, department or tag…"
          }
          value={query}
          active={!!query.trim()}
          onChange={(e) => setQuery(e.target.value)}
        />
        {view === "projects" ? (
          <Select
            className="w-auto min-w-36"
            value={projectStatus}
            active={projectStatus !== "all"}
            onChange={(e) => setProjectStatus(e.target.value)}
            aria-label="Project status"
          >
            <option value="all">All statuses</option>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        ) : null}
        {taskView ? (
          <Select
            className="w-auto min-w-36"
            value={taskStatus}
            active={taskStatus !== "all"}
            onChange={(e) => setTaskStatus(e.target.value as TaskStatusFilter)}
            aria-label="Task status"
          >
            <option value="all">All tasks</option>
            <option value="open">Open</option>
            <option value="approved">Approved</option>
          </Select>
        ) : null}
        {view === "content" ? (
          <>
            <Select
              className="w-auto min-w-44"
              value={contentRole}
              active={contentRole !== "all"}
              onChange={(e) => setContentRole(e.target.value as ContentRole)}
              aria-label="Their part"
            >
              <option value="all">Written or allotted</option>
              <option value="written">Written by {person.fullName.split(" ")[0]}</option>
              <option value="allotted">Allotted to {person.fullName.split(" ")[0]}</option>
            </Select>
            <Select
              className="w-auto min-w-36"
              value={contentStage}
              active={contentStage !== "all"}
              onChange={(e) => setContentStage(e.target.value)}
              aria-label="Status"
            >
              <option value="all">Any status</option>
              <option value="none">Not set</option>
              {CONTENT_STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <PipelineSwitch on={showPipeline} onChange={setShowPipeline} />
          </>
        ) : null}
        {taskView && handable.length ? (
          <Button
            onClick={() =>
              toggle(
                handable.map((t) => t.id),
                !handable.every((t) => picked.includes(t.id)),
              )
            }
          >
            {handable.every((t) => picked.includes(t.id)) ? "Clear selection" : "Select all open"}
          </Button>
        ) : null}
        {dirty ? (
          <button
            onClick={() => {
              setQuery("");
              setProjectStatus("all");
              setTaskStatus("all");
              setContentRole("all");
              setContentStage("all");
            }}
            className="inline-flex h-9.5 items-center gap-1.5 rounded-[10px] border border-line bg-surface-2 px-3 text-[12px] text-ink-muted hover:text-ink"
          >
            <IconFilter size={13} /> Clear
          </button>
        ) : null}
      </Card>

      {view === "projects" ? (
        shownProjects.length === 0 ? (
          <Empty
            icon={<IconProjects size={30} />}
            title={theirProjects.length ? "No projects match these filters" : `${person.fullName} isn't on any project`}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {shownProjects.map((p) => {
              const mine = projectTasks.filter((t) => t.projectId === p.id);
              const open = mine.filter(isOpen).length;
              return (
                <ProjectCard
                  key={p.id}
                  project={p}
                  badges={
                    p.leaderId === id ? (
                      <Badge className="border-brand-bright/30 bg-brand/15 text-brand-ink">Leads it</Badge>
                    ) : null
                  }
                >
                  <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[11px] text-ink-muted">
                    <IconTasks size={12} className="shrink-0 text-ink-faint" />
                    {mine.length ? (
                      <>
                        {person.fullName.split(" ")[0]} holds{" "}
                        <span className="text-ink">
                          {mine.length} task{mine.length === 1 ? "" : "s"}
                        </span>
                        {open ? <span className="text-st-inprogress">· {open} open</span> : <span>· all approved</span>}
                      </>
                    ) : (
                      "No tasks of theirs here"
                    )}
                  </p>
                </ProjectCard>
              );
            })}
          </div>
        )
      ) : null}

      {view === "tasks" ? (
        taskGroups.length === 0 ? (
          <Empty
            icon={<IconTasks size={30} />}
            title={projectTasks.length ? "No tasks match these filters" : `${person.fullName} has no project tasks`}
          />
        ) : (
          taskGroups.map(({ project, pid, tasks }) => (
            <TaskGroup
              key={pid}
              title={project?.name ?? "A project you can't see"}
              href={project ? `/projects/${project.id}` : undefined}
              project={project}
              tasks={tasks}
              selecting={anyHandable}
              mayHandOn={mayHandOn}
              picked={picked}
              onToggle={toggle}
              onOpen={setOpenTaskId}
            />
          ))
        )
      ) : null}

      {view === "individual" ? (
        shownIndividual.length === 0 ? (
          <Empty
            icon={<IconTasks size={30} />}
            title={individualTasks.length ? "No tasks match these filters" : `${person.fullName} has no individual tasks`}
          />
        ) : (
          <TaskGroup
            title="Individual tasks"
            tasks={shownIndividual}
            selecting={anyHandable}
            mayHandOn={mayHandOn}
            picked={picked}
            onToggle={toggle}
            onOpen={setOpenTaskId}
          />
        )
      ) : null}

      {view === "content" ? (
        contentGroups.length === 0 ? (
          <Empty
            icon={<IconContent size={30} />}
            title={
              theirContent.length
                ? "No pieces match these filters"
                : `${person.fullName} hasn't written or been allotted any content`
            }
          />
        ) : (
          contentGroups.map(({ pid, project, entries }) => (
            <section key={pid} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-brand-bright" />
                  {project ? (
                    <Link
                      href={`/projects/${project.id}`}
                      className="truncate text-[14px] font-medium text-ink hover:text-brand-bright"
                    >
                      {project.name}
                    </Link>
                  ) : (
                    <span className="truncate text-[14px] font-medium text-ink">No project</span>
                  )}
                </div>
                <span className="text-[11px] text-ink-faint">
                  {entries.length} piece{entries.length === 1 ? "" : "s"}
                </span>
              </div>
              <Card className="overflow-hidden">
                <ContentTableHeader />
                {entries.map((e) => (
                  <ContentCard
                    key={e.id}
                    entry={e}
                    showProject={false}
                    showJourney={showPipeline}
                    onOpen={() => setOpenEntryId(e.id)}
                  />
                ))}
              </Card>
            </section>
          ))
        )
      ) : null}

      {openTaskId ? (
        <TaskDetailDrawer taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
      ) : null}

      {openEntry ? (
        <ContentDetailScreen entry={openEntry} onClose={() => setOpenEntryId(null)} />
      ) : null}

      {reassigning ? (
        <ReassignDialog
          from={person}
          tasks={pickedTasks}
          onClose={() => setReassigning(false)}
          onDone={() => {
            setReassigning(false);
            setPicked([]);
          }}
        />
      ) : null}
    </div>
  );
}

function Empty({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <Card>
      <EmptyState icon={icon} title={title} />
    </Card>
  );
}

function TaskGroup({
  title,
  href,
  project,
  tasks,
  selecting,
  mayHandOn,
  picked,
  onToggle,
  onOpen,
}: {
  title: string;
  href?: string;
  project?: Project | null;
  tasks: Task[];
  selecting: boolean;
  mayHandOn: (t: Task) => boolean;
  picked: string[];
  onToggle: (ids: string[], on: boolean) => void;
  onOpen: (id: string) => void;
}) {
  const { userById } = useStore();
  const leader = project ? userById(project.leaderId) : undefined;
  const handable = tasks.filter(mayHandOn).map((t) => t.id);
  const allPicked = handable.length > 0 && handable.every((id) => picked.includes(id));
  const open = tasks.filter(isOpen).length;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className={cx("h-2 w-2 shrink-0 rounded-full", project ? "bg-brand-bright" : "bg-ink-faint")} />
          {href ? (
            <Link href={href} className="truncate text-[14px] font-medium text-ink hover:text-brand-bright">
              {title}
            </Link>
          ) : (
            <span className="truncate text-[14px] font-medium text-ink">{title}</span>
          )}
          {leader ? <span className="text-[11px] text-ink-faint">Led by {leader.fullName}</span> : null}
        </div>
        <span className="text-[11px] text-ink-faint">
          {tasks.length} task{tasks.length === 1 ? "" : "s"} · {open} open
        </span>
      </div>
      <Card className="@container overflow-hidden">
        <div className="flex items-stretch">
          {selecting ? (
            <label className="hidden w-10 shrink-0 items-center justify-center border-b border-line bg-surface-2 @3xl:flex">
              <input
                type="checkbox"
                aria-label="Select this group's open tasks"
                disabled={handable.length === 0}
                checked={allPicked}
                onChange={(e) => onToggle(handable, e.target.checked)}
                className="h-4 w-4 accent-brand-bright"
              />
            </label>
          ) : null}
          <div className="min-w-0 flex-1">
            <TaskTableHeader />
          </div>
        </div>
        {tasks.map((t) => (
          <div key={t.id} className="flex items-stretch">
            {selecting ? (
              <label
                className={cx(
                  "flex w-10 shrink-0 items-center justify-center border-b border-line-soft",
                  picked.includes(t.id) && "bg-brand/8",
                )}
                title={mayHandOn(t) ? "Select to reassign" : "Approved work stays with them"}
              >
                <input
                  type="checkbox"
                  disabled={!mayHandOn(t)}
                  checked={picked.includes(t.id)}
                  onChange={(e) => onToggle([t.id], e.target.checked)}
                  className="h-4 w-4 accent-brand-bright disabled:opacity-30"
                />
              </label>
            ) : null}
            <div className={cx("min-w-0 flex-1", picked.includes(t.id) && "bg-brand/8")}>
              <TaskRow task={t} onOpen={onOpen} showProject={false} />
            </div>
          </div>
        ))}
      </Card>
    </section>
  );
}

/**
 * Hand a deactivated person's tasks on. One pick per department among the
 * chosen tasks, from the active people in it - a mixed selection is split by
 * department rather than sent to someone outside it.
 */
function ReassignDialog({
  from,
  tasks,
  onClose,
  onDone,
}: {
  from: User;
  tasks: Task[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { db, updateTask, showToast } = useStore();
  const departments = useMemo(
    () => [...new Set(tasks.map((t) => t.department))].sort(),
    [tasks],
  );
  const [to, setTo] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);

  const openLoad = (userId: string) =>
    db.tasks.filter((t) => t.assigneeId === userId && isOpen(t)).length;

  const optionsFor = (department: string) =>
    db.users
      .filter((u) => u.active && u.id !== from.id && u.departments.includes(department))
      .map((u) => ({
        value: u.id,
        label: u.fullName,
        hint: `${openLoad(u.id)} open task${openLoad(u.id) === 1 ? "" : "s"}`,
        avatarName: u.fullName,
      }));

  const missing = departments.filter((d) => !to[d]);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Reassign ${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
      subtitle={`From ${from.fullName}, to someone active in the same department.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              setTouched(true);
              if (missing.length) return;
              for (const t of tasks) updateTask(t.id, { assigneeId: to[t.department] });
              showToast(
                `${tasks.length} task${tasks.length === 1 ? "" : "s"} reassigned.`,
                "success",
              );
              onDone();
            }}
          >
            Reassign
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {departments.map((d) => {
          const options = optionsFor(d);
          const count = tasks.filter((t) => t.department === d).length;
          return (
            <Field
              key={d}
              label={`${d} · ${count} task${count === 1 ? "" : "s"}`}
              required
              hint={options.length === 0 ? "Nobody active is in this department." : undefined}
              error={touched && !to[d] && options.length ? "Pick who takes these." : undefined}
            >
              <SearchSelect
                options={options}
                value={to[d] ?? ""}
                onChange={(v) => setTo((m) => ({ ...m, [d]: v }))}
                placeholder={options.length ? "Select a person" : "Nobody available"}
                disabled={options.length === 0}
              />
            </Field>
          );
        })}
        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-line-soft bg-surface-2 p-2 text-[12px]">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3">
              <span className="truncate text-ink">{t.title}</span>
              <span className="shrink-0 text-[10px] text-ink-faint">
                {t.status} · due {formatDate(t.dueDate)}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] leading-relaxed text-ink-faint">
          Each task starts again at Not Started for its new owner, keeping its dates, history
          and time already logged. Content allotted on these tasks moves with them.
        </p>
      </div>
    </Modal>
  );
}
