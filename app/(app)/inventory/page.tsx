"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  InventoryStatusBadge,
  codeOf,
  placeText,
  tagOf,
} from "@/components/inventory/inventory-bits";
import { ItemDrawer } from "@/components/inventory/item-drawer";
import { ItemFormModal } from "@/components/inventory/item-form";
import { WorkstationDrawer, WorkstationFormModal } from "@/components/inventory/workstation-drawer";
import { IconChip, IconPlus, IconUser, IconWarning } from "@/components/ui/icons";
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SearchInput,
  Select,
  StatTile,
  Tabs,
  cx,
} from "@/components/ui/primitives";
import { daysBetween, formatDate, todayISO } from "@/lib/calendar";
import { canManageInventory, canViewInventory } from "@/lib/permissions";
import { useStore } from "@/lib/store";
import {
  INVENTORY_CATEGORY_LIST,
  INVENTORY_STATUSES,
  cabinetSummary,
  itemSummary,
  type InventoryCategory,
  type InventoryItem,
  type InventoryStatus,
  type Workstation,
} from "@/lib/types";

/*
 * System Inventory (0011, Archi-inventory.md): every piece of office computer
 * hardware, the workstation it is at, and who has that workstation. Super
 * Admin and Admin manage it; Managers can look; everyone else sees their own
 * workstation on their Profile.
 */

type Tab = "workstations" | "components" | "spares";

export default function InventoryPage() {
  const { currentUser } = useStore();
  if (!canViewInventory(currentUser!)) {
    return (
      <Card>
        <EmptyState
          icon={<IconChip size={30} />}
          title="You don't have access to System Inventory"
          body="The workstation allotted to you, and what is in it, is on your Profile."
          action={
            <Link href="/profile">
              <Button variant="primary">Open my profile</Button>
            </Link>
          }
        />
      </Card>
    );
  }
  return <InventoryScreen />;
}

function InventoryScreen() {
  const { db, currentUser } = useStore();
  const params = useSearchParams();
  const mayManage = canManageInventory(currentUser!);

  const [tab, setTab] = useState<Tab>(params.get("item") ? "components" : "workstations");
  const [deskId, setDeskId] = useState<string | null>(params.get("workstation"));
  const [itemId, setItemId] = useState<string | null>(params.get("item"));
  const [itemForm, setItemForm] = useState<{ item?: InventoryItem } | null>(null);
  const [deskForm, setDeskForm] = useState<{ desk?: Workstation } | null>(null);

  const items = db.inventoryItems;
  const today = todayISO();
  const count = (s: InventoryStatus) => items.filter((i) => i.status === s).length;
  const warrantySoon = items.filter(
    (i) =>
      i.status !== "Retired" &&
      i.warrantyUntil &&
      daysBetween(today, i.warrantyUntil) >= 0 &&
      daysBetween(today, i.warrantyUntil) <= 30,
  ).length;

  const desk = deskId ? db.workstations.find((w) => w.id === deskId) : undefined;
  const item = itemId ? items.find((i) => i.id === itemId) : undefined;
  // Opening one closes the other, so following a link inside a drawer
  // doesn't stack drawers.
  const openDesk = (id: string) => {
    setItemId(null);
    setDeskId(id);
  };
  const openItem = (id: string) => {
    setDeskId(null);
    setItemId(id);
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="System Inventory"
        icon={<IconChip size={20} />}
        subtitle="Office computer hardware: what we own, which desk it is at, and who has that desk"
        actions={
          mayManage ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setDeskForm({})}>
                <IconPlus size={15} /> Add workstation
              </Button>
              <Button variant="primary" onClick={() => setItemForm({})}>
                <IconPlus size={15} /> Add component
              </Button>
            </div>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label="Workstations"
          value={db.workstations.length}
          hint={`${db.workstations.filter((w) => !w.assignedTo).length} free`}
          icon={<IconUser size={17} />}
        />
        <StatTile label="In use" value={count("In use")} tone="green" icon={<IconChip size={17} />} />
        <StatTile label="Spare in stock" value={count("Spare")} tone="blue" />
        <StatTile label="Under repair" value={count("Under repair")} tone="amber" icon={<IconWarning size={17} />} />
        <StatTile label="Warranty ends in 30 days" value={warrantySoon} tone={warrantySoon ? "red" : "neutral"} />
      </div>

      <Tabs
        tabs={[
          { id: "workstations", label: "Workstations", count: db.workstations.length },
          { id: "components", label: "Components", count: items.length },
          { id: "spares", label: "Spares", count: count("Spare") },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "workstations" ? (
        <WorkstationsTab onOpen={openDesk} />
      ) : tab === "components" ? (
        <ComponentsTab onOpen={openItem} />
      ) : (
        <SparesTab onOpen={openItem} />
      )}

      {desk ? (
        <WorkstationDrawer
          desk={desk}
          onClose={() => setDeskId(null)}
          onEdit={() => setDeskForm({ desk })}
          onOpenItem={openItem}
        />
      ) : null}
      {item ? (
        <ItemDrawer
          item={item}
          onClose={() => setItemId(null)}
          onEdit={() => setItemForm({ item })}
          onOpenItem={openItem}
          onOpenDesk={openDesk}
        />
      ) : null}
      {itemForm ? <ItemFormModal item={itemForm.item} onClose={() => setItemForm(null)} /> : null}
      {deskForm ? <WorkstationFormModal desk={deskForm.desk} onClose={() => setDeskForm(null)} /> : null}
    </div>
  );
}

/* ---------------------------------------------------------- workstations */

function WorkstationsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const { db, userById } = useStore();
  const [query, setQuery] = useState("");
  const [allotted, setAllotted] = useState<"all" | "yes" | "no">("all");

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return db.workstations
      .filter((w) => (allotted === "all" ? true : allotted === "yes" ? !!w.assignedTo : !w.assignedTo))
      .filter((w) => {
        if (!q) return true;
        const holder = userById(w.assignedTo)?.fullName ?? "";
        return [w.code, w.name, w.location, holder].some((x) => x.toLowerCase().includes(q));
      })
      .sort((a, b) => codeOf(a).localeCompare(codeOf(b)));
  }, [db.workstations, query, allotted, userById]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <SearchInput
          className="w-full sm:max-w-xs"
          placeholder="Search code, name, location, person…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="w-full sm:w-44">
          <Select value={allotted} onChange={(e) => setAllotted(e.target.value as typeof allotted)} aria-label="Allotted">
            <option value="all">Allotted or free</option>
            <option value="yes">Allotted</option>
            <option value="no">Free</option>
          </Select>
        </div>
        <span className="ml-auto text-[11px] text-ink-faint">
          {list.length} of {db.workstations.length} workstations
        </span>
      </div>
      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconChip size={30} />}
            title={db.workstations.length ? "No workstations match" : "No workstations yet"}
            body={
              db.workstations.length
                ? "Try another search."
                : "Add a workstation for each desk, then place a cabinet, monitor and peripherals at it."
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((w) => (
            <WorkstationCard key={w.id} desk={w} onOpen={() => onOpen(w.id)} />
          ))}
        </div>
      )}
    </>
  );
}

