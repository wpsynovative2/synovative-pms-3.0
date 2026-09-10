"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ExpenseFormModal, ExpenseReviewModal } from "@/components/expense/expense-dialogs";
import { DatePicker } from "@/components/ui/date-picker";
import {
  IconCheck,
  IconClose,
  IconEdit,
  IconFilter,
  IconPlus,
  IconTrash,
  IconWallet,
} from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/modal";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SearchInput,
  Select,
  StatTile,
} from "@/components/ui/primitives";
import { formatINR } from "@/lib/analytics";
import { formatDate } from "@/lib/calendar";
import { EXPENSE_STATUS_STYLE } from "@/lib/master-data";
import {
  canReviewExpense,
  isFinance,
  isProjectLeader,
  visibleProjects,
} from "@/lib/permissions";
import { useStore } from "@/lib/store";
import type { Expense } from "@/lib/types";

interface Filters {
  query: string;
  status: string;
  projectId: string;
  vendorId: string;
  from: string;
  to: string;
}

const EMPTY: Filters = {
  query: "",
  status: "all",
  projectId: "all",
  vendorId: "all",
  from: "",
  to: "",
};

export default function ExpensesPage() {
  const { db, currentUser, projectById, vendorById, userById, deleteExpense } = useStore();
  const user = currentUser!;
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<Filters>({
    ...EMPTY,
    // Finance lands on the queue that needs them.
    status: isFinance(user) ? "Pending" : "all",
  });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [reviewing, setReviewing] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);

  const mayReview = canReviewExpense(user);

  /** Finance sees every expense; everyone else sees their visible projects'. */
  const scoped = useMemo(() => {
    if (mayReview) return db.expenses;
    const allowed = new Set(
      visibleProjects(user, db.projects, db.tasks).map((p) => p.id),
    );
    return db.expenses.filter((e) => allowed.has(e.projectId));
  }, [db.expenses, db.projects, db.tasks, user, mayReview]);

  const myLedProjects = useMemo(
    () => db.projects.filter((p) => isProjectLeader(user, p)),
    [db.projects, user],
  );

  const filtered = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    return scoped
      .filter((e) => {
        if (q && !e.description.toLowerCase().includes(q)) return false;
        if (filters.status !== "all" && e.status !== filters.status) return false;
        if (filters.projectId !== "all" && e.projectId !== filters.projectId) return false;
        if (filters.vendorId !== "all" && e.vendorId !== filters.vendorId) return false;
        if (filters.from && e.expenseDate < filters.from) return false;
        if (filters.to && e.expenseDate > filters.to) return false;
        return true;
      })
      .sort((a, b) => b.expenseDate.localeCompare(a.expenseDate));
  }, [scoped, filters]);

  const totals = useMemo(() => {
    const sum = (s: Expense["status"]) =>
      scoped.filter((e) => e.status === s).reduce((a, e) => a + e.amount, 0);
    return {
      approved: sum("Approved"),
      pending: sum("Pending"),
      rejected: sum("Rejected"),
      pendingCount: scoped.filter((e) => e.status === "Pending").length,
    };
  }, [scoped]);

  const dirty = JSON.stringify(filters) !== JSON.stringify(EMPTY);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    setFilters((f) => ({ ...f, [k]: v }));

  const highlightId = searchParams.get("expense");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Project Expenses"
        icon={<IconWallet size={20} />}
        subtitle={
          mayReview
            ? "You verify these on behalf of Accounts & Finance"
            : "Outside vendor costs on your projects"
        }
        actions={
          myLedProjects.length ? (
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <IconPlus size={15} /> Add expense
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Approved"
          value={formatINR(totals.approved)}
          tone="green"
          icon={<IconCheck size={17} />}
        />
        <StatTile
          label="Pending verification"
          value={formatINR(totals.pending)}
          hint={`${totals.pendingCount} expense${totals.pendingCount === 1 ? "" : "s"}`}
          tone="amber"
          icon={<IconWallet size={17} />}
        />
        <StatTile
          label="Rejected"
          value={formatINR(totals.rejected)}
          tone="red"
          icon={<IconClose size={17} />}
        />
        <StatTile
          label="Total recorded"
          value={formatINR(totals.approved + totals.pending + totals.rejected)}
          hint={`${scoped.length} entries`}
          tone="brand"
        />
      </div>

      <Card className="flex flex-wrap items-end gap-2.5 p-3.5">
        <SearchInput
          className="min-w-52 flex-1"
          placeholder="Search descriptions…"
          value={filters.query}
          onChange={(e) => set("query", e.target.value)}
        />
        <Select
          className="w-auto min-w-32"
          value={filters.status}
          onChange={(e) => set("status", e.target.value)}
          aria-label="Status"
        >
          <option value="all">All statuses</option>
          <option value="Pending">Pending</option>
          <option value="Approved">Approved</option>
          <option value="Rejected">Rejected</option>
        </Select>
        <Select
          className="w-auto min-w-40"
          value={filters.projectId}
          onChange={(e) => set("projectId", e.target.value)}
          aria-label="Project"
        >
          <option value="all">All projects</option>
          {db.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto min-w-36"
          value={filters.vendorId}
          onChange={(e) => set("vendorId", e.target.value)}
          aria-label="Vendor"
        >
          <option value="all">All vendors</option>
          {db.vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </Select>
        <div className="w-36">
          <DatePicker
            value={filters.from}
            onChange={(v) => set("from", v)}
            config={db.calendar}
            ignoreWorkingRules
            allowPast
            placeholder="From"
            clearable
          />
        </div>
        <div className="w-36">
          <DatePicker
            value={filters.to}
            onChange={(v) => set("to", v)}
            config={db.calendar}
            ignoreWorkingRules
            allowPast
            placeholder="To"
            clearable
          />
        </div>
        {dirty ? (
          <button
            onClick={() => setFilters(EMPTY)}
            className="inline-flex h-9.5 items-center gap-1.5 rounded-[10px] border border-line bg-surface-2 px-3 text-[12px] text-ink-muted hover:text-ink"
          >
            <IconFilter size={13} /> Clear
          </button>
        ) : null}
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconWallet size={30} />}
            title="No expenses match these filters"
            body={
              myLedProjects.length
                ? "Add outside vendor costs — drone shoots, models, printing — from a project you lead."
                : "Only a project's leader can add expenses to it."
            }
          />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-left text-[12px]">
            <thead className="bg-surface-2 text-[10px] tracking-wide text-ink-faint uppercase">
              <tr>
                <th className="px-4 py-2.5 font-medium">Description</th>
                <th className="px-4 py-2.5 font-medium">Project</th>
                <th className="px-4 py-2.5 font-medium">Vendor</th>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const project = projectById(e.projectId);
                const vendor = vendorById(e.vendorId);
                const reviewer = e.reviewedBy ? userById(e.reviewedBy) : null;
                const mine = project ? isProjectLeader(user, project) : false;
                return (
                  <tr
                    key={e.id}
                    className={
                      "border-t border-line-soft align-top " +
                      (e.id === highlightId ? "bg-brand/10" : "hover:bg-surface-2")
                    }
                  >
                    <td className="px-4 py-3">
                      <div className="max-w-72 text-ink">{e.description}</div>
                      {e.attachmentName ? (
                        <div className="mt-0.5 text-[10px] text-ink-faint">
                          📎 {e.attachmentName}
                        </div>
                      ) : null}
                      {e.financeRemarks ? (
                        <div className="mt-1.5 max-w-72 rounded border border-st-rejected/25 bg-st-rejected/10 px-2 py-1 text-[10px] text-st-rejected">
                          {e.financeRemarks}
                        </div>
                      ) : null}
                      {reviewer && e.reviewedAt ? (
                        <div className="mt-1 text-[10px] text-ink-faint">
                          {e.status} by {reviewer.fullName} ·{" "}
                          {formatDate(e.reviewedAt.slice(0, 10))}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {project ? (
                        <Link
                          href={`/projects/${project.id}`}
                          className="inline-flex items-center gap-1.5 text-ink-muted hover:text-ink"
                        >
                          <span
                            className="h-2 w-2 rounded-[3px]"
                            style={{ background: project.color }}
                          />
                          <span className="max-w-40 truncate">{project.name}</span>
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{vendor?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-muted">
                      {formatDate(e.expenseDate)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-ink">
                      {formatINR(e.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={EXPENSE_STATUS_STYLE[e.status]}>{e.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {mayReview && e.status === "Pending" ? (
                          <Button size="sm" variant="primary" onClick={() => setReviewing(e)}>
                            Verify
                          </Button>
                        ) : null}
                        {/* Editable only while Pending (§8). */}
                        {mine && e.status === "Pending" ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => {
                                setEditing(e);
                                setFormOpen(true);
                              }}
                            >
                              <IconEdit size={13} />
                            </Button>
                            <Button size="sm" variant="danger" onClick={() => setDeleting(e)}>
                              <IconTrash size={13} />
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {formOpen ? (
        <ExpenseFormModal
          open
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          project={null}
          projectOptions={myLedProjects}
          expense={editing ?? undefined}
        />
      ) : null}

      {reviewing ? (
        <ExpenseReviewModal open onClose={() => setReviewing(null)} expense={reviewing} />
      ) : null}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteExpense(deleting.id)}
        title="Delete this expense?"
        body="Pending expenses can be removed before Accounts & Finance verify them."
      />
    </div>
  );
}
