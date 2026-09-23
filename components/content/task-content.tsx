"use client";

import { useState } from "react";
import { ContentComposer } from "@/components/content/content-form";
import { ContentDetailScreen, ContentLinkRow } from "@/components/content/content-view";
import {
  IconCheck,
  IconClose,
  IconContent,
  IconEdit,
  IconPlus,
  IconSend,
  IconTrash,
} from "@/components/ui/icons";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { Badge, Button, Field, ProgressBar, Textarea, cx } from "@/components/ui/primitives";
import { TASK_STATUS_STYLE } from "@/lib/master-data";
import {
  canDeleteContentEntry,
  canEditContentEntry,
  canReviewContent,
  canSubmitContent,
  canWriteContent,
  isAssignee,
  isContentTask,
} from "@/lib/permissions";
import { useStore } from "@/lib/store";
import {
  contentProgress,
  type ContentDecision,
  type ContentEntry,
  type Project,
  type Task,
} from "@/lib/types";

/*
 * The Content Bank as it appears on a task.
 *
 * On a *content task* this is the whole job: the task says "five reels", the
 * writer writes five pieces, hands each one over, and whoever may review the
 * task decides on them one at a time. The bar counts approvals against the
 * target, and the task approves itself once the batch is done (the database
 * does that, in sync_content_task).
 *
 * On an ordinary task it stays what it was - a place to write the copy that
 * task needs, and to read the piece put in your name.
 */
