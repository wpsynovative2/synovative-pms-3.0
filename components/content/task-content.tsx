"use client";

import { useState } from "react";
import { ContentComposer } from "@/components/content/content-form";
import {
  ContentDetailScreen,
  ContentLinkRow,
  ContentStageControl,
} from "@/components/content/content-view";
import { IconContent, IconEdit, IconPlus, IconTrash } from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/modal";
import { Button, ProgressBar, cx } from "@/components/ui/primitives";
import {
  canDeleteContentEntry,
  canEditContentEntry,
  canWriteContent,
  isAssignee,
  isContentTask,
} from "@/lib/permissions";
import { useStore } from "@/lib/store";
import {
  contentLabel,
  contentProgress,
  isContentEmpty,
  type ContentEntry,
  type Project,
  type Task,
} from "@/lib/types";

/*
 * The Content Bank as it appears on a task.
 *
 * On a *content task* this is the whole job: the task says "five reels", and
 * the five pieces already exist as slots ("<task> Count 1" ...), laid out by
 * the database (0026). The writer fills each one in and says where it has got
 * to through its status; anything written beyond the five is an extra, and the
 * count reads "3/5 + 2". The task is submitted and reviewed as a whole.
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

  // The target slots in order, then extras oldest first.
  const entries = db.contentEntries
    .filter((e) => e.taskId === task.id)
    .sort(
      (a, b) =>
        (a.slot ?? Number.MAX_SAFE_INTEGER) - (b.slot ?? Number.MAX_SAFE_INTEGER) ||
        a.createdAt.localeCompare(b.createdAt),
    );
  const reading = readingId ? db.contentEntries.find((e) => e.id === readingId) : undefined;
  const batch = isContentTask(task);
  const progress = contentProgress(task, db.contentEntries);

  /*
   * A designer's own task carries no content of its own - the writer filed it
   * against theirs. What the designer needs is the piece allotted onto this
   * task (0025), so it is listed here for anyone looking at the task. Pieces
   * allotted before 0025 name no task; those still show on every task their
   * holder has on the project, as they always did.
   */
  const allotted = db.contentEntries.filter(
    (e) =>
      e.taskId !== task.id &&
      (e.allottedTaskId === task.id ||
        (!e.allottedTaskId &&
          isAssignee(user, task) &&
          e.projectId === task.projectId &&
          e.allottedTo === user.id)),
  );

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
                ? `· ${progress.label}`
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
            <IconPlus size={13} /> {batch ? "Add extra" : "Write content"}
          </Button>
        ) : null}
      </div>

      {/* The batch at a glance: what was asked for, and how much stands. */}
      {batch ? (
        <div className="mb-3 rounded-card border border-line bg-surface-2 px-3 py-2.5">
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-mono text-[15px] font-semibold text-ink">
              {progress.filled}
              <span className="text-ink-faint">/{progress.target}</span>
              {progress.extras ? (
                <span className="ml-1.5 text-[13px] text-st-submitted">+ {progress.extras}</span>
              ) : null}
            </span>
            <span className="text-[11px] text-ink-faint">
              {progress.filled < progress.target
                ? `${progress.target - progress.filled} without a status`
                : "All have a status"}
              {progress.extras
                ? ` · ${progress.extras} extra${progress.extras === 1 ? "" : "s"}`
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
          {entries.map((e) => (
            <PieceRow
              key={e.id}
              entry={e}
              numbered={batch}
              onRead={() => {
                // An empty slot has nothing to read; its writer goes straight in.
                if (isContentEmpty(e) && canEditContentEntry(user, e)) {
                  setEditing(e);
                  setComposing(true);
                } else {
                  setReadingId(e.id);
                }
              }}
              onEdit={() => {
                setEditing(e);
                setComposing(true);
              }}
              onDelete={() => setDeleting(e)}
            />
          ))}
        </ul>
      )}

      {allotted.length ? (
        <div className="mt-3">
          <h4 className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
            Content allotted to this task
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
  entry,
  numbered,
  onRead,
  onEdit,
  onDelete,
}: {
  entry: ContentEntry;
  numbered: boolean;
  onRead: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { currentUser, userById } = useStore();
  const user = currentUser!;
  const allotted = userById(entry.allottedTo);
  const empty = isContentEmpty(entry);
  const extra = entry.slot === null;

  return (
    <li
      className={cx(
        "rounded-card border px-3 py-2.5",
        empty ? "border-dashed border-line bg-surface" : "border-line-soft bg-surface-2",
      )}
    >
      <div className="flex flex-wrap items-center gap-2.5">
        {numbered ? (
          <span
            title={extra ? "Beyond the count asked for" : undefined}
            className={cx(
              "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold",
              extra ? "bg-st-submitted/15 text-st-submitted" : "bg-surface-3 text-ink-muted",
            )}
          >
            {extra ? "+" : entry.slot}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <button
            onClick={onRead}
            className="block max-w-full truncate text-left text-[13px] font-medium text-ink hover:text-brand-bright"
          >
            {contentLabel(entry)}
          </button>
          <p className="truncate text-[11px] text-ink-faint">
            {empty ? "Not written yet" : entry.type}
            {extra && numbered ? " · extra" : ""}
            {allotted ? ` · for ${allotted.fullName}` : empty ? "" : " · not allotted yet"}
          </p>
        </div>
        <div className="w-44 shrink-0">
          <ContentStageControl entry={entry} />
        </div>
        {canEditContentEntry(user, entry) ? (
          <Button size="sm" aria-label="Edit content" onClick={onEdit}>
            <IconEdit size={13} />
          </Button>
        ) : null}
        {canDeleteContentEntry(user, entry) ? (
          <Button size="sm" variant="danger" aria-label="Delete content" onClick={onDelete}>
            <IconTrash size={13} />
          </Button>
        ) : null}
      </div>
    </li>
  );
}
