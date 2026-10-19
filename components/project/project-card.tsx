"use client";

import Link from "next/link";
import { CrmChain } from "@/components/crm/crm-chain";
import { RecurrenceBadge } from "@/components/task/task-bits";
import { IconWallet } from "@/components/ui/icons";
import { Avatar, Badge, Card, ProgressBar, cx } from "@/components/ui/primitives";
import { formatINR, projectStats } from "@/lib/analytics";
import { formatShortDate } from "@/lib/calendar";
import { PRIORITY_STYLE, PROJECT_STATUS_STYLE } from "@/lib/master-data";
import { useStore } from "@/lib/store";
import { formatDuration } from "@/lib/time";
import type { Project } from "@/lib/types";

/**
 * A project as a card in a grid: its CRM chain, status, progress, time,
 * deadline and spend, then who created it and who is on it. Links to the
 * project. `children` slots in under the progress bar for a page's own line.
 */
export function ProjectCard({
  project: p,
  badges,
  children,
}: {
  project: Project;
  /** Extra badges after status and priority. */
  badges?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const { db, userById } = useStore();
  const stats = projectStats(p, db.tasks, db.expenses);
  const creator = userById(p.createdBy);
  // The team is whoever is listed on it plus whoever holds a task there - many
  // projects never fill in the member list.
  const teamIds = Array.from(
    new Set([
      ...p.memberIds,
      ...db.tasks.filter((t) => t.projectId === p.id && t.assigneeId).map((t) => t.assigneeId!),
    ]),
  ).filter((id) => id !== p.createdBy);
  const team = teamIds.map((id) => userById(id)).filter(Boolean);
  const members = team.slice(0, 4);

  return (
    <Link href={`/projects/${p.id}`}>
      <Card className="group h-full p-4 transition-colors hover:border-brand-bright/40">
        <div className="flex items-start gap-2.5">
          <span className="mt-1 h-3 w-3 shrink-0 rounded-[4px]" style={{ background: p.color }} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[14px] font-semibold text-ink group-hover:text-ink-strong">
              {p.name}
            </h3>
            <CrmChain
              inline
              className="mt-1"
              companyId={p.companyId}
              clientId={p.clientId}
              clientIds={p.clientIds}
              propertyId={p.propertyId}
              fallbackCompany={p.clientName}
            />
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
          {badges}
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
            barClassName={cx(stats.progress === 100 ? "bg-st-approved" : "bg-brand-bright")}
          />
        </div>

        {children}

        <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line-soft pt-3 text-[11px]">
          <div>
            <dt className="text-ink-faint">Time</dt>
            <dd className="mt-0.5 font-mono text-ink">{formatDuration(stats.totalTimeMs)}</dd>
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
          {creator ? (
            <span className="flex min-w-0 items-center gap-1.5" title="Created by">
              <Avatar name={creator.fullName} size={22} />
              <span className="truncate text-[11px] text-ink-faint">
                Created by <span className="text-ink-muted">{creator.fullName}</span>
              </span>
            </span>
          ) : null}
          <span className="ml-auto flex -space-x-1.5" title={team.map((m) => m!.fullName).join(", ")}>
            {members.map((m) => (
              <Avatar key={m!.id} name={m!.fullName} size={22} className="ring-2 ring-surface" />
            ))}
            {team.length > 4 ? (
              <span className="inline-flex h-[22px] items-center rounded-full bg-surface-3 px-1.5 text-[10px] text-ink-muted ring-2 ring-surface">
                +{team.length - 4}
              </span>
            ) : null}
          </span>
        </div>
      </Card>
    </Link>
  );
}
