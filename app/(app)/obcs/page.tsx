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
  IconTasks,
  IconTrash,
} from "@/components/ui/icons";
import { ConfirmDialog, Drawer, FullScreen, Modal } from "@/components/ui/modal";
import { ButtonLoader } from "@/components/ui/loader";
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
import { RichTextEditor, isRichTextEmpty } from "@/components/ui/rich-text";
import { addDays, addWorkingDays, formatDate, todayISO } from "@/lib/calendar";
import {
  OBC_STATUS_LABEL,
  OBC_STATUS_STYLE,
  PRIORITIES,
  PROJECT_COLORS,
  WORKDAY_HOURS,
} from "@/lib/master-data";
import { canConvertObc, canDeleteCrm, canManageCrm } from "@/lib/permissions";
import { useStore, type ObcInput } from "@/lib/store";
import { OBC_STATUSES, isAllotted, obcProgress } from "@/lib/types";
import type { Obc, ObcItem, ObcService, ObcStatus, Priority } from "@/lib/types";

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
        subtitle="Sales orders raised against a quote — unallotted until a project is raised from one"
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
          label="Unallotted"
          value={db.obcs.filter((o) => o.status === "Submitted").length}
          tone="amber"
        />
        <StatTile
          label="Allotted"
          value={db.obcs.filter((o) => o.status === "Converted").length}
          tone="green"
          icon={<IconProjects size={17} />}
        />
        <StatTile
          label="Services awaiting work"
          value={db.obcs.reduce(
            (n, o) => n + (o.status === "Draft" ? 0 : obcProgress(o.services).pending),
            0,
          )}
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
          {OBC_STATUSES.map((s) => (
            <option key={s} value={s}>
              {OBC_STATUS_LABEL[s]}
            </option>
          ))}
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
                  <th className="px-4 py-2.5 text-left font-medium">Allotment</th>
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
                    <td className="px-4 py-2.5">
                      <AllotmentCell obc={o} />
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge className={OBC_STATUS_STYLE[o.status]}>
                        {OBC_STATUS_LABEL[o.status]}
                      </Badge>
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

/**
 * How much of a quote has become work, which is the question the sales team
 * actually asks of this list. Projects and tasks are counted distinctly
 * because one project usually covers several of the lines sold together, so
 * five services can read as "4 projects, 1 task" or as "1 project" — the
 * second number that matters is how many services are still waiting.
 */