export function TaskContentSection({
  task,
  project,
}: {
  task: Task;
  project: Project | null;
}) {
  const { db, currentUser, deleteContentEntry } = useStore();
  const user = currentUser!;
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<ContentEntry | null>(null);
  // Held by id so an allotment or status changed on the open screen shows at once.
  const [readingId, setReadingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ContentEntry | null>(null);
  const [verdictOn, setVerdictOn] = useState<ContentEntry | null>(null);

  const entries = db.contentEntries.filter((e) => e.taskId === task.id);
  const reading = readingId ? db.contentEntries.find((e) => e.id === readingId) : undefined;
  const batch = isContentTask(task);
  const progress = contentProgress(task, db.contentEntries);

  /*
   * A designer's own task carries no content of its own - the writer filed it
   * against theirs. What the designer needs is the piece that was put in their
   * name on the same project, so it is listed here too rather than making them
   * go looking for the writer's task.
   */
  const allotted = isAssignee(user, task)
    ? db.contentEntries.filter(
        (e) =>
          e.projectId === task.projectId &&
          e.allottedTo === user.id &&
          e.taskId !== task.id,
      )
    : [];

  // Individual tasks have no project to file content against, so the writer's
  // controls only appear on project work.
  const mayWrite = !!project && canWriteContent(user) && isAssignee(user, task);
  if (!mayWrite && entries.length === 0 && allotted.length === 0) return null;

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
          <IconContent size={14} /> {batch ? "Content pieces" : "Content"}
          {entries.length ? (
            <span className="text-ink-faint">
              {batch
                ? `· ${progress.approved} of ${progress.total} approved`
                : `· ${entries.length} ${entries.length === 1 ? "piece" : "pieces"}`}
            </span>
          ) : null}
        </h3>
        {mayWrite ? (
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setEditing(null);
              setComposing(true);
            }}
          >
            <IconPlus size={13} /> {batch ? "Add content" : "Write content"}
          </Button>
        ) : null}
      </div>

      {/* The batch at a glance: what was asked for, and how much stands. */}
      {batch ? (
        <div className="mb-3 rounded-card border border-line bg-surface-2 px-3 py-2.5">
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-mono text-[15px] font-semibold text-ink">
              {progress.approved}
              <span className="text-ink-faint">/{progress.total}</span>
            </span>
            <span className="text-[11px] text-ink-faint">
              {progress.written} written
              {progress.submitted ? ` · ${progress.submitted} awaiting a decision` : ""}
              {progress.written < progress.total
                ? ` · ${progress.total - progress.written} still to write`
                : ""}
            </span>
          </div>
          <ProgressBar value={progress.percent} barClassName="bg-st-approved" />
        </div>
      ) : null}

      {entries.length === 0 ? (
        // Only the writer needs telling their task is still empty; for everyone
        // else the section is here for the piece allotted to them.
        mayWrite ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[12px] text-ink-faint">
            {batch
              ? `Nothing written yet. This task asks for ${task.contentCount}.`
              : "Nothing written for this task yet."}
          </p>
        ) : null
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((e, at) => (
            <PieceRow
              key={e.id}
              index={at + 1}
              entry={e}
              task={task}
              project={project}
              numbered={batch}
              onRead={() => setReadingId(e.id)}
              onEdit={() => {
                setEditing(e);
                setComposing(true);
              }}
              onDelete={() => setDeleting(e)}
              onVerdict={() => setVerdictOn(e)}
            />
          ))}
        </ul>
      )}

      {allotted.length ? (
        <div className="mt-3">
          <h4 className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
            Allotted to you on this project
          </h4>
          <ul className="flex flex-col gap-2">
            {allotted.map((e) => (
              <li key={e.id}>
                <ContentLinkRow entry={e} onOpen={() => setReadingId(e.id)} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {composing && project ? (
        <ContentComposer
          projectId={project.id}
          taskId={task.id}
          entry={editing ?? undefined}
          onClose={() => {
            setComposing(false);
            setEditing(null);
          }}
        />
      ) : null}

      {reading ? (
        <ContentDetailScreen
          entry={reading}
          onClose={() => setReadingId(null)}
          showTaskLink={false}
        />
      ) : null}

      {verdictOn ? (
        <VerdictDialog entry={verdictOn} onClose={() => setVerdictOn(null)} />
      ) : null}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteContentEntry(deleting.id)}
        title="Delete this content?"
        body="It is removed from the Content Bank as well as from this task."
        confirmLabel="Delete content"
      />
    </section>
  );
}

/* ------------------------------------------------------------- one piece */

function PieceRow({
  index,
  entry,
  task,
  project,
  numbered,
  onRead,
  onEdit,
  onDelete,
  onVerdict,
}: {
  index: number;
  entry: ContentEntry;
  task: Task;
  project: Project | null;
  numbered: boolean;
  onRead: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onVerdict: () => void;
}) {
  const { currentUser, userById, submitContent } = useStore();
  const user = currentUser!;
  const allotted = userById(entry.allottedTo);

  const maySubmit = canSubmitContent(user, entry) && entry.status !== "Submitted";
  const mayReview =
    canReviewContent(user, entry, task, project) && entry.status === "Submitted";
  const last = entry.reviews[entry.reviews.length - 1];

  return (
    <li
      className={cx(
        "rounded-card border bg-surface-2 px-3 py-2.5",
        entry.status === "Approved"
          ? "border-st-approved/30"
          : entry.status === "Rejected"
            ? "border-st-rejected/30"
            : entry.status === "Changes Required"
              ? "border-st-changes/30"
              : "border-line-soft",
      )}
    >
      <div className="flex items-start gap-2.5">
        {numbered ? (
          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[10px] font-semibold text-ink-muted">
            {index}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <button
            onClick={onRead}
            className="block max-w-full truncate text-left text-[13px] font-medium text-ink hover:text-brand-bright"
          >
            {entry.caption.trim() || entry.type}
          </button>
          <p className="truncate text-[11px] text-ink-faint">
            {entry.type}
            {allotted ? ` · for ${allotted.fullName}` : " · not allotted yet"}
          </p>
        </div>
        <Badge className={TASK_STATUS_STYLE[entry.status].chip}>{entry.status}</Badge>
      </div>

      {/* The last word on it, so a rewrite is not a guessing game. */}
      {last && entry.status !== "Approved" && last.remarks.trim() ? (
        <p className="mt-2 rounded-lg bg-surface px-2.5 py-1.5 text-[11px] leading-relaxed text-ink-muted">
          <span className="font-medium text-ink">{last.decision}:</span> {last.remarks}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {mayReview ? (
          <Button size="sm" variant="primary" onClick={onVerdict}>
            <IconCheck size={13} /> Review
          </Button>
        ) : null}
        {maySubmit ? (
          <Button size="sm" onClick={() => submitContent(entry.id)}>
            <IconSend size={13} /> Submit
          </Button>
        ) : null}
        {canEditContentEntry(user, entry) && entry.status !== "Approved" ? (
          <Button size="sm" aria-label="Edit content" onClick={onEdit}>
            <IconEdit size={13} />
          </Button>
        ) : null}
        {canDeleteContentEntry(user, entry) && entry.status !== "Approved" ? (
          <Button size="sm" variant="danger" aria-label="Delete content" onClick={onDelete}>
            <IconTrash size={13} />
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/* --------------------------------------------------------- the verdict */

/**
 * One piece, decided. Changes and rejections have to say why - a rewrite with
 * no reason attached is how work goes round twice.
 */
function VerdictDialog({ entry, onClose }: { entry: ContentEntry; onClose: () => void }) {
  const { reviewContent } = useStore();
  const [decision, setDecision] = useState<ContentDecision>("Approved");
  const [remarks, setRemarks] = useState("");
  const [touched, setTouched] = useState(false);

  const needsReason = decision !== "Approved";
  const missing = needsReason && !remarks.trim();

  const choices: { value: ContentDecision; label: string; className: string }[] = [
    {
      value: "Approved",
      label: "Approve",
      className: "border-st-approved/40 bg-st-approved/15 text-st-approved",
    },
    {
      value: "Changes Required",
      label: "Changes required",
      className: "border-st-changes/40 bg-st-changes/15 text-st-changes",
    },
    {
      value: "Rejected",
      label: "Reject",
      className: "border-st-rejected/40 bg-st-rejected/15 text-st-rejected",
    },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={entry.caption.trim() || entry.type}
      subtitle="Your decision on this piece"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              setTouched(true);
              if (missing) return;
              reviewContent(entry.id, decision, remarks.trim());
              onClose();
            }}
          >
            <IconCheck size={14} /> Record decision
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Decision" required>
          <div className="flex flex-wrap gap-1.5">
            {choices.map((c) => (
              <button
                key={c.value}
                onClick={() => setDecision(c.value)}
                className={cx(
                  "h-9 rounded-[10px] border px-3 text-[13px] font-medium transition-colors",
                  decision === c.value
                    ? c.className
                    : "border-line bg-surface-2 text-ink-muted hover:text-ink",
                )}
              >
                {c.value === "Approved" ? (
                  <IconCheck size={13} className="mr-1.5 inline" />
                ) : c.value === "Rejected" ? (
                  <IconClose size={13} className="mr-1.5 inline" />
                ) : null}
                {c.label}
              </button>
            ))}
          </div>
        </Field>

        <Field
          label="Remarks"
          required={needsReason}
          hint={needsReason ? undefined : "Optional on an approval."}
          error={touched && missing ? "Say what needs changing." : undefined}
        >
          <Textarea
            rows={4}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder={
              needsReason
                ? "What has to change, and why…"
                : "Anything worth recording…"
            }
          />
        </Field>
      </div>
    </Modal>
  );
}
