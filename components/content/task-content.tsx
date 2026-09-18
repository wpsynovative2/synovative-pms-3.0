"use client";

import { useState } from "react";
import { ContentComposer } from "@/components/content/content-form";
import { ContentDetail, ContentLinkRow } from "@/components/content/content-view";
import { IconContent, IconEdit, IconPlus, IconTrash } from "@/components/ui/icons";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/primitives";
import {
  canDeleteContentEntry,
  canEditContentEntry,
  canWriteContent,
  isAssignee,
} from "@/lib/permissions";
import { useStore } from "@/lib/store";
import type { ContentEntry, Project, Task } from "@/lib/types";

/*
 * The Content Bank as it appears on a task.
 *
 * A Content Writer working the task writes here — as many pieces as the task
 * calls for. Everyone else on the project sees those pieces as links and reads
 * them; nobody outside the project sees the task at all, so the deck's "no
 * link shown" case is handled by task visibility rather than by this component.
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
  const [reading, setReading] = useState<ContentEntry | null>(null);
  const [deleting, setDeleting] = useState<ContentEntry | null>(null);

  const entries = db.contentEntries.filter((e) => e.taskId === task.id);

  /*
   * A designer's own task carries no content of its own — the writer filed it
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
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
          <IconContent size={14} /> Content
          {entries.length ? (
            <span className="text-ink-faint">
              · {entries.length} {entries.length === 1 ? "piece" : "pieces"}
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
            <IconPlus size={13} /> Write content
          </Button>
        ) : null}
      </div>

      {entries.length === 0 ? (
        // Only the writer needs telling their task is still empty; for everyone
        // else the section is here for the piece allotted to them.
        mayWrite ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[12px] text-ink-faint">
            Nothing written for this task yet.
          </p>
        ) : null
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-1.5">
              <ContentLinkRow entry={e} onOpen={() => setReading(e)} />
              {canEditContentEntry(user, e) ? (
                <Button
                  size="sm"
                  aria-label="Edit content"
                  onClick={() => {
                    setEditing(e);
                    setComposing(true);
                  }}
                >
                  <IconEdit size={13} />
                </Button>
              ) : null}
              {canDeleteContentEntry(user, e) ? (
                <Button
                  size="sm"
                  variant="danger"
                  aria-label="Delete content"
                  onClick={() => setDeleting(e)}
                >
                  <IconTrash size={13} />
                </Button>
              ) : null}
            </li>
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
                <ContentLinkRow entry={e} onOpen={() => setReading(e)} />
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
        <Modal
          open
          onClose={() => setReading(null)}
          size="lg"
          title={reading.caption.trim() || reading.type}
          subtitle="From the Content Bank"
        >
          <ContentDetail entry={reading} />
        </Modal>
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
