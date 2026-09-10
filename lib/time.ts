import type { Task, TimeSession } from "./types";

/**
 * Time tracking (PRD §11). Only start/stop timestamps are stored; elapsed
 * time is always derived here so there are no per-second writes.
 */

export function sessionMs(s: TimeSession, now = Date.now()): number {
  const start = new Date(s.startedAt).getTime();
  const end = s.endedAt ? new Date(s.endedAt).getTime() : now;
  return Math.max(0, end - start);
}

export function taskElapsedMs(task: Task, now = Date.now()): number {
  return task.sessions.reduce((sum, s) => sum + sessionMs(s, now), 0);
}

export function runningSession(task: Task): TimeSession | undefined {
  return task.sessions.find((s) => s.endedAt === null);
}

export const isTimerRunning = (task: Task) => !!runningSession(task);

/** Paused = work started but no session is currently open. */
export const isTimerPaused = (task: Task) =>
  task.status === "In Progress" && !isTimerRunning(task) && task.sessions.length > 0;

/** The one task, if any, whose timer is open for this user (§11.3.1). */
export function findRunningTaskForUser(
  tasks: Task[],
  userId: string,
): Task | undefined {
  return tasks.find(
    (t) => t.assigneeId === userId && t.sessions.some((s) => s.endedAt === null),
  );
}

/** `2h 35m` — compact, for lists and totals. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/** `01:24:07` — for the live timer readout. */
export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => `${n}`.padStart(2, "0")).join(":");
}

export const hoursFromMs = (ms: number) => ms / 3_600_000;

export function formatHours(hours: number): string {
  if (!Number.isFinite(hours)) return "0h";
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded}h`;
}

/**
 * The 11:59 PM cut-off for a given day, in local time (§11.3.4).
 * Deployed to Supabase this is a `pg_cron` job pinned to IST.
 */
export function autoStopInstant(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 0, 0);
  return d;
}
