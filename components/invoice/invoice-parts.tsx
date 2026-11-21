"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ButtonLoader } from "@/components/ui/loader";
import { IconCheck, IconExternal, IconInvoice, IconRepeat, IconTrash } from "@/components/ui/icons";
import { ConfirmDialog, Drawer } from "@/components/ui/modal";
import { Badge, Button, Card, EmptyState, Field, StatTile, cx } from "@/components/ui/primitives";
import { SearchSelect } from "@/components/ui/selects";
import { formatDate, formatDateTime } from "@/lib/calendar";
import {
  formatMoney,
  invoiceStatusLabel,
  invoiceStatusTone,
  readInvoice,
  type ImportResult,
  type InvoiceAddress,
  type InvoiceDetails,
} from "@/lib/invoices";
import { canManageInvoices } from "@/lib/permissions";
import { useStore } from "@/lib/store";
import type { Invoice, InvoiceProjectOption } from "@/lib/types";

/*
 * The pieces of the Invoices module (0009) shared by its page and a project's
 * Invoices tab. Everything here reads; the one change a person makes is which
 * project an invoice belongs to. Books stays the system of record.
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

/* ------------------------------------------------- projects to link to */

/**
 * Every project an invoice can be tied to, with its name. Finance and
 * Business Development see few projects in the store, so the names come from
 * invoice_projects() (0009) instead.
 */
export function useInvoiceProjects() {
  const { invoiceProjects, projectById } = useStore();
  const [loaded, setLoaded] = useState<{ options: InvoiceProjectOption[]; error?: string } | null>(
    null,
  );

  useEffect(() => {
    let live = true;
    invoiceProjects().then(
      (options) => {
        if (live) setLoaded({ options });
      },
      (err: unknown) => {
        if (live)
          setLoaded({
            options: [],
            error: err instanceof Error ? err.message : "Couldn't load the projects.",
          });
      },
    );
    return () => {
      live = false;
    };
  }, [invoiceProjects]);

  return useMemo(() => {
    const byId = new Map((loaded?.options ?? []).map((p) => [p.id, p]));
    return {
      options: loaded?.options ?? [],
      loading: !loaded,
      error: loaded?.error,
      nameOf: (id: string | null) =>
        id ? (projectById(id)?.name ?? byId.get(id)?.name ?? "A deleted project") : "",
    };
  }, [loaded, projectById]);
}

export type InvoiceProjects = ReturnType<typeof useInvoiceProjects>;

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
  projects: InvoiceProjects;
  onOpen: (id: string) => void;
  showProject?: boolean;
}) {
  const { currentUser } = useStore();
  const mayManage = canManageInvoices(currentUser!);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[56rem] text-left text-[12px]">
        <thead className="bg-surface-2 text-[10px] tracking-wide text-ink-faint uppercase">
          <tr>
            <th className="px-4 py-2.5 font-medium">Invoice</th>
            <th className="px-4 py-2.5 font-medium">Date</th>
            <th className="px-4 py-2.5 font-medium">Due</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            {showProject ? <th className="px-4 py-2.5 font-medium">Project</th> : null}
            <th className="px-4 py-2.5 text-right font-medium">Total</th>
            <th className="px-4 py-2.5 text-right font-medium">Balance due</th>
            {mayManage ? <th className="px-4 py-2.5 font-medium"></th> : null}
          </tr>
        </thead>
        <tbody>
          {invoices.map((i) => (
            <tr key={i.id} className="border-t border-line-soft align-top hover:bg-surface-2">
              <td className="px-4 py-3">
                <button
                  onClick={() => onOpen(i.id)}
                  className="text-left text-[13px] font-semibold text-ink hover:text-brand-bright"
                >
                  {i.invoiceNumber || "Unnumbered"}
                </button>
                <div className="max-w-64 truncate text-ink-muted">{i.customerName || "—"}</div>
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-ink-muted">{formatDate(i.invoiceDate)}</td>
              <td className="px-4 py-3 whitespace-nowrap text-ink-muted">{formatDate(i.dueDate)}</td>
              <td className="px-4 py-3">
                <InvoiceStatusBadge status={i.status} />
              </td>
              {showProject ? (
                <td className="px-4 py-3">
                  {i.projectId ? (
                    <span className="block max-w-48 truncate text-ink-muted">
                      {projects.nameOf(i.projectId)}
                    </span>
                  ) : (
                    <span className="text-ink-faint">Not linked</span>
                  )}
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
          ))}
        </tbody>
      </table>
    </div>
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
  projects: InvoiceProjects;
  onClose: () => void;
}) {
  const { currentUser, userById, invoiceDetails, linkInvoiceToProject, deleteInvoice } = useStore();
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
      subtitle={invoice.customerName}
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

        <Field
          label="Project"
          hint={
            mayManage
              ? projects.error ?? "The one project this invoice bills for."
              : undefined
          }
        >
          {mayManage ? (
            <SearchSelect
              options={projects.options.map((p) => ({
                value: p.id,
                label: p.name,
                hint: p.clientName || undefined,
              }))}
              value={invoice.projectId ?? ""}
              onChange={(next) => linkInvoiceToProject(invoice.id, next || null)}
              placeholder={projects.loading ? "Loading projects…" : "Not linked to a project"}
              disabled={projects.loading}
              allowClear
            />
          ) : (
            <ProjectName invoice={invoice} projects={projects} />
          )}
        </Field>

        {!current ? (
          <p className="text-[12px] text-ink-faint">Loading the invoice…</p>
        ) : current.error ? (
          <p className="text-[12px] text-st-rejected">{current.error}</p>
        ) : d ? (
          <InvoiceBody d={d} />
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

function ProjectName({ invoice, projects }: { invoice: Invoice; projects: InvoiceProjects }) {
  const { projectById } = useStore();
  if (!invoice.projectId) return <p className="text-[13px] text-ink-faint">Not linked to a project</p>;
  const visible = projectById(invoice.projectId);
  return visible ? (
    <Link href={`/projects/${visible.id}`} className="text-[13px] text-brand-bright hover:underline">
      {visible.name}
    </Link>
  ) : (
    <p className="text-[13px] text-ink">{projects.nameOf(invoice.projectId)}</p>
  );
}

/* ------------------------------------------------- the invoice itself */

function InvoiceBody({ d }: { d: InvoiceDetails }) {
  const money = (n: number) => formatMoney(n, d.currencyCode);
  const quantity = d.lines.reduce((sum, l) => sum + l.quantity, 0);

  return (
    <>
      <dl className="grid gap-x-5 gap-y-3 text-[13px] sm:grid-cols-2">
        <Fact label="Customer">{d.customerName || "—"}</Fact>
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

/** The Invoices tab on a project: what has been billed against it, read from Books. */
export function ProjectInvoices({ projectId }: { projectId: string }) {
  const { db } = useStore();
  const projects = useInvoiceProjects();
  const [openId, setOpenId] = useState<string | null>(null);

  const list = db.invoices
    .filter((i) => i.projectId === projectId)
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
