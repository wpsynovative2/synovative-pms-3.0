"use client";

import { useCallback, useMemo, useState } from "react";
import { ProjectCard } from "@/components/project/project-card";
import { ProjectFormModal } from "@/components/project/project-form";
import {
  IconFilter,
  IconPlus,
  IconProjects,
} from "@/components/ui/icons";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  SearchInput,
  Select,
  Tabs,
} from "@/components/ui/primitives";
import type { Project } from "@/lib/types";
import {
  PRIORITIES,
  PROJECT_STATUSES,
} from "@/lib/master-data";
import {
  canCreateProjects,
  isGlobalManager,
  isProjectLeader,
  isTeamLeader,
  myProjects,
  visibleProjects,
} from "@/lib/permissions";
import { useStore } from "@/lib/store";

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

type Scope = "all" | "mine" | "created";

export default function ProjectsPage() {
  const { db, currentUser, companyById, propertyById, clientById } = useStore();
  const user = currentUser!;
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [createOpen, setCreateOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("all");

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
  /*
   * The people who raise and run projects - global managers and Project
   * Leaders - also get the projects they created, which is how they find the
   * ones they set up for someone else to lead.
   */
  const mayFilterCreated =
    isGlobalManager(user) || db.projects.some((p) => isProjectLeader(user, p));
  const created = useMemo(
    () => everything.filter((p) => p.createdBy === user.id),
    [everything, user.id],
  );
  const splitScope = isTeamLeader(user) || mine.length !== everything.length;
  const showTabs = splitScope || mayFilterCreated;
  const scoped =
    scope === "created" && mayFilterCreated
      ? created
      : splitScope && scope === "mine"
        ? mine
        : everything;

  const clients = useMemo(
    () => Array.from(new Set(scoped.map((p) => p.clientName))).sort(),
    [scoped],
  );

  // Tags live on tasks; a project is found by any of its tasks' tags.
  const tagsByProject = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const t of db.tasks) {
      if (!t.projectId || t.tags.length === 0) continue;
      map.set(t.projectId, [...(map.get(t.projectId) ?? []), ...t.tags]);
    }
    return map;
  }, [db.tasks]);

  /** Everything a project can be found by: its name, its CRM chain and its tasks' tags. */
  const searchText = useCallback(
    (p: Project) =>
      [
        p.name,
        p.clientName,
        companyById(p.companyId)?.name,
        propertyById(p.propertyId)?.name,
        ...p.clientIds.map((id) => clientById(id)?.fullName),
        ...(tagsByProject.get(p.id) ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    [companyById, propertyById, clientById, tagsByProject],
  );

  const filtered = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    return scoped.filter((p) => {
      if (q && !searchText(p).includes(q)) return false;
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
  }, [scoped, filters, searchText]);

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

      {showTabs ? (
        <Tabs<Scope>
          active={scope}
          onChange={setScope}
          tabs={[
            { id: "all", label: "All projects", count: everything.length },
            ...(splitScope ? [{ id: "mine" as const, label: "My projects", count: mine.length }] : []),
            ...(mayFilterCreated
              ? [{ id: "created" as const, label: "Created by me", count: created.length }]
              : []),
          ]}
        />
      ) : null}

      <Card className="flex flex-wrap items-end gap-2.5 p-3.5">
        <SearchInput
          className="min-w-52 flex-1"
          placeholder="Search projects, companies, properties, clients or tags…"
          value={filters.query}
          active={!!filters.query.trim()}
          onChange={(e) => set("query", e.target.value)}
        />
        <Select
          className="w-auto min-w-32"
          value={filters.status}
          active={filters.status !== "all"}
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
          active={filters.priority !== "all"}
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
          active={filters.client !== "all"}
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
          active={filters.service !== "all"}
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
          active={filters.leaderId !== "all"}
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
          active={filters.memberId !== "all"}
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
            active={!!filters.from}
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
            active={!!filters.to}
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
          {filtered.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}

      {createOpen ? (
        <ProjectFormModal open onClose={() => setCreateOpen(false)} />
      ) : null}
    </div>
  );
}

