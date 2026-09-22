"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CollabPanel } from "@/components/collab/collab-panel";
import {
  IconBuilding,
  IconContact,
  IconEdit,
  IconExternal,
  IconPlus,
  IconProperty,
  IconTrash,
} from "@/components/ui/icons";
import { ConfirmDialog, Drawer, Modal } from "@/components/ui/modal";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SearchInput,
  Select,
  StatTile,
  Tabs,
  Textarea,
} from "@/components/ui/primitives";
import { SearchSelect } from "@/components/ui/selects";
import { PARTY_STATUS_STYLE } from "@/lib/master-data";
import { canDeleteCrm, canManageCrm } from "@/lib/permissions";
import { formatDate } from "@/lib/calendar";
import { useStore, type CompanyInput } from "@/lib/store";
import type { Company, PartyStatus } from "@/lib/types";

/**
 * Module 1 — the real-estate developer master. Everything else in the CRM
 * hangs off a company, so this is the first record anyone creates.
 */
export default function CompaniesPage() {
  const { db, currentUser, deleteCompany } = useStore();
  const user = currentUser!;
  const params = useSearchParams();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<PartyStatus | "all">("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [deleting, setDeleting] = useState<Company | null>(null);
  const [openId, setOpenId] = useState<string | null>(params.get("company"));

  const mayManage = canManageCrm(user);

  const counts = useMemo(() => {
    const clients = new Map<string, number>();
    const properties = new Map<string, number>();
    for (const c of db.clients) clients.set(c.companyId, (clients.get(c.companyId) ?? 0) + 1);
    for (const p of db.properties) {
      properties.set(p.companyId, (properties.get(p.companyId) ?? 0) + 1);
    }
    return { clients, properties };
  }, [db.clients, db.properties]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return db.companies.filter(
      (c) =>
        (status === "all" || c.status === status) &&
        (!q ||
          c.name.toLowerCase().includes(q) ||
          c.legalName.toLowerCase().includes(q) ||
          c.city.toLowerCase().includes(q) ||
          c.gstin.toLowerCase().includes(q)),
    );
  }, [db.companies, query, status]);

  const open = openId ? db.companies.find((c) => c.id === openId) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Companies"
        icon={<IconBuilding size={20} />}
        subtitle="The developer master every client, property and project traces back to"
        actions={
          mayManage ? (
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <IconPlus size={15} /> Add company
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Companies"
          value={db.companies.length}
          tone="brand"
          icon={<IconBuilding size={17} />}
        />
        <StatTile
          label="Active"
          value={db.companies.filter((c) => c.status === "active").length}
          tone="green"
        />
        <StatTile
          label="Clients on record"
          value={db.clients.length}
          tone="blue"
          icon={<IconContact size={17} />}
        />
        <StatTile
          label="Properties"
          value={db.properties.length}
          tone="neutral"
          icon={<IconProperty size={17} />}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          className="max-w-md flex-1"
          placeholder="Search by name, city or GSTIN…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          className="w-auto min-w-36"
          value={status}
          onChange={(e) => setStatus(e.target.value as PartyStatus | "all")}
          aria-label="Status"
        >
          <option value="all">Any status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconBuilding size={30} />}
            title="No companies match"
            body="Add the developers you work with — their clients and properties follow."
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => (
            <Card key={c.id} className="flex flex-col p-4">
              <div className="flex items-start gap-2.5">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-brand/15 text-brand-ink">
                  {c.logoUrl ? (
                    // Logos come from anywhere the client sends them, so this
                    // stays a plain img rather than a configured next/image host.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.logoUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <IconBuilding size={17} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <button
                    onClick={() => setOpenId(c.id)}
                    className="block max-w-full truncate text-left text-[14px] font-semibold text-ink hover:text-brand-bright"
                  >
                    {c.name}
                  </button>
                  <p className="truncate text-[11px] text-ink-faint">
                    {c.city || "No city on record"}
                  </p>
                </div>
                <Badge className={PARTY_STATUS_STYLE[c.status]}>{c.status}</Badge>
              </div>

              <dl className="mt-3.5 space-y-1.5 text-[12px]">
                <Row label="Legal name" value={c.legalName} />
                <Row label="GSTIN" value={c.gstin} mono />
                <Row label="RERA" value={c.reraPromoterId} mono />
                <Row label="Phone" value={c.phone} />
              </dl>

              <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
                <Badge>{counts.clients.get(c.id) ?? 0} clients</Badge>
                <Badge>{counts.properties.get(c.id) ?? 0} properties</Badge>
                <div className="ml-auto flex gap-1">
                  {mayManage ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        setEditing(c);
                        setFormOpen(true);
                      }}
                    >
                      <IconEdit size={13} />
                    </Button>
                  ) : null}
                  {canDeleteCrm(user) ? (
                    <Button size="sm" variant="danger" onClick={() => setDeleting(c)}>
                      <IconTrash size={13} />
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {formOpen ? (
        <CompanyFormModal
          company={editing}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
        />
      ) : null}

      {open ? <CompanyDrawer company={open} onClose={() => setOpenId(null)} /> : null}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteCompany(deleting.id)}
        title={`Delete ${deleting?.name ?? "this company"}?`}
        body="Its clients and properties go with it. Projects already running keep their work but lose the link."
        confirmLabel="Delete company"
      />
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-ink-faint">{label}</dt>
      <dd className={`min-w-0 truncate text-ink-muted ${mono ? "font-mono" : ""}`}>
        {value || "—"}
      </dd>
    </div>
  );
}

/* --------------------------------------------------------------- drawer */

type Pane = "details" | "collab";

function CompanyDrawer({ company, onClose }: { company: Company; onClose: () => void }) {
  const { db, userById } = useStore();
  const [pane, setPane] = useState<Pane>("details");

  const clients = db.clients.filter((c) => c.companyId === company.id);
  const properties = db.properties.filter((p) => p.companyId === company.id);
  const owner = userById(company.accountOwnerId);

  return (
    <Drawer
      open
      onClose={onClose}
      title={company.name}
      subtitle={company.legalName || "Real-estate developer"}
      headerExtra={
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge className={PARTY_STATUS_STYLE[company.status]}>{company.status}</Badge>
          {company.city ? <Badge>{company.city}</Badge> : null}
          {owner ? <Badge>Owned by {owner.fullName}</Badge> : null}
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Tabs<Pane>
          active={pane}
          onChange={setPane}
          tabs={[
            { id: "details", label: "Details" },
            { id: "collab", label: "Comments & MOM" },
          ]}
        />

        {pane === "details" ? (
          <div className="flex flex-col gap-5">
            <Card className="p-4">
              <dl className="grid gap-2.5 text-[12px] sm:grid-cols-2">
                <Fact label="Legal name" value={company.legalName} />
                <Fact label="GSTIN" value={company.gstin} />
                <Fact label="PAN" value={company.pan} />
                <Fact label="RERA promoter ID" value={company.reraPromoterId} />
                <Fact label="Phone" value={company.phone} />
                <Fact label="Email" value={company.email} />
                <Fact label="City" value={company.city} />
                <Fact
                  label="Website"
                  value={company.website}
                  href={company.website || undefined}
                />
                <Fact
                  label="Added by"
                  value={`${userById(company.createdBy)?.fullName ?? "Unknown"} — ${formatDate(
                    company.createdAt,
                  )}`}
                />
              </dl>
              {company.address ? (
                <p className="mt-3 rounded-lg bg-surface-2 px-2.5 py-2 text-[12px] leading-relaxed text-ink-muted">
                  {company.address}
                </p>
              ) : null}
            </Card>

            <section>
              <h3 className="mb-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                Clients ({clients.length})
              </h3>
              {clients.length === 0 ? (
                <p className="text-[12px] text-ink-faint">Nobody linked yet.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {clients.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/clients?client=${c.id}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-[12px] hover:border-brand-bright/40"
                      >
                        <span className="truncate text-ink">{c.fullName}</span>
                        <span className="shrink-0 text-ink-faint">
                          {c.designation || c.role || "—"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                Properties ({properties.length})
              </h3>
              {properties.length === 0 ? (
                <p className="text-[12px] text-ink-faint">No properties on record.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {properties.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/properties?property=${p.id}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-[12px] hover:border-brand-bright/40"
                      >
                        <span className="truncate text-ink">{p.name}</span>
                        <span className="shrink-0 text-ink-faint">
                          {p.configs.length} configs
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : (
          <CollabPanel entityType="company" entityId={company.id} />
        )}
      </div>
    </Drawer>
  );
}

function Fact({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-faint">{label}</dt>
      <dd className="mt-0.5 break-words text-ink">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-brand-bright hover:underline"
          >
            {value} <IconExternal size={12} />
          </a>
        ) : (
          value || "—"
        )}
      </dd>
    </div>
  );
}

/* ----------------------------------------------------------------- form */

function CompanyFormModal({
  company,
  onClose,
}: {
  company: Company | null;
  onClose: () => void;
}) {
  const { db, createCompany, updateCompany } = useStore();
  const [form, setForm] = useState<CompanyInput>({
    name: company?.name ?? "",
    legalName: company?.legalName ?? "",
    gstin: company?.gstin ?? "",
    pan: company?.pan ?? "",
    reraPromoterId: company?.reraPromoterId ?? "",
    address: company?.address ?? "",
    city: company?.city ?? "",
    website: company?.website ?? "",
    phone: company?.phone ?? "",
    email: company?.email ?? "",
    logoUrl: company?.logoUrl ?? "",
    accountOwnerId: company?.accountOwnerId ?? null,
    status: company?.status ?? "active",
  });
  const [touched, setTouched] = useState(false);

  const set = <K extends keyof CompanyInput>(key: K, value: CompanyInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const duplicate = db.companies.some(
    (c) =>
      c.id !== company?.id &&
      c.name.trim().toLowerCase() === form.name.trim().toLowerCase(),
  );
  const valid = form.name.trim() && !duplicate;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={company ? "Edit company" : "Add company"}
      subtitle="Everything a project needs to trace back to its developer"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              const payload: CompanyInput = { ...form, name: form.name.trim() };
              if (company) updateCompany(company.id, payload);
              else createCompany(payload);
              onClose();
            }}
          >
            {company ? "Save changes" : "Add company"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Company name"
            required
            error={
              touched && !form.name.trim()
                ? "Required."
                : duplicate
                  ? "A company with this name already exists."
                  : undefined
            }
          >
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Anant Developers"
            />
          </Field>
          <Field label="Legal name" hint="As printed on the invoice, if different.">
            <Input
              value={form.legalName}
              onChange={(e) => set("legalName", e.target.value)}
              placeholder="Anant Realty Pvt. Ltd."
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="GSTIN">
            <Input
              value={form.gstin}
              onChange={(e) => set("gstin", e.target.value.toUpperCase())}
              placeholder="27AAAAA0000A1Z5"
            />
          </Field>
          <Field label="PAN">
            <Input
              value={form.pan}
              onChange={(e) => set("pan", e.target.value.toUpperCase())}
              placeholder="AAAAA0000A"
            />
          </Field>
          <Field label="RERA promoter ID">
            <Input
              value={form.reraPromoterId}
              onChange={(e) => set("reraPromoterId", e.target.value)}
              placeholder="P51700000000"
            />
          </Field>
        </div>

        <Field label="Head office address">
          <Textarea
            rows={2}
            value={form.address}
            onChange={(e) => set("address", e.target.value)}
            placeholder="Building, street, locality…"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City">
            <Input
              value={form.city}
              onChange={(e) => set("city", e.target.value)}
              placeholder="Mumbai"
            />
          </Field>
          <Field label="Website">
            <Input
              value={form.website}
              onChange={(e) => set("website", e.target.value)}
              placeholder="https://example.com"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Primary phone">
            <Input
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="+91 98200 00000"
            />
          </Field>
          <Field label="Primary email">
            <Input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="contact@example.com"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Logo URL" hint="Any public image link; shown on the company card.">
            <Input
              value={form.logoUrl}
              onChange={(e) => set("logoUrl", e.target.value)}
              placeholder="https://…/logo.png"
            />
          </Field>
          <Field label="Account owner" hint="Who owns this relationship on our side.">
            <SearchSelect
              allowClear
              options={db.users
                .filter((u) => u.active)
                .map((u) => ({ value: u.id, label: u.fullName, avatarName: u.fullName }))}
              value={form.accountOwnerId ?? ""}
              onChange={(v) => set("accountOwnerId", v || null)}
              placeholder="Nobody yet"
            />
          </Field>
        </div>

        <Field label="Status">
          <Select
            value={form.status}
            onChange={(e) => set("status", e.target.value as PartyStatus)}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
