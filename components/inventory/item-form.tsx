"use client";

import { useMemo, useState } from "react";
import { SpecFields, deskLabel, tagOf } from "@/components/inventory/inventory-bits";
import { DatePicker } from "@/components/ui/date-picker";
import { Modal } from "@/components/ui/modal";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { SearchSelect } from "@/components/ui/selects";
import { useStore, type InventoryItemInput, type InventoryPlacement } from "@/lib/store";
import {
  INVENTORY_CATEGORIES,
  INVENTORY_CATEGORY_LIST,
  itemSummary,
  type InventoryCategory,
  type InventoryItem,
} from "@/lib/types";

const blank = (category: InventoryCategory): InventoryItemInput => ({
  category,
  brand: "",
  model: "",
  serialNumber: "",
  specs: {},
  purchaseDate: null,
  price: null,
  vendorId: null,
  warrantyUntil: null,
  notes: "",
});

/**
 * Add a component, or edit one. Adding can put it straight into a cabinet or
 * at a workstation, and "Add another like this" keeps every detail but the
 * serial, so ten identical RAM sticks are quick to enter.
 */
export function ItemFormModal({
  item,
  initialCategory = "RAM",
  initialPlacement = null,
  onClose,
}: {
  item?: InventoryItem;
  initialCategory?: InventoryCategory;
  initialPlacement?: InventoryPlacement;
  onClose: () => void;
}) {
  const { db, addInventoryItem, updateInventoryItem, showToast } = useStore();
  const [form, setForm] = useState<InventoryItemInput>(() =>
    item
      ? {
          category: item.category,
          brand: item.brand,
          model: item.model,
          serialNumber: item.serialNumber,
          specs: item.specs,
          purchaseDate: item.purchaseDate,
          price: item.price,
          vendorId: item.vendorId,
          warrantyUntil: item.warrantyUntil,
          notes: item.notes,
        }
      : blank(initialCategory),
  );
  const [placeKind, setPlaceKind] = useState<"none" | "cabinet" | "workstation">(
    initialPlacement ? ("cabinetId" in initialPlacement ? "cabinet" : "workstation") : "none",
  );
  const [placeId, setPlaceId] = useState(
    initialPlacement
      ? "cabinetId" in initialPlacement
        ? initialPlacement.cabinetId
        : initialPlacement.workstationId
      : "",
  );
  const [added, setAdded] = useState(0);
  const set = <K extends keyof InventoryItemInput>(key: K, value: InventoryItemInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const place = INVENTORY_CATEGORIES[form.category].place;
  const canCabinet = place !== "workstation";
  const canDesk = place !== "cabinet";
  const kind = placeKind === "cabinet" && !canCabinet ? "none" : placeKind === "workstation" && !canDesk ? "none" : placeKind;

  const cabinets = useMemo(
    () =>
      db.inventoryItems
        .filter((i) => i.category === "Cabinet" && i.status !== "Retired")
        .map((c) => {
          const desk = db.workstations.find((w) => w.id === c.workstationId);
          return {
            value: c.id,
            label: `${tagOf(c)} ${itemSummary(c) !== "Cabinet" ? `· ${itemSummary(c)}` : ""}`.trim(),
            hint: desk ? deskLabel(desk) : "Not at a desk",
          };
        }),
    [db.inventoryItems, db.workstations],
  );
  const desks = useMemo(
    () => db.workstations.map((w) => ({ value: w.id, label: deskLabel(w), hint: w.location || undefined })),
    [db.workstations],
  );

  const serial = form.serialNumber.trim().toLowerCase();
  const duplicate =
    !!serial &&
    db.inventoryItems.find((i) => i.id !== item?.id && i.serialNumber.trim().toLowerCase() === serial);

  const save = (another: boolean) => {
    if (duplicate) return;
    const payload: InventoryItemInput = {
      ...form,
      brand: form.brand.trim(),
      model: form.model.trim(),
      serialNumber: form.serialNumber.trim(),
      notes: form.notes.trim(),
    };
    if (item) {
      const { category: _category, ...patch } = payload;
      void _category;
      updateInventoryItem(item.id, patch);
      onClose();
      return;
    }
    const placement: InventoryPlacement =
      kind === "cabinet" && placeId ? { cabinetId: placeId } : kind === "workstation" && placeId ? { workstationId: placeId } : null;
    addInventoryItem(payload, placement);
    if (another) {
      setAdded((n) => n + 1);
      set("serialNumber", "");
      showToast(`${form.category} added. Its details are kept for the next one.`, "success");
    } else {
      onClose();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={item ? `Edit ${tagOf(item)}` : "Add component"}
      subtitle={
        item
          ? `${item.category} · the asset ID and category never change.`
          : added
            ? `${added} added so far. The asset ID is given when it is saved.`
            : "The asset ID (SYN-RAM-0001) is given when it is saved."
      }
      footer={
        <>
          <Button onClick={onClose}>{added ? "Done" : "Cancel"}</Button>
          {!item ? (
            <Button onClick={() => save(true)} disabled={!!duplicate}>
              Add another like this
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => save(false)} disabled={!!duplicate}>
            {item ? "Save changes" : "Add component"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Category" required>
            <Select
              value={form.category}
              disabled={!!item}
              onChange={(e) => {
                const category = e.target.value as InventoryCategory;
                // Details belong to a category; switching starts them afresh.
                setForm((f) => ({ ...f, category, specs: {} }));
              }}
            >
              {INVENTORY_CATEGORY_LIST.map((c) => (
                <option key={c} value={c}>
                  {c}
                  {c === "Storage" ? " (SSD / HDD, “ROM”)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Brand">
            <Input value={form.brand} onChange={(e) => set("brand", e.target.value)} placeholder="e.g. Kingston" />
          </Field>
          <Field label="Model">
            <Input value={form.model} onChange={(e) => set("model", e.target.value)} placeholder="e.g. Fury Beast" />
          </Field>
        </div>

        <Field
          label="Serial number"
          hint="The manufacturer's. Leave blank if it has none."
          error={duplicate ? `${tagOf(duplicate)} already has this serial number.` : undefined}
        >
          <Input
            value={form.serialNumber}
            onChange={(e) => set("serialNumber", e.target.value)}
            placeholder="Printed on the label"
          />
        </Field>

        <div className="rounded-card border border-line-soft p-3">
          <div className="mb-3 text-[12px] font-medium text-ink">{form.category} details</div>
          <SpecFields category={form.category} value={form.specs} onChange={(specs) => set("specs", specs)} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Purchase date">
            <DatePicker
              value={form.purchaseDate ?? ""}
              onChange={(v) => set("purchaseDate", v || null)}
              config={db.calendar}
              ignoreWorkingRules
              allowPast
              clearable
            />
          </Field>
          <Field label="Warranty until">
            <DatePicker
              value={form.warrantyUntil ?? ""}
              onChange={(v) => set("warrantyUntil", v || null)}
              config={db.calendar}
              ignoreWorkingRules
              allowPast
              clearable
            />
          </Field>
          <Field label="Price (₹)">
            <Input
              type="number"
              min={0}
              step="any"
              value={form.price ?? ""}
              onChange={(e) => set("price", e.target.value === "" ? null : Math.max(0, Number(e.target.value)))}
            />
          </Field>
          <Field label="Vendor" hint={db.vendors.length ? undefined : "Add vendors under Vendors."}>
            <SearchSelect
              options={db.vendors.map((v) => ({ value: v.id, label: v.name, hint: v.serviceType ?? undefined }))}
              value={form.vendorId ?? ""}
              onChange={(v) => set("vendorId", v || null)}
              placeholder="Bought from…"
              allowClear
            />
          </Field>
        </div>

        {!item ? (
          <Field label="Where it goes now">
            <div className="flex flex-col gap-2">
              <Select
                value={kind}
                onChange={(e) => {
                  setPlaceKind(e.target.value as typeof placeKind);
                  setPlaceId("");
                }}
              >
                <option value="none">In stock (spare)</option>
                {canCabinet ? <option value="cabinet">Install in a cabinet</option> : null}
                {canDesk ? <option value="workstation">Place at a workstation</option> : null}
              </Select>
              {kind === "cabinet" ? (
                <SearchSelect options={cabinets} value={placeId} onChange={setPlaceId} placeholder="Pick a cabinet…" />
              ) : kind === "workstation" ? (
                <SearchSelect options={desks} value={placeId} onChange={setPlaceId} placeholder="Pick a workstation…" />
              ) : null}
              {kind !== "none" && !placeId ? (
                <span className="text-[11px] text-ink-faint">
                  Pick one, or it is added to stock.{" "}
                  {kind === "workstation" && !desks.length ? "There are no workstations yet." : null}
                  {kind === "cabinet" && !cabinets.length ? "There are no cabinets yet." : null}
                </span>
              ) : null}
            </div>
          </Field>
        ) : null}

        <Field label="Notes">
          <Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
