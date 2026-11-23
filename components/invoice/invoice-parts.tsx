"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ButtonLoader } from "@/components/ui/loader";
import { LEVEL_STYLE } from "@/components/three-d/task-group-card";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconExternal,
  IconInvoice,
  IconRepeat,
  IconTrash,
} from "@/components/ui/icons";
import { ConfirmDialog, Drawer } from "@/components/ui/modal";
import { Popover } from "@/components/ui/popover";
import {
  Badge,
  Button,
  CONTROL_ACTIVE,
  Card,
  EmptyState,
  Field,
  ProgressBar,
  StatTile,
  cx,
} from "@/components/ui/primitives";
import { MultiSelect } from "@/components/ui/selects";
import { FollowUpPanel } from "./follow-ups";
import { formatDate, formatDateTime } from "@/lib/calendar";
import {
  customerSubline,
  formatAge,
  formatMoney,
  invoiceAgeDays,
  type InvoiceGroup,
  type InvoiceGroupKey,
  invoiceStatusLabel,
  invoiceStatusTone,
  readInvoice,
  type ImportResult,
  type InvoiceAddress,
  type InvoiceDetails,
} from "@/lib/invoices";
import { canManageInvoices } from "@/lib/permissions";
import { useStore } from "@/lib/store";
import type { Invoice, InvoiceProjectOption, InvoiceTaskOption } from "@/lib/types";

/*
 * The pieces of the Invoices module (0009) shared by its page and a project's
 * Invoices tab. Everything here reads; what a person changes is what an
 * invoice bills for — any projects and individual tasks (0012) — and its
 * payment follow-ups. Books stays the system of record.
 */

/* --------------------------------------------------------- server calls */

/** Fetch these invoices from Books into the PMS (new ones added, known ones rewritten). */
export async function importInvoices(refs: string[]): Promise<ImportResult[]> {
  const res = await fetch("/api/zoho/invoices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refs }),
  });
  const body = (await res.json().catch(() => null)) as
    | { results?: ImportResult[]; error?: string }
    | null;
  if (!res.ok || !body?.results) throw new Error(body?.error ?? "Couldn't reach Zoho Books.");
  return body.results;
}

/* ------------------------------------- what an invoice can be linked to */

/**
 * Every project and individual task an invoice can be tied to (0012), with
 * their names. Finance and Business Development see few of either in the
 * store, so the names come from invoice_projects() / invoice_tasks() instead.
 */
export function useInvoiceLinkOptions() {
  const { db, invoiceProjects, invoiceTasks, projectById, taskById } = useStore();
  const [loaded, setLoaded] = useState<{
    projects: InvoiceProjectOption[];
    tasks: InvoiceTaskOption[];
    error?: string;
  } | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([invoiceProjects(), invoiceTasks()]).then(
      ([projects, tasks]) => {
        if (live) setLoaded({ projects, tasks });
      },
      (err: unknown) => {
        if (live)
          setLoaded({
            projects: [],
            tasks: [],
            error: err instanceof Error ? err.message : "Couldn't load the projects and tasks.",
          });
      },
    );
    return () => {
      live = false;
    };
  }, [invoiceProjects, invoiceTasks]);

  return useMemo(() => {
    const projectsById = new Map((loaded?.projects ?? []).map((p) => [p.id, p]));
    const tasksById = new Map((loaded?.tasks ?? []).map((t) => [t.id, t]));
    const projectName = (id: string) =>
      projectById(id)?.name ?? projectsById.get(id)?.name ?? "A project you can't see";
    const taskName = (id: string) =>
      taskById(id)?.title ?? tasksById.get(id)?.title ?? "A task you can't see";
    const linksOf = (invoiceId: string) => db.invoiceLinks.filter((l) => l.invoiceId === invoiceId);
    return {
      projects: loaded?.projects ?? [],
      tasks: loaded?.tasks ?? [],
      loading: !loaded,
      error: loaded?.error,
      projectName,
      taskName,
      linksOf,
      /** What an invoice bills for, in words: projects first, then tasks. */
      labelsOf: (invoiceId: string) => {
        const links = linksOf(invoiceId);
        return [
          ...links.filter((l) => l.projectId).map((l) => projectName(l.projectId!)),
          ...links.filter((l) => l.taskId).map((l) => taskName(l.taskId!)),
        ];
      },
    };
  }, [loaded, db.invoiceLinks, projectById, taskById]);
}

