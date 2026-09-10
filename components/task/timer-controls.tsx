"use client";

import { useEffect, useState } from "react";
import { IconClock, IconPause, IconPlay, IconSend } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { Button, cx } from "@/components/ui/primitives";
import { canRunTimer } from "@/lib/permissions";
import { useStore } from "@/lib/store";
import {
  findRunningTaskForUser,
  formatClock,
  isTimerPaused,
  isTimerRunning,
  taskElapsedMs,
} from "@/lib/time";
import type { Task } from "@/lib/types";
import { PauseDialog, SubmitDialog } from "./task-dialogs";

/**
 * §11.1 — Start / Pause / Resume / Submit, plus the "only one timer per user"
 * rule (§11.3.1): starting a second timer offers to close the first one.
 */
export function TimerControls({
  task,
  compact,
}: {
  task: Task;
  compact?: boolean;
}) {
  const { db, currentUser, startTimer, switchTimer } = useStore();
  const [pauseOpen, setPauseOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [conflict, setConflict] = useState<Task | null>(null);
  const [, setTick] = useState(0);

  const running = isTimerRunning(task);
  const paused = isTimerPaused(task);

  // Re-render once a second only while this task's own timer is open.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  if (!currentUser) return null;

  const mine = canRunTimer(currentUser, task);
  const elapsed = taskElapsedMs(task);

  // Terminal states have no timer affordance.
  const finished = task.status === "Approved" || task.status === "Submitted";

  const tryStart = () => {
    const other = findRunningTaskForUser(db.tasks, currentUser.id);
    if (other && other.id !== task.id) {
      setConflict(other);
      return;
    }
    startTimer(task.id);
  };

  return (
    <div
      className={cx(
        "flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3.5 py-2.5",
        compact && "px-3 py-2",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <IconClock size={16} className="shrink-0 text-ink-faint" />
        <div className="min-w-0">
          <div className="text-[10px] font-medium tracking-wide text-ink-faint uppercase">
            Time on task
          </div>
          <div
            className={cx(
              "font-mono text-[15px] tabular-nums",
              running ? "text-ink" : "text-ink-muted",
            )}
          >
            {formatClock(elapsed)}
          </div>
        </div>
        <span className="ml-1 text-[11px] text-ink-faint">
          of {task.estimatedHours}h estimated
        </span>
      </div>

      {!mine ? (
        <span className="text-[11px] text-ink-faint">Assignee only</span>
      ) : finished ? (
        <span className="text-[11px] text-ink-faint">
          {task.status === "Submitted" ? "Awaiting review" : "Complete"}
        </span>
      ) : (
        <div className="flex shrink-0 items-center gap-1.5">
          {running ? (
            <>
              <Button size="sm" onClick={() => setPauseOpen(true)}>
                <IconPause size={13} /> Pause
              </Button>
              <Button size="sm" variant="primary" onClick={() => setSubmitOpen(true)}>
                <IconSend size={13} /> Submit
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="primary" onClick={tryStart}>
                <IconPlay size={13} /> {paused ? "Resume" : "Start"}
              </Button>
              {task.status === "In Progress" ? (
                <Button size="sm" onClick={() => setSubmitOpen(true)}>
                  <IconSend size={13} /> Submit
                </Button>
              ) : null}
            </>
          )}
        </div>
      )}

      <PauseDialog open={pauseOpen} onClose={() => setPauseOpen(false)} task={task} />
      <SubmitDialog open={submitOpen} onClose={() => setSubmitOpen(false)} task={task} />

      <Modal
        open={!!conflict}
        onClose={() => setConflict(null)}
        title="A timer is already running"
        size="sm"
        footer={
          <>
            <Button onClick={() => setConflict(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => {
                if (conflict) switchTimer(conflict.id, task.id);
                setConflict(null);
              }}
            >
              Switch to this task
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-ink-muted">
          Your timer is running on{" "}
          <span className="font-medium text-ink">“{conflict?.title}”</span>. Only one
          timer can run at a time — switching stops that session with the reason{" "}
          <em>Switched</em> and starts this one immediately.
        </p>
      </Modal>
    </div>
  );
}
