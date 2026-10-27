"use client";

import { useMemo, useState } from "react";
import { PieceTypesPicker, pieceTypes } from "@/components/content/piece-types";
import { DatePicker, dateUnavailableReason } from "@/components/ui/date-picker";
import { DurationField } from "@/components/ui/duration-field";
import { IconEdit, IconPlus, IconTemplate, IconTrash } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { Avatar, Button, Field, Input, Select, Switch, cx } from "@/components/ui/primitives";
import { RecurrencePicker } from "@/components/ui/recurrence-picker";
import { RichTextEditor } from "@/components/ui/rich-text";
import { ColorPicker, MultiSelect, SearchSelect } from "@/components/ui/selects";
import { addDays, addWorkingDays, formatDate, nextWorkingDay, todayISO } from "@/lib/calendar";
import { projectedAfter } from "@/lib/dependencies";
import {
  CONTENT_WRITER_DEPARTMENT,
  PRIORITIES,
  PROJECT_COLORS,
  PROJECT_STATUSES,
  SMM_SERVICE,
  WORKDAY_HOURS,
} from "@/lib/master-data";
import { canSetRecurrence } from "@/lib/permissions";
import { ruleError, seriesFor } from "@/lib/recurrence";
import { useStore, type NewProjectTaskInput } from "@/lib/store";
import type {
  CalendarConfig,
  ContentType,
  Priority,
  Project,
  ProjectStatus,
  RecurrenceRule,
  TaskKind,
  TitleMonth,
} from "@/lib/types";

/**
 * A task typed straight into the create-project form. For a repeating project
 * these are what every occurrence copies, so it matters that they can be set up
 * with the project rather than afterwards.
 */
interface TaskDraft {
  key: string;
  title: string;
  description: string;
  department: string;
  assigneeId: string;
  priority: Priority;
  estimatedHours: number;
  startDate: string;
  dueDate: string;
  /*
   * A content task is a batch: "five reels" is one task carrying five pieces,
   * each written and given a status on its own. It is fixed once the task
   * exists - pieces hang off it - but freely changeable here, where nothing
   * has been created yet.
   */
  kind: TaskKind;
  /** Content tasks only: how many pieces were asked for. */
  contentCount: number;
  /** Content tasks only: the CB type of each piece, by slot (0015). */
  contentTypes: ContentType[];
  /**
   * Working days from start to due. In a step-by-step project this is all a
   * task after the first is given; its dates follow the chain (0014).
   */
  durationDays: number;
  /**
   * The task above this one that it waits on, outside SBS; "" when it keeps
   * its own dates. Only a standard task listed higher up counts, so a stale
   * key - that task removed or made a content task - simply drops the wait.
   */
  waitsOnKey: string;
}

/** A task waiting on `after` - by SBS or by choice - and its projected dates. */
interface ChainLink {
  after: TaskDraft;
  startDate: string;
  dueDate: string;
}

/**
 * A template's task on this form. A template is a starting point, not a
 * contract — this project's brief is nearly always a little different — so
 * every field stays editable, and a row can be dropped altogether.
 *
 * `startOffsetDays` / `durationDays` are kept so the dates go on tracking the
 * project window as the start date moves (§13). Touching either date by hand
 * pins the row and stops that, because a hand-set date should not be quietly
 * recalculated underneath whoever set it.
 */
interface TemplateDraft extends TaskDraft {
  startOffsetDays: number;
  tags: string[];
  datesPinned: boolean;
}

/** Where a template row sits in the project window, in working days. */
function templateDates(
  item: { startOffsetDays: number; durationDays: number },
  projectStart: string,
  projectDeadline: string,
  calendar: CalendarConfig,
) {
  let startDate = addWorkingDays(projectStart, item.startOffsetDays, calendar);
  if (startDate > projectDeadline) startDate = projectDeadline;
  let dueDate = addWorkingDays(startDate, item.durationDays, calendar);
  if (dueDate > projectDeadline) dueDate = projectDeadline;
  return { startDate, dueDate };
}

/**
 * Both kinds of draft become the same thing once the project exists. A link
 * in a step-by-step chain makes the task wait on the one before it.
 */
const toTaskInput = (
  d: TaskDraft,
  tags: string[] = [],
  link?: ChainLink,
): NewProjectTaskInput => ({
  title: d.title.trim(),
  description: d.description,
  department: d.department,
  assigneeId: d.assigneeId || null,
  priority: d.priority,
  estimatedHours: d.estimatedHours,
  startDate: link?.startDate ?? d.startDate,
  dueDate: link?.dueDate ?? d.dueDate,
  tags,
  kind: d.kind,
  contentCount: d.kind === "content" ? d.contentCount : 0,
  contentTypes: d.kind === "content" ? pieceTypes(d.contentCount, d.contentTypes) : [],
  key: d.key,
  dependsOnKey: link?.after.key,
  durationDays: link ? d.durationDays : undefined,
});

/** Whole working days, never negative, from what was typed. */
const toDays = (value: string) => Math.max(0, Math.trunc(Number(value)) || 0);

/**
 * What a repeat made on `day` would be called: "<name> – October 2026", or a
 * month on. Mirrors occurrence_name() / title_day() (0029), [Month] included.
 */