function WorkstationCard({ desk, onOpen }: { desk: Workstation; onOpen: () => void }) {
  const { db, userById } = useStore();
  const holder = userById(desk.assignedTo);
  const here = db.inventoryItems.filter((i) => i.workstationId === desk.id);
  const cabinets = here.filter((i) => i.category === "Cabinet");
  const parts = db.inventoryItems.filter((p) => cabinets.some((c) => c.id === p.cabinetId));
  const monitors = here.filter((i) => i.category === "Monitor");
  const others = here.filter((i) => i.category !== "Cabinet" && i.category !== "Monitor");

  return (
    <button onClick={onOpen} className="text-left">
      <Card className="flex h-full flex-col gap-3 p-4 transition-colors hover:border-brand-bright/40">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[13px] font-semibold text-ink">{codeOf(desk)}</div>
            <div className="truncate text-[12px] text-ink-muted">
              {[desk.name, desk.location].filter(Boolean).join(" · ") || "No name yet"}
            </div>
          </div>
          {holder ? (
            <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-ink">
              <Avatar name={holder.fullName} size={22} />
              <span className="truncate">{holder.fullName}</span>
            </span>
          ) : (
            <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-faint">Free</span>
          )}
        </div>
        <div className="rounded-lg bg-surface-2 px-3 py-2 text-[12px]">
          <div className="text-[10px] tracking-wide text-ink-faint uppercase">Cabinet</div>
          <div className="mt-0.5 text-ink">
            {cabinets.length
              ? cabinetSummary(parts) || cabinets.map(tagOf).join(", ")
              : <span className="text-ink-faint">None yet</span>}
          </div>
        </div>
        <div className="mt-auto flex flex-wrap gap-1.5 text-[11px]">
          {monitors.map((m) => (
            <span key={m.id} className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-ink-muted">
              {itemSummary(m) === "Monitor" ? "Monitor" : `Monitor ${itemSummary(m)}`}
            </span>
          ))}
          {others.map((o) => (
            <span key={o.id} className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-ink-muted">
              {o.category}
            </span>
          ))}
        </div>
      </Card>
    </button>
  );
}

/* ------------------------------------------------------------ components */

function ComponentsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const { db, userById } = useStore();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<InventoryCategory | "all">("all");
  const [status, setStatus] = useState<InventoryStatus | "all" | "warranty">("all");
  const today = todayISO();

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return db.inventoryItems
      .filter((i) => category === "all" || i.category === category)
      .filter((i) =>
        status === "all"
          ? true
          : status === "warranty"
            ? !!i.warrantyUntil && daysBetween(today, i.warrantyUntil) >= 0 && daysBetween(today, i.warrantyUntil) <= 30
            : i.status === status,
      )
      .filter((i) => {
        if (!q) return true;
        return [i.assetTag, i.serialNumber, i.brand, i.model, itemSummary(i), placeText(i, db, userById)]
          .some((x) => x.toLowerCase().includes(q));
      })
      .sort((a, b) => a.category.localeCompare(b.category) || a.assetTag.localeCompare(b.assetTag));
  }, [db, query, category, status, today, userById]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <SearchInput
          className="w-full sm:max-w-xs"
          placeholder="Search ID, serial, brand, model, person…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="w-full sm:w-44">
          <Select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} aria-label="Category">
            <option value="all">Any category</option>
            {INVENTORY_CATEGORY_LIST.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-full sm:w-48">
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status">
            <option value="all">Any status</option>
            {INVENTORY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value="warranty">Warranty ends in 30 days</option>
          </Select>
        </div>
        <span className="ml-auto text-[11px] text-ink-faint">
          {list.length} of {db.inventoryItems.length} components
        </span>
      </div>

      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconChip size={30} />}
            title={db.inventoryItems.length ? "No components match" : "No components yet"}
            body={
              db.inventoryItems.length
                ? "Try another category, status or search."
                : "Add the cabinets, RAM, storage, monitors and peripherals you own. Each gets its own asset ID."
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[8rem_7rem_minmax(0,1fr)_minmax(0,1fr)_7rem_6.5rem] gap-x-4 border-b border-line bg-surface-2 px-4 py-2 text-[10px] font-medium tracking-wide text-ink-faint uppercase lg:grid">
            <span>Asset ID</span>
            <span>Category</span>
            <span>What it is</span>
            <span>Where</span>
            <span>Warranty</span>
            <span>Status</span>
          </div>
          {list.map((i) => (
            <button
              key={i.id}
              onClick={() => onOpen(i.id)}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 border-b border-line-soft px-4 py-2.5 text-left text-[12px] transition-colors last:border-0 hover:bg-surface-2 lg:grid-cols-[8rem_7rem_minmax(0,1fr)_minmax(0,1fr)_7rem_6.5rem] lg:items-center"
            >
              <span className="font-mono text-ink">{tagOf(i)}</span>
              <span className="text-ink-muted lg:order-none">{i.category}</span>
              <span className="min-w-0 truncate text-ink">
                {itemSummary(i)}
                {i.brand || i.model ? (
                  <span className="text-ink-faint"> · {[i.brand, i.model].filter(Boolean).join(" ")}</span>
                ) : null}
              </span>
              <span className="min-w-0 truncate text-ink-muted">{placeText(i, db, userById)}</span>
              <span
                className={cx(
                  "text-ink-muted",
                  i.warrantyUntil && i.warrantyUntil < today && "text-st-rejected",
                )}
              >
                {i.warrantyUntil ? formatDate(i.warrantyUntil) : "—"}
              </span>
              <span>
                <InventoryStatusBadge status={i.status} />
              </span>
            </button>
          ))}
        </Card>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- spares */

function SparesTab({ onOpen }: { onOpen: (id: string) => void }) {
  const { db } = useStore();
  const spares = db.inventoryItems.filter((i) => i.status === "Spare");
  const groups = INVENTORY_CATEGORY_LIST.map((c) => ({
    category: c,
    items: spares.filter((i) => i.category === c),
  })).filter((g) => g.items.length);

  if (!groups.length) {
    return (
      <Card>
        <EmptyState
          icon={<IconChip size={30} />}
          title="Nothing in stock"
          body="Components that are not installed or placed, and not under repair or retired, show here."
        />
      </Card>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {groups.map((g) => {
        // Identical parts counted together: "3 × 16 GB DDR4 3200 MHz".
        const kinds = new Map<string, InventoryItem[]>();
        for (const i of g.items) {
          const key = `${itemSummary(i)}|${i.brand}|${i.model}`;
          kinds.set(key, [...(kinds.get(key) ?? []), i]);
        }
        return (
          <Card key={g.category} className="p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="text-[13px] font-semibold text-ink">{g.category}</h3>
              <span className="text-[11px] text-ink-faint">{g.items.length} spare</span>
            </div>
            <ul className="flex flex-col gap-2">
              {[...kinds.values()].map((same) => (
                <li key={same[0].id} className="rounded-lg bg-surface-2 px-3 py-2 text-[12px]">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold text-ink">{same.length} ×</span>
                    <span className="min-w-0 flex-1 truncate text-ink">
                      {itemSummary(same[0])}
                      {same[0].brand || same[0].model ? (
                        <span className="text-ink-faint">
                          {" "}
                          · {[same[0].brand, same[0].model].filter(Boolean).join(" ")}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {same.map((i) => (
                      <button
                        key={i.id}
                        onClick={() => onOpen(i.id)}
                        className="font-mono text-[11px] text-brand-bright hover:underline"
                      >
                        {tagOf(i)}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
    </div>
  );
}
