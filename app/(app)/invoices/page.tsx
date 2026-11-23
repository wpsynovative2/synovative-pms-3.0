"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { FollowUpsTab, isSettled } from "@/components/invoice/follow-ups";
import {
  InvoiceDrawer,
  InvoiceGroupCard,
  InvoiceTable,
  StatusGroupPicker,
  useInvoiceLinkOptions,
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
import {
  AGE_BUCKETS,
  INVOICE_GROUP_BY,
  INVOICE_STATUS_FILTERS,
  customerSearchText,
  groupInvoices,
  invoiceAgeDays,
  invoiceStatusLabel,
  type InvoiceGroupBy,
  type InvoiceGroupKey,
  formatMoney,
} from "@/lib/invoices";
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
  const projects = useInvoiceLinkOptions();
  const params = useSearchParams();
  const [tab, setTab] = useState<PageTab>(params.get("tab") === "follow-ups" ? "follow-ups" : "invoices");

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [link, setLink] = useState<LinkFilter>("any");
  const [salesperson, setSalesperson] = useState("all");
  const [age, setAge] = useState("any");
  const [groupBy, setGroupBy] = useState<InvoiceGroupBy>("none");
  // The statuses to group by. One grouping at a time: picking these clears
  // Group by, and the other way round.
  const [statusGroups, setStatusGroups] = useState<string[]>([]);
  // Groups start closed, so a long list reads as its groups first (as 3D does).
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  // A task's invoice list links straight to one invoice.
  const [openId, setOpenId] = useState<string | null>(params.get("invoice"));
  const [syncing, setSyncing] = useState(false);
  const [fetching, setFetching] = useState(false);

  const all = db.invoices;
  const outstanding = all.reduce((sum, i) => sum + (i.status === "void" ? 0 : i.balance), 0);
  const overdue = all.filter((i) => i.status === "overdue");
  const linkedIds = useMemo(() => new Set(db.invoiceLinks.map((l) => l.invoiceId)), [db.invoiceLinks]);
  const unlinked = all.filter((i) => !linkedIds.has(i.id));

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((i) => status === "all" || i.status === status)
      .filter((i) => (link === "any" ? true : link === "linked" ? linkedIds.has(i.id) : !linkedIds.has(i.id)))
      .filter((i) => salesperson === "all" || (i.salesperson || "") === salesperson)
      .filter((i) => {
        if (age === "any") return true;
        const bucket = AGE_BUCKETS.find((b) => b.id === age);
        const days = invoiceAgeDays(i);
        return !!bucket && days !== null && days >= bucket.min && days <= bucket.max;
      })
      .filter((i) => {
        if (!q) return true;
        return [i.invoiceNumber, ...customerSearchText(i), i.salesperson, ...projects.labelsOf(i.id)].some((x) =>
          x.toLowerCase().includes(q),
        );
      })
      // Newest invoice first.
      .sort(
        (a, b) =>
          (b.invoiceDate ?? "").localeCompare(a.invoiceDate ?? "") ||
          b.invoiceNumber.localeCompare(a.invoiceNumber),
      );
  }, [all, query, status, link, salesperson, age, projects, linkedIds]);

  // Which grouping is on, if any, and its groups. Grouped by status, only the
  // ticked statuses are shown, one group each.
  const grouping: InvoiceGroupKey | null = statusGroups.length
    ? "status"
    : groupBy !== "none"
      ? groupBy
      : null;
  const groups = useMemo(() => {
    if (statusGroups.length) {
      return groupInvoices(
        list.filter((i) => statusGroups.includes(i.status)),
        "status",
      );
    }
    return groupBy !== "none" ? groupInvoices(list, groupBy) : [];
  }, [list, groupBy, statusGroups]);
  const shownCount = grouping === "status" ? groups.reduce((n, g) => n + g.invoices.length, 0) : list.length;

  const filtered =
    !!query.trim() || status !== "all" || link !== "any" || salesperson !== "all" || age !== "any";
  const statusCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of all) m.set(i.status, (m.get(i.status) ?? 0) + 1);
    return m;
  }, [all]);
  const salespeople = Array.from(new Set(all.map((i) => i.salesperson))).sort((a, b) =>
    a.localeCompare(b),
  );
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
        title="ZOHO Books | Invoices"
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
            <StatTile label="Not linked to any work" value={unlinked.length} tone="amber" />
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <SearchInput
              className="w-full sm:max-w-xs"
              placeholder="Search invoice #, customer, company, contact, project…"
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
                <option value="linked">Linked to work</option>
                <option value="unlinked">Not linked</option>
              </Select>
            </div>
            <div className="w-full sm:w-44">
              <Select
                value={salesperson}
                active={salesperson !== "all"}
                onChange={(e) => setSalesperson(e.target.value)}
                aria-label="Salesperson"
              >
                <option value="all">Any salesperson</option>
                {salespeople.map((name) => (
                  <option key={name || "none"} value={name}>
                    {name || "No salesperson"}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-full sm:w-40">
              <Select
                value={age}
                active={age !== "any"}
                onChange={(e) => setAge(e.target.value)}
                aria-label="Invoice age"
              >
                <option value="any">Any age</option>
                {AGE_BUCKETS.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-full sm:w-56">
              <Select
                value={groupBy}
                active={groupBy !== "none"}
                onChange={(e) => {
                  setGroupBy(e.target.value as InvoiceGroupBy);
                  setStatusGroups([]);
                  setOpenGroups(new Set());
                }}
                aria-label="Group by"
              >
                {INVOICE_GROUP_BY.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-full sm:w-56">
              <StatusGroupPicker
                statuses={statuses}
                counts={statusCounts}
                value={statusGroups}
                onChange={(next) => {
                  setStatusGroups(next);
                  if (next.length) setGroupBy("none");
                  setOpenGroups(new Set());
                }}
              />
            </div>
            {filtered ? (
              <button
                onClick={() => {
                  setQuery("");
                  setStatus("all");
                  setLink("any");
                  setSalesperson("all");
                  setAge("any");
                }}
                className="inline-flex items-center gap-1 text-[12px] text-ink-faint hover:text-ink"
              >
                <IconFilter size={13} /> Clear
              </button>
            ) : null}
            <span className="ml-auto text-[11px] text-ink-faint">
              {shownCount} of {all.length} invoices
              {grouping ? ` · ${groups.length} group${groups.length === 1 ? "" : "s"}` : ""}
            </span>
          </div>

          {shownCount === 0 ? (
            <Card>
              <EmptyState
                icon={<IconInvoice size={30} />}
                title={filtered || grouping === "status" ? "No invoices match" : "No invoices yet"}
                body={
                  grouping === "status"
                    ? "No invoices have the statuses you're grouping by. Tick others, or clear the status grouping."
                    : filtered
                    ? "Try another status, salesperson, age, link filter or search."
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
            !grouping ? (
              <Card>
                <InvoiceTable invoices={list} projects={projects} onOpen={setOpenId} />
              </Card>
            ) : (
              <div className="flex flex-col gap-2.5">
                <div className="flex justify-end gap-1.5">
                  <Button size="sm" onClick={() => setOpenGroups(new Set(groups.map((g) => g.key)))}>
                    Expand all
                  </Button>
                  <Button size="sm" onClick={() => setOpenGroups(new Set())}>
                    Collapse all
                  </Button>
                </div>
                {groups.map((g) => (
                  <InvoiceGroupCard
                    key={g.key}
                    group={g}
                    groupBy={grouping}
                    open={openGroups.has(g.key)}
                    onToggle={() =>
                      setOpenGroups((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.key)) next.delete(g.key);
                        else next.add(g.key);
                        return next;
                      })
                    }
                    projects={projects}
                    onOpen={setOpenId}
                  />
                ))}
              </div>
            )
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
