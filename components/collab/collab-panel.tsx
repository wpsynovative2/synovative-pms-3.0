"use client";

import { useMemo, useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { IconComment, IconMinutes, IconPlus, IconTrash } from "@/components/ui/icons";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Tabs,
  Textarea,
  cx,
} from "@/components/ui/primitives";
import { RichText, RichTextEditor, isRichTextEmpty } from "@/components/ui/rich-text";
import { formatDate, relativeTime, todayISO } from "@/lib/calendar";
import { canDeleteCollabEntry, canEditCollabEntry } from "@/lib/permissions";
import { useStore } from "@/lib/store";
import type { CollabEntity, MeetingMinutes } from "@/lib/types";

/*
 * The collaboration log every module shares: a quick internal comment thread,
 * and the formal minutes of a client meeting. Both hang off any record by its
 * (type, id) pair, so adding them to a new module is one component.
 *
 * Who may write is settled by the record itself — if you can open it, you can
 * add to its log — which is why the caller passes nothing but the record.
 */

/** Highlights @mentions without turning the body into rich text. */
function withMentions(body: string) {
  return body.split(/(@[^\s,.;:]+)/g).map((part, i) =>
    part.startsWith("@") && part.length > 1 ? (
      <span key={i} className="font-medium text-brand-bright">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

type Pane = "comments" | "minutes";

export function CollabPanel({
  entityType,
  entityId,
  /** Hides the comment thread where the deck only calls for minutes. */
  comments = true,
  className,
}: {
  entityType: CollabEntity;
  entityId: string;
  comments?: boolean;
  className?: string;
}) {
  const { db } = useStore();
  const [pane, setPane] = useState<Pane>(comments ? "comments" : "minutes");

  const thread = useMemo(
    () =>
      db.comments
        .filter((c) => c.entityType === entityType && c.entityId === entityId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [db.comments, entityType, entityId],
  );

  const log = useMemo(
    () =>
      db.minutes
        .filter((m) => m.entityType === entityType && m.entityId === entityId)
        .sort((a, b) => b.meetingDate.localeCompare(a.meetingDate)),
    [db.minutes, entityType, entityId],
  );

  return (
    <div className={cx("flex flex-col gap-4", className)}>
      {comments ? (
        <Tabs<Pane>
          active={pane}
          onChange={setPane}
          tabs={[
            {
              id: "comments",
              label: "Comments",
              icon: <IconComment size={14} />,
              count: thread.length,
            },
            {
              id: "minutes",
              label: "Minutes of Meeting",
              icon: <IconMinutes size={14} />,
              count: log.length,
            },
          ]}
        />
      ) : null}

      {pane === "comments" && comments ? (
        <CommentThread entityType={entityType} entityId={entityId} />
      ) : (
        <MinutesLog entityType={entityType} entityId={entityId} entries={log} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------- comments */

function CommentThread({
  entityType,
  entityId,
}: {
  entityType: CollabEntity;
  entityId: string;
}) {
  const { db, currentUser, userById, addComment, deleteComment } = useStore();
  const user = currentUser!;
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const thread = db.comments
    .filter((c) => c.entityType === entityType && c.entityId === entityId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const post = () => {
    if (!draft.trim()) return;
    addComment(entityType, entityId, draft);
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-3">
      {thread.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconComment size={26} />}
            title="No comments yet"
            body="Notes here stay internal — the client never sees them."
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {thread.map((c) => {
            const author = userById(c.createdBy);
            return (
              <li
                key={c.id}
                className="flex gap-2.5 rounded-card border border-line-soft bg-surface-2 px-3 py-2.5"
              >
                <Avatar name={author?.fullName ?? "Unknown"} size={26} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[12px] font-semibold text-ink">
                      {author?.fullName ?? "Unknown"}
                    </span>
                    <span className="text-[11px] text-ink-faint">
                      {relativeTime(c.createdAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-muted">
                    {withMentions(c.body)}
                  </p>
                </div>
                {canDeleteCollabEntry(user, c.createdBy) ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Delete comment"
                    onClick={() => setDeleting(c.id)}
                  >
                    <IconTrash size={13} />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <Textarea
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note for the team… use @name to call someone out."
        />
        <div className="flex justify-end">
          <Button variant="primary" size="sm" disabled={!draft.trim()} onClick={post}>
            Post comment
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteComment(deleting)}
        title="Delete this comment?"
        body="It disappears for everyone on the thread."
      />
    </div>
  );
}

/* -------------------------------------------------------------- minutes */

function MinutesLog({
  entityType,
  entityId,
  entries,
}: {
  entityType: CollabEntity;
  entityId: string;
  entries: MeetingMinutes[];
}) {
  const { currentUser, userById, deleteMinutes } = useStore();
  const user = currentUser!;
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MeetingMinutes | null>(null);
  const [deleting, setDeleting] = useState<MeetingMinutes | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <IconPlus size={14} /> Add minutes
        </Button>
      </div>

      {entries.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconMinutes size={26} />}
            title="No minutes recorded"
            body="Write up what was agreed in a client meeting so the whole team can read it back."
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((m) => {
            const author = userById(m.createdBy);
            return (
              <li key={m.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="text-[14px] font-semibold text-ink">{m.title}</h4>
                      <p className="mt-0.5 text-[11px] text-ink-faint">
                        {formatDate(m.meetingDate)}
                        {m.attendees ? ` · ${m.attendees}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {canEditCollabEntry(user, m.createdBy) ? (
                        <Button
                          size="sm"
                          onClick={() => {
                            setEditing(m);
                            setFormOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                      ) : null}
                      {canDeleteCollabEntry(user, m.createdBy) ? (
                        <Button size="sm" variant="danger" onClick={() => setDeleting(m)}>
                          <IconTrash size={13} />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  <RichText html={m.body} className="mt-3" />
                  <p className="mt-3 border-t border-line-soft pt-2 text-[11px] text-ink-faint">
                    Logged by {author?.fullName ?? "Unknown"} · {relativeTime(m.createdAt)}
                  </p>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {formOpen ? (
        <MinutesForm
          entityType={entityType}
          entityId={entityId}
          minutes={editing}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMinutes(deleting.id)}
        title="Delete these minutes?"
        body="The record is removed from the meeting history for good."
      />
    </div>
  );
}

function MinutesForm({
  entityType,
  entityId,
  minutes,
  onClose,
}: {
  entityType: CollabEntity;
  entityId: string;
  minutes: MeetingMinutes | null;
  onClose: () => void;
}) {
  const { db, saveMinutes } = useStore();
  const [title, setTitle] = useState(minutes?.title ?? "");
  const [meetingDate, setMeetingDate] = useState(minutes?.meetingDate ?? todayISO());
  const [attendees, setAttendees] = useState(minutes?.attendees ?? "");
  const [body, setBody] = useState(minutes?.body ?? "");
  const [touched, setTouched] = useState(false);

  const valid = title.trim() && !isRichTextEmpty(body);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={minutes ? "Edit minutes" : "Minutes of Meeting"}
      subtitle="Kept as a history log against this record"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              saveMinutes(
                {
                  entityType,
                  entityId,
                  title: title.trim(),
                  meetingDate,
                  attendees: attendees.trim(),
                  body,
                },
                minutes?.id,
              );
              onClose();
            }}
          >
            {minutes ? "Save minutes" : "Log minutes"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Meeting title"
            required
            error={touched && !title.trim() ? "Required." : undefined}
          >
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Launch campaign review"
            />
          </Field>
          <Field label="Meeting date" required>
            <DatePicker value={meetingDate} onChange={setMeetingDate} config={db.calendar} allowPast />
          </Field>
        </div>

        <Field label="Attendees" hint="Names as you would write them in an email.">
          <Input
            value={attendees}
            onChange={(e) => setAttendees(e.target.value)}
            placeholder="Ammar, Priya, client's marketing head"
          />
        </Field>

        <Field
          label="Minutes"
          required
          error={touched && isRichTextEmpty(body) ? "Write what was agreed." : undefined}
        >
          <RichTextEditor
            value={body}
            onChange={setBody}
            minHeight={180}
            placeholder="What was discussed, what was agreed, and who owns what next…"
          />
        </Field>
      </div>
    </Modal>
  );
}
