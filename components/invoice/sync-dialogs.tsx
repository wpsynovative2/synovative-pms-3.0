"use client";

import { useEffect, useState } from "react";
import { ButtonLoader, Loader } from "@/components/ui/loader";
import { IconCheck, IconWarning } from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import { Button, Field, Input, ProgressBar } from "@/components/ui/primitives";
import {
  IMPORT_BATCH,
  SYNC_FILTERS,
  invoiceStatusLabel,
  type ImportResult,
  type SyncReport,
} from "@/lib/invoices";
import { useStore } from "@/lib/store";
import { importInvoices } from "./refetch";

/* ------------------------------------------------------------------ sync */

type SyncState =
  | { phase: "checking" }
  | { phase: "failed"; error: string }
  | { phase: "importing" | "finished"; report: SyncReport; done: number; failures: ImportResult[] };

/**
 * Sync from Zoho Books: ask the server which invoices in Books' working views
 * are not in the PMS yet, then add them a batch at a time so a large first
 * sync shows progress instead of timing out. Invoices already here are not
 * touched. Closing the dialog stops after the batch in flight.
 */
export function SyncDialog({ onClose }: { onClose: () => void }) {
  const { refreshInvoices } = useStore();
  const [state, setState] = useState<SyncState>({ phase: "checking" });

  useEffect(() => {
    let live = true;
    (async () => {
      let report: SyncReport;
      try {
        const res = await fetch("/api/zoho/invoices/sync");
        const body = (await res.json().catch(() => null)) as (SyncReport & { error?: string }) | null;
        if (!res.ok || !body) throw new Error(body?.error ?? "Couldn't reach Zoho Books.");
        report = body;
      } catch (err) {
        if (live) setState({ phase: "failed", error: err instanceof Error ? err.message : "Couldn't reach Zoho Books." });
        return;
      }
      if (!live) return;

      const failures: ImportResult[] = [];
      let done = 0;
      setState({ phase: "importing", report, done, failures: [] });
      for (let at = 0; at < report.fresh.length && live; at += IMPORT_BATCH) {
        const batch = report.fresh.slice(at, at + IMPORT_BATCH);
        try {
          const results = await importInvoices(batch.map((c) => c.zohoId));
          failures.push(...results.filter((r) => !r.ok));
        } catch (err) {
          const error = err instanceof Error ? err.message : "Couldn't reach Zoho Books.";
          failures.push(...batch.map((c) => ({ ref: c.number || c.zohoId, ok: false as const, error })));
        }
        done += batch.length;
        if (live) setState({ phase: "importing", report, done, failures: [...failures] });
        refreshInvoices();
      }
      if (live) setState({ phase: "finished", report, done, failures });
    })();
    return () => {
      live = false;
    };
  }, [refreshInvoices]);

  const busy = state.phase === "checking" || state.phase === "importing";

  return (
    <Modal
      open
      onClose={onClose}
      title="Sync from Zoho Books"
      subtitle="Adds invoices that are in Books but not yet in the PMS. Invoices already here are left as they are."
      footer={
        <Button variant={busy ? "secondary" : "primary"} onClick={onClose}>
          {busy ? "Stop and close" : "Done"}
        </Button>
      }
    >
      {state.phase === "checking" ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <Loader size={32} label="Checking Zoho Books" />
          <p className="text-[13px] text-ink-muted">Checking Zoho Books…</p>
          <p className="max-w-sm text-[11px] text-ink-faint">
            {SYNC_FILTERS.map((f) => f.label).join(" · ")}
          </p>
        </div>
      ) : state.phase === "failed" ? (
        <p className="flex items-start gap-2 rounded-lg border border-st-rejected/30 bg-st-rejected/10 px-3 py-2.5 text-[13px] text-st-rejected">
          <IconWarning size={16} className="mt-0.5 shrink-0" />
          {state.error}
        </p>
      ) : (
        <SyncProgress state={state} />
      )}
    </Modal>
  );
}

