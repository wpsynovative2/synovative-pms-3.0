"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ProjectFormModal } from "@/components/project/project-form";
import { IconCube, IconPlus } from "@/components/ui/icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  ProgressBar,
  SearchInput,
} from "@/components/ui/primitives";
import { formatDate } from "@/lib/calendar";
import { canCreateThreeDProjects, canViewThreeD, visibleProjects } from "@/lib/permissions";
import { useStore } from "@/lib/store";

/*
 * The 3D module (0022, Archi-3d.md): the 3D projects you can see. It is for the 3D
 * Artists department, global managers and Business Development. A 3D project is an
 * ordinary project, so it also shows on the Projects page for whoever can see it.
 */
export default function ThreeDProjectsPage() {
  const { db, currentUser } = useStore();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const projects = useMemo(() => {
    if (!currentUser) return [];
    const q = query.trim().toLowerCase();
    return visibleProjects(currentUser, db.projects, db.tasks).filter(
      (p) => p.is3d && (!q || p.name.toLowerCase().includes(q)),
    );
  }, [currentUser, db.projects, db.tasks, query]);

  if (!canViewThreeD(currentUser!)) {
    return (
      <Card>
        <EmptyState
          icon={<IconCube size={30} />}
          title="You don't have access to 3D Projects"
          body="This module is for the 3D Artists department, Business Development and managers."
        />
      </Card>
    );
  }

  const mayCreate = canCreateThreeDProjects(currentUser!);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="3D Projects"
        icon={<IconCube size={20} />}
        subtitle={`${projects.length} project${projects.length === 1 ? "" : "s"} in your scope`}
        actions={
          mayCreate ? (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <IconPlus size={15} /> New 3D project
            </Button>
          ) : null
        }
      />

      <SearchInput
        placeholder="Search 3D projects…"
        value={query}
        active={!!query.trim()}
        onChange={(e) => setQuery(e.target.value)}
      />

      {projects.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconCube size={30} />}
            title={query.trim() ? "No 3D projects match that search" : "No 3D projects yet"}
            body={
              query.trim()
                ? undefined
                : mayCreate
                  ? "Create one, then lay out its work in numbered groups of tasks."
                  : "A 3D project appears here once you have a task in it."
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          {projects.map((p) => {
            const tasks = db.tasks.filter((t) => t.projectId === p.id && t.kind === "standard");
            const approved = tasks.filter((t) => t.status === "Approved").length;
            const groups = db.taskGroups.filter((g) => g.projectId === p.id).length;
            return (
              <Link key={p.id} href={`/3d-projects/${p.id}`}>
                <Card className="flex flex-wrap items-center gap-x-5 gap-y-2 p-4 transition-colors hover:border-brand-bright/40">
                  <span className="flex min-w-52 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{p.name}</span>
                      {p.stepByStep ? <Badge>SBS</Badge> : null}
                    </span>
                    <span className="text-[11px] text-ink-faint">
                      {p.status} · due {formatDate(p.deadline)}
                    </span>
                  </span>
                  <span className="text-[12px] text-ink-muted">
                    {groups} group{groups === 1 ? "" : "s"}
                  </span>
                  <span className="flex w-44 items-center gap-2.5">
                    <ProgressBar value={tasks.length ? (approved / tasks.length) * 100 : 0} />
                    <span className="shrink-0 text-[12px] text-ink-muted">
                      {approved}/{tasks.length}
                    </span>
                  </span>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {creating ? <ProjectFormModal open threeD onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
