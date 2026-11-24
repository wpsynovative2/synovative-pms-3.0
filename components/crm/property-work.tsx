"use client";

import Link from "next/link";
import { useState } from "react";
import { StatusBadge } from "@/components/task/task-bits";
import { InvoiceStatusBadge } from "@/components/invoice/invoice-parts";
import {
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconInvoice,
  IconPlus,
} from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { Badge, Button, SearchInput, cx } from "@/components/ui/primitives";
import { formatShortDate } from "@/lib/calendar";
import { customerSearchText, customerSubline, formatMoney } from "@/lib/invoices";
import { PROJECT_STATUS_STYLE } from "@/lib/master-data";
import { canManageInvoices, canViewInvoices } from "@/lib/permissions";
import { useStore } from "@/lib/store";
import type { Database, Invoice } from "@/lib/types";

/*
 * The work raised for a property, opened from its card: its projects
 * (projects.property_id) and individual tasks (tasks.property_id, 0019), each
 * tagged with what it is, and under each the invoices that bill it (0012) for
 * those who may see invoices. Only what the viewer can already see is listed —
 * this reads the store, so RLS has had its say.
 */

type WorkRow = {
  id: string;
  kind: "project" | "task";
  href: string;
  title: string;
  dot?: string;
  dates: string;
  badge: React.ReactNode;
  invoices: Invoice[];
};

/**
 * A property's projects and individual tasks, optionally only those no invoice
 * bills yet. A cancelled project is never waiting on an invoice, so it is left
 * out of that view.
 */
export function propertyWork(db: Database, propertyId: string, onlyUninvoiced = false) {
  const linkedProjects = new Set(db.invoiceLinks.map((l) => l.projectId).filter(Boolean));
  const linkedTasks = new Set(db.invoiceLinks.map((l) => l.taskId).filter(Boolean));
  return {
    projects: db.projects.filter(
      (p) =>
        p.propertyId === propertyId &&
        (!onlyUninvoiced || (p.status !== "Cancelled" && !linkedProjects.has(p.id))),
    ),
    tasks: db.tasks.filter(
      (t) => !t.projectId && t.propertyId === propertyId && (!onlyUninvoiced || !linkedTasks.has(t.id)),
    ),
  };
}

/** The property card's "Show projects & individual tasks", and the list it opens. */
export function PropertyWorkToggle({
  propertyId,
  onlyUninvoiced = false,
}: {
  propertyId: string;
  /** The Not invoiced tab: only work no invoice bills yet. */
  onlyUninvoiced?: boolean;
}) {
  const { db, currentUser } = useStore();
  const [open, setOpen] = useState(false);
  const showInvoices = canViewInvoices(currentUser!);

  const { projects, tasks } = propertyWork(db, propertyId, onlyUninvoiced);
  const total = projects.length + tasks.length;

  if (total === 0) {
    return (
      <p className="text-[11px] text-ink-faint">
        {onlyUninvoiced ? "Every project and task here has an invoice." : "No projects or individual tasks yet."}
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cx(
          "flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12px] transition-colors",
          open
            ? "border-brand-bright/40 bg-brand/10 text-brand-ink"
            : "border-line bg-surface-2 text-ink-muted hover:text-ink",
        )}
      >
        {open ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
        <span className="font-medium">
          {open ? "Hide" : "Show"} {onlyUninvoiced ? "work with no invoice" : "projects & individual tasks"}
        </span>
        <span className="ml-auto flex gap-1">
          {projects.length ? <KindChip kind="project" count={projects.length} /> : null}
          {tasks.length ? <KindChip kind="task" count={tasks.length} /> : null}
        </span>
      </button>
      {open ? (
        <PropertyWorkList propertyId={propertyId} showInvoices={showInvoices} onlyUninvoiced={onlyUninvoiced} />
      ) : null}
    </div>
  );
}

function PropertyWorkList({
  propertyId,
  showInvoices,
  onlyUninvoiced,
}: {
  propertyId: string;
  showInvoices: boolean;
  onlyUninvoiced: boolean;
}) {
  const { db, propertyById, companyById } = useStore();
  const work = propertyWork(db, propertyId, onlyUninvoiced);
  const companyName = companyById(propertyById(propertyId)?.companyId)?.name ?? "";
  const invoicesById = new Map(db.invoices.map((i) => [i.id, i]));
  const invoicesFor = (match: (l: { projectId: string | null; taskId: string | null }) => boolean) =>
    showInvoices
      ? db.invoiceLinks
          .filter(match)
          .map((l) => invoicesById.get(l.invoiceId))
          .filter((i): i is Invoice => !!i)
          .sort((a, b) => (b.invoiceDate ?? "").localeCompare(a.invoiceDate ?? ""))
      : [];

  // Projects first, each kind newest first.
  const rows: WorkRow[] = [
    ...work.projects
      .sort((a, b) => b.startDate.localeCompare(a.startDate))
      .map((p) => ({
        id: p.id,
        kind: "project" as const,
        href: `/projects/${p.id}`,
        title: p.name,
        dot: p.color,
        dates: `${formatShortDate(p.startDate)} → ${formatShortDate(p.deadline)}`,
        badge: <Badge className={PROJECT_STATUS_STYLE[p.status]}>{p.status}</Badge>,
        invoices: invoicesFor((l) => l.projectId === p.id),
      })),
    ...work.tasks
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate))
      .map((t) => ({
        id: t.id,
        kind: "task" as const,
        href: `/tasks?type=individual&task=${t.id}`,
        title: t.title,
        dates: `Due ${formatShortDate(t.dueDate)}`,
        badge: <StatusBadge status={t.status} task={t} />,
        invoices: invoicesFor((l) => l.taskId === t.id),
      })),
  ];

  // An invoice billing two of this property's projects counts once.
  const billed = new Map(rows.flatMap((r) => r.invoices).map((i) => [i.id, i]));
  const counted = [...billed.values()].filter((i) => i.status !== "void");
  const due = counted.reduce((sum, i) => sum + i.balance, 0);

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {showInvoices && billed.size ? (
        <p className="px-0.5 text-[11px] text-ink-faint">
          {billed.size} invoice{billed.size === 1 ? "" : "s"} ·{" "}
          <span className={due > 0 ? "font-medium text-ink" : ""}>{formatMoney(due)} due</span>
        </p>
      ) : null}
      <ul className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <WorkItem key={`${r.kind}-${r.id}`} row={r} showInvoices={showInvoices} companyName={companyName} />
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------- linking an invoice */