function AllotmentCell({ obc }: { obc: Obc }) {
  const p = obcProgress(obc.services);

  if (p.services === 0) {
    return <span className="text-[12px] text-ink-faint">No services yet</span>;
  }

  const raised = [
    p.projects ? `${p.projects} ${p.projects === 1 ? "project" : "projects"}` : null,
    p.tasks ? `${p.tasks} ${p.tasks === 1 ? "task" : "tasks"}` : null,
  ].filter(Boolean);

  return (
    <div className="min-w-36">
      <div className="text-ink">
        {raised.length ? raised.join(" · ") : <span className="text-ink-faint">Not allotted</span>}
      </div>
      <div className="text-[11px] text-ink-faint">
        {p.allotted} of {p.services} {p.services === 1 ? "service" : "services"}
        {p.pending ? ` · ${p.pending} to go` : ""}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- drawer */

/** Quoted text becomes rich text, so anything angle-bracketed stays literal. */
const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br />");

/** A service's own words, as the rich text a brief is written in. */
const lineBrief = (x: ObcService) =>
  x.description.trim() ? `<p>${escapeHtml(x.description.trim())}</p>` : "";

/** One line of the estimate, read-only: what the client bought. */
function EstimateLine({ item }: { item: ObcItem }) {
  return (
    <li className="rounded-card border border-line-soft bg-surface-2 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-[13px] font-medium text-ink">{item.service}</span>
        <span className="shrink-0 font-mono text-[12px] text-ink-muted">x{item.quantity}</span>
      </div>
      {item.description ? (
        <p className="mt-1 text-[12px] text-ink-muted">{item.description}</p>
      ) : null}
      {item.briefDescription ? (
        <p className="mt-1.5 border-t border-line-soft pt-1.5 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-faint">
          {item.briefDescription}
        </p>
      ) : null}
    </li>
  );
}

/**
 * One service we are going to deliver. Services still waiting are pickable —
 * that selection is what a project or an individual task gets raised from. One
 * already allotted says where it went instead, and cannot be picked again: the
 * counts on the list only mean something while each service is in one place.
 * Deleting the project or task frees it.
 */
function ServiceLine({
  item,
  selectable,
  selected,
  onToggle,
}: {
  item: ObcService;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const { projectById, taskById } = useStore();
  const project = item.projectId ? projectById(item.projectId) : undefined;
  const task = item.taskId ? taskById(item.taskId) : undefined;
  const allotted = isAllotted(item);
  const pickable = selectable && !allotted;

  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-[13px] font-medium text-ink">{item.service}</span>
        <span className="shrink-0 font-mono text-[12px] text-ink-muted">x{item.quantity}</span>
      </div>
      {item.description ? (
        <p className="mt-1 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-muted">
          {item.description}
        </p>
      ) : null}
    </>
  );

  return (
    <li
      className={cx(
        "rounded-card border px-3 py-2.5 transition-colors",
        selected && pickable
          ? "border-brand-bright/50 bg-brand/10"
          : "border-line-soft bg-surface-2",
      )}
    >
      <div className="flex gap-2.5">
        {pickable ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Include ${item.service}`}
            className="mt-1 h-4 w-4 shrink-0 accent-brand-bright"
          />
        ) : null}
        <div className="min-w-0 flex-1">{body}</div>
      </div>

      {allotted ? (
        <div className="mt-2 border-t border-line-soft pt-2 text-[11px]">
          {project ? (
            <Link
              href={`/projects/${project.id}`}
              className="inline-flex items-center gap-1.5 text-brand-bright hover:underline"
            >
              <IconProjects size={12} /> {project.name}
            </Link>
          ) : task ? (
            <Link
              href={`/tasks?type=individual&task=${task.id}`}
              className="inline-flex items-center gap-1.5 text-brand-bright hover:underline"
            >
              <IconTasks size={12} /> {task.title}
            </Link>
          ) : (
            <span className="text-ink-faint">Allotted to work you cannot see</span>
          )}
        </div>
      ) : null}
    </li>
  );
}

type Pane = "details" | "collab";

function ObcDrawer({ obc, onClose }: { obc: Obc; onClose: () => void }) {
  const { db, currentUser, companyById, clientById, propertyById, userById, submitObc } =
    useStore();
  const user = currentUser!;
  const [pane, setPane] = useState<Pane>("details");
  // Which delivery services the next project or task is being raised for. Work
  // is allotted service by service, so this is the whole selection model.
  const [picked, setPicked] = useState<string[]>([]);
  const [convertOpen, setConvertOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);

  // An order usually covers several strands of work, so an OBC can carry more
  // than one project. `obc.projectId` only names the first.
  const projects = db.projects.filter((p) => p.obcId === obc.id);
  const mayRaise = canConvertObc(user) && obc.status !== "Draft";

  const pending = obc.services.filter((x) => !isAllotted(x));
  const progress = obcProgress(obc.services);
  // A selection can go stale if the work it named was deleted in another tab.
  const selected = obc.services.filter((x) => picked.includes(x.id) && !isAllotted(x));

  const toggle = (id: string) =>
    setPicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

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
          <Badge className={OBC_STATUS_STYLE[obc.status]}>
            {OBC_STATUS_LABEL[obc.status]}
          </Badge>
          <Badge>{obc.code}</Badge>
          <Badge>
            {obc.services.length} {obc.services.length === 1 ? "service" : "services"}
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
                <Fact
                  label="Raised by"
                  value={`${userById(obc.createdBy)?.fullName ?? "Unknown"} — ${formatDate(
                    obc.createdAt,
                  )}`}
                />
                <Fact label="Submitted" value={obc.submittedAt ? formatDate(obc.submittedAt) : "—"} />
                <Fact label="Allotted" value={obc.convertedAt ? formatDate(obc.convertedAt) : "—"} />
              </dl>
              {obc.notes ? (
                <p className="mt-3 rounded-lg bg-surface-2 px-2.5 py-2 text-[12px] leading-relaxed text-ink-muted">
                  {obc.notes}
                </p>
              ) : null}
            </Card>

            {obc.items.length ? (
              <section>
                <h3 className="mb-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                  The estimate ({obc.items.length})
                </h3>
                <p className="mb-2 text-[11px] text-ink-faint">
                  What the client bought, straight from Zoho. Work is raised from the
                  services below, not from these lines.
                </p>
                <ul className="flex flex-col gap-2">
                  {obc.items.map((i) => (
                    <EstimateLine key={i.id} item={i} />
                  ))}
                </ul>
              </section>
            ) : null}

            <section>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                  Services to deliver
                </h3>
                <span className="text-[11px] text-ink-faint">
                  {progress.allotted} of {progress.services} allotted
                </span>
                {mayRaise && pending.length > 1 ? (
                  <button
                    onClick={() =>
                      setPicked(
                        selected.length === pending.length ? [] : pending.map((i) => i.id),
                      )
                    }
                    className="ml-auto text-[11px] text-brand-bright hover:underline"
                  >
                    {selected.length === pending.length ? "Clear selection" : "Select all waiting"}
                  </button>
                ) : null}
              </div>

              {obc.services.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[12px] text-ink-faint">
                  No services yet. A Business Development Executive lists what we will
                  deliver on this order before work can be raised from it.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {obc.services.map((x) => (
                    <ServiceLine
                      key={x.id}
                      item={x}
                      selectable={mayRaise}
                      selected={picked.includes(x.id)}
                      onToggle={() => toggle(x.id)}
                    />
                  ))}
                </ul>
              )}

              {/* Straight from the brief to the work that delivers it. */}
              {mayRaise ? (
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Button
                    size="sm"
                    variant={selected.length ? "primary" : "secondary"}
                    disabled={!selected.length}
                    onClick={() => setConvertOpen(true)}
                  >
                    <IconProjects size={12} /> Create project
                  </Button>
                  <Button
                    size="sm"
                    disabled={!selected.length}
                    onClick={() => setTaskOpen(true)}
                  >
                    <IconPlus size={12} /> Create individual task
                  </Button>
                  <span className="text-[11px] text-ink-faint">
                    {selected.length
                      ? `${selected.length} selected`
                      : obc.services.length === 0
                        ? "List the services to deliver first"
                        : pending.length
                          ? "Pick the services this work covers"
                          : "Every service has been allotted"}
                  </span>
                </div>
              ) : null}
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
              {obc.status !== "Draft" && !canConvertObc(user) ? (
                <p className="text-[12px] text-ink-faint">
                  {progress.pending} of {progress.services} services still waiting on a Super
                  Admin, Admin or Manager to raise the work.
                </p>
              ) : null}
            </section>
          </div>
        ) : (
          <CollabPanel entityType="obc" entityId={obc.id} />
        )}
      </div>

      {convertOpen && selected.length ? (
        <ConvertModal
          obc={obc}
          services={selected}
          onClose={() => setConvertOpen(false)}
          onDone={() => {
            setPicked([]);
            // Nothing left to allot means there is nothing more to do here.
            if (selected.length === pending.length) onClose();
          }}
        />
      ) : null}

      {taskOpen && selected.length ? (
        <ObcTaskModal
          obc={obc}
          services={selected}
          onClose={() => setTaskOpen(false)}
          onDone={() => {
            setPicked([]);
            if (selected.length === pending.length) onClose();
          }}
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
 * Raising a project for some of a quote's services.
 *
 * The services picked in the drawer arrive here and stay adjustable: each one
 * contributes its name to the project's services and its own brief, written
 * into a box of its own. Dropping a service here drops its brief with it —
 * which is the whole point of keeping the briefs apart rather than merged into
 * one blob of text nobody can safely unpick afterwards.
 *
 * A template may be chosen too, and contributes *only its tasks*. What the
 * project is about comes from what was sold, never from the template.
 */
function ConvertModal({
  obc,
  services: picked,
  onClose,
  onDone,
}: {
  obc: Obc;
  /** The delivery services this project is being raised for; at least one. */
  services: ObcService[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { db, companyById, clientById, propertyById, convertObc } = useStore();
  const property = propertyById(obc.propertyId);
  const company = companyById(obc.companyId);
  const client = clientById(obc.clientId);

  /** The master-list service a delivery line names, when it names one. */
  const knownService = (line: ObcService) =>
    db.services.find((x) => x.toLowerCase() === line.service.trim().toLowerCase());

  const base = property?.name ?? company?.name ?? obcLabel(obc);
  const [chosen, setChosen] = useState<string[]>(() => picked.map((x) => x.id));
  const [name, setName] = useState(
    picked.length === 1 ? `${base} — ${picked[0].service}` : base,
  );
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [startDate, setStartDate] = useState(todayISO());
  const [deadline, setDeadline] = useState(addDays(todayISO(), 30));
  const [priority, setPriority] = useState<Priority>("Medium");
  const [leaderId, setLeaderId] = useState("");
  const [templateId, setTemplateId] = useState("");

  // Quoted lines become the project's services where their names line up with
  // the master list; anything bespoke is left for the leader to add by hand,
  // which is why this is state rather than derived outright.
  const [services, setServices] = useState<string[]>(() =>
    [...new Set(picked.map(knownService).filter((x): x is string => !!x))],
  );

  /*
   * The brief, kept one box per service. Seeded from what was quoted — not
   * re-typing it is exactly what the Zoho pull exists for — and editable,
   * because what was sold and what the team has to build are rarely word for
   * word the same. Keyed by line id, so an edit survives a service being
   * dropped and picked up again.
   */
  const [briefs, setBriefs] = useState<Record<string, string>>(() =>
    Object.fromEntries(picked.map((x) => [x.id, lineBrief(x)])),
  );
  /** Anything true of the project as a whole rather than of one service. */
  const [notes, setNotes] = useState(() =>
    obc.notes.trim() ? `<p>${escapeHtml(obc.notes.trim())}</p>` : "",
  );

  const [drafts, setDrafts] = useState<TaskDraft[]>([]);
  const [touched, setTouched] = useState(false);
  const [tab, setTab] = useState<ConvertTab>("project");

  const included = picked.filter((x) => chosen.includes(x.id));

  /**
   * Dropping a service takes its service name off the project with it, and its
   * brief stops being written into the description. Done here rather than in an
   * effect so the two can never disagree mid-render.
   */
  const toggleService = (line: ObcService) => {
    const known = knownService(line);
    if (chosen.includes(line.id)) {
      setChosen((ids) => ids.filter((x) => x !== line.id));
      // Only pull the service name if no other included line also covers it.
      if (
        known &&
        !picked.some(
          (o) => o.id !== line.id && chosen.includes(o.id) && knownService(o) === known,
        )
      ) {
        setServices((list) => list.filter((x) => x !== known));
      }
      return;
    }
    setChosen((ids) => [...ids, line.id]);
    if (known) setServices((list) => (list.includes(known) ? list : [...list, known]));
  };

  /** A template brings its tasks and nothing else (see the note above). */
  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = db.projectTemplates.find((x) => x.id === id);
    if (!t) {
      setDrafts([]);
      return;
    }
    setDrafts(
      t.tasks.map((item) => {
        let from = addWorkingDays(startDate, item.startOffsetDays, db.calendar);
        if (from > deadline) from = deadline;
        let to = addWorkingDays(from, item.durationDays, db.calendar);
        if (to > deadline) to = deadline;
        return {
          key: crypto.randomUUID(),
          title: item.title,
          description: item.description,
          department: item.department,
          assigneeId: "",
          priority: item.priority,
          estimatedHours: item.estimatedHours,
          startDate: from,
          dueDate: to,
        };
      }),
    );
    setTab("tasks");
  };

  /** The description as saved: the general note, then each service's brief. */
  const buildDescription = () =>
    [
      notes,
      ...included.map((i) => {
        const body = briefs[i.id] ?? "";
        return isRichTextEmpty(body)
          ? ""
          : `<p><strong>${escapeHtml(i.service)}</strong></p>${body}`;
      }),
    ]
      .filter((part) => part && !isRichTextEmpty(part))
      .join("");

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
  const valid =
    name.trim() &&
    startDate &&
    deadline &&
    deadline >= startDate &&
    !badDraft &&
    included.length > 0;

  const submit = () => {
    setTouched(true);
    if (!valid) {
      // Don't leave the person staring at a valid-looking tab while the error
      // sits on the other one.
      setTab(badDraft && name.trim() ? "tasks" : "project");
      return;
    }
    // Dates are clamped to the project window so a task can never fall outside it.
    const clamp = (iso: string) =>
      iso < startDate ? startDate : iso > deadline ? deadline : iso;

    convertObc(
      obc.id,
      {
        name: name.trim(),
        color,
        clientName: client?.fullName ?? company?.name ?? "",
        services,
        startDate,
        deadline,
        description: buildDescription(),
        status: "Planning",
        priority,
        leaderId: leaderId || null,
        memberIds: [],
        companyId: obc.companyId,
        clientId: obc.clientId,
        propertyId: obc.propertyId,
      },
      included.map((i) => i.id),
      drafts.map((d) => {
        const from = clamp(d.startDate);
        return {
          title: d.title.trim(),
          description: d.description,
          department: d.department,
          assigneeId: d.assigneeId || null,
          priority: d.priority,
          startDate: from,
          dueDate: clamp(d.dueDate < from ? from : d.dueDate),
          estimatedHours: d.estimatedHours,
          tags: [],
        };
      }),
    );

    onClose();
    onDone();
  };

  return (
    /*
     * The whole window, not a dialog on top of the OBC drawer. Converting is a
     * sitting-down job — the brief is read on the right while the project and
     * its first tasks are laid out on the left — and at dialog width the two
     * columns were fighting each other for room.
     */
    <FullScreen
      open
      onClose={onClose}
      title={
        included.length === 1
          ? `Create project for ${included[0].service}`
          : `Create project for ${included.length} services`
      }
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
      <div className="mx-auto grid w-full max-w-[1500px] gap-6 px-4 py-5 sm:px-6 lg:grid-cols-[1.45fr_1fr]">
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
            label="Services this project covers"
            hint="From the order. Unticking one takes its brief off the project too."
            error={
              touched && included.length === 0 ? "Keep at least one service." : undefined
            }
          >
            <ul className="flex flex-col gap-1.5">
              {picked.map((i) => (
                <li key={i.id}>
                  <label
                    className={cx(
                      "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px] transition-colors",
                      chosen.includes(i.id)
                        ? "border-brand-bright/50 bg-brand/10 text-ink"
                        : "border-line bg-surface-2 text-ink-faint",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={chosen.includes(i.id)}
                      onChange={() => toggleService(i)}
                      className="h-4 w-4 shrink-0 accent-brand-bright"
                    />
                    <span className="min-w-0 flex-1 truncate">{i.service}</span>
                    <span className="shrink-0 font-mono text-[11px] text-ink-faint">
                      x{i.quantity}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </Field>

          <Field
            label="Requirements / Services"
            hint="Matched against the master list; add anything bespoke by hand."
          >
            <MultiSelect
              options={db.services.map((s) => ({ value: s, label: s }))}
              value={services}
              onChange={setServices}
              placeholder="Search services…"
            />
          </Field>

          <Field
            label="Project note"
            hint="Anything true of the whole project rather than of one service."
          >
            <RichTextEditor
              value={notes}
              onChange={setNotes}
              minHeight={90}
              placeholder="What this project is, and what done looks like…"
            />
          </Field>

          {included.map((i) => (
            <Field
              key={i.id}
              label={`Brief — ${i.service}`}
              hint="Straight from the quote. Edit it into what the team will build."
            >
              <RichTextEditor
                value={briefs[i.id] ?? ""}
                onChange={(v) => setBriefs((b) => ({ ...b, [i.id]: v }))}
                minHeight={110}
                placeholder={`What "${i.service}" has to deliver…`}
              />
            </Field>
          ))}
          </div>

          <div className={cx("flex-col gap-4", tab === "tasks" ? "flex" : "hidden")}>
          {db.projectTemplates.length ? (
            <Field
              label="Start the tasks from a template"
              hint="Only the template's tasks are used. What the project is about comes from the quote, not the template."
            >
              <SearchSelect
                allowClear
                options={db.projectTemplates.map((t) => ({
                  value: t.id,
                  label: t.name,
                  hint: `${t.tasks.length} task${t.tasks.length === 1 ? "" : "s"}`,
                }))}
                value={templateId}
                onChange={applyTemplate}
                placeholder="No template"
              />
            </Field>
          ) : null}

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
        <aside className="flex flex-col gap-3 lg:sticky lg:top-5 lg:self-start">
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
            Selected services ({included.length} of {obc.services.length})
          </h4>

          {/* Its own scroll, so the quoted lines stay beside the form rather
              than running the page past it. */}
          <ul className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto pr-1 lg:max-h-[calc(100vh-24rem)]">
            {included.map((i) => (
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
                  <p className="mt-1 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-muted">
                    {i.description}
                  </p>
                ) : null}
                {/* Straight from a sold service to the task that delivers it. */}
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

          {obc.items.length ? (
            <details className="rounded-card border border-line-soft bg-surface-2 px-3 py-2.5">
              <summary className="cursor-pointer text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                The estimate ({obc.items.length})
              </summary>
              <ul className="mt-2 flex flex-col gap-2">
                {obc.items.map((i) => (
                  <EstimateLine key={i.id} item={i} />
                ))}
              </ul>
            </details>
          ) : null}

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
    </FullScreen>
  );
}

/**
 * An individual task raised for some of a quote's services.
 *
 * Small pieces of a quote do not deserve a project of their own, so they go
 * straight to one person as an individual task. The work itself is the ordinary
 * task form — same fields, same task templates, and a template prefills the
 * content here exactly as it does anywhere else — it is only seeded from what
 * was sold, and the lines are allotted to it once it exists.
 */
function ObcTaskModal({
  obc,
  services,
  onClose,
  onDone,
}: {
  obc: Obc;
  services: ObcService[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { allotObcServices } = useStore();

  const title =
    services.length === 1
      ? services[0].service
      : `${services[0].service} +${services.length - 1} more`;

  const description = [
    obc.notes.trim() ? `<p>${escapeHtml(obc.notes.trim())}</p>` : "",
    ...services.map((x) => {
      const body = lineBrief(x);
      return body ? `<p><strong>${escapeHtml(x.service)}</strong></p>${body}` : "";
    }),
  ]
    .filter(Boolean)
    .join("");

  return (
    <TaskFormModal
      open
      onClose={onClose}
      project={null}
      mode="individual"
      defaultTitle={title}
      defaultDescription={description}
      onCreated={(task) => {
        allotObcServices(
          obc.id,
          services.map((x) => x.id),
          { kind: "task", taskId: task.id },
        );
        onDone();
      }}
    />
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

/** A service we will deliver, not yet allotted to anything. */
const blankService = (service = "", description = ""): ObcService => ({
  id: crypto.randomUUID(),
  service,
  quantity: 1,
  description,
  projectId: null,
  taskId: null,
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
    services: obc?.services ?? [],
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

  const setService = (id: string, patch: Partial<ObcService>) =>
    set(
      "services",
      form.services.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    );

  /*
   * The estimate is a starting point for the delivery list, not the list
   * itself: three sold lines routinely become ten or twelve services here. This
   * copies across the ones that are not on the list yet, so the common case is
   * one click and then adding the rest by hand.
   */
  const copyFromEstimate = () => {
    const already = new Set(
      form.services.map((x) => x.service.trim().toLowerCase()).filter(Boolean),
    );
    const extra = form.items
      .filter((i) => i.service.trim() && !already.has(i.service.trim().toLowerCase()))
      .map((i) =>
        blankService(
          i.service.trim(),
          [i.description, i.briefDescription].map((t) => t.trim()).filter(Boolean).join("\n\n"),
        ),
      );
    if (extra.length) set("services", [...form.services, ...extra]);
  };

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
  const badService = form.services.some((x) => !x.service.trim());
  // An OBC can be raised before the delivery list is written — that is the
  // Business Development Executive's next job, not a reason to block saving.
  const valid = form.companyId && form.items.length > 0 && !badItem && !badService;

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
                services: form.services.map((x) => ({ ...x, service: x.service.trim() })),
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
              {fetching ? <ButtonLoader /> : <IconSearch size={13} />}
              {fetching ? "Fetching…" : "Fetch quote"}
            </Button>
          </div>

          <p className="mt-2 text-[11px] text-ink-faint">
            Either the record ID or the Quote Number printed on the estimate works — they
            are different numbers and this accepts both. Pulling replaces the estimate
            lines below; the delivery list is left alone.
          </p>
        </section>

        <Field
          label="The estimate"
          required
          hint="What the client bought, and the brief that came with it. Reference only — work is raised from the delivery list below."
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

        <Field
          label="Services to deliver"
          hint="What we will actually do — usually far more lines than the estimate has. A manager raises projects and individual tasks from these."
          error={touched && badService ? "Every service needs a name." : undefined}
        >
          <div className="flex flex-col gap-2">
            {form.services.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[12px] text-ink-faint">
                Nothing listed yet. Nobody can raise work from this OBC until there is.
              </p>
            ) : null}

            {form.services.map((x) => {
              const allotted = isAllotted(x);
              return (
                <div
                  key={x.id}
                  className="rounded-card border border-line-soft bg-surface-2 p-2.5"
                >
                  <div className="grid gap-2 sm:grid-cols-[2fr_0.6fr_auto]">
                    <Input
                      value={x.service}
                      onChange={(e) => setService(x.id, { service: e.target.value })}
                      placeholder="Service we will deliver"
                      aria-label="Service"
                      list="obc-services"
                    />
                    <Input
                      type="number"
                      min="0"
                      value={x.quantity}
                      onChange={(e) =>
                        setService(x.id, { quantity: Number(e.target.value) || 0 })
                      }
                      placeholder="Qty"
                      aria-label="Quantity"
                    />
                    <Button
                      variant="ghost"
                      aria-label="Remove service"
                      // Removing one that already has work behind it would
                      // strand the project or task it was raised for.
                      disabled={allotted}
                      title={allotted ? "Work has been raised for this service" : undefined}
                      onClick={() =>
                        set(
                          "services",
                          form.services.filter((o) => o.id !== x.id),
                        )
                      }
                    >
                      <IconTrash size={14} />
                    </Button>
                  </div>
                  <Textarea
                    className="mt-2"
                    rows={2}
                    value={x.description}
                    onChange={(e) => setService(x.id, { description: e.target.value })}
                    placeholder="What this service has to deliver"
                    aria-label="Service description"
                  />
                  {allotted ? (
                    <p className="mt-1.5 text-[11px] text-ink-faint">
                      Already allotted — editing the name here does not rename the work
                      raised from it.
                    </p>
                  ) : null}
                </div>
              );
            })}

            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" onClick={() => set("services", [...form.services, blankService()])}>
                <IconPlus size={14} /> Add service
              </Button>
              {form.items.some((i) => i.service.trim()) ? (
                <Button size="sm" onClick={copyFromEstimate}>
                  <IconQuote size={14} /> Copy from the estimate
                </Button>
              ) : null}
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
