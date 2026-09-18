"use client";

import { useMemo, useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { IconChevronDown, IconPlus, IconTrash } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import {
  Badge,
  Button,
  Field,
  Input,
  Select,
  cx,
} from "@/components/ui/primitives";
import { RichTextEditor, isRichTextEmpty } from "@/components/ui/rich-text";
import { SearchSelect } from "@/components/ui/selects";
import { todayISO } from "@/lib/calendar";
import { useStore, type ContentInput } from "@/lib/store";
import {
  CONTENT_BILLING_TYPES,
  CONTENT_TYPES,
  type ContentBillingType,
  type ContentEntry,
  type ContentType,
} from "@/lib/types";

/*
 * Where a Content Writer actually writes. One task usually carries several
 * pieces — a reel script, three captions, the OOH line — so the composer holds
 * a list of drafts and saves them together rather than making the writer open
 * the same dialog five times.
 *
 * Editing works through the same component with a single draft, so there is
 * one form to keep right.
 */

interface Draft extends ContentInput {
  key: string;
}

const blank = (projectId: string, taskId: string | null): Draft => ({
  key: crypto.randomUUID(),
  projectId,
  taskId,
  date: todayISO(),
  type: "Static Design",
  onPic: "",
  caption: "",
  description: "",
  referenceLinks: [],
  billingType: "Count",
  allottedTo: null,
});

const fromEntry = (entry: ContentEntry): Draft => ({
  key: entry.id,
  projectId: entry.projectId,
  taskId: entry.taskId,
  date: entry.date,
  type: entry.type,
  onPic: entry.onPic,
  caption: entry.caption,
  description: entry.description,
  referenceLinks: entry.referenceLinks,
  billingType: entry.billingType,
  allottedTo: entry.allottedTo,
});

/** A piece needs somewhere to live and something in it. */
const incomplete = (d: Draft) =>
  !d.projectId ||
  (isRichTextEmpty(d.description) && isRichTextEmpty(d.onPic) && !d.caption.trim());

export function ContentComposer({
  /** Fixed when opened from a task; picked in the form otherwise. */
  projectId,
  taskId = null,
  entry,
  onClose,
}: {
  projectId?: string;
  taskId?: string | null;
  entry?: ContentEntry;
  onClose: () => void;
}) {
  const { db, currentUser, createContentEntry, updateContentEntry } = useStore();
  const user = currentUser!;

  // Projects the writer actually works on — the same set they may file against.
  const projectOptions = useMemo(() => {
    const mine = new Set(
      db.tasks.filter((t) => t.assigneeId === user.id && t.projectId).map((t) => t.projectId!),
    );
    return db.projects
      .filter((p) => mine.has(p.id) || p.leaderId === user.id || p.id === projectId)
      .map((p) => ({ value: p.id, label: p.name, hint: p.clientName }));
  }, [db.projects, db.tasks, user.id, projectId]);

  const [drafts, setDrafts] = useState<Draft[]>(() =>
    entry ? [fromEntry(entry)] : [blank(projectId ?? "", taskId)],
  );
  const [open, setOpen] = useState<string>(() =>
    entry ? entry.id : (drafts[0]?.key ?? ""),
  );
  const [touched, setTouched] = useState(false);

  const setDraft = (key: string, patch: Partial<Draft>) =>
    setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const addDraft = () => {
    // A new piece copies where the last one was filed — same project, same
    // task, same day — because that is nearly always right.
    const last = drafts[drafts.length - 1];
    const next: Draft = {
      ...blank(last?.projectId ?? projectId ?? "", last?.taskId ?? taskId),
      date: last?.date ?? todayISO(),
      allottedTo: last?.allottedTo ?? null,
      billingType: last?.billingType ?? "Count",
    };
    setDrafts((list) => [...list, next]);
    setOpen(next.key);
  };

  const valid = drafts.length > 0 && !drafts.some(incomplete);

  const save = () => {
    setTouched(true);
    if (!valid) return;
    for (const d of drafts) {
      const payload: ContentInput = {
        projectId: d.projectId,
        taskId: d.taskId,
        date: d.date,
        type: d.type,
        onPic: d.onPic,
        caption: d.caption.trim(),
        description: d.description,
        referenceLinks: d.referenceLinks.map((l) => l.trim()).filter(Boolean),
        billingType: d.billingType,
        allottedTo: d.allottedTo,
      };
      if (entry) updateContentEntry(entry.id, payload);
      else createContentEntry(payload);
    }
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={entry ? "Edit content" : "Write content"}
      subtitle={
        entry
          ? "Changes reach everyone working on this project"
          : "Add as many pieces as this task needs — they save together"
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            {entry
              ? "Save content"
              : `Save ${drafts.length} ${drafts.length === 1 ? "piece" : "pieces"}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {drafts.map((d, index) => (
          <DraftBlock
            key={d.key}
            draft={d}
            index={index}
            total={drafts.length}
            expanded={open === d.key}
            onToggle={() => setOpen(open === d.key ? "" : d.key)}
            onChange={(patch) => setDraft(d.key, patch)}
            onRemove={
              drafts.length > 1
                ? () => setDrafts((list) => list.filter((x) => x.key !== d.key))
                : undefined
            }
            projectOptions={projectOptions}
            lockProject={!!projectId}
            showError={touched && incomplete(d)}
          />
        ))}

        {entry ? null : (
          <div>
            <Button onClick={addDraft}>
              <IconPlus size={14} /> Add content
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ one draft */

function DraftBlock({
  draft,
  index,
  total,
  expanded,
  onToggle,
  onChange,
  onRemove,
  projectOptions,
  lockProject,
  showError,
}: {
  draft: Draft;
  index: number;
  total: number;
  expanded: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<Draft>) => void;
  onRemove?: () => void;
  projectOptions: { value: string; label: string; hint?: string }[];
  lockProject: boolean;
  showError: boolean;
}) {
  const { db, projectById } = useStore();

  // Allotment is offered to the people already on that project, since the
  // piece is handed to whoever will make the creative from it.
  const people = useMemo(() => {
    const project = projectById(draft.projectId);
    const ids = new Set<string>(project?.memberIds ?? []);
    if (project?.leaderId) ids.add(project.leaderId);
    for (const t of db.tasks) {
      if (t.projectId === draft.projectId && t.assigneeId) ids.add(t.assigneeId);
    }
    return db.users
      .filter((u) => u.active && ids.has(u.id))
      .map((u) => ({ value: u.id, label: u.fullName, avatarName: u.fullName }));
  }, [db.tasks, db.users, draft.projectId, projectById]);

  const setLink = (i: number, value: string) =>
    onChange({
      referenceLinks: draft.referenceLinks.map((l, at) => (at === i ? value : l)),
    });

  return (
    <section
      className={cx(
        "rounded-card border bg-surface-2",
        showError ? "border-st-rejected/50" : "border-line-soft",
      )}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left"
        aria-expanded={expanded}
      >
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[11px] font-semibold text-brand-ink">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ink">
            {draft.caption.trim() || draft.type}
          </span>
          {total > 1 ? (
            <span className="block text-[11px] text-ink-faint">
              {draft.type} · {draft.billingType}
            </span>
          ) : null}
        </span>
        {showError ? (
          <Badge className="border-st-rejected/30 bg-st-rejected/15 text-st-rejected">
            Needs content
          </Badge>
        ) : null}
        <IconChevronDown
          size={15}
          className={cx("shrink-0 text-ink-faint transition-transform", expanded && "rotate-180")}
        />
      </button>

      {expanded ? (
        <div className="flex flex-col gap-4 border-t border-line-soft px-3.5 py-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Date" required>
              <DatePicker
                value={draft.date}
                onChange={(v) => onChange({ date: v })}
                config={db.calendar}
                allowPast
              />
            </Field>
            <Field label="CB type" required>
              <Select
                value={draft.type}
                onChange={(e) => onChange({ type: e.target.value as ContentType })}
              >
                {CONTENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Billing type" hint="Counted against the retainer, or billed extra.">
              <Select
                value={draft.billingType}
                onChange={(e) =>
                  onChange({ billingType: e.target.value as ContentBillingType })
                }
              >
                {CONTENT_BILLING_TYPES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {lockProject ? null : (
            <Field label="Project" required>
              <SearchSelect
                options={projectOptions}
                value={draft.projectId}
                onChange={(v) => onChange({ projectId: v, allottedTo: null })}
                placeholder="Which project is this for?"
              />
            </Field>
          )}

          <Field label="On pic" hint="The words that appear on the creative itself.">
            <RichTextEditor
              value={draft.onPic}
              onChange={(v) => onChange({ onPic: v })}
              minHeight={80}
              placeholder="Headline, sub-line, offer strip…"
            />
          </Field>

          <Field label="Caption">
            <Input
              value={draft.caption}
              onChange={(e) => onChange({ caption: e.target.value })}
              placeholder="The caption that goes with the post"
            />
          </Field>

          <Field
            label="Content description"
            hint="The brief, the script or the body copy — whatever the team needs to build this."
          >
            <RichTextEditor
              value={draft.description}
              onChange={(v) => onChange({ description: v })}
              minHeight={140}
              placeholder="Write the content here…"
            />
          </Field>

          <Field label="Reference links" hint="Moodboards, competitor posts, the client's mail.">
            <div className="flex flex-col gap-2">
              {draft.referenceLinks.map((link, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={link}
                    onChange={(e) => setLink(i, e.target.value)}
                    placeholder="https://…"
                    aria-label={`Reference link ${i + 1}`}
                  />
                  <Button
                    variant="ghost"
                    aria-label="Remove link"
                    onClick={() =>
                      onChange({
                        referenceLinks: draft.referenceLinks.filter((_, at) => at !== i),
                      })
                    }
                  >
                    <IconTrash size={14} />
                  </Button>
                </div>
              ))}
              <div>
                <Button
                  size="sm"
                  onClick={() => onChange({ referenceLinks: [...draft.referenceLinks, ""] })}
                >
                  <IconPlus size={14} /> Add link
                </Button>
              </div>
            </div>
          </Field>

          <Field
            label="Allotment to"
            hint={
              people.length
                ? "The team member who will build this."
                : "Nobody is on this project yet."
            }
          >
            <SearchSelect
              allowClear
              disabled={!people.length}
              options={people}
              value={draft.allottedTo ?? ""}
              onChange={(v) => onChange({ allottedTo: v || null })}
              placeholder="Nobody yet"
            />
          </Field>

          {onRemove ? (
            <div className="flex justify-end border-t border-line-soft pt-3">
              <Button variant="danger" size="sm" onClick={onRemove}>
                <IconTrash size={13} /> Remove this piece
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
