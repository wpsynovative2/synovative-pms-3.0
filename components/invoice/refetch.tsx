"use client";

import { useState } from "react";
import { ButtonLoader } from "@/components/ui/loader";
import { IconRepeat } from "@/components/ui/icons";
import { Button } from "@/components/ui/primitives";
import { IMPORT_BATCH, type ImportResult } from "@/lib/invoices";
import { useStore } from "@/lib/store";
import type { Invoice } from "@/lib/types";

/*
 * Bringing invoices already in the PMS up to date from Zoho Books (0009). The
 * import route rewrites Books' own columns and keeps links (0012) and
 * follow-ups (0011), so a refetch never loses work done here.
 */

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

/**
 * Refetch many invoices, a batch at a time (IMPORT_BATCH) so each request stays
 * inside its timeout and the button can count progress. Each invoice is about
 * one call to Books, which allows roughly 100 a minute: once it starts
 * refusing, the run stops there and says how far it got, rather than failing
 * every invoice left one by one. The list reloads once, at the end.
 */
export function useInvoiceRefetch() {
  const { showToast, refreshInvoices } = useStore();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const refetch = async (invoices: Invoice[]) => {
    if (!invoices.length || progress) return;
    const total = invoices.length;
    const numberOf = new Map(invoices.map((i) => [i.zohoInvoiceId, i.invoiceNumber]));
    const failed: string[] = [];
    let ok = 0;
    let stopped = "";
    setProgress({ done: 0, total });

    for (let at = 0; at < total && !stopped; at += IMPORT_BATCH) {
      const batch = invoices.slice(at, at + IMPORT_BATCH);
      try {
        const results = await importInvoices(batch.map((i) => i.zohoInvoiceId));
        for (const r of results) {
          if (r.ok) ok += 1;
          else if (/rate-limit/i.test(r.error)) stopped = r.error;
          else failed.push(numberOf.get(r.ref) || r.ref);
        }
      } catch (err) {
        stopped = err instanceof Error ? err.message : "Couldn't reach Zoho Books.";
      }
      setProgress({ done: Math.min(total, at + batch.length), total });
    }

    setProgress(null);
    if (ok) refreshInvoices();
    const plural = (n: number) => `${n} invoice${n === 1 ? "" : "s"}`;
    if (stopped) {
      showToast(`Refetched ${ok} of ${total}, then stopped: ${stopped}`);
    } else if (failed.length) {
      const named = failed.slice(0, 3).join(", ") + (failed.length > 3 ? ` and ${failed.length - 3} more` : "");
      showToast(`Refetched ${ok} of ${total}. Couldn't refetch ${named}.`);
    } else {
      showToast(`${plural(ok)} refetched from Zoho Books.`, "success");
    }
  };

  return { progress, refetch };
}
