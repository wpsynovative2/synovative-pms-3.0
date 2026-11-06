"use client";

import { useEffect, useMemo, useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconComment,
  IconEye,
  IconPause,
  IconPlay,
  IconRepeat,
  IconSend,
  IconTasks,
  IconUser,
} from "@/components/ui/icons";
import { Button, Card, EmptyState, Select, StatTile, cx } from "@/components/ui/primitives";
import { RichText } from "@/components/ui/rich-text";
import {
  ACTIVITY_FILTERS,
  buildDayActivity,
  matchesActivityFilter,
  type ActivityEvent,
  type ActivityFilter,
  type ActivityKind,
} from "@/lib/activity";
import { addDays, formatDate, fromISODate, todayISO } from "@/lib/calendar";
import { useStore } from "@/lib/store";
import { formatDuration } from "@/lib/time";
import type { Task, TaskOpen, User } from "@/lib/types";

const KIND_STYLE: Record<ActivityKind, { icon: React.ReactNode; tone: string }> = {
  open: { icon: <IconEye size={13} />, tone: "bg-surface-3 text-ink-muted" },
  start: { icon: <IconPlay size={13} />, tone: "bg-st-inprogress/15 text-st-inprogress" },
  switch: { icon: <IconRepeat size={13} />, tone: "bg-st-waiting/15 text-st-waiting" },
  stop: { icon: <IconPause size={13} />, tone: "bg-st-submitted/15 text-st-submitted" },
  submit: { icon: <IconSend size={13} />, tone: "bg-brand/15 text-brand-ink" },
  review: { icon: <IconCheck size={13} />, tone: "bg-st-approved/15 text-st-approved" },
  remark: { icon: <IconComment size={13} />, tone: "bg-surface-3 text-ink-muted" },
  assigned: { icon: <IconUser size={13} />, tone: "bg-st-changes/15 text-st-changes" },
  handed: { icon: <IconUser size={13} />, tone: "bg-st-changes/15 text-st-changes" },
};

const clock = (at: string) =>
  new Date(at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });

type Loaded = { key: string; rows: TaskOpen[]; error?: string };

/**
 * What someone did on one day: the tasks they opened, when their timer started,
 * switched and stopped, and what they submitted, reviewed, remarked on or were
 * handed. Opens are read from the database when the day is picked (0028); the
 * rest is already in the store with each task, so it covers the tasks the viewer
 * can see.
 */