/** An invoice's projects and tasks, with one added or taken away. */
function useLinkEdit() {
  const { db, setInvoiceLinks } = useStore();
  return (invoiceId: string, row: Pick<WorkRow, "kind" | "id">, link: boolean) => {
    const links = db.invoiceLinks.filter((l) => l.invoiceId === invoiceId);
    let projectIds = links.filter((l) => l.projectId).map((l) => l.projectId!);
    let taskIds = links.filter((l) => l.taskId).map((l) => l.taskId!);
    if (row.kind === "project") {
      projectIds = link ? [...new Set([...projectIds, row.id])] : projectIds.filter((id) => id !== row.id);
    } else {
      taskIds = link ? [...new Set([...taskIds, row.id])] : taskIds.filter((id) => id !== row.id);
    }
    setInvoiceLinks(invoiceId, projectIds, taskIds);
  };
}

const MAX_RESULTS = 60;

/**
 * Search the invoices already in the PMS and tie one to this project or
 * individual task (0012). With nothing typed, the property's own company's
 * invoices come first; an invoice can bill any number of projects and tasks,
 * so one already linked elsewhere is still offered.
 */
function LinkInvoiceModal({
  row,
  companyName,
  onClose,
}: {
  row: WorkRow;
  companyName: string;
  onClose: () => void;
}) {
  const { db, showToast } = useStore();
  const edit = useLinkEdit();
  const [query, setQuery] = useState("");

  const linkedHere = new Set(row.invoices.map((i) => i.id));
  const linkCount = new Map<string, number>();
  for (const l of db.invoiceLinks) linkCount.set(l.invoiceId, (linkCount.get(l.invoiceId) ?? 0) + 1);

  const company = companyName.trim().toLowerCase();
  const isOurs = (i: Invoice) =>
    !!company &&
    customerSearchText(i).some((x) => {
      const v = x.trim().toLowerCase();
      return !!v && (v.includes(company) || company.includes(v));
    });

  const q = query.trim().toLowerCase();
  const matches = db.invoices
    .filter((i) => !q || [i.invoiceNumber, ...customerSearchText(i)].some((x) => x.toLowerCase().includes(q)))
    .sort(
      (a, b) =>
        Number(isOurs(b)) - Number(isOurs(a)) ||
        (b.invoiceDate ?? "").localeCompare(a.invoiceDate ?? "") ||
        b.invoiceNumber.localeCompare(a.invoiceNumber),
    );
  const shown = matches.slice(0, MAX_RESULTS);

  return (
    <Modal
      open
      onClose={onClose}
      title="Link an invoice"
      subtitle={`${KIND_STYLE[row.kind].label}: ${row.title}`}
      size="lg"
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="flex flex-col gap-3">
        <SearchInput
          autoFocus
          placeholder="Search invoice #, customer, company or contact…"
          value={query}
          active={!!q}
          onChange={(e) => setQuery(e.target.value)}
        />
        <p className="text-[11px] text-ink-faint">
          {matches.length} invoice{matches.length === 1 ? "" : "s"}
          {matches.length > MAX_RESULTS ? ` — showing the first ${MAX_RESULTS}, search to narrow` : ""}
          {!q && company ? ` · ${companyName}'s first` : ""}
        </p>

        {shown.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12px] text-ink-faint">
            No invoice matches. Fetch it from Zoho Books on the Invoices page first.
          </p>
        ) : (
          <ul className="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto">
            {shown.map((i) => {
              const here = linkedHere.has(i.id);
              const elsewhere = (linkCount.get(i.id) ?? 0) - (here ? 1 : 0);
              const sub = customerSubline(i);
              return (
                <li
                  key={i.id}
                  className={cx(
                    "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-[12px]",
                    here ? "border-brand-bright/40 bg-brand/10" : "border-line-soft bg-surface-2",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-ink">{i.invoiceNumber}</span>
                      <InvoiceStatusBadge status={i.status} />
                      {isOurs(i) ? <Badge>{companyName}</Badge> : null}
                    </div>
                    <div className="truncate text-ink-muted">
                      {i.customerName}
                      {sub ? <span className="text-ink-faint"> · {sub}</span> : null}
                    </div>
                    <div className="text-[11px] text-ink-faint">
                      {formatShortDate(i.invoiceDate)} · {formatMoney(i.total, i.currencyCode)} ·{" "}
                      {formatMoney(i.balance, i.currencyCode)} due
                      {elsewhere > 0 ? ` · also linked to ${elsewhere} other` : ""}
                    </div>
                  </div>
                  {here ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        edit(i.id, row, false);
                        showToast(`${i.invoiceNumber} unlinked.`, "success");
                      }}
                    >
                      Unlink
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        edit(i.id, row, true);
                        showToast(`${i.invoiceNumber} linked to ${row.title}.`, "success");
                      }}
                    >
                      Link
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}

const KIND_STYLE = {
  project: { chip: "bg-brand/15 text-brand-ink", edge: "border-l-tint-violet", label: "Project" },
  task: { chip: "bg-tint-blue/15 text-tint-blue", edge: "border-l-tint-blue", label: "Individual task" },
} as const;

function KindChip({ kind, count }: { kind: WorkRow["kind"]; count: number }) {
  return (
    <span className={cx("rounded-md px-1.5 py-0.5 text-[10px] font-semibold", KIND_STYLE[kind].chip)}>
      {count} {kind === "project" ? "Project" : "IT"}
      {count === 1 ? "" : "s"}
    </span>
  );
}

function WorkItem({
  row,
  showInvoices,
  companyName,
}: {
  row: WorkRow;
  showInvoices: boolean;
  companyName: string;
}) {
  const { currentUser } = useStore();
  const mayLink = canManageInvoices(currentUser!);
  const edit = useLinkEdit();
  const [linking, setLinking] = useState(false);
  const style = KIND_STYLE[row.kind];
  return (
    <li
      className={cx(
        "rounded-lg border border-line-soft border-l-[3px] bg-surface-2 px-2.5 py-2 text-[12px]",
        style.edge,
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={cx(
            "shrink-0 rounded px-1.5 py-px text-[9px] font-semibold tracking-wide uppercase",
            style.chip,
          )}
        >
          {style.label}
        </span>
        <span className="ml-auto shrink-0">{row.badge}</span>
      </div>
      <Link
        href={row.href}
        title={row.title}
        className="mt-1 flex items-center gap-1.5 font-medium text-ink hover:text-brand-bright"
      >
        {row.dot ? <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: row.dot }} /> : null}
        <span className="truncate">{row.title}</span>
      </Link>
      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-faint">
        <span>{row.dates}</span>
        {showInvoices ? (
          <span className="ml-auto inline-flex items-center gap-1">
            <IconInvoice size={11} />
            {row.invoices.length ? `${row.invoices.length} invoice${row.invoices.length === 1 ? "" : "s"}` : "No invoices"}
          </span>
        ) : null}
        {mayLink ? (
          <button
            type="button"
            onClick={() => setLinking(true)}
            className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium text-brand-bright hover:bg-brand/10"
          >
            <IconPlus size={11} /> Link invoice
          </button>
        ) : null}
      </div>
      {linking ? (
        <LinkInvoiceModal row={row} companyName={companyName} onClose={() => setLinking(false)} />
      ) : null}

      {showInvoices && row.invoices.length ? (
        <ul className="mt-1.5 flex flex-col gap-1 border-t border-line-soft pt-1.5">
          {row.invoices.map((i) => (
            <li key={i.id} className="flex items-center gap-1.5 text-[11px]">
              <Link href={`/invoices?invoice=${i.id}`} className="font-medium text-ink hover:text-brand-bright">
                {i.invoiceNumber}
              </Link>
              <InvoiceStatusBadge status={i.status} />
              <span className={cx("ml-auto font-mono", i.balance > 0 ? "text-ink" : "text-ink-faint")}>
                {formatMoney(i.balance, i.currencyCode)} due
              </span>
              {mayLink ? (
                <button
                  type="button"
                  onClick={() => edit(i.id, row, false)}
                  aria-label={`Unlink ${i.invoiceNumber}`}
                  title={`Unlink ${i.invoiceNumber}`}
                  className="text-ink-faint hover:text-st-rejected"
                >
                  <IconClose size={12} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
