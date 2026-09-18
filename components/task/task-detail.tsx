"use client";

import { useState } from "react";
import {
  IconCheck,
  IconClose,
  IconEdit,
  IconLink,
  IconTrash,
  IconWhatsApp,
} from "@/components/ui/icons";
import { ConfirmDialog, Drawer } from "@/components/ui/modal";
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  cx,
} from "@/components/ui/primitives";
import { RichText, RichTextEditor, isRichTextEmpty } from "@/components/ui/rich-text";
import { formatDate, formatDateTime, relativeTime } from "@/lib/calendar";
import {
  canAddRemark,
  canDeleteTask,
  canEditTaskFully,
  canReviewTask,
  isAssignee,
  visibleTasks,
} from "@/lib/permissions";
import { useStore } from "@/lib/store";
import { formatDuration, sessionMs, taskElapsedMs } from "@/lib/time";
import type { Review, Submission } from "@/lib/types";
import { OverdueBadge, PriorityBadge, ProjectChip, RecurrenceBadge, StatusBadge } from "./task-bits";
import { ReviewDialog } from "./task-dialogs";
import { TaskFormModal } from "./task-form";
import { TimerControls } from "./timer-controls";

type HistoryEntry =
  | { kind: "submission"; at: string; data: Submission }
  | { kind: "review"; at: string; data: Review };

