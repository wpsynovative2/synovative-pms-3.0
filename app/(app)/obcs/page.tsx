"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CollabPanel } from "@/components/collab/collab-panel";
import { TaskFormModal } from "@/components/task/task-form";
import { DatePicker } from "@/components/ui/date-picker";
import { DurationField } from "@/components/ui/duration-field";
import {
  IconBuilding,
  IconContact,
  IconEdit,
  IconPlus,
  IconProjects,
  IconProperty,
  IconQuote,
  IconSearch,
  IconSend,
  IconTrash,
} from "@/components/ui/icons";
import { ConfirmDialog, Drawer, Modal } from "@/components/ui/modal";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SearchInput,
  Select,
  StatTile,
  Tabs,
  Textarea,
  cx,
} from "@/components/ui/primitives";
import { ColorPicker, MultiSelect, SearchSelect } from "@/components/ui/selects";
import { RichTextEditor } from "@/components/ui/rich-text";
import { addDays, formatDate, todayISO } from "@/lib/calendar";
import {
  OBC_STATUS_STYLE,
  PRIORITIES,
  PROJECT_COLORS,
  WORKDAY_HOURS,
} from "@/lib/master-data";
import {
  canConvertObc,
  canCreateTaskInProject,
  canDeleteCrm,
  canManageCrm,
} from "@/lib/permissions";
import { useStore, type ObcInput } from "@/lib/store";
import type { Obc, ObcItem, ObcStatus, Priority } from "@/lib/types";

/**
 * An OBC goes by the name of the quote behind it — that is what the sales team
 * calls the deal. The generated code is the fallback for one raised by hand.
 */
const obcLabel = (o: Obc) => o.zohoQuoteName.trim() || o.code;

/**
 * Module 4 — the New OBC. A Business Executive raises it against a company,
 * client and property, pulls the quoted services from Zoho, and submits it.
 * A Super Admin, Admin or Manager then turns it into a real project.
 */
