"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ProjectFormModal } from "@/components/project/project-form";
import { RecurrenceBadge } from "@/components/task/task-bits";
import {
  IconFilter,
  IconPlus,
  IconProjects,
  IconWallet,
} from "@/components/ui/icons";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  ProgressBar,
  SearchInput,
  Select,
  Tabs,
  cx,
} from "@/components/ui/primitives";
import { formatINR, projectStats } from "@/lib/analytics";
import { formatShortDate } from "@/lib/calendar";
import {
  PRIORITIES,
  PRIORITY_STYLE,
  PROJECT_STATUSES,
  PROJECT_STATUS_STYLE,
} from "@/lib/master-data";
import {
  canCreateProjects,
  isTeamLeader,
  myProjects,
  visibleProjects,
} from "@/lib/permissions";
import { useStore } from "@/lib/store";
import { formatDuration } from "@/lib/time";

interface Filters {
  query: string;
  status: string;
  priority: string;
  client: string;
  service: string;
  leaderId: string;
  memberId: string;
  from: string;
  to: string;
}

const EMPTY: Filters = {
  query: "",
  status: "all",
  priority: "all",
  client: "all",
  service: "all",
  leaderId: "all",
  memberId: "all",
  from: "",
  to: "",
};

export default function ProjectsPage() {
  const { db, currentUser, userById } = useStore();
  const user = currentUser!;
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [createOpen, setCreateOpen] = useState(false);
  const [scope, setScope] = useState<"all" | "mine">("all");

  const everything = useMemo(
    () => visibleProjects(user, db.projects, db.tasks),
    [user, db.projects, db.tasks],
  );

  /**
   * Projects this person is personally on. A Team Leader sees their whole
   * department's work, so the two differ and the tabs below appear; for anyone
   * whose scope is already just their own projects they are identical and the
   * tabs stay hidden.
   */
  const mine = useMemo(
    () => myProjects(user, db.projects, db.tasks),
    [user, db.projects, db.tasks],
  );
  // A Team Leader always gets the choice, even when their department's
  // projects happen to be exactly the ones they hold a task in today -
  // otherwise the tabs would appear out of nowhere the first time they differ.
  const splitScope = isTeamLeader(user) || mine.length !== everything.length;
  const scoped = splitScope && scope === "mine" ? mine : everything;

  const clients = useMemo(
    () => Array.from(new Set(scoped.map((p) => p.clientName))).sort(),
    [scoped],
  );

  const filtered = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    return scoped.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q) && !p.clientName.toLowerCase().includes(q))
        return false;
      if (filters.status !== "all" && p.status !== filters.status) return false;
      if (filters.priority !== "all" && p.priority !== filters.priority) return false;
      if (filters.client !== "all" && p.clientName !== filters.client) return false;
      if (filters.service !== "all" && !p.services.includes(filters.service)) return false;
      if (filters.leaderId !== "all" && p.leaderId !== filters.leaderId) return false;
      if (filters.memberId !== "all" && !p.memberIds.includes(filters.memberId)) return false;
      // Date range = projects overlapping the window.
      if (filters.from && p.deadline < filters.from) return false;
      if (filters.to && p.startDate > filters.to) return false;
      return true;
    });
  }, [scoped, filters]);

  const dirty = JSON.stringify(filters) !== JSON.stringify(EMPTY);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    setFilters((f) => ({ ...f, [k]: v }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Projects"
        icon={<IconProjects size={20} />}
        subtitle={
          isTeamLeader(user)
            ? `${filtered.length} of ${scoped.length} project${scoped.length === 1 ? "" : "s"} across ${user.departments.join(", ")}`
            : `${filtered.length} of ${scoped.length} project${scoped.length === 1 ? "" : "s"} in your scope`
        }
        actions={
          canCreateProjects(user) ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <IconPlus size={15} /> New project
            </Button>
          ) : null
        }
      />

      {splitScope ? (
        <Tabs<"all" | "mine">
          active={scope}
          onChange={setScope}
          tabs={[
            { id: "all", label: "All projects", count: everything.length },
            { id: "mine", label: "My projects", count: mine.length },
          ]}
        />
      ) : null}

      <Card className="flex flex-wrap items-end gap-2.5 p-3.5">
        <SearchInput
          className="min-w-52 flex-1"
          placeholder="Search projects or clients…"
          value={filters.query}
          onChange={(e) => set("query", e.target.value)}
        />
        <Select
          className="w-auto min-w-32"
          value={filters.status}
          onChange={(e) => set("status", e.target.value)}
          aria-label="Status"
        >
          <option value="all">All statuses</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto min-w-32"
          value={filters.priority}
          onChange={(e) => set("priority", e.target.value)}
          aria-label="Priority"
        >
          <option value="all">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto min-w-36"
          value={filters.client}
          onChange={(e) => set("client", e.target.value)}
          aria-label="Client"
        >
          <option value="all">All clients</option>
          {clients.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto min-w-40"
          value={filters.service}
          onChange={(e) => set("service", e.target.value)}
          aria-label="Service"
        >
          <option value="all">All services</option>
          {db.services.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto min-w-36"
          value={filters.leaderId}
          onChange={(e) => set("leaderId", e.target.value)}
          aria-label="Project leader"
        >
          <option value="all">Any leader</option>
          {db.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto min-w-36"
          value={filters.memberId}
          onChange={(e) => set("memberId", e.target.value)}
          aria-label="Team member"
        >
          <option value="all">Any member</option>
          {db.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName}
            </option>
          ))}
        </Select>
        <div className="w-36">
          <DatePicker
            value={filters.from}
            onChange={(v) => set("from", v)}
            config={db.calendar}
            ignoreWorkingRules
            allowPast
            placeholder="From"
            clearable
          />
        </div>
        <div className="w-36">
          <DatePicker
            value={filters.to}
            onChange={(v) => set("to", v)}
            config={db.calendar}
            ignoreWorkingRules
            allowPast
            placeholder="To"
            clearable
          />
        </div>
        {dirty ? (
          <button
            onClick={() => setFilters(EMPTY)}
            className="inline-flex h-9.5 items-center gap-1.5 rounded-[10px] border border-line bg-surface-2 px-3 text-[12px] text-ink-muted hover:text-ink"
          >
            <IconFilter size={13} /> Clear
          </button>
        ) : null}
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconProjects size={30} />}
            title={scoped.length === 0 ? "No projects yet" : "No projects match these filters"}
            body={
              scoped.length === 0
                ? "Projects you lead, are a member of, or hold a task in will appear here."
                : "Try widening the filters."
            }
            action={
              canCreateProjects(user) && scoped.length === 0 ? (
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  <IconPlus size={15} /> Create the first project
                </Button>
              ) : null
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => {
            const stats = projectStats(p, db.tasks, db.expenses);
            const leader = userById(p.leaderId);
            const members = p.memberIds
              .map((id) => userById(id))
              .filter(Boolean)
              .slice(0, 4);
            return (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <Card className="group h-full p-4 transition-colors hover:border-brand-bright/40">
                  <div className="flex items-start gap-2.5">
                    <span
                      className="mt-1 h-3 w-3 shrink-0 rounded-[4px]"
                      style={{ background: p.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-[14px] font-semibold text-ink group-hover:text-ink-strong">
                        {p.name}
                      </h3>
                      <p className="truncate text-[11px] text-ink-faint">{p.clientName}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge className={PROJECT_STATUS_STYLE[p.status]}>{p.status}</Badge>
                    <Badge className={PRIORITY_STYLE[p.priority]}>{p.priority}</Badge>
                    <RecurrenceBadge item={p} />
                    {stats.overdueTasks > 0 ? (
                      <Badge className="border-st-rejected/40 bg-st-rejected/20 text-st-rejected">
                        {stats.overdueTasks} overdue
                      </Badge>
                    ) : null}
                  </div>

                  <div className="mt-4">
                    <div className="mb-1.5 flex items-baseline justify-between text-[11px]">
                      <span className="text-ink-muted">
                        {stats.approvedTasks}/{stats.totalTasks} tasks approved
                      </span>
                      <span className="font-mono text-ink">{stats.progress}%</span>
                    </div>
                    <ProgressBar
                      value={stats.progress}
                      barClassName={cx(
                        stats.progress === 100 ? "bg-st-approved" : "bg-brand-bright",
                      )}
                    />
                  </div>

                  <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line-soft pt-3 text-[11px]">
                    <div>
                      <dt className="text-ink-faint">Time</dt>
                      <dd className="mt-0.5 font-mono text-ink">
                        {formatDuration(stats.totalTimeMs)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-faint">Deadline</dt>
                      <dd className="mt-0.5 text-ink">{formatShortDate(p.deadline)}</dd>
                    </div>
                    <div>
                      <dt className="flex items-center gap-1 text-ink-faint">
                        <IconWallet size={11} /> Spend
                      </dt>
                      <dd className="mt-0.5 text-ink">{formatINR(stats.approvedExpenses)}</dd>
                    </div>
                  </dl>

                  <div className="mt-3 flex items-center gap-2 border-t border-line-soft pt-3">
                    {leader ? (
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Avatar name={leader.fullName} size={22} />
                        <span className="truncate text-[11px] text-ink-muted">
                          {leader.fullName}
                        </span>
                      </span>
                    ) : null}
                    <span className="ml-auto flex -space-x-1.5">
                      {members.map((m) => (
                        <Avatar
                          key={m!.id}
                          name={m!.fullName}
                          size={22}
                          className="ring-2 ring-surface"
                        />
                      ))}
                      {p.memberIds.length > 4 ? (
                        <span className="inline-flex h-[22px] items-center rounded-full bg-surface-3 px-1.5 text-[10px] text-ink-muted ring-2 ring-surface">
                          +{p.memberIds.length - 4}
                        </span>
                      ) : null}
                    </span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {createOpen ? (
        <ProjectFormModal open onClose={() => setCreateOpen(false)} />
      ) : null}
    </div>
  );
}
