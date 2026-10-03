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
import { Button, ProgressBar } from "@/components/ui/primitives";
import {
  canDeleteContentEntry,
  canEditContentEntry,
  canWriteContent,
  isAssignee,
  isContentTask,
} from "@/lib/permissions";
import { useStore } from "@/lib/store";
import { contentProgress, type ContentEntry, type Project, type Task } from "@/lib/types";

/*
 * The Content Bank as it appears on a task.
 *
 * On a *content task* this is the whole job: the task says "five reels", the
 * writer writes five pieces and says where each has got to through its status
 * (the stage - Ready To Move, Design Completed, ...). Pieces are not reviewed
 * one by one any more (0024); the task is submitted and reviewed as a whole.
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
                ? `· ${progress.written} of ${progress.total} written`
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
              {progress.written}
              <span className="text-ink-faint">/{progress.total}</span>
            </span>
            <span className="text-[11px] text-ink-faint">
              {progress.staged} with a status
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
              numbered={batch}
              onRead={() => setReadingId(e.id)}
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
  numbered,
  onRead,
  onEdit,
  onDelete,
}: {
  index: number;
  entry: ContentEntry;
  numbered: boolean;
  onRead: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { currentUser, userById } = useStore();
  const user = currentUser!;
  const allotted = userById(entry.allottedTo);

  return (
    <li className="rounded-card border border-line-soft bg-surface-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        {numbered ? (
          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[10px] font-semibold text-ink-muted">
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