function titleExample(name: string, day: string, monthsOn: 0 | 1) {
  const [y, m] = day.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1 + monthsOn, 1));
  const month = at.toLocaleString("en-IN", { month: "long", timeZone: "UTC" });
  const year = String(at.getUTCFullYear());
  const base = name.trim() || "Project name";
  return /\[(month|year)\]/i.test(base)
    ? base.replace(/\[month\]/gi, month).replace(/\[year\]/gi, year)
    : `${base} – ${month} ${year}`;
}

/** Stands for a typed client name from before clients were picked from Companies. */
const LEGACY_CLIENT = "__typed__";

interface FormState {
  name: string;
  color: string;
  clientName: string;
  services: string[];
  startDate: string;
  deadline: string;
  description: string;
  status: ProjectStatus;
  priority: Priority;
  leaderId: string;
  memberIds: string[];
  propertyId: string;
  /** The company the work is for; its name is clientName. */
  companyId: string;
  /** The company's contacts this project is for, first one leading. */
  clientIds: string[];
  /** A blueprint's copies are named for this month or the next (0029). */
  titleMonth: TitleMonth;
  /** SBS: standard tasks run one after another (0014). */
  stepByStep: boolean;
}

export function ProjectFormModal({
  open,
  onClose,
  project,
  onCreated,
  recurring = false,
}: {
  open: boolean;
  onClose: () => void;
  project?: Project;
  onCreated?: (p: Project) => void;
  /**
   * Opened from the Recurrence page: this is a repeating blueprint, and the
   * repeat rule is required. Everywhere else a project does not repeat.
   */
  recurring?: boolean;
}) {
  const { db, currentUser, projectById, createProjectWithTasks, updateProject } = useStore();

  const defaultStart = nextWorkingDay(todayISO(), db.calendar);
  const [templateId, setTemplateId] = useState("");
  const [templateDrafts, setTemplateDrafts] = useState<TemplateDraft[]>([]);
  /** Template rows open for editing; collapsed they read as the old summary. */
  const [openRows, setOpenRows] = useState<string[]>([]);

  const [form, setForm] = useState<FormState>({
    name: project?.name ?? "",
    color: project?.color ?? PROJECT_COLORS[0],
    clientName: project?.clientName ?? "",
    services: project?.services ?? [],
    startDate: project?.startDate ?? defaultStart,
    deadline: project?.deadline ?? addDays(defaultStart, 30),
    description: project?.description ?? "",
    status: project?.status ?? "Planning",
    priority: project?.priority ?? "Medium",
    leaderId: project?.leaderId ?? "",
    memberIds: project?.memberIds ?? [],
    propertyId: project?.propertyId ?? "",
    clientIds: project?.clientIds ?? [],
    titleMonth: project?.titleMonth ?? "current",
    stepByStep: project?.stepByStep ?? false,
    // Older projects only carry the typed name; match it to a company if one exists.
    companyId:
      project?.companyId ??
      db.companies.find(
        (c) => c.name.trim().toLowerCase() === project?.clientName.trim().toLowerCase(),
      )?.id ??
      "",
  });
  const [repeat, setRepeat] = useState<RecurrenceRule | null>(
    project?.recurrence?.rule ?? null,
  );
  const [drafts, setDrafts] = useState<TaskDraft[]>([]);
  const [touched, setTouched] = useState(false);

  // Only a blueprint carries the rule (0009); copies and ordinary projects don't.
  const mayRepeat =
    recurring && !!currentUser && canSetRecurrence(currentUser) && !project?.series;
  const seriesSource = project?.series ? projectById(project.series.sourceId) : undefined;
  // A Social Media retainer chooses which month its repeats are named for.
  const askTitleMonth = mayRepeat && form.services.includes(SMM_SERVICE);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const setDraft = (key: string, patch: Partial<TaskDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  /** A new row starts inside the project window, so its dates are always valid. */
  const addDraft = (kind: TaskKind = "standard") =>
    setDrafts((ds) => [
      ...ds,
      {
        key: crypto.randomUUID(),
        title: "",
        description: "",
        // A content task starts with the writers' desk.
        department: kind === "content" ? CONTENT_WRITER_DEPARTMENT : "",
        assigneeId: "",
        priority: form.priority,
        estimatedHours: WORKDAY_HOURS / 2,
        startDate: form.startDate,
        dueDate: form.deadline,
        kind,
        // One piece is the smallest batch that means anything; whoever raises
        // it is expected to set the count actually being written.
        contentCount: kind === "content" ? 1 : 0,
        contentTypes: [],
        durationDays: 1,
        waitsOnKey: "",
      },
    ]);

  const template = db.projectTemplates.find((t) => t.id === templateId);

  // A project raised from an OBC takes its chain from the OBC, and edits to
  // the OBC push it down (updateObc), so the two are never allowed to differ.
  const chainFromObc = !!project?.obcId;

  /*
   * The client is picked from Companies. A project saved before that, whose
   * typed name matches no company, keeps its name as an option of its own so
   * editing it never loses what was there.
   */
  const clientOptions = useMemo(() => {
    const options = [...db.companies]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ value: c.id, label: c.name, hint: c.city || undefined }));
    if (project && !form.companyId && project.clientName.trim()) {
      options.unshift({ value: LEGACY_CLIENT, label: project.clientName, hint: "Not in Companies" });
    }
    return options;
  }, [db.companies, project, form.companyId]);

  const pickClient = (id: string) => {
    if (id === LEGACY_CLIENT) return;
    const company = db.companies.find((c) => c.id === id);
    setForm((f) => {
      const property = db.properties.find((p) => p.id === f.propertyId);
      return {
        ...f,
        companyId: id,
        clientName: company?.name ?? "",
        // A property and its contacts belong to one company; changing it drops a mismatch.
        propertyId: property && property.companyId !== id ? "" : f.propertyId,
        clientIds: f.clientIds.filter(
          (cid) => db.clients.find((x) => x.id === cid)?.companyId === id,
        ),
      };
    });
  };

  // Properties narrow to the chosen company.
  const propertyOptions = useMemo(
    () =>
      db.properties
        .filter((p) => !form.companyId || p.companyId === form.companyId)
        .map((p) => ({
          value: p.id,
          label: p.name,
          hint: db.companies.find((c) => c.id === p.companyId)?.name,
        })),
    [db.properties, db.companies, form.companyId],
  );

  /**
   * A property implies its company, so picking one sets the company too, and
   * its contacts are offered as the project's clients when none are picked yet.
   */
  const pickProperty = (id: string) => {
    const property = db.properties.find((p) => p.id === id);
    const company = db.companies.find((c) => c.id === property?.companyId);
    setForm((f) => ({
      ...f,
      propertyId: id,
      ...(company ? { companyId: company.id, clientName: company.name } : {}),
      clientIds: (() => {
        const kept = f.clientIds.filter(
          (cid) => !company || db.clients.find((x) => x.id === cid)?.companyId === company.id,
        );
        return kept.length ? kept : (property?.clientIds ?? []);
      })(),
    }));
  };

  // Clients are the chosen company's contacts.
  const clientContactOptions = useMemo(
    () =>
      db.clients
        .filter((c) => c.companyId === form.companyId)
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
        .map((c) => ({
          value: c.id,
          label: c.fullName,
          hint: c.designation || undefined,
          avatarName: c.fullName,
        })),
    [db.clients, form.companyId],
  );

  /** The CRM chain: the company, its property and the contacts picked. */
  const chainFor = (id: string) => {
    const property = db.properties.find((p) => p.id === id);
    return {
      propertyId: property?.id ?? null,
      companyId: property?.companyId ?? (form.companyId || null),
      clientId: form.clientIds[0] ?? null,
      clientIds: form.clientIds,
    };
  };

  const userOptions = useMemo(
    () =>
      db.users
        .filter((u) => u.active)
        .map((u) => ({
          value: u.id,
          label: u.fullName,
          hint: u.departments[0],
          avatarName: u.fullName,
        })),
    [db.users],
  );

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    setOpenRows([]);
    const t = db.projectTemplates.find((x) => x.id === id);
    if (!t) {
      setTemplateDrafts([]);
      return;
    }
    // The template's own length decides the deadline, and its tasks are laid
    // out inside that window before anyone touches them.
    const deadline = addWorkingDays(form.startDate, t.durationDays, db.calendar);
    setForm((f) => ({
      ...f,
      color: t.color,
      services: t.services,
      priority: t.priority,
      description: t.description,
      deadline,
    }));
    setTemplateDrafts(
      t.tasks.map((item) => ({
        key: crypto.randomUUID(),
        title: item.title,
        description: item.description,
        department: item.department,
        assigneeId: "",
        priority: item.priority,
        estimatedHours: item.estimatedHours,
        // A template task may be a content batch, with its count and the
        // type of each piece (0017).
        kind: item.kind,
        contentCount: item.kind === "content" ? item.contentCount : 0,
        contentTypes: item.kind === "content" ? item.contentTypes : [],
        ...templateDates(item, form.startDate, deadline, db.calendar),
        startOffsetDays: item.startOffsetDays,
        durationDays: item.durationDays,
        waitsOnKey: "",
        tags: item.tags,
        datesPinned: false,
      })),
    );
  };

  const setTemplateDraft = (key: string, patch: Partial<TemplateDraft>) =>
    setTemplateDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  /*
   * The template's rows as they currently stand. An unpinned row's dates are
   * worked out from the project window on every render rather than stored, so
   * moving the project start moves them with it - the behaviour the read-only
   * list had - while a row whose dates were set by hand keeps them.
   */
  const resolvedTemplateDrafts = useMemo(
    () =>
      templateDrafts.map((d) =>
        d.datesPinned
          ? d
          : { ...d, ...templateDates(d, form.startDate, form.deadline, db.calendar) },
      ),
    [templateDrafts, form.startDate, form.deadline, db.calendar],
  );

  /** The standard tasks in the order listed, template rows first. */
  const standardDrafts = useMemo(
    () => [...resolvedTemplateDrafts, ...drafts].filter((d) => d.kind === "standard"),
    [resolvedTemplateDrafts, drafts],
  );

  /*
   * Which tasks wait on which. SBS: each standard task after the first waits
   * on the one before it (0014). Otherwise a task waits only where its switch
   * is on, on a task listed above it. Either way it starts the day that one is
   * approved, so here it shows the projection from that one's due date.
   * Content tasks keep their own dates and are never waited on.
   */
  const chain = useMemo(() => {
    const links = new Map<string, ChainLink>();
    standardDrafts.forEach((d, i) => {
      const after = form.stepByStep
        ? standardDrafts[i - 1]
        : standardDrafts.slice(0, i).find((x) => x.key === d.waitsOnKey);
      if (!after) return;
      // Always listed above, so its own projection is already in.
      const afterDue = links.get(after.key)?.dueDate ?? after.dueDate;
      links.set(d.key, { after, ...projectedAfter(afterDue, d.durationDays, db.calendar) });
    });
    return links;
  }, [form.stepByStep, standardDrafts, db.calendar]);

  /**
   * The "Waits on another task" switch and picker for a standard task with
   * one listed above it. Under SBS the order decides, so it isn't offered.
   */
  const waitsOnControls = (d: TaskDraft, update: (patch: Partial<TaskDraft>) => void) => {
    const earlier = standardDrafts.slice(
      0,
      standardDrafts.findIndex((x) => x.key === d.key),
    );
    if (form.stepByStep || d.kind !== "standard" || earlier.length === 0) return null;
    const link = chain.get(d.key);
    return (
      <div className="flex flex-col gap-1.5">
        <Switch
          on={!!link}
          // Starts on the task just above, the usual case; changeable below.
          onChange={(on) => update({ waitsOnKey: on ? earlier[earlier.length - 1].key : "" })}
          label="Waits on another task"
          className="self-start"
        />
        {link ? (
          <SearchSelect
            options={earlier.map((x) => ({
              value: x.key,
              label: x.title.trim() || "Untitled task",
              hint: x.department || "No department",
            }))}
            value={link.after.key}
            onChange={(v) => update({ waitsOnKey: v })}
            placeholder="Pick a task above"
          />
        ) : (
          <p className="text-[11px] text-ink-faint">
            Starts the day the task it waits on is approved, and runs for the days you give it.
          </p>
        )}
      </div>
    );
  };

  /** "After “Brief” is approved · 12 Nov → 18 Nov", for a task in the chain. */
  const chainSummary = (link: ChainLink) => (
    <span className={cx(link.dueDate > form.deadline ? "text-st-rejected" : "text-ink-faint")}>
      After “{link.after.title.trim() || "the task before"}” is approved ·{" "}
      {formatDate(link.startDate)} → {formatDate(link.dueDate)} (projected)
      {link.dueDate > form.deadline ? " · past the project deadline" : ""}
    </span>
  );

  const startBlocked = dateUnavailableReason(form.startDate, {
    config: db.calendar,
    allowPast: !!project,
  });

  const errors = {
    name: !form.name.trim() ? "A project name is required." : undefined,
    clientName: !form.clientName.trim() ? "Pick the company." : undefined,
    // A project raised from an OBC takes whatever the OBC says.
    propertyId: !chainFromObc && !form.propertyId ? "Pick the property." : undefined,
    services: form.services.length === 0 ? "Pick at least one service." : undefined,
    startDate: startBlocked ?? undefined,
    deadline:
      form.deadline < form.startDate
        ? "The deadline must be on or after the start date."
        : undefined,
    repeat: mayRepeat
      ? repeat
        ? ruleError(repeat, form.startDate)
        : "Pick how often it repeats."
      : undefined,
    tasks: drafts.some(
      (d) => !d.title.trim() || !d.department || (d.kind === "content" && d.contentCount < 1),
    )
      ? "Every task needs a title and a department, and a content task at least one piece."
      : undefined,
    templateTasks: templateDrafts.some(
      (d) => !d.title.trim() || !d.department || (d.kind === "content" && d.contentCount < 1),
    )
      ? "Every task needs a title and a department, and a content task at least one piece."
      : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);

  const save = () => {
    setTouched(true);
    if (!valid) return;

    const payload = {
      name: form.name.trim(),
      color: form.color,
      clientName: form.clientName.trim(),
      services: form.services,
      startDate: form.startDate,
      deadline: form.deadline,
      description: form.description,
      status: form.status,
      priority: form.priority,
      leaderId: form.leaderId || null,
      memberIds: form.memberIds,
      stepByStep: form.stepByStep,
      ...(chainFromObc ? {} : chainFor(form.propertyId)),
      ...(mayRepeat
        ? {
            recurrence: seriesFor(project?.recurrence, repeat, form.startDate),
            // Only a Social Media retainer is named ahead; anything else as made.
            titleMonth: askTitleMonth ? form.titleMonth : ("current" as const),
          }
        : {}),
    };

    if (project) {
      updateProject(project.id, payload);
      onClose();
      return;
    }

    // The template's tasks as they now stand, then anything typed in on top.
    // The store clamps every date to the project window.
    const created = createProjectWithTasks({
      project: payload,
      tasks: [
        ...resolvedTemplateDrafts.map((d) => toTaskInput(d, d.tags, chain.get(d.key))),
        ...drafts.map((d) => toTaskInput(d, [], chain.get(d.key))),
      ],
    });

    onClose();
    onCreated?.(created);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        recurring
          ? project
            ? "Edit repeating project"
            : "New repeating project"
          : project
            ? "Edit project"
            : "Create project"
      }
      subtitle={
        recurring
          ? "A blueprint: on each date it repeats, a project with these tasks is created in Projects."
          : project
            ? undefined
            : "Start blank, or pick a template to create the project and its tasks together."
      }
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            {project ? "Save changes" : "Create project"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {!project && db.projectTemplates.length ? (
          <Field
            label="Project template"
            hint="Pre-fills this form; its tasks are created with the project."
          >
            <SearchSelect
              options={db.projectTemplates.map((t) => ({
                value: t.id,
                label: t.name,
                hint: `${t.tasks.length} task${t.tasks.length === 1 ? "" : "s"} · ${t.durationDays} days`,
              }))}
              value={templateId}
              onChange={applyTemplate}
              placeholder="Blank project"
              allowClear
            />
          </Field>
        ) : null}

        <Field label="Project name" required error={touched ? errors.name : undefined}>
          <Input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Lodha Amara — Launch Campaign"
          />
        </Field>

        <div className="grid items-start gap-4 sm:grid-cols-3">
          <Field
            label="Company"
            required
            hint={
              chainFromObc
                ? "Set by the OBC this project was raised from."
                : db.companies.length === 0
                  ? "Add the company under Companies first."
                  : undefined
            }
            error={touched ? errors.clientName : undefined}
          >
            <SearchSelect
              disabled={chainFromObc}
              options={clientOptions}
              value={form.companyId || (form.clientName.trim() ? LEGACY_CLIENT : "")}
              onChange={pickClient}
              placeholder="Select a company"
            />
          </Field>

          <Field
            label="Property"
            required={!chainFromObc}
            hint={
              chainFromObc
                ? "Set by the OBC this project was raised from."
                : form.companyId && propertyOptions.length === 0
                  ? "This company has no properties yet."
                  : "Only the chosen company's properties are listed."
            }
            error={touched ? errors.propertyId : undefined}
          >
            <SearchSelect
              disabled={chainFromObc}
              options={propertyOptions}
              value={form.propertyId}
              onChange={pickProperty}
              placeholder="Select a property"
            />
          </Field>

          <Field
            label="Clients"
            hint={
              chainFromObc
                ? "Set by the OBC this project was raised from."
                : !form.companyId
                  ? "Pick the company first."
                  : clientContactOptions.length === 0
                    ? "This company has no clients yet."
                    : `${form.clientIds.length} selected`
            }
          >
            <MultiSelect
              disabled={chainFromObc || !form.companyId}
              options={clientContactOptions}
              value={form.clientIds}
              onChange={(v) => set("clientIds", v)}
              placeholder="Search clients…"
              emptyLabel="No clients selected"
              maxVisibleChips={3}
            />
          </Field>
        </div>

        <Field label="Project colour" required>
          <ColorPicker
            value={form.color}
            onChange={(v) => set("color", v)}
            presets={PROJECT_COLORS}
          />
        </Field>

        <Field
          label="Requirements / Services"
          required
          hint={`${form.services.length} selected`}
          error={touched ? errors.services : undefined}
        >
          <MultiSelect
            options={db.services.map((s) => ({ value: s, label: s }))}
            value={form.services}
            onChange={(v) => set("services", v)}
            placeholder="Search services…"
            emptyLabel="No services selected yet"
            maxVisibleChips={8}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={recurring ? "First date" : "Start date"}
            required
            hint={recurring ? "The first project is created on this date." : undefined}
            error={touched ? errors.startDate : undefined}
          >
            <DatePicker
              value={form.startDate}
              onChange={(v) => {
                set("startDate", v);
                if (form.deadline < v) set("deadline", v);
              }}
              config={db.calendar}
              allowPast={!!project}
            />
          </Field>

          <Field
            label="Deadline"
            required
            hint="Task dates are constrained to this window."
            error={touched ? errors.deadline : undefined}
          >
            <DatePicker
              value={form.deadline}
              onChange={(v) => set("deadline", v)}
              config={db.calendar}
              min={form.startDate}
              allowPast={!!project}
            />
          </Field>
        </div>

        <div className="flex flex-col gap-1.5">
          <Switch
            on={form.stepByStep}
            onChange={(v) => set("stepByStep", v)}
            label="SBS — step by step"
            className="self-start"
          />
          <p className="text-[11px] leading-relaxed text-ink-faint">
            {project
              ? "Tasks added to this project wait on the last one by default. Tasks already here keep their dates."
              : "Tasks run one after another: the first has its own dates, and each after it starts the day the one before is approved and takes the days you give it. Content tasks keep their own dates."}
          </p>
        </div>

        {mayRepeat ? (
          <Field
            label="Repeat"
            required
            hint={
              repeat
                ? "On each date a project named “<name> – <Month> <Year>” is created with these tasks. Write [Month] and [Year] in the name to place them yourself."
                : undefined
            }
          >
            <RecurrencePicker
              value={repeat}
              onChange={setRepeat}
              anchor={form.startDate}
              config={db.calendar}
              error={touched ? errors.repeat : undefined}
            />
          </Field>
        ) : null}

        {askTitleMonth ? (
          <Field
            label="Title type"
            required
            hint="Which month each repeat is named for. A repeat made in December and named for the upcoming month is January of the next year."
          >
            <Select
              value={form.titleMonth}
              onChange={(e) => set("titleMonth", e.target.value as TitleMonth)}
            >
              <option value="current">
                {titleExample(form.name, form.startDate, 0)} (current month and year)
              </option>
              <option value="upcoming">
                {titleExample(form.name, form.startDate, 1)} (upcoming month)
              </option>
            </Select>
          </Field>
        ) : null}

        {!mayRepeat && project?.series ? (
          <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-ink-faint">
            Repeat #{project.series.index} of{" "}
            <span className="text-ink-muted">{seriesSource?.name ?? "a deleted series"}</span>.
            The repeat rule is edited on the Recurrence page.
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status" required>
            <Select
              value={form.status}
              onChange={(e) => set("status", e.target.value as ProjectStatus)}
            >
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Priority" required>
            <Select
              value={form.priority}
              onChange={(e) => set("priority", e.target.value as Priority)}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="Project Leader"
          hint="Optional — leave it empty until someone takes it on. The leader reviews the project's work and files its expenses."
        >
          <SearchSelect
            options={userOptions}
            value={form.leaderId}
            onChange={(v) => set("leaderId", v)}
            placeholder="Nobody yet"
          />
        </Field>

        <Field
          label="Team Members"
          hint="Optional. A Team Leader added here sees the project straight away and can create and allot its tasks; anyone else sees it once they hold a task in it."
        >
          <MultiSelect
            options={userOptions.filter((o) => o.value !== form.leaderId)}
            value={form.memberIds}
            onChange={(v) => set("memberIds", v)}
            placeholder="Search team members…"
            emptyLabel="No team members added"
          />
        </Field>

        <Field label="Description">
          <RichTextEditor
            value={form.description}
            onChange={(v) => set("description", v)}
            placeholder="Scope, deliverables, anything the team should know…"
          />
        </Field>

        {/*
          * Template tasks get their assignee at creation time (§13) — and now
          * anything else that needs changing for this project. Rows read as the
          * plain summary until one is opened, so a template that needs no edits
          * is still a glance and a dropdown.
          */}
        {template && !project ? (
          <div className="rounded-xl border border-brand-bright/25 bg-brand/8 p-4">
            <div className="mb-3 flex items-center gap-2">
              <IconTemplate size={15} className="text-brand-ink" />
              <span className="text-[13px] font-semibold text-ink">
                Tasks from “{template.name}”
              </span>
              <span className="ml-auto text-[11px] text-ink-faint">
                {templateDrafts.filter((d) => d.assigneeId).length}/{templateDrafts.length}{" "}
                assigned
              </span>
            </div>
            <p className="mb-3 text-[11px] leading-relaxed text-ink-faint">
              Dates are calculated from the project start using working days only, and
              follow it if you move it. Edit any task to change it for this project — the
              template itself is left alone. Tasks you leave unassigned are still created.
            </p>

            {templateDrafts.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[11px] text-ink-faint">
                Every task from this template has been removed. The project will be created
                on its own.
              </p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {resolvedTemplateDrafts.map((d, i) => {
                  const open = openRows.includes(d.key);
                  const label = d.title.trim() || `Task ${i + 1}`;
                  const options = db.users
                    .filter((u) => u.active && u.departments.includes(d.department))
                    .map((u) => ({
                      value: u.id,
                      label: u.fullName,
                      avatarName: u.fullName,
                    }));
                  return (
                    <li key={d.key} className="rounded-lg border border-line bg-surface-2 p-3">
                      <div className="grid gap-2.5 sm:grid-cols-[1.4fr_1fr]">
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-medium text-ink">
                            {label}
                          </div>
                          <div className="mt-0.5 text-[10px] text-ink-faint">
                            {d.kind === "content"
                              ? `Content task · ${d.contentCount} piece${d.contentCount === 1 ? "" : "s"} · `
                              : ""}
                            {d.department || "No department"} · {d.estimatedHours}h ·{" "}
                            {chain.get(d.key) ? (
                              chainSummary(chain.get(d.key)!)
                            ) : (
                              <>
                                {formatDate(d.startDate)} → {formatDate(d.dueDate)}
                                {d.datesPinned ? " · dates set by hand" : ""}
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <div className="min-w-0 flex-1">
                            <SearchSelect
                              options={options}
                              value={d.assigneeId}
                              onChange={(v) => setTemplateDraft(d.key, { assigneeId: v })}
                              placeholder={
                                !d.department
                                  ? "Pick a department first"
                                  : options.length
                                    ? "Assign to…"
                                    : "Nobody in this department"
                              }
                              allowClear
                            />
                          </div>
                          <Button
                            size="sm"
                            variant={open ? "primary" : "secondary"}
                            aria-label={`${open ? "Done editing" : "Edit"} ${label}`}
                            aria-expanded={open}
                            onClick={() =>
                              setOpenRows((keys) =>
                                open ? keys.filter((k) => k !== d.key) : [...keys, d.key],
                              )
                            }
                          >
                            <IconEdit size={13} />
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            aria-label={`Remove ${label}`}
                            onClick={() => {
                              setTemplateDrafts((ds) => ds.filter((x) => x.key !== d.key));
                              setOpenRows((keys) => keys.filter((k) => k !== d.key));
                            }}
                          >
                            <IconTrash size={13} />
                          </Button>
                        </div>
                      </div>

                      {open ? (
                        <div className="mt-3 flex flex-col gap-2.5 border-t border-line-soft pt-3">
                          <Input
                            value={d.title}
                            onChange={(e) => setTemplateDraft(d.key, { title: e.target.value })}
                            placeholder="What needs doing?"
                            aria-label="Task title"
                          />

                          {d.kind === "content" ? (
                            <div className="flex flex-col gap-2">
                              <label className="flex items-center gap-2 text-[12px] text-ink-muted">
                                How many pieces?
                                <span className="w-24">
                                  <Input
                                    type="number"
                                    min="1"
                                    value={d.contentCount ? String(d.contentCount) : ""}
                                    onChange={(e) =>
                                      setTemplateDraft(d.key, {
                                        contentCount: Math.max(
                                          0,
                                          Math.trunc(Number(e.target.value)) || 0,
                                        ),
                                      })
                                    }
                                    aria-label="Pieces in this task"
                                  />
                                </span>
                              </label>
                              <PieceTypesPicker
                                count={d.contentCount}
                                types={d.contentTypes}
                                onChange={(contentTypes) =>
                                  setTemplateDraft(d.key, { contentTypes })
                                }
                              />
                            </div>
                          ) : null}

                          <RichTextEditor
                            value={d.description}
                            onChange={(v) => setTemplateDraft(d.key, { description: v })}
                            minHeight={72}
                            placeholder="Brief, references, deliverable format…"
                          />

                          <div className="grid gap-2.5 sm:grid-cols-2">
                            <SearchSelect
                              options={db.departments.map((x) => ({ value: x, label: x }))}
                              value={d.department}
                              onChange={(v) =>
                                // The assignee comes from the department, so it
                                // can't survive the department changing under it.
                                setTemplateDraft(d.key, { department: v, assigneeId: "" })
                              }
                              placeholder="Department"
                            />
                            <Select
                              value={d.priority}
                              onChange={(e) =>
                                setTemplateDraft(d.key, {
                                  priority: e.target.value as Priority,
                                })
                              }
                              aria-label="Priority"
                            >
                              {PRIORITIES.map((x) => (
                                <option key={x} value={x}>
                                  {x}
                                </option>
                              ))}
                            </Select>
                          </div>

                          {waitsOnControls(d, (patch) => setTemplateDraft(d.key, patch))}

                          {chain.get(d.key) ? (
                            <div className="flex flex-col gap-1.5">
                              <label className="flex items-center gap-2 text-[12px] text-ink-muted">
                                Days to complete
                                <span className="w-24">
                                  <Input
                                    type="number"
                                    min="0"
                                    value={String(d.durationDays)}
                                    onChange={(e) =>
                                      setTemplateDraft(d.key, {
                                        durationDays: toDays(e.target.value),
                                      })
                                    }
                                    aria-label="Working days for this task"
                                  />
                                </span>
                              </label>
                              <p className="text-[11px]">{chainSummary(chain.get(d.key)!)}</p>
                            </div>
                          ) : (
                            <div className="grid gap-2.5 sm:grid-cols-2">
                              <DatePicker
                                value={d.startDate}
                                onChange={(v) =>
                                  setTemplateDraft(d.key, {
                                    startDate: v,
                                    dueDate: d.dueDate < v ? v : d.dueDate,
                                    datesPinned: true,
                                  })
                                }
                                config={db.calendar}
                                min={form.startDate}
                                max={form.deadline}
                                allowPast
                              />
                              <DatePicker
                                value={d.dueDate}
                                onChange={(v) =>
                                  setTemplateDraft(d.key, { dueDate: v, datesPinned: true })
                                }
                                config={db.calendar}
                                min={d.startDate > form.startDate ? d.startDate : form.startDate}
                                max={form.deadline}
                                allowPast
                              />
                            </div>
                          )}

                          <DurationField
                            valueHours={d.estimatedHours}
                            onChange={(h: number | null) =>
                              setTemplateDraft(d.key, {
                                estimatedHours: h ?? WORKDAY_HOURS / 2,
                              })
                            }
                          />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            {touched && errors.templateTasks ? (
              <p className="mt-2 text-[11px] text-st-rejected">{errors.templateTasks}</p>
            ) : null}
          </div>
        ) : null}

        {!project ? (
          <Field
            label="Tasks"
            hint={
              repeat
                ? "These are the tasks every occurrence of this repeating project will copy."
                : "Optional — add the project's tasks now, or later from the project itself."
            }
            error={touched ? errors.tasks : undefined}
          >
            <div className="flex flex-col gap-2.5">
              {drafts.map((d, i) => (
                <div
                  key={d.key}
                  className="rounded-xl border border-line bg-surface-2 p-3"
                >
                  <div className="mb-2.5 flex items-center gap-2">
                    <span className="text-[11px] font-medium text-ink-faint">
                      {d.kind === "content" ? "Content task" : "Task"} {i + 1}
                    </span>
                    <Button
                      size="sm"
                      variant="danger"
                      className="ml-auto"
                      onClick={() =>
                        setDrafts((ds) => ds.filter((x) => x.key !== d.key))
                      }
                      aria-label={`Remove task ${i + 1}`}
                    >
                      <IconTrash size={13} />
                    </Button>
                  </div>

                  <div className="flex flex-col gap-2.5">
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      <Select
                        value={d.kind}
                        onChange={(e) => {
                          const kind = e.target.value as TaskKind;
                          setDraft(d.key, {
                            kind,
                            contentCount: kind === "content" ? Math.max(1, d.contentCount) : 0,
                            ...(kind === "content" && d.department !== CONTENT_WRITER_DEPARTMENT
                              ? { department: CONTENT_WRITER_DEPARTMENT, assigneeId: "" }
                              : {}),
                          });
                        }}
                        aria-label={`Type of task ${i + 1}`}
                      >
                        <option value="standard">Standard task</option>
                        <option value="content">Content task</option>
                      </Select>
                      {d.kind === "content" ? (
                        <Input
                          type="number"
                          min="1"
                          value={d.contentCount ? String(d.contentCount) : ""}
                          onChange={(e) =>
                            setDraft(d.key, {
                              contentCount: Math.max(0, Math.trunc(Number(e.target.value)) || 0),
                            })
                          }
                          placeholder="How many pieces? e.g. 5"
                          aria-label={`Pieces in task ${i + 1}`}
                        />
                      ) : null}
                    </div>

                    {d.kind === "content" ? (
                      <p className="-mt-1 text-[11px] text-ink-faint">
                        The writer drafts each piece in the Content Bank and sets its
                        status; the task is submitted and reviewed as a whole.
                      </p>
                    ) : null}

                    {d.kind === "content" && d.contentCount > 0 ? (
                      <div>
                        <p className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                          CB type of each piece
                        </p>
                        <PieceTypesPicker
                          count={d.contentCount}
                          types={d.contentTypes}
                          onChange={(contentTypes) => setDraft(d.key, { contentTypes })}
                        />
                      </div>
                    ) : null}

                    <Input
                      value={d.title}
                      onChange={(e) => setDraft(d.key, { title: e.target.value })}
                      placeholder="What needs doing?"
                    />

                    <RichTextEditor
                      value={d.description}
                      onChange={(v) => setDraft(d.key, { description: v })}
                      placeholder="Brief, references, deliverable format…"
                    />

                    <div className="grid gap-2.5 sm:grid-cols-2">
                      <SearchSelect
                        options={db.departments.map((x) => ({ value: x, label: x }))}
                        value={d.department}
                        onChange={(v) =>
                          // The assignee comes from the department, so it can't
                          // survive the department changing under it.
                          setDraft(d.key, { department: v, assigneeId: "" })
                        }
                        placeholder="Department"
                      />
                      <SearchSelect
                        options={db.users
                          .filter((u) => u.active && u.departments.includes(d.department))
                          .map((u) => ({
                            value: u.id,
                            label: u.fullName,
                            avatarName: u.fullName,
                          }))}
                        value={d.assigneeId}
                        onChange={(v) => setDraft(d.key, { assigneeId: v })}
                        placeholder="Nobody yet"
                      />
                    </div>

                    {waitsOnControls(d, (patch) => setDraft(d.key, patch))}

                    {chain.get(d.key) ? (
                      <div className="flex flex-col gap-1.5">
                        <label className="flex items-center gap-2 text-[12px] text-ink-muted">
                          Days to complete
                          <span className="w-24">
                            <Input
                              type="number"
                              min="0"
                              value={String(d.durationDays)}
                              onChange={(e) =>
                                setDraft(d.key, { durationDays: toDays(e.target.value) })
                              }
                              aria-label={`Working days for task ${i + 1}`}
                            />
                          </span>
                        </label>
                        <p className="text-[11px]">{chainSummary(chain.get(d.key)!)}</p>
                      </div>
                    ) : (
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        <DatePicker
                          value={d.startDate}
                          onChange={(v) => setDraft(d.key, { startDate: v })}
                          config={db.calendar}
                          min={form.startDate}
                          max={form.deadline}
                          allowPast
                        />
                        <DatePicker
                          value={d.dueDate}
                          onChange={(v) => setDraft(d.key, { dueDate: v })}
                          config={db.calendar}
                          min={d.startDate > form.startDate ? d.startDate : form.startDate}
                          max={form.deadline}
                          allowPast
                        />
                      </div>
                    )}

                    <div className="grid gap-2.5 sm:grid-cols-2">
                      <Select
                        value={d.priority}
                        onChange={(e) =>
                          setDraft(d.key, { priority: e.target.value as Priority })
                        }
                        aria-label="Priority"
                      >
                        {PRIORITIES.map((x) => (
                          <option key={x} value={x}>
                            {x}
                          </option>
                        ))}
                      </Select>
                      <DurationField
                        valueHours={d.estimatedHours}
                        onChange={(h: number | null) =>
                          setDraft(d.key, { estimatedHours: h ?? WORKDAY_HOURS / 2 })
                        }
                      />
                    </div>
                  </div>
                </div>
              ))}

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => addDraft()}>
                  <IconPlus size={14} /> Add task
                </Button>
                <Button onClick={() => addDraft("content")}>
                  <IconPlus size={14} /> Add content task
                </Button>
              </div>
            </div>
          </Field>
        ) : null}

        {form.leaderId ? (
          <p
            className={cx(
              "flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11px] text-ink-faint",
            )}
          >
            <Avatar
              name={db.users.find((u) => u.id === form.leaderId)?.fullName ?? "?"}
              size={18}
            />
            The Project Leader can create tasks in this project, review submissions and
            add expenses — regardless of their global role.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
