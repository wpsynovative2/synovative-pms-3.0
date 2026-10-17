"use client";

import { useMemo, useState } from "react";
import { InventoryHistory, codeOf, deskLabel, tagOf } from "@/components/inventory/inventory-bits";
import { ItemFormModal } from "@/components/inventory/item-form";
import { PickSpareDialog, TakeOutDialog } from "@/components/inventory/pickers";
import { IconEdit, IconPlus, IconTrash } from "@/components/ui/icons";
import { ConfirmDialog, Drawer, Modal } from "@/components/ui/modal";
import { Avatar, Button, Field, Input, Textarea } from "@/components/ui/primitives";
import { SearchSelect } from "@/components/ui/selects";
import { formatDate } from "@/lib/calendar";
import { canManageInventory, canViewInventory } from "@/lib/permissions";
import { useStore, type WorkstationInput } from "@/lib/store";
import { cabinetSummary, itemSummary, type InventoryItem, type Workstation } from "@/lib/types";

/** One desk: who has it, the cabinet and what is inside it, everything else on it. */
export function WorkstationDrawer({
  desk,
  onClose,
  onEdit,
  onOpenItem,
}: {
  desk: Workstation;
  onClose: () => void;
  onEdit: () => void;
  onOpenItem: (id: string) => void;
}) {
  const { db, currentUser, userById, assignWorkstation, deleteWorkstation } = useStore();
  const mayManage = canManageInventory(currentUser!);
  const [placing, setPlacing] = useState(false);
  const [installInto, setInstallInto] = useState<InventoryItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [takingOut, setTakingOut] = useState<InventoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [allotTo, setAllotTo] = useState("");
  const [note, setNote] = useState("");

  const here = db.inventoryItems.filter((i) => i.workstationId === desk.id);
  const cabinets = here.filter((i) => i.category === "Cabinet");
  const others = here.filter((i) => i.category !== "Cabinet");
  const holder = userById(desk.assignedTo);
  const people = useMemo(
    () =>
      db.users
        .filter((u) => u.active && u.id !== desk.assignedTo)
        .map((u) => ({ value: u.id, label: u.fullName, hint: u.departments[0], avatarName: u.fullName })),
    [db.users, desk.assignedTo],
  );

  const allot = (profileId: string | null) => {
    assignWorkstation(desk.id, profileId, note.trim());
    setAllotTo("");
    setNote("");
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={<span className="font-mono">{codeOf(desk)}</span>}
      subtitle={[desk.name, desk.location].filter(Boolean).join(" · ") || "No name or location yet"}
      headerExtra={
        mayManage ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Button size="sm" variant="primary" onClick={() => setPlacing(true)}>
              Place from stock
            </Button>
            <Button size="sm" onClick={() => setAdding(true)}>
              <IconPlus size={13} /> Add new item here
            </Button>
            <Button size="sm" onClick={onEdit}>
              <IconEdit size={13} /> Edit
            </Button>
            <Button size="sm" variant="danger" aria-label="Delete workstation" onClick={() => setDeleting(true)}>
              <IconTrash size={13} />
            </Button>
          </div>
        ) : null
      }
    >
      <div className="flex flex-col gap-5">
        <section className="rounded-card border border-line-soft bg-surface-2 p-3">
          <div className="text-[11px] tracking-wide text-ink-faint uppercase">Allotted to</div>
          {holder ? (
            <div className="mt-1.5 flex items-center gap-2.5">
              <Avatar name={holder.fullName} size={28} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-ink">{holder.fullName}</div>
                <div className="text-[11px] text-ink-faint">
                  {holder.departments[0] ?? ""}
                  {desk.assignedAt ? ` · since ${formatDate(desk.assignedAt)}` : ""}
                </div>
              </div>
              {mayManage ? (
                <Button size="sm" onClick={() => allot(null)}>
                  Take back
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="mt-1 text-[13px] text-ink-muted">Nobody - a free desk.</div>
          )}
          {mayManage ? (
            <div className="mt-3 flex flex-col gap-2 border-t border-line-soft pt-3">
              <div className="flex flex-wrap gap-2">
                <div className="min-w-0 flex-1">
                  <SearchSelect
                    options={people}
                    value={allotTo}
                    onChange={setAllotTo}
                    placeholder={holder ? "Give it to someone else…" : "Allot to…"}
                  />
                </div>
                <Button variant="primary" disabled={!allotTo} onClick={() => allot(allotTo)}>
                  Allot
                </Button>
              </div>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note for the history (optional), e.g. New joiner"
              />
            </div>
          ) : null}
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
            Cabinet{cabinets.length === 1 ? "" : "s"}
          </h3>
          {cabinets.length === 0 ? (
            <p className="text-[12px] text-ink-faint">No cabinet at this desk yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {cabinets.map((c) => {
                const parts = db.inventoryItems.filter((p) => p.cabinetId === c.id);
                return (
                  <div key={c.id} className="rounded-card border border-line-soft">
                    <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-3 py-2">
                      <button className="font-mono text-[12px] text-brand-bright hover:underline" onClick={() => onOpenItem(c.id)}>
                        {tagOf(c)}
                      </button>
                      <span className="min-w-0 flex-1 truncate text-[12px] text-ink-muted">
                        {cabinetSummary(parts) || [c.brand, c.model].filter(Boolean).join(" ") || "Cabinet"}
                      </span>
                      {mayManage ? (
                        <>
                          <Button size="sm" onClick={() => setInstallInto(c)}>
                            Install part
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setTakingOut(c)}>
                            Remove
                          </Button>
                        </>
                      ) : null}
                    </div>
                    {parts.length ? (
                      <ul className="divide-y divide-line-soft">
                        {parts.map((p) => (
                          <PartRow
                            key={p.id}
                            item={p}
                            onOpen={() => onOpenItem(p.id)}
                            onTakeOut={mayManage ? () => setTakingOut(p) : undefined}
                          />
                        ))}
                      </ul>
                    ) : (
                      <p className="px-3 py-2.5 text-[12px] text-ink-faint">Nothing installed.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
            On the desk ({others.length})
          </h3>
          {others.length ? (
            <ul className="divide-y divide-line-soft rounded-card border border-line-soft">
              {others.map((p) => (
                <PartRow
                  key={p.id}
                  item={p}
                  onOpen={() => onOpenItem(p.id)}
                  onTakeOut={mayManage ? () => setTakingOut(p) : undefined}
                />
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-ink-faint">No monitor, keyboard or other item yet.</p>
          )}
        </section>

        {desk.notes ? (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-muted">
            {desk.notes}
          </p>
        ) : null}

        {canViewInventory(currentUser!) ? (
          <InventoryHistory
            target={{ workstationId: desk.id }}
            refreshKey={`${desk.assignedTo}|${here.length}|${db.inventoryItems.filter((i) => cabinets.some((c) => c.id === i.cabinetId)).length}`}
          />
        ) : null}
      </div>

      {placing ? <PickSpareDialog into={{ workstationId: desk.id }} onClose={() => setPlacing(false)} /> : null}
      {installInto ? <PickSpareDialog into={{ cabinet: installInto }} onClose={() => setInstallInto(null)} /> : null}
      {adding ? (
        <ItemFormModal
          initialCategory="Monitor"
          initialPlacement={{ workstationId: desk.id }}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {takingOut ? <TakeOutDialog item={takingOut} status="Spare" onClose={() => setTakingOut(null)} /> : null}
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => {
          deleteWorkstation(desk.id);
          onClose();
        }}
        title={`Delete ${deskLabel(desk)}?`}
        body={
          here.length
            ? `Everything on it (${here.length} item${here.length === 1 ? "" : "s"}) goes back to stock as spare; parts stay inside their cabinet. Its history is kept.`
            : "Its history is kept."
        }
        confirmLabel="Delete workstation"
      />
    </Drawer>
  );
}

function PartRow({
  item,
  onOpen,
  onTakeOut,
}: {
  item: InventoryItem;
  onOpen: () => void;
  onTakeOut?: () => void;
}) {
  return (
    <li className="flex items-center gap-3 px-3 py-2 text-[12px]">
      <span className="w-24 shrink-0 text-ink-faint">{item.category}</span>
      <button onClick={onOpen} className="min-w-0 flex-1 truncate text-left text-ink hover:text-brand-bright">
        {itemSummary(item)}
        {item.brand || item.model ? (
          <span className="text-ink-faint"> · {[item.brand, item.model].filter(Boolean).join(" ")}</span>
        ) : null}
      </button>
      <span className="shrink-0 font-mono text-[11px] text-ink-muted">{tagOf(item)}</span>
      {onTakeOut ? (
        <Button size="sm" variant="ghost" onClick={onTakeOut}>
          Take out
        </Button>
      ) : null}
    </li>
  );
}

/** Add or edit a workstation's name, location and notes. Its code is generated. */
export function WorkstationFormModal({ desk, onClose }: { desk?: Workstation; onClose: () => void }) {
  const { addWorkstation, updateWorkstation } = useStore();
  const [form, setForm] = useState<WorkstationInput>({
    name: desk?.name ?? "",
    location: desk?.location ?? "",
    notes: desk?.notes ?? "",
  });
  const save = () => {
    const payload = { name: form.name.trim(), location: form.location.trim(), notes: form.notes.trim() };
    if (desk) updateWorkstation(desk.id, payload);
    else addWorkstation(payload);
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={desk ? `Edit ${codeOf(desk)}` : "Add workstation"}
      subtitle={desk ? undefined : "Its code (WS-001) is given when it is saved."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            {desk ? "Save changes" : "Add workstation"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Design desk 4" />
        </Field>
        <Field label="Location">
          <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Floor 1, design bay" />
        </Field>
        <Field label="Notes">
          <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
