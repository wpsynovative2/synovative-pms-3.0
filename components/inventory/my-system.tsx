"use client";

import { codeOf, tagOf } from "@/components/inventory/inventory-bits";
import { IconChip } from "@/components/ui/icons";
import { Card, CardHeader } from "@/components/ui/primitives";
import { formatDate } from "@/lib/calendar";
import { useStore } from "@/lib/store";
import { cabinetSummary, itemSummary, type InventoryItem } from "@/lib/types";

/**
 * Profile: the workstation allotted to the signed-in person and what is in it,
 * read-only. Row Level Security already limits what they get to their own
 * desk (0011); the filter here is for Admins, who see every desk.
 */
export function MySystemCard() {
  const { db, currentUser } = useStore();
  const mine = db.workstations.filter((w) => w.assignedTo === currentUser!.id);
  if (mine.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title={mine.length === 1 ? "My system" : "My systems"}
        subtitle="The workstation allotted to you. Tell an Admin if anything here is wrong."
      />
      <div className="flex flex-col gap-4 px-4 pb-4">
        {mine.map((desk) => {
          const here = db.inventoryItems.filter((i) => i.workstationId === desk.id);
          const cabinets = here.filter((i) => i.category === "Cabinet");
          const others = here.filter((i) => i.category !== "Cabinet");
          return (
            <div key={desk.id} className="rounded-card border border-line-soft">
              <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-3 py-2">
                <IconChip size={15} className="text-ink-muted" />
                <span className="font-mono text-[13px] font-semibold text-ink">{codeOf(desk)}</span>
                <span className="text-[12px] text-ink-muted">
                  {[desk.name, desk.location].filter(Boolean).join(" · ")}
                </span>
                {desk.assignedAt ? (
                  <span className="ml-auto text-[11px] text-ink-faint">since {formatDate(desk.assignedAt)}</span>
                ) : null}
              </div>
              <ul className="divide-y divide-line-soft">
                {cabinets.map((c) => {
                  const parts = db.inventoryItems.filter((p) => p.cabinetId === c.id);
                  return (
                    <li key={c.id} className="px-3 py-2 text-[12px]">
                      <Row item={c} text={cabinetSummary(parts) || itemSummary(c)} />
                      {parts.length ? (
                        <ul className="mt-1.5 ml-3 flex flex-col gap-1 border-l border-line-soft pl-3">
                          {parts.map((p) => (
                            <li key={p.id}>
                              <Row item={p} text={itemSummary(p)} />
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
                {others.map((o) => (
                  <li key={o.id} className="px-3 py-2 text-[12px]">
                    <Row item={o} text={itemSummary(o)} />
                  </li>
                ))}
                {here.length === 0 ? (
                  <li className="px-3 py-2.5 text-[12px] text-ink-faint">Nothing recorded at this desk yet.</li>
                ) : null}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Row({ item, text }: { item: InventoryItem; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-ink-faint">{item.category}</span>
      <span className="min-w-0 flex-1 truncate text-ink">
        {text}
        {item.brand || item.model ? (
          <span className="text-ink-faint"> · {[item.brand, item.model].filter(Boolean).join(" ")}</span>
        ) : null}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-ink-muted">{tagOf(item)}</span>
    </div>
  );
}