export function TaskDetailDrawer({
  taskId,
  onClose,
}: {
  taskId: string | null;
  onClose: () => void;
}) {
  const { db, currentUser, taskById, projectById, userById, addRemark, deleteTask } =
    useStore();
  const [remark, setRemark] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const task = taskId ? taskById(taskId) : undefined;
  const project = task?.projectId ? projectById(task.projectId) : null;

  if (!task || !currentUser) return null;

  // The drawer can be deep-linked with ?task=<id>, so it re-checks scope itself
  // rather than trusting whichever list opened it (§4.2).
  if (!visibleTasks(currentUser, db.tasks, db.projects).some((t) => t.id === task.id)) {
    return <TaskNotVisible onClose={onClose} />;
  }

  // Submissions and reviews interleaved, newest first (§12.3).
  const history: HistoryEntry[] = [
    ...task.submissions.map<HistoryEntry>((s) => ({
      kind: "submission",
      at: s.at,
      data: s,
    })),
    ...task.reviews.map<HistoryEntry>((r) => ({ kind: "review", at: r.at, data: r })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const mayEdit = canEditTaskFully(currentUser, task, project ?? null);
  const mayDelete = canDeleteTask(currentUser, task, project ?? null);
  // A task parked with the client is still open for review: whoever parked it
  // comes back and settles it once the client answers.
  const mayReview =
    canReviewTask(currentUser, task, project ?? null) &&
    (task.status === "Submitted" || task.status === "Waiting for Client Response");
  const mayRemark = canAddRemark(currentUser, task, project ?? null);
  const assignee = userById(task.assigneeId);
  const creator = userById(task.createdBy);

  const submitRemark = () => {
    if (isRichTextEmpty(remark)) return;
    addRemark(task.id, remark);
    setRemark("");
  };

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={task.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ProjectChip
              project={project}
              href={project ? `/projects/${project.id}` : undefined}
            />
            <span className="text-ink-faint">·</span>
            <span>{task.department}</span>
          </span>
        }
        headerExtra={
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={task.status} task={task} />
            <PriorityBadge priority={task.priority} />
            <RecurrenceBadge item={task} />
            <OverdueBadge task={task} />
            <div className="ml-auto flex items-center gap-1.5">
              {mayReview ? (
                <Button size="sm" variant="primary" onClick={() => setReviewOpen(true)}>
                  <IconCheck size={13} /> Review
                </Button>
              ) : null}
              {mayEdit ? (
                <Button size="sm" onClick={() => setEditOpen(true)}>
                  <IconEdit size={13} /> Edit
                </Button>
              ) : null}
              {mayDelete ? (
                <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
                  <IconTrash size={13} />
                </Button>
              ) : null}
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-5">
          <TimerControls task={task} />

          {/* What the assignee may and may not touch (§9.4) */}
          {isAssignee(currentUser, task) && !mayEdit ? (
            <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-ink-faint">
              On your own task you control the timer and can add remarks. Title,
              dates, assignee, priority and estimate are set by your reviewer.
            </p>
          ) : null}

          {/* Facts */}
          <Card className="grid grid-cols-2 gap-x-4 gap-y-3.5 p-4 sm:grid-cols-3">
            <Fact label="Assigned to">
              {assignee ? (
                <span className="inline-flex items-center gap-1.5">
                  <Avatar name={assignee.fullName} size={20} />
                  <span className="truncate">{assignee.fullName}</span>
                </span>
              ) : (
                "—"
              )}
            </Fact>
            <Fact label="Start date">{formatDate(task.startDate)}</Fact>
            <Fact label="Due date">{formatDate(task.dueDate)}</Fact>
            <Fact label="Estimated">{task.estimatedHours}h</Fact>
            <Fact label="Time spent">{formatDuration(taskElapsedMs(task))}</Fact>
            <Fact label="Created by">{creator?.fullName ?? "—"}</Fact>
          </Card>

          {task.tags.length ? (
            <div className="flex flex-wrap gap-1.5">
              {task.tags.map((t) => (
                <Badge key={t}>#{t}</Badge>
              ))}
            </div>
          ) : null}

          {!isRichTextEmpty(task.description) ? (
            <Section title="Description">
              <RichText html={task.description} />
            </Section>
          ) : null}

          {/* Submission & review history (§12.3) */}
          <Section
            title="Submission history"
            hint={
              history.length
                ? `${task.submissions.length} submission${task.submissions.length === 1 ? "" : "s"} · ${task.reviews.length} review${task.reviews.length === 1 ? "" : "s"}`
                : undefined
            }
          >
            {history.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-5 text-center text-[12px] text-ink-faint">
                Nothing submitted yet.
              </p>
            ) : (
              <ol className="relative space-y-4 pl-6">
                <span className="absolute top-1.5 bottom-1.5 left-[7px] w-px bg-line" />
                {history.map((entry) =>
                  entry.kind === "submission" ? (
                    <SubmissionEntry key={entry.data.id} submission={entry.data} />
                  ) : (
                    <ReviewEntry key={entry.data.id} review={entry.data} />
                  ),
                )}
              </ol>
            )}
          </Section>

          {/* Time log */}
          {task.sessions.length ? (
            <Section title="Time log" hint={`${task.sessions.length} session${task.sessions.length === 1 ? "" : "s"}`}>
              <div className="overflow-hidden rounded-xl border border-line">
                <table className="w-full text-left text-[12px]">
                  <thead className="bg-surface-2 text-[10px] tracking-wide text-ink-faint uppercase">
                    <tr>
                      <th className="px-3 py-2 font-medium">Started</th>
                      <th className="px-3 py-2 font-medium">Duration</th>
                      <th className="px-3 py-2 font-medium">Ended because</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...task.sessions].reverse().map((s) => (
                      <tr key={s.id} className="border-t border-line-soft">
                        <td className="px-3 py-2 text-ink-muted">
                          {formatDateTime(s.startedAt)}
                        </td>
                        <td className="px-3 py-2 font-mono text-ink">
                          {formatDuration(sessionMs(s))}
                        </td>
                        <td className="px-3 py-2 text-ink-muted">
                          {s.endedAt ? (
                            <span
                              className={cx(
                                s.endReason === "Auto-stopped" && "text-st-submitted",
                              )}
                            >
                              {s.endNote ?? s.endReason}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-st-inprogress">
                              <span className="animate-pulse-dot h-1.5 w-1.5 rounded-full bg-st-inprogress" />
                              Running now
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          ) : null}

          {/* Remarks thread (§9.4) */}
          <Section title="Remarks" hint="Visible to everyone who can see this task">
            {task.remarks.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[12px] text-ink-faint">
                No remarks yet.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {task.remarks.map((r) => {
                  const author = userById(r.byUserId);
                  return (
                    <li key={r.id} className="flex gap-2.5">
                      <Avatar name={author?.fullName ?? "?"} size={26} />
                      <div className="min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2">
                        <div className="flex items-baseline gap-2">
                          <span className="text-[12px] font-medium text-ink">
                            {author?.fullName ?? "Unknown"}
                          </span>
                          <span className="text-[10px] text-ink-faint">
                            {relativeTime(r.at)}
                          </span>
                        </div>
                        <RichText html={r.text} className="mt-0.5" />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {mayRemark ? (
              <div className="mt-3 flex flex-col gap-2">
                <RichTextEditor
                  value={remark}
                  onChange={setRemark}
                  placeholder="Add a remark for the reviewer…"
                  minHeight={64}
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={isRichTextEmpty(remark)}
                    onClick={submitRemark}
                  >
                    Post remark
                  </Button>
                </div>
              </div>
            ) : null}
          </Section>
        </div>
      </Drawer>

      {editOpen ? (
        <TaskFormModal
          open
          onClose={() => setEditOpen(false)}
          task={task}
          project={project ?? null}
          mode={task.projectId ? "project" : "individual"}
        />
      ) : null}

      <ReviewDialog open={reviewOpen} onClose={() => setReviewOpen(false)} task={task} />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          deleteTask(task.id);
          onClose();
        }}
        title="Delete this task?"
        body="The task, its time log, submissions and reviews are removed. This cannot be undone."
      />
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium tracking-wide text-ink-faint uppercase">
        {label}
      </div>
      <div className="mt-0.5 truncate text-[13px] text-ink">{children}</div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
          {title}
        </h3>
        {hint ? <span className="text-[10px] text-ink-faint">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Node({ className }: { className: string }) {
  return (
    <span
      className={cx(
        "absolute top-1 -left-6 h-3.5 w-3.5 rounded-full border-2 border-surface",
        className,
      )}
    />
  );
}

function SubmissionEntry({ submission }: { submission: Submission }) {
  const { userById } = useStore();
  const author = userById(submission.byUserId);
  return (
    <li className="relative">
      <Node className="bg-st-submitted" />
      <div className="rounded-xl border border-line bg-surface-2 p-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[12px] font-semibold text-st-submitted">Submitted</span>
          <span className="text-[11px] text-ink-muted">
            by {author?.fullName ?? "Unknown"}
          </span>
          <span className="ml-auto text-[10px] text-ink-faint">
            {formatDateTime(submission.at)}
          </span>
        </div>

        <div className="mt-2 flex items-center gap-1.5">
          <Badge className="border-line bg-surface-3 text-ink-muted">
            {submission.outputLocation === "Google Drive" ? (
              <IconLink size={11} />
            ) : (
              <IconWhatsApp size={11} />
            )}
            {submission.outputLocation}
          </Badge>
        </div>

        {submission.driveLink ? (
          <a
            href={submission.driveLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block truncate text-[12px] text-brand-bright hover:underline"
          >
            {submission.driveLink}
          </a>
        ) : null}

        <RichText html={submission.description} className="mt-2" />
      </div>
    </li>
  );
}

function ReviewEntry({ review }: { review: Review }) {
  const { userById } = useStore();
  const reviewer = userById(review.byUserId);
  const newAssignee = review.newAssigneeId ? userById(review.newAssigneeId) : null;

  const tone =
    review.decision === "Approved"
      ? { text: "text-st-approved", node: "bg-st-approved" }
      : review.decision === "Changes Required"
        ? { text: "text-st-changes", node: "bg-st-changes" }
        : { text: "text-st-rejected", node: "bg-st-rejected" };

  return (
    <li className="relative">
      <Node className={tone.node} />
      <div className="rounded-xl border border-line bg-surface-2 p-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={cx("text-[12px] font-semibold", tone.text)}>
            {review.decision}
            {newAssignee ? ` — reassigned to ${newAssignee.fullName}` : ""}
          </span>
          <span className="text-[11px] text-ink-muted">
            by {reviewer?.fullName ?? "Unknown"}
          </span>
          <span className="ml-auto text-[10px] text-ink-faint">
            {formatDateTime(review.at)}
          </span>
        </div>

        {review.source ? (
          <div className="mt-2">
            <Badge className="border-line bg-surface-3 text-ink-muted">
              Source: {review.source}
            </Badge>
          </div>
        ) : null}

        <RichText html={review.remarks} className="mt-2" />

        {review.newDueDate ? (
          <p className="mt-2 text-[11px] text-ink-faint">
            Due date moved to {formatDate(review.newDueDate)}
          </p>
        ) : null}
      </div>
    </li>
  );
}

/** Shown when a drawer is asked for a task the user may not see. */
export function TaskNotVisible({ onClose }: { onClose: () => void }) {
  return (
    <Drawer open onClose={onClose} title="Task unavailable">
      <EmptyState
        icon={<IconClose size={28} />}
        title="You don't have access to this task"
        body="It may have been deleted, or it belongs to a project or department outside your scope."
      />
    </Drawer>
  );
}

