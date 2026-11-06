import type { ReviewDecision, Task, TaskOpen } from "./types";

/**
 * One person's day, for the Activity tab on their page. Everything but the task
 * opens (0028) is already on record with the task: timer sessions, submissions,
 * reviews, remarks and changes of hands. This puts them on one timeline.
 */
export type ActivityKind =
  | "open"
  | "start"
  | "switch"
  | "stop"
  | "submit"
  | "review"
  | "remark"
  | "assigned"
  | "handed";

export type ActivityFilter = "all" | "open" | "timer" | "submit" | "remark" | "assign";

export const ACTIVITY_FILTERS: { id: ActivityFilter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "open", label: "Opened tasks" },
  { id: "timer", label: "Timer: started, switched, stopped" },
  { id: "submit", label: "Submissions and reviews" },
  { id: "remark", label: "Remarks" },
  { id: "assign", label: "Assignments" },
];

const FILTER_KINDS: Record<Exclude<ActivityFilter, "all">, ActivityKind[]> = {
  open: ["open"],
  timer: ["start", "switch", "stop"],
  submit: ["submit", "review"],
  remark: ["remark"],
  assign: ["assigned", "handed"],
};

export const matchesActivityFilter = (kind: ActivityKind, filter: ActivityFilter) =>
  filter === "all" || FILTER_KINDS[filter].includes(kind);

export interface ActivityEvent {
  id: string;
  at: string;
  kind: ActivityKind;
  taskId: string;
  /** The task switched to, on a switch. */
  toTaskId?: string;
  /** The other person on an assignment: who gave it, or who it went to. */
  otherUserId?: string | null;
  stopReason?: "End of day" | "Auto-stopped" | "Paused";
  decision?: ReviewDecision;
  note?: string;
}

export interface TaskTime {
  taskId: string;
  ms: number;
  running: boolean;
}

export interface DayActivity {
  events: ActivityEvent[];
  /** Timer time inside the day, per task, most first. */
  time: TaskTime[];
  totalMs: number;
  /** The task their timer is running on now, if it started on or before this day. */
  runningTaskId: string | null;
}

/** A start this close to a Switched stop is the same step (§11.2 option 2). */
const SWITCH_WINDOW_MS = 60_000;

const within = (at: string, from: number, to: number) => {
  const t = new Date(at).getTime();
  return t >= from && t < to;
};

export function buildDayActivity(
  personId: string,
  tasks: Task[],
  opens: TaskOpen[],
  dayStart: Date,
  dayEnd: Date,
  now = Date.now(),
): DayActivity {
  const from = dayStart.getTime();
  const to = dayEnd.getTime();
  const events: ActivityEvent[] = [];
  const time = new Map<string, TaskTime>();
  let runningTaskId: string | null = null;

  const starts: ActivityEvent[] = [];
  const switches: { event: ActivityEvent; at: number }[] = [];

  for (const t of tasks) {
    for (const s of t.sessions) {
      if (s.userId !== personId) continue;
      const start = new Date(s.startedAt).getTime();
      const end = s.endedAt ? new Date(s.endedAt).getTime() : now;

      const overlap = Math.min(end, to) - Math.max(start, from);
      if (overlap > 0) {
        const row = time.get(t.id) ?? { taskId: t.id, ms: 0, running: false };
        row.ms += overlap;
        if (!s.endedAt) row.running = true;
        time.set(t.id, row);
      }
      if (!s.endedAt && start < to) runningTaskId = t.id;

      if (start >= from && start < to) {
        starts.push({ id: `start-${s.id}`, at: s.startedAt, kind: "start", taskId: t.id });
      }
      if (s.endedAt && within(s.endedAt, from, to)) {
        // A submission closes its own session; the submission says it.
        if (s.endReason === "Submitted") continue;
        if (s.endReason === "Switched") {
          const event: ActivityEvent = {
            id: `switch-${s.id}`,
            at: s.endedAt,
            kind: "switch",
            taskId: t.id,
            note: s.endNote,
          };
          switches.push({ event, at: end });
          events.push(event);
        } else {
          events.push({
            id: `stop-${s.id}`,
            at: s.endedAt,
            kind: "stop",
            taskId: t.id,
            stopReason: s.endReason === "End of day" || s.endReason === "Auto-stopped" ? s.endReason : "Paused",
            note: s.endNote,
          });
        }
      }
    }

    for (const sub of t.submissions) {
      if (sub.byUserId === personId && within(sub.at, from, to))
        events.push({
          id: `submit-${sub.id}`,
          at: sub.at,
          kind: "submit",
          taskId: t.id,
          note: sub.outputLocation,
        });
    }
    for (const r of t.reviews) {
      if (r.byUserId === personId && within(r.at, from, to))
        events.push({
          id: `review-${r.id}`,
          at: r.at,
          kind: "review",
          taskId: t.id,
          decision: r.decision,
          note: r.remarks,
        });
    }
    for (const r of t.remarks) {
      if (r.byUserId === personId && within(r.at, from, to))
        events.push({ id: `remark-${r.id}`, at: r.at, kind: "remark", taskId: t.id, note: r.text });
    }
    for (const a of t.assignments ?? []) {
      if (!within(a.at, from, to)) continue;
      if (a.toUserId === personId)
        events.push({
          id: `assigned-${a.id}`,
          at: a.at,
          kind: "assigned",
          taskId: t.id,
          otherUserId: a.byUserId,
        });
      else if (a.byUserId === personId)
        events.push({
          id: `handed-${a.id}`,
          at: a.at,
          kind: "handed",
          taskId: t.id,
          otherUserId: a.toUserId,
        });
    }
  }

  // Fold the start that follows a switch into it, so it reads "from A to B".
  for (const start of starts) {
    const at = new Date(start.at).getTime();
    const match = switches.find(
      (s) => !s.event.toTaskId && s.event.taskId !== start.taskId && Math.abs(s.at - at) <= SWITCH_WINDOW_MS,
    );
    if (match) match.event.toTaskId = start.taskId;
    else events.push(start);
  }

  for (const o of opens) {
    if (within(o.at, from, to))
      events.push({ id: `open-${o.id}`, at: o.at, kind: "open", taskId: o.taskId });
  }

  // By instant: the database and optimistic writes don't format timestamps alike.
  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const rows = [...time.values()].sort((a, b) => b.ms - a.ms);
  return {
    events,
    time: rows,
    totalMs: rows.reduce((sum, r) => sum + r.ms, 0),
    runningTaskId,
  };
}