function SyncProgress({ state }: { state: Extract<SyncState, { report: SyncReport }> }) {
  const { report, done, failures } = state;
  const total = report.fresh.length;
  const added = done - failures.length;

  return (
    <div className="flex flex-col gap-4">
      <ul className="grid gap-1.5 text-[12px] sm:grid-cols-2">
        {report.filters.map((f) => (
          <li
            key={f.label}
            className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-1.5"
            title={f.error}
          >
            <span className="text-ink-muted">{f.label}</span>
            {f.error ? (
              <span className="inline-flex items-center gap-1 text-st-rejected">
                <IconWarning size={12} /> Not read
              </span>
            ) : (
              <span className="font-mono text-ink">{f.count}</span>
            )}
          </li>
        ))}
      </ul>

      <p className="text-[13px] text-ink-muted">
        {report.matched} invoice{report.matched === 1 ? "" : "s"} in these views ·{" "}
        {report.alreadyHere} already in the PMS ·{" "}
        <span className="font-medium text-ink">{total} new</span>
      </p>

      {total > 0 ? (
        <div className="flex flex-col gap-1.5">
          <ProgressBar value={(done / total) * 100} />
          <p className="text-[12px] text-ink-faint">
            {state.phase === "importing" ? `Adding ${Math.min(done + IMPORT_BATCH, total)} of ${total}…` : null}
            {state.phase === "finished" ? (
              <span className="inline-flex items-center gap-1 text-st-approved">
                <IconCheck size={13} /> Added {added} invoice{added === 1 ? "" : "s"}.
              </span>
            ) : null}
          </p>
        </div>
      ) : state.phase === "finished" ? (
        <p className="inline-flex items-center gap-1 text-[13px] text-st-approved">
          <IconCheck size={14} /> Everything is already in the PMS.
        </p>
      ) : null}

      {report.filters.some((f) => f.error) ? (
        <div className="rounded-lg border border-st-submitted/30 bg-st-submitted/10 px-3 py-2 text-[12px] text-st-submitted">
          Zoho Books didn&apos;t answer for{" "}
          {report.filters
            .filter((f) => f.error)
            .map((f) => `${f.label} (${f.error})`)
            .join("; ")}
          . The other views were synced.
        </div>
      ) : null}

      {failures.length ? (
        <div>
          <p className="mb-1.5 text-[12px] font-medium text-st-rejected">
            {failures.length} couldn&apos;t be added
          </p>
          <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-[11px]">
            {failures.map((f) => (
              <li key={f.ref} className="rounded bg-surface-2 px-2 py-1 text-ink-muted">
                <span className="font-medium text-ink">{f.ref}</span> — {"error" in f ? f.error : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {total > 0 && total <= 12 ? (
        <ul className="flex flex-col gap-1 text-[11px] text-ink-faint">
          {report.fresh.map((c) => (
            <li key={c.zohoId}>
              <span className="text-ink-muted">{c.number}</span> · {c.customer} ·{" "}
              {invoiceStatusLabel(c.status)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------- fetch by id */

/**
 * One invoice by the number the user has to hand — Books' record id or the
 * printed invoice number. Whatever its status: this is how a paid or void
 * invoice the sync does not look at gets into the PMS. One already here is
 * refetched.
 */
export function FetchInvoiceDialog({
  onClose,
  onFetched,
}: {
  onClose: () => void;
  onFetched: (id: string) => void;
}) {
  const { showToast, refreshInvoices } = useStore();
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = ref.trim();
    if (!value) return;
    setBusy(true);
    setError("");
    try {
      const [result] = await importInvoices([value]);
      if (!result?.ok) {
        setError(result && "error" in result ? result.error : "Couldn't fetch the invoice.");
        return;
      }
      showToast(
        `${result.number} ${result.created ? "added from" : "refetched from"} Zoho Books.`,
        "success",
      );
      refreshInvoices();
      onFetched(result.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach Zoho Books.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Fetch an invoice" size="sm">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field
          label="Invoice ID or number"
          htmlFor="invoice-ref"
          error={error || undefined}
          hint="The invoice number (INV-002372) or the long ID in the invoice's Zoho Books link. Any status."
        >
          <Input
            id="invoice-ref"
            autoFocus
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="INV-002372"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !ref.trim()}>
            {busy ? <ButtonLoader /> : null}
            {busy ? "Fetching…" : "Fetch"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
