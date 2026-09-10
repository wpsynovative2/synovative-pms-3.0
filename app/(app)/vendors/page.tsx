"use client";

import { useMemo, useState } from "react";
import { IconEdit, IconPlus, IconTrash, IconTruck, IconWallet } from "@/components/ui/icons";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SearchInput,
  StatTile,
  Textarea,
} from "@/components/ui/primitives";
import { SearchSelect } from "@/components/ui/selects";
import { formatINR } from "@/lib/analytics";
import { SERVICES } from "@/lib/master-data";
import { useStore } from "@/lib/store";
import type { Vendor } from "@/lib/types";

/** §15 — directory feeding the expense form's vendor picker. */
export default function VendorsPage() {
  const { db, createVendor, updateVendor, deleteVendor } = useStore();
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [deleting, setDeleting] = useState<Vendor | null>(null);

  const spendByVendor = useMemo(() => {
    const map = new Map<string, { approved: number; count: number }>();
    for (const e of db.expenses) {
      const entry = map.get(e.vendorId) ?? { approved: 0, count: 0 };
      if (e.status === "Approved") entry.approved += e.amount;
      entry.count += 1;
      map.set(e.vendorId, entry);
    }
    return map;
  }, [db.expenses]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return db.vendors.filter(
      (v) =>
        !q ||
        v.name.toLowerCase().includes(q) ||
        v.serviceType.toLowerCase().includes(q) ||
        v.contactPerson.toLowerCase().includes(q),
    );
  }, [db.vendors, query]);

  const totalApproved = [...spendByVendor.values()].reduce((s, v) => s + v.approved, 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Vendors"
        icon={<IconTruck size={20} />}
        subtitle="Outside suppliers used when adding project expenses"
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <IconPlus size={15} /> Add vendor
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Vendors on record"
          value={db.vendors.length}
          tone="brand"
          icon={<IconTruck size={17} />}
        />
        <StatTile
          label="Approved spend"
          value={formatINR(totalApproved)}
          hint="Across all projects"
          tone="green"
          icon={<IconWallet size={17} />}
        />
        <StatTile
          label="Expense entries"
          value={db.expenses.length}
          tone="neutral"
        />
      </div>

      <SearchInput
        className="max-w-md"
        placeholder="Search vendors, services or contacts…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconTruck size={30} />}
            title="No vendors match"
            body="Add the drone operators, studios, printers and casting agencies you work with."
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((v) => {
            const spend = spendByVendor.get(v.id);
            return (
              <Card key={v.id} className="flex flex-col p-4">
                <div className="flex items-start gap-2.5">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand/15 text-[#c9b6f2]">
                    <IconTruck size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[14px] font-semibold text-ink">{v.name}</h3>
                    <p className="truncate text-[11px] text-ink-faint">{v.serviceType}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      onClick={() => {
                        setEditing(v);
                        setFormOpen(true);
                      }}
                    >
                      <IconEdit size={13} />
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => setDeleting(v)}>
                      <IconTrash size={13} />
                    </Button>
                  </div>
                </div>

                <dl className="mt-3.5 space-y-1.5 text-[12px]">
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-ink-faint">Contact</dt>
                    <dd className="min-w-0 truncate text-ink-muted">{v.contactPerson}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-ink-faint">Phone</dt>
                    <dd className="min-w-0 truncate text-ink-muted">{v.phone}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-ink-faint">Email</dt>
                    <dd className="min-w-0 truncate text-ink-muted">{v.email}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-ink-faint">Typical rate</dt>
                    <dd className="font-mono text-ink">{formatINR(v.rate)}</dd>
                  </div>
                </dl>

                {v.notes ? (
                  <p className="mt-3 rounded-lg bg-surface-2 px-2.5 py-2 text-[11px] leading-relaxed text-ink-faint">
                    {v.notes}
                  </p>
                ) : null}

                <div className="mt-auto flex items-center gap-2 border-t border-line-soft pt-3">
                  <Badge className="border-st-approved/30 bg-st-approved/15 text-st-approved">
                    {formatINR(spend?.approved ?? 0)} approved
                  </Badge>
                  <Badge>{spend?.count ?? 0} entries</Badge>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {formOpen ? (
        <VendorFormModal
          open
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          vendor={editing ?? undefined}
          onSave={(payload) => {
            if (editing) updateVendor(editing.id, payload);
            else createVendor(payload);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteVendor(deleting.id)}
        title="Delete this vendor?"
        body="Existing expenses keep their reference but will show the vendor as unknown."
      />
    </div>
  );
}

function VendorFormModal({
  open,
  onClose,
  vendor,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  vendor?: Vendor;
  onSave: (v: Omit<Vendor, "id">) => void;
}) {
  const [name, setName] = useState(vendor?.name ?? "");
  const [serviceType, setServiceType] = useState(vendor?.serviceType ?? "");
  const [contactPerson, setContactPerson] = useState(vendor?.contactPerson ?? "");
  const [phone, setPhone] = useState(vendor?.phone ?? "");
  const [email, setEmail] = useState(vendor?.email ?? "");
  const [rate, setRate] = useState(vendor ? String(vendor.rate) : "");
  const [notes, setNotes] = useState(vendor?.notes ?? "");
  const [touched, setTouched] = useState(false);

  const valid = name.trim() && serviceType && Number(rate) > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={vendor ? "Edit vendor" : "Add vendor"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              onSave({
                name: name.trim(),
                serviceType,
                contactPerson: contactPerson.trim(),
                phone: phone.trim(),
                email: email.trim(),
                rate: Number(rate),
                notes: notes.trim() || undefined,
              });
              onClose();
            }}
          >
            {vendor ? "Save changes" : "Add vendor"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Vendor name"
            required
            error={touched && !name.trim() ? "Required." : undefined}
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. SkyLens Aerials"
            />
          </Field>
          <Field
            label="Service type"
            required
            error={touched && !serviceType ? "Pick a service." : undefined}
          >
            <SearchSelect
              options={SERVICES.map((s) => ({ value: s, label: s }))}
              value={serviceType}
              onChange={setServiceType}
              placeholder="What do they supply?"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact person">
            <Input
              value={contactPerson}
              onChange={(e) => setContactPerson(e.target.value)}
              placeholder="e.g. Imran Shaikh"
            />
          </Field>
          <Field label="Phone">
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98200 00000"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ops@vendor.in"
            />
          </Field>
          <Field
            label="Typical rate (₹)"
            required
            error={touched && !(Number(rate) > 0) ? "Enter a rate." : undefined}
          >
            <Input
              type="number"
              min="1"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="18000"
            />
          </Field>
        </div>

        <Field label="Notes">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Coverage area, turnaround, payment terms…"
          />
        </Field>
      </div>
    </Modal>
  );
}
