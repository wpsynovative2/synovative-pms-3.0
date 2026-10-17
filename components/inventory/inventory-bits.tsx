"use client";

import { useEffect, useState } from "react";
import { Badge, Input, Select, cx } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/calendar";
import { useStore } from "@/lib/store";
import {
  INVENTORY_CATEGORIES,
  type Database,
  type InventoryCategory,
  type InventoryEvent,
  type InventoryItem,
  type InventoryStatus,
  type User,
  type Workstation,
} from "@/lib/types";

/*
 * Pieces shared by the System Inventory screens (0011): status badges, where
 * a component is, the spec fields of a category, and a history list.
 */

export const INVENTORY_STATUS_STYLE: Record<InventoryStatus, string> = {
  "In use": "bg-st-approved/15 text-st-approved border-st-approved/30",
  Spare: "bg-st-inprogress/15 text-st-inprogress border-st-inprogress/30",
  "Under repair": "bg-st-changes/15 text-st-changes border-st-changes/30",
  Retired: "bg-surface-3 text-ink-faint border-line",
};

export function InventoryStatusBadge({ status }: { status: InventoryStatus }) {
  return <Badge className={INVENTORY_STATUS_STYLE[status]}>{status}</Badge>;
}

/** "SYN-RAM-0031" until the save comes back with its ID. */
export const tagOf = (item: InventoryItem) => item.assetTag || "New";
export const codeOf = (desk: Workstation) => desk.code || "New";

/** What a workstation is called: "WS-012 · Design desk 4". */
export const deskLabel = (desk: Workstation) =>
  desk.name ? `${codeOf(desk)} · ${desk.name}` : codeOf(desk);

/** The workstation a component is at, directly or through its cabinet. */
export function deskOf(item: InventoryItem, db: Database): Workstation | undefined {
  const deskId =
    item.workstationId ??
    (item.cabinetId ? db.inventoryItems.find((c) => c.id === item.cabinetId)?.workstationId : null);
  return deskId ? db.workstations.find((w) => w.id === deskId) : undefined;
}

/** Where a component is, in words: "In SYN-CAB-0012 at WS-012 · Neha". */
export function placeText(
  item: InventoryItem,
  db: Database,
  userById: (id: string | null) => User | undefined,
): string {
  const desk = deskOf(item, db);
  const holder = desk ? userById(desk.assignedTo)?.fullName : undefined;
  const cabinet = item.cabinetId ? db.inventoryItems.find((c) => c.id === item.cabinetId) : undefined;
  const parts = [
    cabinet ? `In ${tagOf(cabinet)}` : null,
    desk ? (cabinet ? `at ${deskLabel(desk)}` : `At ${deskLabel(desk)}`) : null,
    holder ?? null,
  ].filter(Boolean);
  if (parts.length) return parts.join(" · ").replace(" · at ", " at ");
  return item.status === "Spare" ? "In stock" : item.status;
}

/** The details a category asks for, laid out two by two. */
export function SpecFields({
  category,
  value,
  onChange,
}: {
  category: InventoryCategory;
  value: InventoryItem["specs"];
  onChange: (next: InventoryItem["specs"]) => void;
}) {
  const fields = INVENTORY_CATEGORIES[category].specs;
  const set = (key: string, v: string, numeric: boolean) => {
    const next = { ...value };
    if (v === "") delete next[key];
    else next[key] = numeric && Number.isFinite(Number(v)) ? Number(v) : v;
    onChange(next);
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => (
        <label key={f.key} className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium tracking-wide text-ink-muted uppercase">
            {f.label}
            {f.unit ? <span className="ml-1 normal-case text-ink-faint">({f.unit})</span> : null}
          </span>
          {f.type === "select" ? (
            <Select
              value={String(value[f.key] ?? "")}
              onChange={(e) => set(f.key, e.target.value, false)}
            >
              <option value="">Not recorded</option>
              {f.options!.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              type={f.type === "number" ? "number" : "text"}
              min={f.type === "number" ? 0 : undefined}
              step="any"
              value={String(value[f.key] ?? "")}
              onChange={(e) => set(f.key, e.target.value, f.type === "number")}
            />
          )}
        </label>
      ))}
    </div>
  );
}

/** A component's details as label / value pairs, skipping what wasn't recorded. */
export function specRows(item: InventoryItem): { label: string; value: string }[] {
  return INVENTORY_CATEGORIES[item.category].specs
    .filter((f) => item.specs[f.key] !== undefined && item.specs[f.key] !== "")
    .map((f) => ({
      label: f.label,
      value: `${item.specs[f.key]}${f.unit && f.unit !== "inch" ? ` ${f.unit}` : f.unit === "inch" ? '"' : ""}`,
    }));
}

const KIND_TEXT: Record<InventoryEvent["kind"], string> = {
  added: "Added",
  edited: "Edited",
  installed: "Installed",
  placed: "Placed",
  removed: "Taken out",
  status: "Status changed",
  assigned: "Allotted",
  unassigned: "Unallotted",
  deleted: "Deleted",
};

/**
 * The history of one component or workstation, newest first. Read from the
 * database when shown; `refreshKey` changes whenever what it describes does,
 * so a move made in the drawer appears in its history straight away.
 */
export function InventoryHistory({
  target,
  refreshKey,
}: {
  target: { itemId: string } | { workstationId: string };
  refreshKey: string;
}) {
  const { inventoryHistory, userById } = useStore();
  const [events, setEvents] = useState<InventoryEvent[] | null>(null);
  const targetKey = "itemId" in target ? `i:${target.itemId}` : `w:${target.workstationId}`;

  useEffect(() => {
    let live = true;
    // A save is still on its way when the key changes; give it a moment.
    const timer = setTimeout(() => {
      void inventoryHistory(target).then((rows) => {
        if (live) setEvents(rows);
      });
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // target is rebuilt every render; targetKey is what identifies it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, refreshKey, inventoryHistory]);

  return (
    <section>
      <h3 className="mb-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase">History</h3>
      {events === null ? (
        <p className="text-[12px] text-ink-faint">Loading…</p>
      ) : events.length === 0 ? (
        <p className="text-[12px] text-ink-faint">Nothing recorded yet.</p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {events.map((e) => (
            <li key={e.id} className="rounded-lg bg-surface-2 px-3 py-2 text-[12px]">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="font-medium text-ink">{KIND_TEXT[e.kind] ?? e.kind}</span>
                {"workstationId" in target && e.subject ? (
                  <span className="font-mono text-[11px] text-ink-muted">{e.subject}</span>
                ) : null}
                {e.fromLabel || e.toLabel ? (
                  <span className="text-ink-muted">
                    {e.fromLabel ? <>{e.fromLabel}</> : null}
                    {e.fromLabel && e.toLabel ? " → " : null}
                    {e.toLabel ? <>{e.toLabel}</> : null}
                  </span>
                ) : null}
                <span className={cx("ml-auto text-[11px] text-ink-faint")}>
                  {formatDateTime(e.at)} · {e.actor ? (userById(e.actor)?.fullName ?? "Someone") : "System"}
                </span>
              </div>
              {e.note ? <p className="mt-0.5 text-[11px] text-ink-faint">{e.note}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
