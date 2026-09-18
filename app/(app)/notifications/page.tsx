"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  IconBell,
  IconCheck,
  IconClock,
  IconSend,
  IconSparkle,
  IconTasks,
  IconWallet,
  IconWarning,
} from "@/components/ui/icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Select,
  StatTile,
  cx,
} from "@/components/ui/primitives";
import { formatDateTime, relativeTime } from "@/lib/calendar";
import { useStore } from "@/lib/store";
import type { NotificationType } from "@/lib/types";

const TYPE_LABEL: Record<NotificationType, string> = {
  task_assigned: "Task assigned",
  task_submitted: "Task submitted",
  review_decision: "Review decision",
  remark_added: "Remark added",
  expense_added: "Expense added",
  expense_reviewed: "Expense reviewed",
  due_soon: "Due soon",
  overdue: "Overdue",
  timer_autostop: "Timer auto-stopped",
  content_allotted: "Content allotted",
};

const TYPE_ICON: Record<NotificationType, React.ReactNode> = {
  task_assigned: <IconTasks size={15} />,
  task_submitted: <IconSend size={15} />,
  review_decision: <IconCheck size={15} />,
  remark_added: <IconBell size={15} />,
  expense_added: <IconWallet size={15} />,
  expense_reviewed: <IconWallet size={15} />,
  due_soon: <IconClock size={15} />,
  overdue: <IconWarning size={15} />,
  timer_autostop: <IconClock size={15} />,
  content_allotted: <IconSparkle size={15} />,
};

const TYPE_TONE: Record<NotificationType, string> = {
  task_assigned: "bg-brand/15 text-brand-ink",
  task_submitted: "bg-st-submitted/15 text-st-submitted",
  review_decision: "bg-st-approved/15 text-st-approved",
  remark_added: "bg-st-inprogress/15 text-st-inprogress",
  expense_added: "bg-st-submitted/15 text-st-submitted",
  expense_reviewed: "bg-st-approved/15 text-st-approved",
  due_soon: "bg-st-submitted/15 text-st-submitted",
  overdue: "bg-st-rejected/15 text-st-rejected",
  timer_autostop: "bg-st-changes/15 text-st-changes",
  content_allotted: "bg-brand/15 text-brand-ink",
};

/** §17 — in-app only: list, filter, mark as read. */
export default function NotificationsPage() {
  const { db, currentUser, markNotificationRead, markAllNotificationsRead } = useStore();
  const user = currentUser!;
  const router = useRouter();

  const [readFilter, setReadFilter] = useState<"all" | "unread" | "read">("all");
  const [typeFilter, setTypeFilter] = useState<NotificationType | "all">("all");

  const mine = useMemo(
    () =>
      db.notifications
        .filter((n) => n.userId === user.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [db.notifications, user.id],
  );

  const filtered = mine.filter((n) => {
    if (readFilter === "unread" && n.read) return false;
    if (readFilter === "read" && !n.read) return false;
    if (typeFilter !== "all" && n.type !== typeFilter) return false;
    return true;
  });

  const unread = mine.filter((n) => !n.read).length;
  const typesPresent = Array.from(new Set(mine.map((n) => n.type)));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Notifications"
        icon={<IconBell size={20} />}
        subtitle="In-app only — everything that needs your attention"
        actions={
          unread > 0 ? (
            <Button onClick={markAllNotificationsRead}>
              <IconCheck size={14} /> Mark all read
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Total" value={mine.length} tone="neutral" icon={<IconBell size={17} />} />
        <StatTile
          label="Unread"
          value={unread}
          tone={unread ? "brand" : "green"}
          hint={unread ? "Waiting on you" : "You're all caught up"}
        />
        <StatTile label="Kinds" value={typesPresent.length} tone="blue" />
      </div>

      <Card className="flex flex-wrap items-end gap-2.5 p-3.5">
        <Select
          className="w-auto min-w-32"
          value={readFilter}
          onChange={(e) => setReadFilter(e.target.value as typeof readFilter)}
          aria-label="Read state"
        >
          <option value="all">All</option>
          <option value="unread">Unread</option>
          <option value="read">Read</option>
        </Select>
        <Select
          className="w-auto min-w-44"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
          aria-label="Type"
        >
          <option value="all">All types</option>
          {typesPresent.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconBell size={30} />}
            title={mine.length === 0 ? "No notifications yet" : "Nothing matches these filters"}
            body={
              mine.length === 0
                ? "Assignments, submissions, reviews and expense decisions land here."
                : undefined
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {filtered.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                markNotificationRead(n.id);
                router.push(n.href);
              }}
              className={cx(
                "flex w-full gap-3 border-b border-line-soft px-4 py-3.5 text-left transition-colors last:border-0 hover:bg-surface-2",
                !n.read && "bg-brand/6",
              )}
            >
              <span
                className={cx(
                  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]",
                  TYPE_TONE[n.type],
                )}
              >
                {TYPE_ICON[n.type]}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-ink">{n.title}</span>
                  <Badge>{TYPE_LABEL[n.type]}</Badge>
                  {!n.read ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-brand-bright" />
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-muted">
                  {n.body}
                </span>
                <span className="mt-1 block text-[10px] text-ink-faint">
                  {relativeTime(n.createdAt)} · {formatDateTime(n.createdAt)}
                </span>
              </span>
            </button>
          ))}
        </Card>
      )}

      <Card className="px-4 py-3 text-[11px] leading-relaxed text-ink-faint">
        Notifications are in-app only. In production, only the signed-in user&apos;s own
        notification stream uses a Supabase Realtime subscription — everything else is
        fetched on demand to stay inside the free tier.
      </Card>
    </div>
  );
}
