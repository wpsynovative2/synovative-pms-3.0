"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { FollowUpsTab, isSettled } from "@/components/invoice/follow-ups";
import {
  InvoiceDrawer,
  InvoiceTable,
  useInvoiceProjects,
} from "@/components/invoice/invoice-parts";
import { FetchInvoiceDialog, SyncDialog } from "@/components/invoice/sync-dialogs";
import {
  IconFilter,
  IconInvoice,
  IconPhone,
  IconRepeat,
  IconSearch,
  IconWarning,
} from "@/components/ui/icons";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  SearchInput,
  Select,
  StatTile,
  Tabs,
} from "@/components/ui/primitives";
import { todayISO } from "@/lib/calendar";
import { INVOICE_STATUS_FILTERS, formatMoney, invoiceStatusLabel } from "@/lib/invoices";
import { canManageInvoices, canViewInvoices } from "@/lib/permissions";
import { useStore } from "@/lib/store";

/*
 * Invoices (0009): a read-only copy of the invoices raised in Zoho Books,
 * each tied to the one project it bills for. Accounts & Finance (and Super
 * Admins) bring them in — Sync for everything new in Books' working views,
 * Fetch for one by its number, Refetch to bring one up to date — and Admins
 * and Business Development read them. Books stays the system of record:
 * nothing about an invoice is edited here.
 *
 * The Follow-ups tab (0011) is where Accounts chase payment: calls logged
 * against invoices and the next call scheduled. The morning reminder links
 * here with ?tab=follow-ups.
 */

type LinkFilter = "any" | "linked" | "unlinked";
type PageTab = "invoices" | "follow-ups";

export default function InvoicesPage() {
  const { currentUser } = useStore();
  if (!canViewInvoices(currentUser!)) {
    return (
      <Card>
        <EmptyState
          icon={<IconInvoice size={30} />}
          title="You don't have access to Invoices"
          body="Invoices are open to Accounts & Finance, Business Development, Admins and Super Admins."
        />
      </Card>
    );
  }
  return <Invoices />;
}

function Invoices() {
  const { db, currentUser } = useStore();
  const mayManage = canManageInvoices(currentUser!);
  const projects = useInvoiceProjects();
  const params = useSearchParams();
  const [tab, setTab] = useState<PageTab>(params.get("tab") === "follow-ups" ? "follow-ups" : "invoices");

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [link, setLink] = useState<LinkFilter>("any");
  const [openId, setOpenId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [fetching, setFetching] = useState(false);

  const all = db.invoices;
  const outstanding = all.reduce((sum, i) => sum + (i.status === "void" ? 0 : i.balance), 0);
  const overdue = all.filter((i) => i.status === "overdue");
  const unlinked = all.filter((i) => !i.projectId);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((i) => status === "all" || i.status === status)
      .filter((i) => (link === "any" ? true : link === "linked" ? !!i.projectId : !i.projectId))
      .filter((i) => {
        if (!q) return true;
        return [i.invoiceNumber, i.customerName, i.salesperson, projects.nameOf(i.projectId)].some((x) =>
          x.toLowerCase().includes(q),
        );
      })
      // Newest invoice first.
      .sort(
        (a, b) =>
          (b.invoiceDate ?? "").localeCompare(a.invoiceDate ?? "") ||
          b.invoiceNumber.localeCompare(a.invoiceNumber),
      );
  }, [all, query, status, link, projects]);

  const filtered = !!query.trim() || status !== "all" || link !== "any";
  const today = todayISO();
  const callsDue = all.filter((i) => !isSettled(i) && i.nextCallOn && i.nextCallOn <= today).length;
  const open = openId ? all.find((i) => i.id === openId) : undefined;
  // Statuses on the list, plus the usual ones, so a filter never offers nothing.
  const statuses = Array.from(new Set([...INVOICE_STATUS_FILTERS, ...all.map((i) => i.status)])).filter(
    Boolean,
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Invoices"
        icon={<IconInvoice size={20} />}
        subtitle="Read from Zoho Books and tied to their projects. Edit invoices in Books, then refetch them here."
        actions={
          mayManage ? (
            <>
              <Button onClick={() => setFetching(true)}>
                <IconSearch size={15} /> Fetch by ID
              </Button>
              <Button variant="primary" onClick={() => setSyncing(true)}>
                <IconRepeat size={15} /> Sync from Zoho Books
              </Button>
            </>
          ) : null
        }
      />

      <Tabs<PageTab>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "invoices", label: "Invoices", icon: <IconInvoice size={14} />, count: all.length },
          { id: "follow-ups", label: "Follow-ups", icon: <IconPhone size={14} />, count: callsDue },
        ]}
      />

      {tab === "follow-ups" ? <FollowUpsTab onOpen={setOpenId} /> : null}

      {tab === "invoices" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Balance due"
              value={formatMoney(outstanding)}
              tone="blue"
              icon={<IconInvoice size={17} />}
            />
            <StatTile label="Invoices in the PMS" value={all.length} icon={<IconInvoice size={17} />} />
            <StatTile
              label="Overdue"
              value={overdue.length}
              tone="red"
              icon={<IconWarning size={17} />}
            />
            <StatTile label="Not linked to a project" value={unlinked.length} tone="amber" />
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <SearchInput
              className="w-full sm:max-w-xs"
              placeholder="Search invoice #, customer, project…"
              value={query}
              active={!!query.trim()}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="w-full sm:w-44">
              <Select
                value={status}
                active={status !== "all"}
                onChange={(e) => setStatus(e.target.value)}
                aria-label="Status"
              >
                <option value="all">Any status</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {invoiceStatusLabel(s)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-full sm:w-44">
              <Select
                value={link}
                active={link !== "any"}
                onChange={(e) => setLink(e.target.value as LinkFilter)}
                aria-label="Project"
              >
                <option value="any">Linked or not</option>
                <option value="linked">Linked to a project</option>
                <option value="unlinked">Not linked</option>
              </Select>
            </div>
            {filtered ? (
              <button
                onClick={() => {
                  setQuery("");
                  setStatus("all");
                  setLink("any");
                }}
                className="inline-flex items-center gap-1 text-[12px] text-ink-faint hover:text-ink"
              >
                <IconFilter size={13} /> Clear
              </button>
            ) : null}
            <span className="ml-auto text-[11px] text-ink-faint">
              {list.length} of {all.length} invoices
            </span>
          </div>

          {list.length === 0 ? (
            <Card>
              <EmptyState
                icon={<IconInvoice size={30} />}
                title={filtered ? "No invoices match" : "No invoices yet"}
                body={
                  filtered
                    ? "Try another status, project filter or search."
                    : mayManage
                      ? "Sync from Zoho Books to bring in every invoice pending approval, partially paid, unpaid, overdue or with a payment initiated, or fetch one by its number."
                      : "Accounts & Finance bring invoices in from Zoho Books."
                }
                action={
                  !filtered && mayManage ? (
                    <Button variant="primary" onClick={() => setSyncing(true)}>
                      <IconRepeat size={15} /> Sync from Zoho Books
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            <Card>
              <InvoiceTable invoices={list} projects={projects} onOpen={setOpenId} />
            </Card>
          )}

        </>
      ) : null}

      {open ? <InvoiceDrawer invoice={open} projects={projects} onClose={() => setOpenId(null)} /> : null}
      {syncing ? <SyncDialog onClose={() => setSyncing(false)} /> : null}
      {fetching ? (
        <FetchInvoiceDialog
          onClose={() => setFetching(false)}
          onFetched={(id) => {
            setFetching(false);
            setOpenId(id);
          }}
        />
      ) : null}
    </div>
  );
}
