"use client";

import { useState } from "react";
import {
  InventoryHistory,
  InventoryStatusBadge,
  deskLabel,
  deskOf,
  placeText,
  specRows,
  tagOf,
} from "@/components/inventory/inventory-bits";
import { MoveItemDialog, PickSpareDialog, TakeOutDialog } from "@/components/inventory/pickers";
import { IconEdit, IconTrash } from "@/components/ui/icons";
import { ConfirmDialog, Drawer } from "@/components/ui/modal";
import { Button, cx } from "@/components/ui/primitives";
import { formatINR } from "@/lib/analytics";
import { daysBetween, formatDate, todayISO } from "@/lib/calendar";
import { canManageInventory, canViewInventory } from "@/lib/permissions";
import { useStore } from "@/lib/store";
import { cabinetSummary, itemSummary, type InventoryItem } from "@/lib/types";

/** One component: what it is, where it is, what can be done with it, and its history. */
export function ItemDrawer({
  item,
  onClose,
  onEdit,
  onOpenItem,
  onOpenDesk,
}: {
  item: InventoryItem;
  onClose: () => void;
  onEdit: () => void;
  onOpenItem: (id: string) => void;
  onOpenDesk: (id: string) => void;
}) {
  const { db, currentUser, userById, vendorById, deleteInventoryItem } = useStore();
  const mayManage = canManageInventory(currentUser!);
  const [moving, setMoving] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [takeOut, setTakeOut] = useState<"Spare" | "Under repair" | "Retired" | null>(null);
  const [deleting, setDeleting] = useState(false);

  const placed = !!(item.cabinetId || item.workstationId);
  const isCabinet = item.category === "Cabinet";
  const parts = isCabinet ? db.inventoryItems.filter((p) => p.cabinetId === item.id) : [];
  const desk = deskOf(item, db);
  const cabinet = item.cabinetId ? db.inventoryItems.find((c) => c.id === item.cabinetId) : undefined;
  const warrantyDays = item.warrantyUntil ? daysBetween(todayISO(), item.warrantyUntil) : null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{tagOf(item)}</span>
          <InventoryStatusBadge status={item.status} />
        </span>
      }
      subtitle={`${item.category} · ${[item.brand, item.model].filter(Boolean).join(" ") || itemSummary(item)}`}
      headerExtra={
        mayManage ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {item.status !== "Retired" && item.status !== "Under repair" ? (
              <Button size="sm" variant="primary" onClick={() => setMoving(true)}>
                {placed ? "Move" : item.category === "Cabinet" || item.category === "Monitor" ? "Place at a desk" : "Install / place"}
              </Button>
            ) : null}
            {placed ? (
              <Button size="sm" onClick={() => setTakeOut("Spare")}>
                Take out
              </Button>
            ) : item.status !== "Spare" ? (
              <Button size="sm" onClick={() => setTakeOut("Spare")}>
                Back to spare
              </Button>
            ) : null}
            {item.status !== "Under repair" ? (
              <Button size="sm" onClick={() => setTakeOut("Under repair")}>
                Under repair
              </Button>
            ) : null}
            {item.status !== "Retired" ? (
              <Button
                size="sm"
                variant="danger"
                disabled={isCabinet && parts.length > 0}
                title={isCabinet && parts.length ? "Take the parts out first" : undefined}
                onClick={() => setTakeOut("Retired")}
              >
                Retire
              </Button>
            ) : null}
            <Button size="sm" onClick={onEdit}>
              <IconEdit size={13} /> Edit
            </Button>
            <Button size="sm" variant="danger" aria-label="Delete component" onClick={() => setDeleting(true)}>
              <IconTrash size={13} />
            </Button>
          </div>
        ) : null
      }
    >
      <div className="flex flex-col gap-5">
        <div className="rounded-card border border-line-soft bg-surface-2 px-3 py-2.5 text-[13px]">
          <div className="text-[11px] tracking-wide text-ink-faint uppercase">Where it is</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink">
            {cabinet ? (
              <button className="font-mono text-brand-bright hover:underline" onClick={() => onOpenItem(cabinet.id)}>
                {tagOf(cabinet)}
              </button>
            ) : null}
            {desk ? (
              <button className="text-brand-bright hover:underline" onClick={() => onOpenDesk(desk.id)}>
                {deskLabel(desk)}
              </button>
            ) : null}
            {desk?.assignedTo ? <span className="text-ink-muted">· {userById(desk.assignedTo)?.fullName}</span> : null}
            {!cabinet && !desk ? <span>{placeText(item, db, userById)}</span> : null}
          </div>
        </div>

        {isCabinet ? (
          <section>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                Inside ({parts.length})
              </h3>
              {mayManage && item.status !== "Retired" ? (
                <Button size="sm" className="ml-auto" onClick={() => setInstalling(true)}>
                  Install a part
                </Button>
              ) : null}
            </div>
            {parts.length ? (
              <>
                <p className="mb-2 text-[12px] text-ink-muted">{cabinetSummary(parts)}</p>
                <ul className="flex flex-col gap-1.5">
                  {parts.map((p) => (
                    <li key={p.id}>
                      <button
                        onClick={() => onOpenItem(p.id)}
                        className="flex w-full items-center gap-3 rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-left text-[12px] hover:border-brand-bright/40"
                      >
                        <span className="w-24 shrink-0 text-ink-faint">{p.category}</span>
                        <span className="min-w-0 flex-1 truncate text-ink">{itemSummary(p)}</span>
                        <span className="shrink-0 font-mono text-[11px] text-ink-muted">{tagOf(p)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-[12px] text-ink-faint">Empty. Install a processor, motherboard, RAM and so on.</p>
            )}
          </section>
        ) : null}

        <dl className="grid gap-x-5 gap-y-3 text-[13px] sm:grid-cols-2">
          <Fact label="Brand">{item.brand || "—"}</Fact>
          <Fact label="Model">{item.model || "—"}</Fact>
          <Fact label="Serial number">
            <span className="font-mono">{item.serialNumber || "—"}</span>
          </Fact>
          {specRows(item).map((r) => (
            <Fact key={r.label} label={r.label}>
              {r.value}
            </Fact>
          ))}
          <Fact label="Purchased">{item.purchaseDate ? formatDate(item.purchaseDate) : "—"}</Fact>
          <Fact label="Price">{item.price !== null ? formatINR(item.price) : "—"}</Fact>
          <Fact label="Vendor">{(item.vendorId && vendorById(item.vendorId)?.name) || "—"}</Fact>
          <Fact label="Warranty">
            {item.warrantyUntil ? (
              <span className={cx(warrantyDays !== null && warrantyDays < 0 && "text-st-rejected")}>
                {formatDate(item.warrantyUntil)}
                {warrantyDays !== null && warrantyDays < 0 ? " · ended" : warrantyDays !== null && warrantyDays <= 30 ? ` · ${warrantyDays} days left` : ""}
              </span>
            ) : (
              "—"
            )}
          </Fact>
          <Fact label="Added">
            {formatDate(item.createdAt)} by {userById(item.createdBy)?.fullName ?? "someone"}
          </Fact>
        </dl>

        {item.notes ? (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-muted">
            {item.notes}
          </p>
        ) : null}

        {canViewInventory(currentUser!) ? (
          <InventoryHistory
            target={{ itemId: item.id }}
            refreshKey={`${item.status}|${item.cabinetId}|${item.workstationId}|${item.serialNumber}|${item.notes}|${parts.length}`}
          />
        ) : null}
      </div>

      {moving ? <MoveItemDialog item={item} onClose={() => setMoving(false)} /> : null}
      {installing ? <PickSpareDialog into={{ cabinet: item }} onClose={() => setInstalling(false)} /> : null}
      {takeOut ? <TakeOutDialog item={item} status={takeOut} onClose={() => setTakeOut(null)} /> : null}
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => {
          deleteInventoryItem(item.id);
          onClose();
        }}
        title={`Delete ${tagOf(item)}?`}
        body={
          isCabinet && parts.length
            ? `Only for a mistaken entry. Its ${parts.length} part${parts.length === 1 ? "" : "s"} stay and become spares. Its ID is never used again. To keep its history, Retire it instead.`
            : "Only for a mistaken entry. Its ID is never used again. To keep it on record, Retire it instead."
        }
        confirmLabel="Delete"
      />
    </Drawer>
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