export default function ObcsPage() {
  const { db, currentUser, companyById, clientById, propertyById, deleteObc } = useStore();
  const user = currentUser!;
  const params = useSearchParams();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ObcStatus | "all">("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Obc | null>(null);
  const [deleting, setDeleting] = useState<Obc | null>(null);
  const [openId, setOpenId] = useState<string | null>(params.get("obc"));

  const mayManage = canManageCrm(user);
  const noCompanies = db.companies.length === 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return db.obcs.filter((o) => {
      if (status !== "all" && o.status !== status) return false;
      if (!q) return true;
      const company = companyById(o.companyId)?.name ?? "";
      const client = clientById(o.clientId)?.fullName ?? "";
      return (
        obcLabel(o).toLowerCase().includes(q) ||
        o.code.toLowerCase().includes(q) ||
        company.toLowerCase().includes(q) ||
        client.toLowerCase().includes(q) ||
        o.zohoQuoteNumber.toLowerCase().includes(q)
      );
    });
  }, [db.obcs, query, status, companyById, clientById]);

  const open = openId ? db.obcs.find((o) => o.id === openId) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="New OBCs"
        icon={<IconQuote size={20} />}
        subtitle="Sales orders raised against a quote, and converted into projects"
        actions={
          mayManage ? (
            <Button
              variant="primary"
              disabled={noCompanies}
              title={noCompanies ? "Add a company first" : undefined}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <IconPlus size={15} /> Raise OBC
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="OBCs raised"
          value={db.obcs.length}
          tone="brand"
          icon={<IconQuote size={17} />}
        />
        <StatTile
          label="Awaiting conversion"
          value={db.obcs.filter((o) => o.status === "Submitted").length}
          tone="amber"
        />
        <StatTile
          label="Converted"
          value={db.obcs.filter((o) => o.status === "Converted").length}
          tone="green"
          icon={<IconProjects size={17} />}
        />
        <StatTile
          label="Services quoted"
          value={db.obcs.reduce((s, o) => s + o.items.length, 0)}
          tone="neutral"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          className="max-w-md flex-1"
          placeholder="Search by quote name, code, company or client…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          className="w-auto min-w-40"
          value={status}
          onChange={(e) => setStatus(e.target.value as ObcStatus | "all")}
          aria-label="Status"
        >
          <option value="all">Any status</option>
          <option value="Draft">Draft</option>
          <option value="Submitted">Submitted</option>
          <option value="Converted">Converted</option>
        </Select>
      </div>

      {noCompanies ? (
        <Card>
          <EmptyState
            icon={<IconBuilding size={30} />}
            title="No companies yet"
            body="An OBC starts from a company, its client and their property."
            action={
              <Link href="/companies">
                <Button variant="primary">Go to Companies</Button>
              </Link>
            }
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconQuote size={30} />}
            title="No OBCs match"
            body="Raise one when a quote is accepted and the work is ready to start."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-surface-2 text-[11px] tracking-wide text-ink-faint uppercase">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Quote</th>
                  <th className="px-4 py-2.5 text-left font-medium">Company / client</th>
                  <th className="px-4 py-2.5 text-left font-medium">Property</th>
                  <th className="px-4 py-2.5 text-right font-medium">Services</th>
                  <th className="px-4 py-2.5 text-left font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr key={o.id} className="border-t border-line-soft hover:bg-surface-2/60">
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => setOpenId(o.id)}
                        className="max-w-56 truncate font-medium text-ink hover:text-brand-bright"
                      >
                        {obcLabel(o)}
                      </button>
                      <div className="text-[11px] text-ink-faint">
                        {o.code} · {formatDate(o.createdAt)}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="truncate text-ink">
                        {companyById(o.companyId)?.name ?? "—"}
                      </div>
                      <div className="truncate text-[11px] text-ink-faint">
                        {clientById(o.clientId)?.fullName ?? "No client"}
                      </div>
                    </td>
                    <td className="max-w-48 truncate px-4 py-2.5 text-ink-muted">
                      {propertyById(o.propertyId)?.name ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-ink">
                      {o.items.length}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge className={OBC_STATUS_STYLE[o.status]}>{o.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        {mayManage ? (
                          <Button
                            size="sm"
                            onClick={() => {
                              setEditing(o);
                              setFormOpen(true);
                            }}
                          >
                            <IconEdit size={13} />
                          </Button>
                        ) : null}
                        {canDeleteCrm(user) ? (
                          <Button size="sm" variant="danger" onClick={() => setDeleting(o)}>
                            <IconTrash size={13} />
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {formOpen ? (
        <ObcFormModal
          obc={editing}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
        />
      ) : null}

      {open ? <ObcDrawer obc={open} onClose={() => setOpenId(null)} /> : null}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteObc(deleting.id)}
        title={`Delete ${deleting ? obcLabel(deleting) : "this OBC"}?`}
        body={
          deleting && db.projects.some((p) => p.obcId === deleting.id)
            ? `This also deletes ${
                db.projects.filter((p) => p.obcId === deleting.id).length
              } project(s) raised from it, and every task, time log and expense on them. It cannot be undone.`
            : "The sales order and its quoted lines are removed."
        }
        confirmLabel="Delete OBC"
      />
    </div>
  );
}

/* --------------------------------------------------------------- drawer */

type Pane = "details" | "collab";

function ObcDrawer({ obc, onClose }: { obc: Obc; onClose: () => void }) {
  const { db, currentUser, companyById, clientById, propertyById, submitObc } = useStore();
  const user = currentUser!;
  const [pane, setPane] = useState<Pane>("details");
  // The quoted line a new project or task is being raised for, if any.
  const [converting, setConverting] = useState<ObcItem | null>(null);
  const [convertOpen, setConvertOpen] = useState(false);
  const [taskFor, setTaskFor] = useState<ObcItem | null>(null);

  // A quote often covers several strands of work, so an OBC can carry more
  // than one project. `obc.projectId` only names the first.
  const projects = db.projects.filter((p) => p.obcId === obc.id);
  // Tasks raised from a line go to the project the OBC started.
  const mainProject = projects.find((p) => p.id === obc.projectId) ?? projects[0];

  return (
    <Drawer
      open
      onClose={onClose}
      title={obcLabel(obc)}
      subtitle={`${companyById(obc.companyId)?.name ?? "Unknown company"} · ${
        clientById(obc.clientId)?.fullName ?? "No client"
      }`}
      headerExtra={
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge className={OBC_STATUS_STYLE[obc.status]}>{obc.status}</Badge>
          <Badge>{obc.code}</Badge>
          <Badge>
            {obc.items.length} {obc.items.length === 1 ? "service" : "services"}
          </Badge>
          {obc.zohoQuoteNumber ? <Badge>Quote {obc.zohoQuoteNumber}</Badge> : null}
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Tabs<Pane>
          active={pane}
          onChange={setPane}
          tabs={[
            { id: "details", label: "Details" },
            { id: "collab", label: "Comments & MOM" },
          ]}
        />

        {pane === "details" ? (
          <div className="flex flex-col gap-5">
            <Card className="p-4">
              <dl className="grid gap-2.5 text-[12px] sm:grid-cols-2">
                <Fact
                  label="Company"
                  value={companyById(obc.companyId)?.name ?? "—"}
                  icon={<IconBuilding size={13} />}
                />
                <Fact
                  label="Client"
                  value={clientById(obc.clientId)?.fullName ?? "—"}
                  icon={<IconContact size={13} />}
                />
                <Fact
                  label="Property"
                  value={propertyById(obc.propertyId)?.name ?? "—"}
                  icon={<IconProperty size={13} />}
                />
                <Fact label="Zoho quote" value={obc.zohoQuoteNumber || "Entered by hand"} />
                <Fact label="Submitted" value={obc.submittedAt ? formatDate(obc.submittedAt) : "—"} />
                <Fact label="Converted" value={obc.convertedAt ? formatDate(obc.convertedAt) : "—"} />
              </dl>
              {obc.notes ? (
                <p className="mt-3 rounded-lg bg-surface-2 px-2.5 py-2 text-[12px] leading-relaxed text-ink-muted">
                  {obc.notes}
                </p>
              ) : null}
            </Card>

            <section>
              <h3 className="mb-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                Quoted services
              </h3>
              {obc.items.length === 0 ? (
                <p className="text-[12px] text-ink-faint">Nothing quoted yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {obc.items.map((i) => (
                    <li
                      key={i.id}
                      className="rounded-card border border-line-soft bg-surface-2 px-3 py-2.5"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 text-[13px] font-medium text-ink">
                          {i.service}
                        </span>
                        <span className="shrink-0 font-mono text-[12px] text-ink-muted">
                          x{i.quantity}
                        </span>
                      </div>
                      {i.description ? (
                        <p className="mt-1 text-[12px] text-ink-muted">{i.description}</p>
                      ) : null}
                      {i.briefDescription ? (
                        <p className="mt-1.5 border-t border-line-soft pt-1.5 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-faint">
                          {i.briefDescription}
                        </p>
                      ) : null}

                      {/* Straight from the brief to the work that delivers it. */}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {canConvertObc(user) ? (
                          <Button
                            size="sm"
                            onClick={() => {
                              setConverting(i);
                              setConvertOpen(true);
                            }}
                          >
                            <IconProjects size={12} /> Add project for this
                          </Button>
                        ) : null}
                        {mainProject && canCreateTaskInProject(user, mainProject) ? (
                          <Button size="sm" onClick={() => setTaskFor(i)}>
                            <IconPlus size={12} /> Add task for this
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {projects.length ? (
              <section>
                <h3 className="mb-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                  Projects from this OBC ({projects.length})
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {projects.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/projects/${p.id}`}
                        className="flex items-center gap-2 rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-[12px] hover:border-brand-bright/40"
                      >
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: p.color }}
                        />
                        <span className="min-w-0 flex-1 truncate text-ink">{p.name}</span>
                        <span className="shrink-0 text-ink-faint">{p.status}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-4">
              {obc.status === "Draft" && canManageCrm(user) ? (
                <Button variant="primary" onClick={() => submitObc(obc.id)}>
                  <IconSend size={14} /> Submit OBC
                </Button>
              ) : null}
              {obc.status !== "Draft" && canConvertObc(user) ? (
                <Button
                  variant={obc.status === "Submitted" ? "primary" : "secondary"}
                  onClick={() => {
                    setConverting(null);
                    setConvertOpen(true);
                  }}
                >
                  <IconProjects size={14} />
                  {obc.status === "Submitted" ? "Create project from OBC" : "Add another project"}
                </Button>
              ) : null}
              {obc.status === "Submitted" && !canConvertObc(user) ? (
                <p className="text-[12px] text-ink-faint">
                  Waiting on a Super Admin, Admin or Manager to convert this into a project.
                </p>
              ) : null}
            </section>
          </div>
        ) : (
          <CollabPanel entityType="obc" entityId={obc.id} />
        )}
      </div>

      {convertOpen ? (
        <ConvertModal
          obc={obc}
          seed={converting}
          onClose={() => {
            setConvertOpen(false);
            setConverting(null);
          }}
          // Raising an extra project leaves the OBC open; the first conversion
          // is the one that finishes with it.
          onDone={() => {
            if (obc.status === "Submitted") onClose();
          }}
        />
      ) : null}

      {taskFor && mainProject ? (
        <TaskFormModal
          open
          onClose={() => setTaskFor(null)}
          project={mainProject}
          mode="project"
          defaultTitle={taskFor.service}
        />
      ) : null}
    </Drawer>
  );
}

function Fact({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[11px] text-ink-faint">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-1.5 break-words text-ink">
        {icon}
        {value}
      </dd>
    </div>
  );
}

/* -------------------------------------------------------------- convert */

type ConvertTab = "project" | "tasks";

/** Quoted text becomes rich text, so anything angle-bracketed stays literal. */
const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br />");

/** A task typed in while converting, before the project exists to hang it on. */
interface TaskDraft {
  key: string;
  title: string;
  /** Rich text, same as a task created on its own. */
  description: string;
  department: string;
  assigneeId: string;
  priority: Priority;
  estimatedHours: number;
  startDate: string;
  dueDate: string;
}

/**
 * Turning an OBC into a project. Everything the OBC already knows — company,
 * client, property and the quoted services — comes across; the manager fills in
 * what a project needs, and lays out the first tasks while the brief is still
 * in front of them, which is why the quoted lines sit alongside the form rather
 * than behind it.
 */
function ConvertModal({
  obc,
  seed,
  onClose,
  onDone,
}: {
  obc: Obc;
  /** Raised from one quoted line: its service names the project and leads its tasks. */
  seed?: ObcItem | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { db, companyById, clientById, propertyById, convertObc, createTask } = useStore();
  const property = propertyById(obc.propertyId);
  const company = companyById(obc.companyId);
  const client = clientById(obc.clientId);

  const base = property?.name ?? company?.name ?? obcLabel(obc);
  const [name, setName] = useState(seed ? `${base} — ${seed.service}` : base);
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [startDate, setStartDate] = useState(todayISO());
  const [deadline, setDeadline] = useState(addDays(todayISO(), 30));
  const [priority, setPriority] = useState<Priority>("Medium");
  const [leaderId, setLeaderId] = useState("");
  // Quoted line items become the project's services where their names line up
  // with the master list; anything bespoke is left for the leader to add.
  const [services, setServices] = useState<string[]>(() =>
    (seed ? [seed] : obc.items)
      .map((i) =>
        db.services.find((s) => s.toLowerCase() === i.service.trim().toLowerCase()),
      )
      .filter((s): s is string => !!s),
  );
  /*
   * The brief the delivery team reads. Seeded from what was quoted, because
   * re-typing it is exactly what the Zoho pull exists to avoid.
   */
  const [description, setDescription] = useState(() => {
    const lines = seed ? [seed] : obc.items;
    const parts = lines.flatMap((i) =>
      [i.description, i.briefDescription].filter((t) => t.trim()),
    );
    const body = [obc.notes.trim(), ...parts].filter(Boolean);
    return body.length ? body.map((t) => `<p>${escapeHtml(t)}</p>`).join("") : "";
  });
  const [drafts, setDrafts] = useState<TaskDraft[]>([]);
  const [touched, setTouched] = useState(false);
  const [tab, setTab] = useState<ConvertTab>("project");

  const setDraft = (key: string, patch: Partial<TaskDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  /** A new row starts inside the project window, so its dates are always valid. */
  const addDraft = (title = "") =>
    setDrafts((ds) => [
      ...ds,
      {
        key: crypto.randomUUID(),
        title,
        description: "",
        department: "",
        assigneeId: "",
        priority,
        estimatedHours: WORKDAY_HOURS / 2,
        startDate,
        dueDate: deadline,
      },
    ]);

  const badDraft = drafts.some((d) => !d.title.trim() || !d.department);
  const valid = name.trim() && startDate && deadline && deadline >= startDate && !badDraft;

  const submit = () => {
    setTouched(true);
    if (!valid) {
      // Don't leave the person staring at a valid-looking tab while the error
      // sits on the other one.
      setTab(badDraft && name.trim() ? "tasks" : "project");
      return;
    }
    const created = convertObc(obc.id, {
      name: name.trim(),
      color,
      clientName: client?.fullName ?? company?.name ?? "",
      services,
      startDate,
      deadline,
      description,
      status: "Planning",
      priority,
      leaderId: leaderId || null,
      memberIds: [],
      companyId: obc.companyId,
      clientId: obc.clientId,
      propertyId: obc.propertyId,
    });

    // Dates are clamped to the project window so a task can never fall outside it.
    const clamp = (iso: string) =>
      iso < startDate ? startDate : iso > deadline ? deadline : iso;
    for (const d of drafts) {
      const from = clamp(d.startDate);
      const to = clamp(d.dueDate < from ? from : d.dueDate);
      createTask({
        projectId: created.id,
        title: d.title.trim(),
        description: d.description,
        department: d.department,
        assigneeId: d.assigneeId || null,
        status: "Not Started",
        priority: d.priority,
        startDate: from,
        dueDate: to,
        estimatedHours: d.estimatedHours,
        tags: [],
      });
    }

    onClose();
    onDone();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={seed ? `Create project for ${seed.service}` : "Create project from OBC"}
      subtitle={`${obcLabel(obc)} · ${company?.name ?? ""}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            {drafts.length
              ? `Create project + ${drafts.length} ${drafts.length === 1 ? "task" : "tasks"}`
              : "Create project"}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
        {/* ------------------------------------------------ the project --- */}
        <div className="flex flex-col gap-4">
          <Tabs<ConvertTab>
            active={tab}
            onChange={setTab}
            tabs={[
              { id: "project", label: "Project" },
              { id: "tasks", label: "Tasks", count: drafts.length },
            ]}
          />

          <div className={cx("flex-col gap-4", tab === "project" ? "flex" : "hidden")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Project name"
              required
              error={touched && !name.trim() ? "Required." : undefined}
            >
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Colour">
              <ColorPicker value={color} onChange={setColor} presets={PROJECT_COLORS} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date" required>
              <DatePicker value={startDate} onChange={setStartDate} config={db.calendar} />
            </Field>
            <Field
              label="Deadline"
              required
              error={touched && deadline < startDate ? "Must fall after the start." : undefined}
            >
              <DatePicker
                value={deadline}
                onChange={setDeadline}
                config={db.calendar}
                min={startDate}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Priority">
              <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Project leader" hint="Can be filled in later.">
              <SearchSelect
                allowClear
                options={db.users
                  .filter((u) => u.active)
                  .map((u) => ({ value: u.id, label: u.fullName, avatarName: u.fullName }))}
                value={leaderId}
                onChange={setLeaderId}
                placeholder="Nobody yet"
              />
            </Field>
          </div>

          <Field
            label="Services"
            hint="Pre-filled from the quoted lines that match a known service."
          >
            <MultiSelect
              options={db.services.map((s) => ({ value: s, label: s }))}
              value={services}
              onChange={setServices}
              placeholder="Search services…"
            />
          </Field>

          <Field
            label="Description"
            hint="Seeded from what was quoted — edit it into the brief the team will work from."
          >
            <RichTextEditor
              value={description}
              onChange={setDescription}
              minHeight={140}
              placeholder="What this project is, and what done looks like…"
            />
          </Field>
          </div>

          <div className={cx("flex-col gap-4", tab === "tasks" ? "flex" : "hidden")}>
          <Field
            label="Tasks"
            hint="Optional — lay out the first tasks now, or later from the project itself."
            error={touched && badDraft ? "Every task needs a title and a department." : undefined}
          >
            <div className="flex flex-col gap-2.5">
              {drafts.map((d, i) => (
                <div key={d.key} className="rounded-xl border border-line bg-surface-2 p-3">
                  <div className="mb-2.5 flex items-center gap-2">
                    <span className="text-[11px] font-medium text-ink-faint">Task {i + 1}</span>
                    <Button
                      size="sm"
                      variant="danger"
                      className="ml-auto"
                      onClick={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
                      aria-label={`Remove task ${i + 1}`}
                    >
                      <IconTrash size={13} />
                    </Button>
                  </div>

                  <div className="flex flex-col gap-2.5">
                    <Input
                      value={d.title}
                      onChange={(e) => setDraft(d.key, { title: e.target.value })}
                      placeholder="What needs doing?"
                    />

                    <RichTextEditor
                      value={d.description}
                      onChange={(v) => setDraft(d.key, { description: v })}
                      minHeight={72}
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

                    <div className="grid gap-2.5 sm:grid-cols-2">
                      <DatePicker
                        value={d.startDate}
                        onChange={(v) => setDraft(d.key, { startDate: v })}
                        config={db.calendar}
                        min={startDate}
                        max={deadline}
                        allowPast
                      />
                      <DatePicker
                        value={d.dueDate}
                        onChange={(v) => setDraft(d.key, { dueDate: v })}
                        config={db.calendar}
                        min={d.startDate > startDate ? d.startDate : startDate}
                        max={deadline}
                        allowPast
                      />
                    </div>

                    <div className="grid gap-2.5 sm:grid-cols-2">
                      <Select
                        value={d.priority}
                        onChange={(e) => setDraft(d.key, { priority: e.target.value as Priority })}
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

              <Button className="self-start" onClick={() => addDraft()}>
                <IconPlus size={14} /> Add task
              </Button>
            </div>
          </Field>
          </div>
        </div>

        {/* --------------------------------------------- the OBC, beside --- */}
        <aside className="flex flex-col gap-3 lg:sticky lg:top-0 lg:self-start">
          <div className="rounded-card border border-line-soft bg-surface-2 px-3 py-2.5">
            <h4 className="text-[12px] font-semibold text-ink">{obcLabel(obc)}</h4>
            <dl className="mt-2 flex flex-col gap-1 text-[12px]">
              <Provenance icon={<IconBuilding size={12} />} value={company?.name} />
              <Provenance icon={<IconContact size={12} />} value={client?.fullName} />
              <Provenance icon={<IconProperty size={12} />} value={property?.name} />
              {obc.zohoQuoteNumber ? (
                <Provenance
                  icon={<IconQuote size={12} />}
                  value={`Quote ${obc.zohoQuoteNumber}`}
                />
              ) : null}
            </dl>
            <p className="mt-2 border-t border-line-soft pt-2 text-[11px] text-ink-faint">
              The project keeps its link to all of these, and back to this OBC.
            </p>
          </div>

          <h4 className="text-[11px] font-medium tracking-wide text-ink-muted uppercase">
            What was quoted ({obc.items.length})
          </h4>

          <ul className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto pr-1">
            {obc.items.map((i) => (
              <li
                key={i.id}
                className="rounded-card border border-line-soft bg-surface-2 px-3 py-2.5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 text-[13px] font-medium text-ink">{i.service}</span>
                  <span className="shrink-0 font-mono text-[12px] text-ink-muted">
                    &times;{i.quantity}
                  </span>
                </div>
                {i.description ? (
                  <p className="mt-1 text-[12px] text-ink-muted">{i.description}</p>
                ) : null}
                {i.briefDescription ? (
                  <p className="mt-1.5 border-t border-line-soft pt-1.5 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-faint">
                    {i.briefDescription}
                  </p>
                ) : null}
                {/* Straight from a quoted line to the task that delivers it. */}
                <Button
                  size="sm"
                  className="mt-2"
                  onClick={() => addDraft(i.service)}
                  title={`Add a task for ${i.service}`}
                >
                  <IconPlus size={12} /> Add task for this
                </Button>
              </li>
            ))}
          </ul>

          {obc.notes ? (
            <div className="rounded-card border border-line-soft bg-surface-2 px-3 py-2.5">
              <h5 className="text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                Notes
              </h5>
              <p className="mt-1 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-muted">
                {obc.notes}
              </p>
            </div>
          ) : null}
        </aside>
      </div>
    </Modal>
  );
}

/** One line of the OBC's provenance in the side panel. */
function Provenance({ icon, value }: { icon: React.ReactNode; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-1.5 text-ink-muted">
      <span className="shrink-0 text-ink-faint">{icon}</span>
      <span className="min-w-0 truncate">{value}</span>
    </div>
  );
}

/* ----------------------------------------------------------------- form */

const blankItem = (): ObcItem => ({
  id: crypto.randomUUID(),
  service: "",
  quantity: 1,
  description: "",
  briefDescription: "",
});

/** What the quote lookup hands back. */
interface QuoteResult {
  quote: { id: string; number: string; subject: string; total: number; stage: string };
  lines: {
    service: string;
    quantity: number;
    description: string;
    briefDescription: string;
  }[];
}

function ObcFormModal({ obc, onClose }: { obc: Obc | null; onClose: () => void }) {
  const { db, showToast, createObc, updateObc } = useStore();
  const [form, setForm] = useState<ObcInput>({
    companyId: obc?.companyId ?? "",
    clientId: obc?.clientId ?? null,
    propertyId: obc?.propertyId ?? null,
    zohoQuoteId: obc?.zohoQuoteId ?? "",
    zohoQuoteNumber: obc?.zohoQuoteNumber ?? "",
    zohoQuoteName: obc?.zohoQuoteName ?? "",
    notes: obc?.notes ?? "",
    items: obc?.items ?? [],
  });
  const [touched, setTouched] = useState(false);
  const [reference, setReference] = useState(obc?.zohoQuoteNumber ?? "");
  const [fetching, setFetching] = useState(false);
  const [fetched, setFetched] = useState<QuoteResult["quote"] | null>(null);

  const set = <K extends keyof ObcInput>(key: K, value: ObcInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const clientOptions = db.clients
    .filter((c) => c.companyId === form.companyId)
    .map((c) => ({ value: c.id, label: c.fullName, hint: c.designation }));

  // Properties narrow to the client where one is chosen, and to the company
  // otherwise — the deck's "filtered by client".
  const propertyOptions = db.properties
    .filter((p) =>
      form.clientId ? p.clientId === form.clientId : p.companyId === form.companyId,
    )
    .map((p) => ({ value: p.id, label: p.name }));

  const setItem = (id: string, patch: Partial<ObcItem>) =>
    set(
      "items",
      form.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    );

  const loadQuote = async () => {
    const ref = reference.trim();
    if (!ref) return;
    setFetching(true);
    try {
      const res = await fetch(`/api/zoho/quotes?ref=${encodeURIComponent(ref)}`);
      const body = (await res.json()) as QuoteResult & { error?: string };
      if (!res.ok) {
        showToast(body.error ?? "Couldn't reach Zoho.");
        return;
      }
      setFetched(body.quote);
      setForm((f) => ({
        ...f,
        zohoQuoteId: body.quote.id,
        zohoQuoteNumber: body.quote.number || ref,
        zohoQuoteName: body.quote.subject,
        items: body.lines.map((l) => ({ id: crypto.randomUUID(), ...l })),
      }));
      showToast(
        `Pulled ${body.lines.length} line${body.lines.length === 1 ? "" : "s"} from ${
          body.quote.subject
        }.`,
        "success",
      );
    } catch {
      showToast("Couldn't reach Zoho.");
    } finally {
      setFetching(false);
    }
  };

  const badItem = form.items.some((i) => !i.service.trim());
  const valid = form.companyId && form.items.length > 0 && !badItem;

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={obc ? `Edit ${obcLabel(obc)}` : "Raise a New OBC"}
      subtitle="Company, client and property, then the services that were quoted"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              const payload: ObcInput = {
                ...form,
                items: form.items.map((i) => ({ ...i, service: i.service.trim() })),
              };
              if (obc) updateObc(obc.id, payload);
              else createObc(payload);
              onClose();
            }}
          >
            {obc ? "Save changes" : "Save as draft"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Company"
            required
            error={touched && !form.companyId ? "Required." : undefined}
          >
            <SearchSelect
              options={db.companies.map((c) => ({ value: c.id, label: c.name, hint: c.city }))}
              value={form.companyId}
              onChange={(v) =>
                setForm((f) => ({ ...f, companyId: v, clientId: null, propertyId: null }))
              }
              placeholder="Select"
            />
          </Field>
          <Field label="Client" hint="Filtered by company.">
            <SearchSelect
              allowClear
              disabled={!form.companyId}
              options={clientOptions}
              value={form.clientId ?? ""}
              onChange={(v) => setForm((f) => ({ ...f, clientId: v || null, propertyId: null }))}
              placeholder="Select"
            />
          </Field>
          <Field label="Property" hint="Filtered by client.">
            <SearchSelect
              allowClear
              disabled={!form.companyId}
              options={propertyOptions}
              value={form.propertyId ?? ""}
              onChange={(v) => set("propertyId", v || null)}
              placeholder="Select"
            />
          </Field>
        </div>

        {/* ---------------------------------------------------- Zoho --- */}
        <section className="rounded-card border border-line-soft bg-surface-2 p-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h4 className="text-[12px] font-semibold text-ink">Zoho CRM quote</h4>
              <p className="text-[11px] text-ink-faint">
                {form.zohoQuoteNumber
                  ? `Pulled from quote ${form.zohoQuoteNumber}${
                      fetched?.subject ? ` — ${fetched.subject}` : ""
                    }.`
                  : "Paste the quote ID or quote number to pull its lines."}
              </p>
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap gap-2">
            <Input
              className="min-w-56 flex-1 font-mono"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void loadQuote();
                }
              }}
              placeholder="588860000019985003"
              aria-label="Zoho quote ID or number"
            />
            <Button disabled={!reference.trim() || fetching} onClick={loadQuote}>
              <IconSearch size={13} />
              {fetching ? "Fetching…" : "Fetch quote"}
            </Button>
          </div>

          <p className="mt-2 text-[11px] text-ink-faint">
            Either the record ID or the Quote Number printed on the quote works — they
            are different numbers and this accepts both. Pulling replaces the lines below.
          </p>
        </section>

        <Field
          label="Quoted services"
          required
          hint="What was sold, and the brief that came with it."
          error={
            touched && form.items.length === 0
              ? "An OBC needs at least one line."
              : touched && badItem
                ? "Every line needs a service."
                : undefined
          }
        >
          <div className="flex flex-col gap-2">
            {form.items.map((i) => (
              <div
                key={i.id}
                className="rounded-card border border-line-soft bg-surface-2 p-2.5"
              >
                <div className="grid gap-2 sm:grid-cols-[2fr_0.6fr_auto]">
                  <Input
                    value={i.service}
                    onChange={(e) => setItem(i.id, { service: e.target.value })}
                    placeholder="Product / service"
                    aria-label="Service"
                    list="obc-services"
                  />
                  <Input
                    type="number"
                    min="0"
                    value={i.quantity}
                    onChange={(e) => setItem(i.id, { quantity: Number(e.target.value) || 0 })}
                    placeholder="Qty"
                    aria-label="Quantity"
                  />
                  <Button
                    variant="ghost"
                    aria-label="Remove line"
                    onClick={() =>
                      set(
                        "items",
                        form.items.filter((x) => x.id !== i.id),
                      )
                    }
                  >
                    <IconTrash size={14} />
                  </Button>
                </div>
                <Input
                  className="mt-2"
                  value={i.description}
                  onChange={(e) => setItem(i.id, { description: e.target.value })}
                  placeholder="Short description"
                  aria-label="Short description"
                />
                <Textarea
                  className="mt-2"
                  rows={3}
                  value={i.briefDescription}
                  onChange={(e) => setItem(i.id, { briefDescription: e.target.value })}
                  placeholder="Brief description — what this deliverable has to contain"
                  aria-label="Brief description"
                />
              </div>
            ))}
            <datalist id="obc-services">
              {db.services.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <div>
              <Button size="sm" onClick={() => set("items", [...form.items, blankItem()])}>
                <IconPlus size={14} /> Add line
              </Button>
            </div>
          </div>
        </Field>

        <Field label="Notes">
          <Textarea
            rows={2}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Anything the delivery team should know before the project starts…"
          />
        </Field>
      </div>
    </Modal>
  );
}
