"use client";

import { useMemo, useState } from "react";
import { deskLabel, tagOf } from "@/components/inventory/inventory-bits";
import { Modal } from "@/components/ui/modal";
import { Button, Field, Input } from "@/components/ui/primitives";
import { SearchSelect } from "@/components/ui/selects";
import { useStore } from "@/lib/store";
import { INVENTORY_CATEGORIES, itemSummary, type InventoryItem } from "@/lib/types";

/**
 * Move one component: into a cabinet (internal parts, Other) or to a
 * workstation (cabinets, monitors, peripherals, Other). The database checks
 * the same rules (0011).
 */
export function MoveItemDialog({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const { db, installInventoryItem, placeInventoryItem } = useStore();
  const place = INVENTORY_CATEGORIES[item.category].place;
  const [kind, setKind] = useState<"cabinet" | "workstation">(place === "workstation" ? "workstation" : "cabinet");
  const [target, setTarget] = useState("");
  const [note, setNote] = useState("");

  const cabinets = useMemo(
    () =>
      db.inventoryItems
        .filter((c) => c.category === "Cabinet" && c.status !== "Retired" && c.id !== item.cabinetId)
        .map((c) => {
          const desk = db.workstations.find((w) => w.id === c.workstationId);
          return { value: c.id, label: tagOf(c), hint: desk ? deskLabel(desk) : "Not at a desk" };
        }),
    [db.inventoryItems, db.workstations, item.cabinetId],
  );
  const desks = useMemo(
    () =>
      db.workstations
        .filter((w) => w.id !== item.workstationId)
        .map((w) => ({ value: w.id, label: deskLabel(w), hint: w.location || undefined })),
    [db.workstations, item.workstationId],
  );

  const save = () => {
    if (!target) return;
    if (kind === "cabinet") installInventoryItem(item.id, target, note.trim());
    else placeInventoryItem(item.id, target, note.trim());
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Move ${tagOf(item)}`}
      subtitle={`${item.category} · ${itemSummary(item)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!target}>
            {kind === "cabinet" ? "Install" : "Place"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {place === "either" ? (
          <div className="flex gap-2">
            <Button size="sm" variant={kind === "cabinet" ? "primary" : "secondary"} onClick={() => { setKind("cabinet"); setTarget(""); }}>
              Into a cabinet
            </Button>
            <Button size="sm" variant={kind === "workstation" ? "primary" : "secondary"} onClick={() => { setKind("workstation"); setTarget(""); }}>
              At a workstation
            </Button>
          </div>
        ) : null}
        <Field label={kind === "cabinet" ? "Cabinet" : "Workstation"} required>
          <SearchSelect
            options={kind === "cabinet" ? cabinets : desks}
            value={target}
            onChange={setTarget}
            placeholder={kind === "cabinet" ? "Pick a cabinet…" : "Pick a workstation…"}
          />
        </Field>
        <Field label="Note" hint="Kept in the history, e.g. why it moved.">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
    </Modal>
  );
}

/** Take a component out, or change what a spare is: Spare, Under repair or Retired. */
export function TakeOutDialog({
  item,
  status,
  onClose,
}: {
  item: InventoryItem;
  status: "Spare" | "Under repair" | "Retired";
  onClose: () => void;
}) {
  const { removeInventoryItem } = useStore();
  const [note, setNote] = useState("");
  const placed = !!(item.cabinetId || item.workstationId);
  const title =
    status === "Spare"
      ? placed
        ? `Take ${tagOf(item)} out`
        : `Mark ${tagOf(item)} spare`
      : status === "Under repair"
        ? `Send ${tagOf(item)} for repair`
        : `Retire ${tagOf(item)}`;
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={title}
      subtitle={
        placed
          ? `It comes out of where it is now and becomes ${status === "Spare" ? "a spare in stock" : status.toLowerCase()}.`
          : `It becomes ${status === "Spare" ? "a spare in stock" : status.toLowerCase()}.`
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={status === "Retired" ? "danger" : "primary"}
            onClick={() => {
              removeInventoryItem(item.id, status, note.trim());
              onClose();
            }}
          >
            {status === "Spare" ? (placed ? "Take out" : "Mark spare") : status === "Under repair" ? "Under repair" : "Retire"}
          </Button>
        </>
      }
    >
      <Field label="Note" hint="Kept in the history.">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={status === "Under repair" ? "e.g. Fails memtest" : "Optional"}
          autoFocus
        />
      </Field>
    </Modal>
  );
}

/**
 * Pick a spare to install into a cabinet or place at a workstation. Only
 * spares that can go there are offered.
 */
export function PickSpareDialog({
  into,
  onClose,
}: {
  into: { cabinet: InventoryItem } | { workstationId: string };
  onClose: () => void;
}) {
  const { db, installInventoryItem, placeInventoryItem } = useStore();
  const [chosen, setChosen] = useState("");
  const [note, setNote] = useState("");
  const toCabinet = "cabinet" in into;

  const options = useMemo(
    () =>
      db.inventoryItems
        .filter((i) => i.status === "Spare")
        .filter((i) => {
          const place = INVENTORY_CATEGORIES[i.category].place;
          return toCabinet ? place !== "workstation" : place !== "cabinet";
        })
        .sort((a, b) => a.category.localeCompare(b.category) || a.assetTag.localeCompare(b.assetTag))
        .map((i) => ({
          value: i.id,
          label: `${tagOf(i)} · ${itemSummary(i)}`,
          hint: [i.category, i.brand, i.model].filter(Boolean).join(" · "),
        })),
    [db.inventoryItems, toCabinet],
  );

  const save = () => {
    if (!chosen) return;
    if ("cabinet" in into) installInventoryItem(chosen, into.cabinet.id, note.trim());
    else placeInventoryItem(chosen, into.workstationId, note.trim());
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={toCabinet ? `Install a part in ${tagOf((into as { cabinet: InventoryItem }).cabinet)}` : "Place an item at this workstation"}
      subtitle={
        toCabinet
          ? "Processor, motherboard, RAM, storage, GPU, power supply - from stock."
          : "A cabinet, monitor, keyboard, mouse, UPS or accessory - from stock."
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!chosen}>
            {toCabinet ? "Install" : "Place"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Spare"
          required
          hint={options.length ? `${options.length} in stock that fit.` : "Nothing in stock fits. Add it first."}
        >
          <SearchSelect options={options} value={chosen} onChange={setChosen} placeholder="Search by ID, brand or model…" />
        </Field>
        <Field label="Note" hint="Kept in the history.">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
    </Modal>
  );
}
