"use client";

import { useMemo, useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { IconContent, IconPlus, IconTrash } from "@/components/ui/icons";
import { FullScreen } from "@/components/ui/modal";
import { Badge, Button, Field, Input, Select, cx } from "@/components/ui/primitives";
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
 * Where a Content Writer actually writes — the whole window, because this is
 * the one screen in the app somebody sits in front of for an hour.
 *
 * One task usually carries several pieces: a reel script, three captions, the
 * OOH line. They are held as a list of drafts and saved together, with the
 * pieces down the left and the piece being written filling the rest. Editing
 * an existing entry runs through the same component with a single draft, so
 * there is one writing surface to keep right.
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
  const { db, currentUser, projectById, createContentEntry, updateContentEntry } = useStore();
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
  const [activeKey, setActiveKey] = useState<string>(() => drafts[0]?.key ?? "");
  const [touched, setTouched] = useState(false);

  const active = drafts.find((d) => d.key === activeKey) ?? drafts[0];

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
    setActiveKey(next.key);
  };

  const removeDraft = (key: string) => {
    const rest = drafts.filter((d) => d.key !== key);
    setDrafts(rest);
    if (activeKey === key) setActiveKey(rest[rest.length - 1]?.key ?? "");
  };

  const unfinished = drafts.filter(incomplete);
  const valid = drafts.length > 0 && unfinished.length === 0;

  const save = () => {
    setTouched(true);
    if (!valid) {
      // Take the writer to the first piece that still needs something.
      setActiveKey(unfinished[0]?.key ?? activeKey);
      return;
    }
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

  const project = projectById(active?.projectId);

  return (
    <FullScreen
      open
      onClose={onClose}
      title={entry ? "Edit content" : "Write content"}
      subtitle={
        project
          ? `${project.name}${project.clientName ? ` · ${project.clientName}` : ""}`
          : "Content Bank"
      }
      footer={
        <>
          {touched && unfinished.length ? (
            <span className="mr-auto text-[12px] text-st-rejected">
              {unfinished.length} {unfinished.length === 1 ? "piece needs" : "pieces need"} something
              written in them.
            </span>
          ) : null}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            {entry
              ? "Save content"
              : `Save ${drafts.length} ${drafts.length === 1 ? "piece" : "pieces"}`}
          </Button>
        </>
      }
    >
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-5 px-4 py-5 lg:flex-row lg:gap-8 sm:px-6">
        {/* ------------------------------------------------- the pieces --- */}
        {entry ? null : (
          <aside className="lg:w-60 lg:shrink-0">
            <h3 className="mb-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
              Pieces ({drafts.length})
            </h3>
            <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
              {drafts.map((d, i) => {
                const needsWork = touched && incomplete(d);
                return (
                  <li key={d.key} className="shrink-0 lg:shrink">
                    <button
                      onClick={() => setActiveKey(d.key)}
                      className={cx(
                        "flex w-full min-w-48 items-center gap-2.5 rounded-card border px-3 py-2 text-left transition-colors lg:min-w-0",
                        d.key === active?.key
                          ? "border-brand-bright/50 bg-brand/10"
                          : needsWork
                            ? "border-st-rejected/40 bg-surface-2"
                            : "border-line-soft bg-surface-2 hover:border-brand-bright/30",
                      )}
                    >
                      <span
                        className={cx(
                          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                          d.key === active?.key
                            ? "bg-brand text-white"
                            : "bg-surface-3 text-ink-muted",
                        )}
                      >
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">
                          {d.caption.trim() || d.type}
                        </span>
                        <span className="block truncate text-[11px] text-ink-faint">
                          {d.billingType}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <Button className="mt-2 w-full" onClick={addDraft}>
              <IconPlus size={14} /> Add content
            </Button>
          </aside>
        )}

        {/* -------------------------------------------------- the piece --- */}
        {active ? (
          <section className="min-w-0 flex-1 pb-6">
            <div className="mx-auto max-w-3xl">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand/15 text-brand-ink">
                  <IconContent size={16} />
                </span>
                <h3 className="text-[15px] font-semibold text-ink">
                  {active.caption.trim() || active.type}
                </h3>
                {touched && incomplete(active) ? (
                  <Badge className="border-st-rejected/30 bg-st-rejected/15 text-st-rejected">
                    Needs content
                  </Badge>
                ) : null}
                {drafts.length > 1 ? (
                  <Button
                    size="sm"
                    variant="danger"
                    className="ml-auto"
                    onClick={() => removeDraft(active.key)}
                  >
                    <IconTrash size={13} /> Remove
                  </Button>
                ) : null}
              </div>

              <div className="flex flex-col gap-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Date" required>
                    <DatePicker
                      value={active.date}
                      onChange={(v) => setDraft(active.key, { date: v })}
                      config={db.calendar}
                      allowPast
                    />
                  </Field>
                  <Field label="CB type" required>
                    <Select
                      value={active.type}
                      onChange={(e) =>
                        setDraft(active.key, { type: e.target.value as ContentType })
                      }
                    >
                      {CONTENT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label="Billing type"
                    hint="Counted against the retainer, or billed extra."
                  >
                    <Select
                      value={active.billingType}
                      onChange={(e) =>
                        setDraft(active.key, {
                          billingType: e.target.value as ContentBillingType,
                        })
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

                {projectId ? null : (
                  <Field label="Project" required>
                    <SearchSelect
                      options={projectOptions}
                      value={active.projectId}
                      onChange={(v) => setDraft(active.key, { projectId: v, allottedTo: null })}
                      placeholder="Which project is this for?"
                    />
                  </Field>
                )}

                <Field label="On pic" hint="The words that appear on the creative itself.">
                  <RichTextEditor
                    value={active.onPic}
                    onChange={(v) => setDraft(active.key, { onPic: v })}
                    minHeight={120}
                    placeholder="Headline, sub-line, offer strip…"
                  />
                </Field>

                <Field label="Caption">
                  <Input
                    value={active.caption}
                    onChange={(e) => setDraft(active.key, { caption: e.target.value })}
                    placeholder="The caption that goes with the post"
                  />
                </Field>

                <Field
                  label="Content description"
                  hint="The brief, the script or the body copy — whatever the team needs to build this."
                >
                  <RichTextEditor
                    value={active.description}
                    onChange={(v) => setDraft(active.key, { description: v })}
                    minHeight={320}
                    placeholder="Write the content here…"
                  />
                </Field>

                <ReferenceLinks
                  links={active.referenceLinks}
                  onChange={(referenceLinks) => setDraft(active.key, { referenceLinks })}
                />

                <Allotment
                  projectId={active.projectId}
                  value={active.allottedTo}
                  onChange={(allottedTo) => setDraft(active.key, { allottedTo })}
                />
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </FullScreen>
  );
}

/* ---------------------------------------------------------------- bits */

function ReferenceLinks({
  links,
  onChange,
}: {
  links: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <Field label="Reference links" hint="Moodboards, competitor posts, the client's mail.">
      <div className="flex flex-col gap-2">
        {links.map((link, i) => (
          <div key={i} className="flex gap-2">
            <Input
              value={link}
              onChange={(e) => onChange(links.map((l, at) => (at === i ? e.target.value : l)))}
              placeholder="https://…"
              aria-label={`Reference link ${i + 1}`}
            />
            <Button
              variant="ghost"
              aria-label="Remove link"
              onClick={() => onChange(links.filter((_, at) => at !== i))}
            >
              <IconTrash size={14} />
            </Button>
          </div>
        ))}
        <div>
          <Button size="sm" onClick={() => onChange([...links, ""])}>
            <IconPlus size={14} /> Add link
          </Button>
        </div>
      </div>
    </Field>
  );
}

/**
 * Who the piece is handed to. The project's own team comes first, because that
 * is the usual answer - but not the only one: the designer or editor who will
 * build the creative often has no task on the project yet, and allotting the
 * content is how they are brought on to it. So the whole active directory is
 * offered, with everyone else listed under their department.
 */
function Allotment({
  projectId,
  value,
  onChange,
}: {
  projectId: string;
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const { db, projectById } = useStore();

  const { people, onProject } = useMemo(() => {
    const project = projectById(projectId);
    const ids = new Set<string>(project?.memberIds ?? []);
    if (project?.leaderId) ids.add(project.leaderId);
    for (const t of db.tasks) {
      if (t.projectId === projectId && t.assigneeId) ids.add(t.assigneeId);
    }
    const active = db.users.filter((u) => u.active);
    const toOption = (u: (typeof active)[number]) => ({
      value: u.id,
      label: u.fullName,
      hint: ids.has(u.id) ? "On this project" : u.departments[0],
      avatarName: u.fullName,
    });
    // On the project first, then everyone else - the list is searchable, so
    // ordering is about what the eye lands on rather than what is reachable.
    return {
      people: [
        ...active.filter((u) => ids.has(u.id)).map(toOption),
        ...active.filter((u) => !ids.has(u.id)).map(toOption),
      ],
      onProject: ids.size,
    };
  }, [db.tasks, db.users, projectId, projectById]);

  return (
    <Field
      label="Allotment to"
      hint={
        onProject
          ? "The team member who will build this — on this project or not."
          : "Nobody is on this project yet; anyone can still be given the piece."
      }
    >
      <SearchSelect
        allowClear
        options={people}
        value={value ?? ""}
        onChange={(v) => onChange(v || null)}
        placeholder="Nobody yet"
      />
    </Field>
  );
}
