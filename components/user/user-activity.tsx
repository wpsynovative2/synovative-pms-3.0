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
import { addDays, daysBetween, formatDate, fromISODate, toISODate, todayISO } from "@/lib/calendar";
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

type Preset = "today" | "yesterday" | "last7" | "week" | "month" | "custom";

/** Monday of the week `iso` falls in. */
const weekStart = (iso: string) => addDays(iso, -((fromISODate(iso).getDay() + 6) % 7));

function presetRange(preset: Exclude<Preset, "custom">, today: string): { from: string; to: string } {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "last7":
      return { from: addDays(today, -6), to: today };
    case "week":
      return { from: weekStart(today), to: today };
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
  }
}

const PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last7", label: "Last 7 days" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "custom", label: "Custom range" },
];

/**
 * What someone did over a day or a range of days: the tasks they opened, when
 * their timer started, switched and stopped, and what they submitted, reviewed,
 * remarked on or were handed. Opens are read from the database when the range is
 * picked (0028); the rest is already in the store with each task, so it covers
 * the tasks the viewer can see.
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
  const [range, setRange] = useState({ from: today, to: today });
  const { from, to } = range;
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [reload, setReload] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  const days = daysBetween(from, to) + 1;
  const singleDay = days === 1;
  const preset: Preset =
    PRESETS.find((p) => {
      if (p.id === "custom") return false;
      const r = presetRange(p.id, today);
      return r.from === from && r.to === to;
    })?.id ?? "custom";

  /** Moves the range by its own length, never past today. */
  const shift = (direction: -1 | 1) => {
    let next = { from: addDays(from, direction * days), to: addDays(to, direction * days) };
    if (next.to > today) next = { from: addDays(today, -(days - 1)), to: today };
    setRange(next);
  };

  const dayStart = useMemo(() => fromISODate(from), [from]);
  const dayEnd = useMemo(() => fromISODate(addDays(to, 1)), [to]);
  const key = `${person.id}|${from}|${to}|${reload}`;

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
  const shown = useMemo(
    () => activity.events.filter((e) => matchesActivityFilter(e.kind, filter)),
    [activity.events, filter],
  );
  const openedCount = new Set(opens.map((o) => o.taskId)).size;
  const switchCount = activity.events.filter((e) => e.kind === "switch").length;
  const running = to === today && activity.runningTaskId ? taskById(activity.runningTaskId) : undefined;
  const first = person.fullName.split(" ")[0];
  const dayLabel = (iso: string) => (iso === today ? "Today" : formatDate(iso));
  const rangeLabel = singleDay ? dayLabel(from) : `${formatDate(from)} – ${dayLabel(to)}`;
  const period = singleDay ? "this day" : "these days";

  // Over a range, the timeline is split by day.
  const byDay = useMemo(() => {
    const out: { day: string; events: ActivityEvent[] }[] = [];
    for (const e of shown) {
      const day = toISODate(new Date(e.at));
      if (out.at(-1)?.day !== day) out.push({ day, events: [] });
      out.at(-1)!.events.push(e);
    }
    return out;
  }, [shown]);

  const taskName = (id: string | undefined) => {
    const t = id ? taskById(id) : undefined;
    return t ? `${t.code ? `${t.code} ` : ""}${t.title}` : "a task you can't see";
  };
  const projectName = (t: Task | undefined) =>
    t?.projectId ? (projectById(t.projectId)?.name ?? null) : t ? "Individual task" : null;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center gap-2.5 p-3.5">
        <Select
          className="w-auto min-w-36"
          value={preset}
          active={preset !== "today"}
          onChange={(e) => {
            const next = e.target.value as Preset;
            if (next !== "custom") setRange(presetRange(next, today));
          }}
          aria-label="Period"
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id} disabled={p.id === "custom"}>
              {p.label}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          aria-label={singleDay ? "Previous day" : "Previous period"}
          onClick={() => shift(-1)}
        >
          <IconChevronLeft size={14} />
        </Button>
        <div className="flex items-center gap-1.5">
          <div className="w-40">
            <DatePicker
              value={from}
              // Picking a start after the end moves the end along with it.
              onChange={(v) => setRange((r) => ({ from: v || today, to: (v || today) > r.to ? v || today : r.to }))}
              config={db.calendar}
              ignoreWorkingRules
              allowPast
              max={today}
            />
          </div>
          <span className="text-[12px] text-ink-faint">to</span>
          <div className="w-40">
            <DatePicker
              value={to}
              onChange={(v) => setRange((r) => ({ from: r.from, to: v || today }))}
              config={db.calendar}
              ignoreWorkingRules
              allowPast
              min={from}
              max={today}
            />
          </div>
        </div>
        <Button
          size="sm"
          aria-label={singleDay ? "Next day" : "Next period"}
          disabled={to >= today}
          onClick={() => shift(1)}
        >
          <IconChevronRight size={14} />
        </Button>
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
            <h2 className="text-sm font-medium text-ink">{rangeLabel}</h2>
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
                    ? `Nothing of that kind on ${period}`
                    : `No activity from ${first} on ${period}`
              }
            />
          ) : (
            <div className={cx("flex flex-col", singleDay && "py-1.5")}>
              {byDay.map(({ day, events }) => (
                <section key={day} className="border-t border-line-soft first:border-t-0">
                  {singleDay ? null : (
                    <h3 className="flex items-baseline justify-between gap-2 border-b border-line-soft bg-surface-2 px-4 py-1.5 text-[12px] font-medium text-ink-muted">
                      {dayLabel(day)}
                      <span className="text-[11px] font-normal text-ink-faint">
                        {events.length} event{events.length === 1 ? "" : "s"}
                      </span>
                    </h3>
                  )}
                  <ol className="flex flex-col">
                    {events.map((e) => (
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
                </section>
              ))}
            </div>
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