export type InvoiceLinkOptions = ReturnType<typeof useInvoiceLinkOptions>;

/* ------------------------------------------------------------ status */

export function InvoiceStatusBadge({ status }: { status: string }) {
  return <Badge className={invoiceStatusTone(status)}>{invoiceStatusLabel(status)}</Badge>;
}

/* ------------------------------------------------------------ refetch */

/** Re-read one invoice from Books, keeping the project it is tied to. */
export function RefetchButton({ invoice, label = false }: { invoice: Invoice; label?: boolean }) {
  const { showToast, refreshInvoices } = useStore();
  const [busy, setBusy] = useState(false);

  const refetch = async () => {
    setBusy(true);
    try {
      const [result] = await importInvoices([invoice.zohoInvoiceId]);
      if (result?.ok) showToast(`${result.number} refetched from Zoho Books.`, "success");
      else showToast(result?.error ?? "Couldn't refetch the invoice.");
      refreshInvoices();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't reach Zoho Books.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      size="sm"
      onClick={refetch}
      disabled={busy}
      aria-label={`Refetch ${invoice.invoiceNumber} from Zoho Books`}
      title="Refetch from Zoho Books"
    >
      {busy ? <ButtonLoader /> : <IconRepeat size={13} />}
      {label ? (busy ? "Refetching…" : "Refetch") : null}
    </Button>
  );
}

/* -------------------------------------------------------------- table */

export function InvoiceTable({
  invoices,
  projects,
  onOpen,
  showProject = true,
}: {
  invoices: Invoice[];
  projects: InvoiceLinkOptions;
  onOpen: (id: string) => void;
  showProject?: boolean;
}) {
  const { currentUser } = useStore();
  const mayManage = canManageInvoices(currentUser!);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[72rem] text-left text-[12px]">
        <thead className="bg-surface-2 text-[10px] tracking-wide text-ink-faint uppercase">
          <tr>
            <th className="px-4 py-2.5 font-medium">Invoice</th>
            <th className="px-4 py-2.5 font-medium">Date</th>
            <th className="px-4 py-2.5 font-medium">Due</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 font-medium">Invoice age</th>
            <th className="px-4 py-2.5 font-medium">Salesperson</th>
            {showProject ? <th className="px-4 py-2.5 font-medium">Linked to</th> : null}
            <th className="px-4 py-2.5 text-right font-medium">Total</th>
            <th className="px-4 py-2.5 text-right font-medium">Balance due</th>
            {mayManage ? <th className="px-4 py-2.5 font-medium"></th> : null}
          </tr>
        </thead>
        <tbody>
          {invoices.map((i) => (
            <InvoiceRow
              key={i.id}
              invoice={i}
              projects={projects}
              onOpen={onOpen}
              showProject={showProject}
              mayManage={mayManage}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------------- group cards */

const GROUP_LEVEL_LABEL: Record<InvoiceGroupKey, string> = {
  display: "Display name",
  company: "Company",
  contact: "Primary contact",
  status: "Status",
};

/**
 * One group of invoices, laid out as a 3D project lays out its groups
 * (LEVEL_STYLE): a violet-edged card whose header names the group and carries
 * its sums, opening onto the group's own table. How much of the group's total
 * has come in is its progress bar.
 */
export function InvoiceGroupCard({
  group,
  groupBy,
  open,
  onToggle,
  projects,
  onOpen,
}: {
  group: InvoiceGroup<Invoice>;
  groupBy: InvoiceGroupKey;
  open: boolean;
  onToggle: () => void;
  projects: InvoiceLinkOptions;
  onOpen: (id: string) => void;
}) {
  const billed = group.invoices.filter((i) => i.status !== "void");
  const total = billed.reduce((sum, i) => sum + i.total, 0);
  const due = billed.reduce((sum, i) => sum + i.balance, 0);
  const collected = total > 0 ? Math.round(((total - due) / total) * 100) : 0;
  const overdue = group.invoices.filter((i) => i.status === "overdue").length;
  const style = LEVEL_STYLE.group;

  return (
    <Card className={style.card}>
      <div className={cx("flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3", style.header)}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-48 flex-1 items-center gap-2 text-left"
        >
          {open ? (
            <IconChevronDown size={15} className="shrink-0 text-ink-faint" />
          ) : (
            <IconChevronRight size={15} className="shrink-0 text-ink-faint" />
          )}
          <span className="flex shrink-0 items-center gap-1.5">
            <span className={cx("rounded-md px-1.5 py-0.5 text-[12px] font-semibold", style.chip)}>
              {group.invoices.length}
            </span>
            <span className={cx("text-[10px] font-semibold tracking-wide uppercase", style.label)}>
              {GROUP_LEVEL_LABEL[groupBy]}
            </span>
          </span>
          <span className="truncate text-sm font-semibold text-ink">{group.label}</span>
          <span className="shrink-0 text-[11px] text-ink-faint">
            {group.invoices.length} invoice{group.invoices.length === 1 ? "" : "s"}
            {overdue ? ` · ${overdue} overdue` : ""}
          </span>
        </button>

        <div className="flex w-36 flex-col gap-1">
          <ProgressBar value={collected} barClassName="bg-st-approved" />
          <span className="text-[10px] text-ink-faint">{collected}% collected</span>
        </div>

        <div className="text-right font-mono text-[12px] leading-tight">
          <div className="text-ink-muted">Total {formatMoney(total)}</div>
          <div className={due > 0 ? "font-medium text-ink" : "text-ink-faint"}>Due {formatMoney(due)}</div>
        </div>
      </div>

      {open ? (
        <div className="border-t border-line-soft">
          <InvoiceTable invoices={group.invoices} projects={projects} onOpen={onOpen} />
        </div>
      ) : null}
    </Card>
  );
}

/* --------------------------------------------------- group by status */

/**
 * Group by status: tick the statuses to group by, and the list shows one
 * group per ticked status, holding only those invoices. None ticked means
 * no status grouping. The page lets one grouping apply at a time.
 */
export function StatusGroupPicker({
  statuses,
  counts,
  value,
  onChange,
}: {
  statuses: string[];
  counts: Map<string, number>;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLButtonElement>(null);
  const label =
    value.length === 0
      ? "Group by status"
      : value.length === 1
        ? `By status: ${invoiceStatusLabel(value[0])}`
        : `By status: ${value.length} statuses`;
  const toggle = (s: string) => onChange(value.includes(s) ? value.filter((x) => x !== s) : [...value, s]);

  return (
    <>
      <button
        ref={boxRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cx(
          "flex h-9.5 w-full items-center justify-between gap-2 rounded-[10px] border px-3 text-left text-[13px] text-ink",
          "focus:border-brand-bright focus:ring-2 focus:ring-brand-bright/25 focus:outline-none",
          value.length ? CONTROL_ACTIVE : "border-line bg-surface-2",
        )}
      >
        <span className="truncate">{label}</span>
        <IconChevronDown size={14} className="shrink-0 text-ink-faint" />
      </button>
      <Popover anchorRef={boxRef} open={open} onClose={() => setOpen(false)} maxHeight={340} className="w-60 rounded-[10px] p-1">
        <div role="listbox" aria-multiselectable="true">
          {statuses.map((s) => {
            const on = value.includes(s);
            return (
              <button
                key={s}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => toggle(s)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-surface-2"
              >
                <span
                  className={cx(
                    "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    on ? "border-brand-bright bg-brand text-on-brand" : "border-line bg-surface",
                  )}
                >
                  {on ? <IconCheck size={11} /> : null}
                </span>
                <span className="flex-1">{invoiceStatusLabel(s)}</span>
                <span className="text-[11px] text-ink-faint">{counts.get(s) ?? 0}</span>
              </button>
            );
          })}
        </div>
        {value.length ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="mt-1 w-full border-t border-line-soft px-2.5 pt-2 pb-1 text-left text-[12px] text-ink-faint hover:text-ink"
          >
            Clear — no status grouping
          </button>
        ) : null}
      </Popover>
    </>
  );
}

function InvoiceRow({
  invoice: i,
  projects,
  onOpen,
  showProject,
  mayManage,
}: {
  invoice: Invoice;
  projects: InvoiceLinkOptions;
  onOpen: (id: string) => void;
  showProject: boolean;
  mayManage: boolean;
}) {
  const age = invoiceAgeDays(i);
  return (
    <tr className="border-t border-line-soft align-top hover:bg-surface-2">
      <td className="px-4 py-3">
        <button
          onClick={() => onOpen(i.id)}
          className="text-left text-[13px] font-semibold text-ink hover:text-brand-bright"
        >
          {i.invoiceNumber || "Unnumbered"}
        </button>
        <div className="max-w-64 truncate text-ink-muted">{i.customerName || "—"}</div>
        {customerSubline(i) ? (
          <div className="max-w-64 truncate text-[11px] text-ink-faint">{customerSubline(i)}</div>
        ) : null}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-ink-muted">{formatDate(i.invoiceDate)}</td>
      <td className="px-4 py-3 whitespace-nowrap text-ink-muted">{formatDate(i.dueDate)}</td>
      <td className="px-4 py-3">
        <InvoiceStatusBadge status={i.status} />
      </td>
      <td
        className={cx(
          "px-4 py-3 whitespace-nowrap",
          // Old and still owed is what Accounts chase first.
          age !== null && age > 90 && i.balance > 0 ? "font-medium text-st-rejected" : "text-ink-muted",
        )}
      >
        {formatAge(age)}
      </td>
      <td className="px-4 py-3">
        <span className="block max-w-36 truncate text-ink-muted">{i.salesperson || "—"}</span>
      </td>
      {showProject ? (
        <td className="px-4 py-3">
          <LinkedLabels labels={projects.labelsOf(i.id)} />
        </td>
      ) : null}
      <td className="px-4 py-3 text-right font-mono whitespace-nowrap text-ink">
        {formatMoney(i.total, i.currencyCode)}
      </td>
      <td
        className={cx(
          "px-4 py-3 text-right font-mono whitespace-nowrap",
          i.balance > 0 ? "text-ink" : "text-ink-faint",
        )}
      >
        {formatMoney(i.balance, i.currencyCode)}
      </td>
      {mayManage ? (
        <td className="px-4 py-3 text-right">
          <RefetchButton invoice={i} />
        </td>
      ) : null}
    </tr>
  );
}

/* ------------------------------------------------------------- drawer */

type Loaded = { key: string; details?: InvoiceDetails; error?: string };

export function InvoiceDrawer({
  invoice,
  projects,
  onClose,
}: {
  invoice: Invoice;
  projects: InvoiceLinkOptions;
  onClose: () => void;
}) {
  const { currentUser, userById, invoiceDetails, setInvoiceLinks, deleteInvoice } = useStore();
  const mayManage = canManageInvoices(currentUser!);
  const [deleting, setDeleting] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  // A refetch changes fetchedAt, which reads the invoice again.
  const key = `${invoice.id}|${invoice.fetchedAt}`;
  useEffect(() => {
    let live = true;
    invoiceDetails(invoice.id).then(
      (raw) => {
        if (live) setLoaded({ key, details: readInvoice(raw) });
      },
      (err: unknown) => {
        if (live)
          setLoaded({ key, error: err instanceof Error ? err.message : "Couldn't load the invoice." });
      },
    );
    return () => {
      live = false;
    };
  }, [key, invoice.id, invoiceDetails]);

  // Keep showing the last read of this invoice while a refetched one loads.
  const current = loaded && loaded.key.startsWith(`${invoice.id}|`) ? loaded : null;
  const d = current?.details;
  const fetchedBy = userById(invoice.fetchedBy);

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        <span className="flex flex-wrap items-center gap-2">
          {invoice.invoiceNumber || "Unnumbered invoice"}
          <InvoiceStatusBadge status={invoice.status} />
        </span>
      }
      subtitle={[invoice.customerName, customerSubline(invoice)].filter(Boolean).join(" · ")}
      headerExtra={
        <div className="mt-3 flex flex-wrap gap-1.5">
          {mayManage ? <RefetchButton invoice={invoice} label /> : null}
          <a
            href={`/api/zoho/invoices/${invoice.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3 text-xs font-medium text-ink hover:bg-surface-3"
          >
            <IconExternal size={13} /> PDF
          </a>
          <a
            href={`/api/zoho/invoices/${invoice.id}/open`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3 text-xs font-medium text-ink hover:bg-surface-3"
          >
            <IconExternal size={13} /> Open in Zoho Books
          </a>
          {mayManage ? (
            <Button
              size="sm"
              variant="danger"
              aria-label="Remove from the PMS"
              onClick={() => setDeleting(true)}
            >
              <IconTrash size={13} />
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-[11px] text-ink-faint">
          Read only — edit this invoice in Zoho Books, then refetch it here. Fetched{" "}
          {formatDateTime(invoice.fetchedAt)}
          {fetchedBy ? ` by ${fetchedBy.fullName}` : ""}.
        </p>

        {mayManage ? (
          <InvoiceLinkFields
            invoiceId={invoice.id}
            options={projects}
            onChange={(projectIds, taskIds) => setInvoiceLinks(invoice.id, projectIds, taskIds)}
          />
        ) : (
          <LinkedList invoiceId={invoice.id} options={projects} />
        )}

        <FollowUpPanel invoice={invoice} />

        {!current ? (
          <p className="text-[12px] text-ink-faint">Loading the invoice…</p>
        ) : current.error ? (
          <p className="text-[12px] text-st-rejected">{current.error}</p>
        ) : d ? (
          <InvoiceBody d={d} company={invoice.customerCompany} />
        ) : null}
      </div>

      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => {
          deleteInvoice(invoice.id);
          onClose();
        }}
        title={`Remove ${invoice.invoiceNumber || "this invoice"} from the PMS?`}
        body="Only the PMS copy goes; the invoice in Zoho Books is untouched. If it is still pending approval, unpaid, partially paid, overdue or payment initiated in Books, the next sync will add it back."
        confirmLabel="Remove invoice"
      />
    </Drawer>
  );
}

/** A cell's worth of what an invoice bills for: two names, then "+3 more". */
function LinkedLabels({ labels }: { labels: string[] }) {
  if (!labels.length) return <span className="text-ink-faint">Not linked</span>;
  const shown = labels.slice(0, 2);
  return (
    <span className="block max-w-56 text-ink-muted" title={labels.join(", ")}>
      {shown.map((l, at) => (
        <span key={at} className="block truncate">
          {l}
        </span>
      ))}
      {labels.length > shown.length ? (
        <span className="text-[11px] text-ink-faint">+{labels.length - shown.length} more</span>
      ) : null}
    </span>
  );
}

/** Pick the projects and individual tasks an invoice bills for. */
function InvoiceLinkFields({
  invoiceId,
  options,
  onChange,
}: {
  invoiceId: string;
  options: InvoiceLinkOptions;
  onChange: (projectIds: string[], taskIds: string[]) => void;
}) {
  const links = options.linksOf(invoiceId);
  const projectIds = links.filter((l) => l.projectId).map((l) => l.projectId!);
  const taskIds = links.filter((l) => l.taskId).map((l) => l.taskId!);

  // A linked project or task missing from the options (still loading, or made
  // a blueprint since) still shows as a chip rather than vanishing.
  const projectOptions = [
    ...options.projects.map((p) => ({ value: p.id, label: p.name, hint: p.clientName || undefined })),
    ...projectIds
      .filter((id) => !options.projects.some((p) => p.id === id))
      .map((id) => ({ value: id, label: options.projectName(id) })),
  ];
  const taskOptions = [
    ...options.tasks.map((t) => ({
      value: t.id,
      label: t.title,
      hint:
        [t.assigneeName, t.dueDate ? `due ${formatDate(t.dueDate)}` : ""].filter(Boolean).join(" · ") ||
        undefined,
    })),
    ...taskIds
      .filter((id) => !options.tasks.some((t) => t.id === id))
      .map((id) => ({ value: id, label: options.taskName(id) })),
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Projects" hint={options.error ?? "Every project this invoice bills for."}>
        <MultiSelect
          options={projectOptions}
          value={projectIds}
          onChange={(next) => onChange(next, taskIds)}
          placeholder={options.loading ? "Loading projects…" : "Search projects…"}
          emptyLabel="No projects"
          disabled={options.loading}
        />
      </Field>
      <Field label="Individual tasks" hint="Work raised without a project.">
        <MultiSelect
          options={taskOptions}
          value={taskIds}
          onChange={(next) => onChange(projectIds, next)}
          placeholder={options.loading ? "Loading tasks…" : "Search individual tasks…"}
          emptyLabel="No individual tasks"
          disabled={options.loading}
        />
      </Field>
    </div>
  );
}

/** What an invoice bills for, read only, linking to whatever the viewer can open. */
function LinkedList({ invoiceId, options }: { invoiceId: string; options: InvoiceLinkOptions }) {
  const { projectById, taskById } = useStore();
  const links = options.linksOf(invoiceId);
  return (
    <Field label="Bills for">
      {links.length === 0 ? (
        <p className="text-[13px] text-ink-faint">Not linked to a project or task</p>
      ) : (
        <ul className="flex flex-col gap-1 text-[13px]">
          {links.map((l) => {
            const visible = l.projectId ? projectById(l.projectId) : taskById(l.taskId!);
            const label = l.projectId ? options.projectName(l.projectId) : options.taskName(l.taskId!);
            const href = l.projectId ? "/projects/" + l.projectId : "/tasks?type=individual&task=" + l.taskId;
            return (
              <li key={l.id} className="flex items-center gap-2">
                <Badge>{l.projectId ? "Project" : "Task"}</Badge>
                {visible ? (
                  <Link href={href} className="truncate text-brand-bright hover:underline">
                    {label}
                  </Link>
                ) : (
                  <span className="truncate text-ink">{label}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Field>
  );
}

/* ------------------------------------------------- the invoice itself */

function InvoiceBody({ d, company }: { d: InvoiceDetails; company: string }) {
  const money = (n: number) => formatMoney(n, d.currencyCode);
  const quantity = d.lines.reduce((sum, l) => sum + l.quantity, 0);

  return (
    <>
      <dl className="grid gap-x-5 gap-y-3 text-[13px] sm:grid-cols-2">
        <Fact label="Display name">{d.customerName || "—"}</Fact>
        <Fact label="Company name">{company || "—"}</Fact>
        <Fact label="Primary contact">{d.contactPerson || "—"}</Fact>
        <Fact label="Place of supply">{d.placeOfSupply || "—"}</Fact>
        <Fact label="Invoice date">{formatDate(d.date)}</Fact>
        <Fact label="Terms">{d.terms || "—"}</Fact>
        <Fact label="Due date">{formatDate(d.dueDate)}</Fact>
        <Fact label="Order number">{d.orderNumber || "—"}</Fact>
        <Fact label="Salesperson">{d.salesperson || "—"}</Fact>
        <Fact label="GST treatment">{d.gstTreatment || "—"}</Fact>
        <Fact label="GSTIN">{d.gstNo || "—"}</Fact>
        {d.subject ? (
          <div className="sm:col-span-2">
            <Fact label="Subject">{d.subject}</Fact>
          </div>
        ) : null}
      </dl>

      {d.billing || d.shipping ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <AddressBlock label="Billing address" address={d.billing} />
          <AddressBlock label="Shipping address" address={d.shipping} />
        </div>
      ) : null}

      <section>
        <SectionTitle>Items</SectionTitle>
        <div className="overflow-x-auto rounded-card border border-line-soft">
          <table className="w-full min-w-[38rem] text-left text-[12px]">
            <thead className="bg-surface-2 text-[10px] tracking-wide text-ink-faint uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Item details</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Rate</th>
                <th className="px-3 py-2 text-right font-medium">Discount</th>
                <th className="px-3 py-2 font-medium">Tax</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-ink-faint">
                    No line items.
                  </td>
                </tr>
              ) : (
                d.lines.map((l) => (
                  <tr key={l.id} className="border-t border-line-soft align-top">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-ink">{l.name}</div>
                      {l.description ? (
                        <div className="mt-0.5 max-w-72 whitespace-pre-wrap text-ink-muted">
                          {l.description}
                        </div>
                      ) : null}
                      {l.kind || l.code ? (
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-ink-faint">
                          {l.kind ? (
                            <Badge className="border-st-approved/30 bg-st-approved/15 px-1.5 py-0 text-[9px] tracking-wide text-st-approved uppercase">
                              {l.kind}
                            </Badge>
                          ) : null}
                          {l.code ? (
                            <span>
                              {l.kind === "Goods" ? "HSN" : "SAC"}: {l.code}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap text-ink-muted">
                      {l.quantity}
                      {l.unit ? ` ${l.unit}` : ""}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap text-ink-muted">
                      {money(l.rate)}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap text-ink-muted">
                      {l.discount ? (l.discount.endsWith("%") ? l.discount : money(Number(l.discount))) : "—"}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-ink-muted">{l.tax || "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-medium whitespace-nowrap text-ink">
                      {money(l.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-card border border-line-soft bg-surface-2 px-4 py-3 text-[13px]">
        <TotalRow label="Sub total" value={money(d.subTotal)} strong />
        {d.charges.map((c, at) => (
          <TotalRow key={`${c.label}-${at}`} label={c.label} value={money(c.amount)} />
        ))}
        <div className="my-2 border-t border-line-soft" />
        <TotalRow label={`Total (${d.currencyCode === "INR" ? "₹" : d.currencyCode})`} value={money(d.total)} big />
        {d.paid ? <TotalRow label="Payments received" value={`- ${money(d.paid)}`} /> : null}
        {d.credits ? <TotalRow label="Credits applied" value={`- ${money(d.credits)}`} /> : null}
        {d.writtenOff ? <TotalRow label="Written off" value={`- ${money(d.writtenOff)}`} /> : null}
        <TotalRow label="Balance due" value={money(d.balance)} strong />
        {quantity ? (
          <p className="mt-1 text-right text-[11px] text-ink-faint">Total quantity: {quantity}</p>
        ) : null}
      </section>

      {d.payments.length ? (
        <section>
          <SectionTitle>Payments</SectionTitle>
          <ul className="flex flex-col gap-1.5">
            {d.payments.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg bg-surface-2 px-3 py-2 text-[12px]"
              >
                <span className="font-mono font-medium text-ink">{money(p.amount)}</span>
                <span className="text-ink-muted">{formatDate(p.date)}</span>
                {p.mode ? <span className="text-ink-muted">{p.mode}</span> : null}
                {p.number ? <span className="text-ink-faint">#{p.number}</span> : null}
                {p.reference ? <span className="text-ink-faint">Ref {p.reference}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {d.customerNotes ? (
        <section>
          <SectionTitle>Customer notes</SectionTitle>
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-muted">
            {d.customerNotes}
          </p>
        </section>
      ) : null}

      {d.termsAndConditions ? (
        <section>
          <SectionTitle>Terms &amp; conditions</SectionTitle>
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-muted">
            {d.termsAndConditions}
          </p>
        </section>
      ) : null}

      {d.portalUrl ? (
        <a
          href={d.portalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 self-start text-[12px] text-brand-bright hover:underline"
        >
          Customer&apos;s view of this invoice <IconExternal size={12} />
        </a>
      ) : null}
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
      {children}
    </h3>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] tracking-wide text-ink-faint uppercase">{label}</dt>
      <dd className="mt-0.5 break-words text-ink">{children}</dd>
    </div>
  );
}

function AddressBlock({ label, address }: { label: string; address: InvoiceAddress | null }) {
  return (
    <div className="rounded-card border border-line-soft px-3 py-2.5 text-[12px]">
      <div className="text-[11px] tracking-wide text-ink-faint uppercase">{label}</div>
      {address ? (
        <div className="mt-1 text-ink-muted">
          {address.attention ? <div className="font-medium text-ink">{address.attention}</div> : null}
          {address.lines.map((line, at) => (
            <div key={at}>{line}</div>
          ))}
          {address.phone ? <div>Phone: {address.phone}</div> : null}
        </div>
      ) : (
        <p className="mt-1 text-ink-faint">—</p>
      )}
    </div>
  );
}

function TotalRow({
  label,
  value,
  strong,
  big,
}: {
  label: string;
  value: string;
  strong?: boolean;
  big?: boolean;
}) {
  return (
    <div
      className={cx(
        "flex items-center justify-between gap-4 py-1",
        big ? "text-[15px] font-semibold text-ink" : strong ? "font-medium text-ink" : "text-ink-muted",
      )}
    >
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

/* ------------------------------------------------ a project's invoices */

/**
 * The Invoices tab on a project: what has been billed against it, read from
 * Books. An invoice can bill several projects, so its whole total shows here
 * even when it covers others too.
 */
export function ProjectInvoices({ projectId }: { projectId: string }) {
  const { db } = useStore();
  const projects = useInvoiceLinkOptions();
  const [openId, setOpenId] = useState<string | null>(null);

  const linked = new Set(db.invoiceLinks.filter((l) => l.projectId === projectId).map((l) => l.invoiceId));
  const list = db.invoices
    .filter((i) => linked.has(i.id))
    .sort((a, b) => (b.invoiceDate ?? "").localeCompare(a.invoiceDate ?? ""));
  const billed = list.filter((i) => i.status !== "void");
  const invoiced = billed.reduce((sum, i) => sum + i.total, 0);
  const due = billed.reduce((sum, i) => sum + i.balance, 0);
  const open = openId ? list.find((i) => i.id === openId) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Invoiced" value={formatMoney(invoiced)} icon={<IconInvoice size={17} />} />
        <StatTile
          label="Received"
          value={formatMoney(invoiced - due)}
          tone="green"
          icon={<IconCheck size={17} />}
        />
        <StatTile label="Balance due" value={formatMoney(due)} tone="amber" />
      </div>
      <Card>
        {list.length === 0 ? (
          <EmptyState
            icon={<IconInvoice size={30} />}
            title="No invoices linked"
            body="Accounts & Finance tie invoices from Zoho Books to their project on the Invoices page."
          />
        ) : (
          <InvoiceTable invoices={list} projects={projects} onOpen={setOpenId} showProject={false} />
        )}
      </Card>
      {open ? <InvoiceDrawer invoice={open} projects={projects} onClose={() => setOpenId(null)} /> : null}
    </div>
  );
}

/* ------------------------------------------- an individual task's invoices */

/** The invoices billing an individual task (0012), each opening on the Invoices page. */
export function TaskInvoiceList({ taskId }: { taskId: string }) {
  const { db } = useStore();
  const ids = new Set(db.invoiceLinks.filter((l) => l.taskId === taskId).map((l) => l.invoiceId));
  const list = db.invoices.filter((i) => ids.has(i.id));
  return (
    <ul className="flex flex-col gap-1.5">
      {list.map((i) => (
        <li
          key={i.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-surface-2 px-3 py-2 text-[12px]"
        >
          <Link
            href={"/invoices?invoice=" + i.id}
            className="font-semibold text-ink hover:text-brand-bright"
          >
            {i.invoiceNumber}
          </Link>
          <InvoiceStatusBadge status={i.status} />
          <span className="ml-auto font-mono text-ink-muted">
            {formatMoney(i.total, i.currencyCode)}
            {i.balance > 0 ? ` · ${formatMoney(i.balance, i.currencyCode)} due` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