export function UserActivity({
  person,
  onOpenTask,
}: {
  person: User;
  onOpenTask: (taskId: string) => void;
}) {
  const { db, taskById, projectById, userById, taskOpensFor } = useStore();
  const today = todayISO();
  const [day, setDay] = useState(today);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [reload, setReload] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const dayStart = useMemo(() => fromISODate(day), [day]);
  const dayEnd = useMemo(() => fromISODate(addDays(day, 1)), [day]);
  const key = `${person.id}|${day}|${reload}`;

  useEffect(() => {
    let live = true;
    taskOpensFor(person.id, dayStart.toISOString(), dayEnd.toISOString()).then(
      (rows) => {
        if (live) setLoaded({ key, rows });
      },
      (err: unknown) => {
        if (live)
          setLoaded({
            key,
            rows: [],
            error: err instanceof Error ? err.message : "Couldn't load the tasks they opened.",
          });
      },
    );
    return () => {
      live = false;
    };
  }, [key, person.id, dayStart, dayEnd, taskOpensFor]);

  const loading = loaded?.key !== key;
  const opens = useMemo(() => (loaded && !loading ? loaded.rows : []), [loaded, loading]);

  const activity = useMemo(
    () => buildDayActivity(person.id, db.tasks, opens, dayStart, dayEnd),
    [person.id, db.tasks, opens, dayStart, dayEnd],
  );
  const shown = activity.events.filter((e) => matchesActivityFilter(e.kind, filter));
  const openedCount = new Set(opens.map((o) => o.taskId)).size;
  const switchCount = activity.events.filter((e) => e.kind === "switch").length;
  const running = day === today && activity.runningTaskId ? taskById(activity.runningTaskId) : undefined;
  const first = person.fullName.split(" ")[0];

  const taskName = (id: string | undefined) => {
    const t = id ? taskById(id) : undefined;
    return t ? `${t.code ? `${t.code} ` : ""}${t.title}` : "a task you can't see";
  };
  const projectName = (t: Task | undefined) =>
    t?.projectId ? (projectById(t.projectId)?.name ?? null) : t ? "Individual task" : null;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center gap-2.5 p-3.5">
        <Button size="sm" aria-label="Previous day" onClick={() => setDay((d) => addDays(d, -1))}>
          <IconChevronLeft size={14} />
        </Button>
        <div className="w-44">
          <DatePicker
            value={day}
            onChange={(v) => setDay(v || today)}
            config={db.calendar}
            ignoreWorkingRules
            allowPast
            max={today}
          />
        </div>
        <Button
          size="sm"
          aria-label="Next day"
          disabled={day >= today}
          onClick={() => setDay((d) => addDays(d, 1))}
        >
          <IconChevronRight size={14} />
        </Button>
        {day !== today ? (
          <Button size="sm" onClick={() => setDay(today)}>
            Today
          </Button>
        ) : null}
        <Select
          className="ml-auto w-auto min-w-52"
          value={filter}
          active={filter !== "all"}
          onChange={(e) => setFilter(e.target.value as ActivityFilter)}
          aria-label="What to show"
        >
          {ACTIVITY_FILTERS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </Select>
        <Button size="sm" onClick={() => setReload((n) => n + 1)}>
          Refresh
        </Button>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          icon={<IconClock size={16} />}
          tone="blue"
          label="Time on the timer"
          value={formatDuration(activity.totalMs)}
          hint={running ? `Working now on ${taskName(running.id)}` : undefined}
        />
        <StatTile
          icon={<IconTasks size={16} />}
          tone="brand"
          label="Tasks worked on"
          value={activity.time.length}
        />
        <StatTile
          icon={<IconEye size={16} />}
          tone="neutral"
          label="Tasks opened"
          value={loading ? "…" : openedCount}
        />
        <StatTile
          icon={<IconRepeat size={16} />}
          tone="amber"
          label="Switches between tasks"
          value={switchCount}
        />
      </div>

      {loaded?.error && !loading ? (
        <Card className="border-st-submitted/30 bg-st-submitted/10 px-4 py-3 text-[12px] text-st-submitted">
          Couldn&apos;t read the tasks {first} opened, so they are left out below. If this is new,
          migration 0028 has probably not been run yet. ({loaded.error})
        </Card>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="overflow-hidden">
          <div className="flex items-baseline justify-between gap-2 border-b border-line-soft px-4 py-3">
            <h2 className="text-sm font-medium text-ink">
              {day === today ? "Today" : formatDate(day)}
            </h2>
            <span className="text-[11px] text-ink-faint">
              {shown.length} event{shown.length === 1 ? "" : "s"}
            </span>
          </div>
          {shown.length === 0 ? (
            <EmptyState
              icon={<IconClock size={30} />}
              title={
                loading
                  ? "Loading…"
                  : activity.events.length
                    ? "Nothing of that kind on this day"
                    : `No activity from ${first} on this day`
              }
            />
          ) : (
            <ol className="flex flex-col py-1.5">
              {shown.map((e) => (
                <EventRow
                  key={e.id}
                  event={e}
                  taskName={taskName}
                  projectName={(id) => projectName(id ? taskById(id) : undefined)}
                  userName={(id) => (id ? (userById(id)?.fullName ?? "someone") : "the system")}
                  onOpenTask={onOpenTask}
                />
              ))}
            </ol>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b border-line-soft px-4 py-3">
            <h2 className="text-sm font-medium text-ink">Time by task</h2>
          </div>
          {activity.time.length === 0 ? (
            <p className="px-4 py-4 text-[12px] text-ink-faint">No time logged on this day.</p>
          ) : (
            <ul className="flex flex-col py-1.5">
              {activity.time.map((row) => {
                const t = taskById(row.taskId);
                return (
                  <li key={row.taskId}>
                    <button
                      type="button"
                      onClick={() => onOpenTask(row.taskId)}
                      className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-surface-2"
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[13px] text-ink">{taskName(row.taskId)}</span>
                        <span className="truncate text-[11px] text-ink-faint">{projectName(t)}</span>
                      </span>
                      <span
                        className={cx(
                          "shrink-0 text-[12px] font-medium",
                          row.running ? "text-st-inprogress" : "text-ink-muted",
                        )}
                      >
                        {formatDuration(row.ms)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function EventRow({
  event: e,
  taskName,
  projectName,
  userName,
  onOpenTask,
}: {
  event: ActivityEvent;
  taskName: (id: string | undefined) => string;
  projectName: (id: string | undefined) => string | null;
  userName: (id: string | null | undefined) => string;
  onOpenTask: (taskId: string) => void;
}) {
  const style = KIND_STYLE[e.kind];
  const task = <span className="font-medium text-ink">{taskName(e.taskId)}</span>;

  const sentence = (() => {
    switch (e.kind) {
      case "open":
        return <>Opened {task}</>;
      case "start":
        return <>Started working on {task}</>;
      case "switch":
        return e.toTaskId ? (
          <>
            Switched from {task} to{" "}
            <span className="font-medium text-ink">{taskName(e.toTaskId)}</span>
          </>
        ) : (
          <>
            Switched away from {task}
            {e.note ? <span className="text-ink-faint"> · {e.note}</span> : null}
          </>
        );
      case "stop":
        return e.stopReason === "Auto-stopped" ? (
          <>Timer on {task} was stopped automatically at the end of the day</>
        ) : e.stopReason === "End of day" ? (
          <>Stopped {task}, done for the day</>
        ) : (
          <>
            Stopped the timer on {task}
            {e.note ? <span className="text-ink-faint"> · {e.note}</span> : null}
          </>
        );
      case "submit":
        return (
          <>
            Submitted {task}
            {e.note ? <span className="text-ink-faint"> to {e.note}</span> : null}
          </>
        );
      case "review":
        return (
          <>
            Reviewed {task}: <span className="font-medium text-ink">{e.decision}</span>
          </>
        );
      case "remark":
        return <>Added a remark on {task}</>;
      case "assigned":
        return (
          <>
            Was given {task}
            {e.otherUserId ? (
              <span className="text-ink-faint"> by {userName(e.otherUserId)}</span>
            ) : null}
          </>
        );
      case "handed":
        return e.otherUserId ? (
          <>
            Handed {task} to <span className="font-medium text-ink">{userName(e.otherUserId)}</span>
          </>
        ) : (
          <>Took {task} off its assignee</>
        );
    }
  })();

  const project = projectName(e.toTaskId ?? e.taskId);
  const body = e.kind === "remark" || e.kind === "review" ? e.note : undefined;

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpenTask(e.toTaskId ?? e.taskId)}
        className="flex w-full items-start gap-3 px-4 py-2 text-left transition-colors hover:bg-surface-2"
      >
        <span className="w-16 shrink-0 pt-1 text-[11px] text-ink-faint tabular-nums">{clock(e.at)}</span>
        <span
          className={cx(
            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
            style.tone,
          )}
        >
          {style.icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col pt-0.5">
          <span className="text-[13px] leading-snug text-ink-muted">{sentence}</span>
          {project ? <span className="truncate text-[11px] text-ink-faint">{project}</span> : null}
          {body ? <RichText html={body} className="mt-1 line-clamp-2 text-[12px]" /> : null}
        </span>
      </button>
    </li>
  );
}
