"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { CollabPanel } from "@/components/collab/collab-panel";
import {
  IconCrane,
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
import { MultiSelect, SearchSelect } from "@/components/ui/selects";
import { PARTY_STATUS_STYLE } from "@/lib/master-data";
import {
  canDeleteCrm,
  canManageCrm,
  canSeeClientDetails,
  canSeeClients,
  canSeeCrmPhones,
  canViewClientsModule,
} from "@/lib/permissions";
import { formatDate } from "@/lib/calendar";
import { useStore, type CompanyInput } from "@/lib/store";
import {
  CLIENT_ROLES,
  COMPANY_NATURES,
  type ClientRole,
  type Company,
  type PartyStatus,
} from "@/lib/types";

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
          c.nature.toLowerCase().includes(q) ||
          c.city.toLowerCase().includes(q) ||
          c.gstin.toLowerCase().includes(q)),
    );
  }, [db.companies, query, status]);

  const open = openId ? db.companies.find((c) => c.id === openId) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Companies"
        icon={<IconCrane size={20} />}
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
          icon={<IconCrane size={17} />}
        />
        <StatTile
          label="Active"
          value={db.companies.filter((c) => c.status === "active").length}
          tone="green"
        />
        {canSeeClients(user) ? (
          <StatTile
            label="Clients on record"
            value={db.clients.length}
            tone="blue"
            icon={<IconContact size={17} />}
          />
        ) : null}
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
          active={!!query.trim()}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          className="w-auto min-w-36"
          value={status}
          active={status !== "all"}
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
            icon={<IconCrane size={30} />}
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
                    <IconCrane size={17} />
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
                <Row label="Nature" value={c.nature} />
                <Row label="Legal name" value={c.legalName} />
                <Row label="GSTIN" value={c.gstin} mono />
                <Row label="RERA" value={c.reraPromoterId} mono />
                {canSeeCrmPhones(user) ? <Row label="Phone" value={c.phone} /> : null}
              </dl>

              <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
                {canSeeClients(user) ? (
                  <Badge>{counts.clients.get(c.id) ?? 0} clients</Badge>
                ) : null}
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
  const { db, userById, currentUser } = useStore();
  // Names are fine to show; the contact book itself is for managers.
  const mayOpenClients = canViewClientsModule(currentUser!);
  const maySeeClients = canSeeClients(currentUser!);
  const mayClientDetails = canSeeClientDetails(currentUser!);
  const mayPhones = canSeeCrmPhones(currentUser!);
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
                <Fact label="Nature of company" value={company.nature} />
                <Fact label="Legal name" value={company.legalName} />
                <Fact label="GSTIN" value={company.gstin} />
                <Fact label="PAN" value={company.pan} />
                <Fact label="RERA promoter ID" value={company.reraPromoterId} />
                {mayPhones ? <Fact label="Phone" value={company.phone} /> : null}
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

            {maySeeClients ? (
              <section>
                <h3 className="mb-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                  Clients ({clients.length})
                </h3>
                {clients.length === 0 ? (
                  <p className="text-[12px] text-ink-faint">Nobody linked yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {clients.map((c) => {
                      // Numbers for those allowed them (0020): Business
                      // Development calls these people.
                      const numbers = mayClientDetails
                        ? [
                            c.mobile ? `Mobile ${c.mobile}` : "",
                            c.whatsapp && c.whatsapp !== c.mobile ? `WhatsApp ${c.whatsapp}` : "",
                          ].filter(Boolean)
                        : [];
                      const body = (
                        <>
                          <span className="min-w-0">
                            <span className="block truncate text-ink">{c.fullName}</span>
                            {numbers.length ? (
                              <span className="mt-0.5 block truncate font-mono text-[11px] text-ink-muted">
                                {numbers.join(" · ")}
                              </span>
                            ) : mayClientDetails ? (
                              <span className="mt-0.5 block text-[11px] text-ink-faint">No number</span>
                            ) : null}
                          </span>
                          {mayClientDetails ? (
                            <span className="shrink-0 text-ink-faint">
                              {c.designation || c.role || "—"}
                            </span>
                          ) : null}
                        </>
                      );
                      const box =
                        "flex items-center justify-between gap-2 rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-[12px]";
                      return (
                        <li key={c.id}>
                          {mayOpenClients ? (
                            <Link
                              href={`/clients?client=${c.id}`}
                              className={`${box} hover:border-brand-bright/40`}
                            >
                              {body}
                            </Link>
                          ) : (
                            <div className={box}>{body}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ) : null}

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

/**
 * Contacts and properties typed alongside a new company. They are written
 * after the company, in the order listed — `commit()` queues each write behind
 * the last, so the company row exists before anything points at it. `key` is
 * only for the form; the property's contact picks are mapped to the real
 * client ids at save time.
 */
interface DraftClient {
  key: string;
  fullName: string;
  designation: string;
  mobile: string;
  whatsapp: string;
  email: string;
  role: ClientRole | null;
}

interface DraftProperty {
  key: string;
  name: string;
  maharera: string;
  address: string;
  clientKeys: string[];
}

const draftKey = () => crypto.randomUUID();

const blankClient = (): DraftClient => ({
  key: draftKey(),
  fullName: "",
  designation: "",
  mobile: "",
  whatsapp: "",
  email: "",
  role: null,
});

const blankProperty = (): DraftProperty => ({
  key: draftKey(),
  name: "",
  maharera: "",
  address: "",
  clientKeys: [],
});

function CompanyFormModal({
  company,
  onClose,
}: {
  company: Company | null;
  onClose: () => void;
}) {
  const { db, currentUser, createCompany, updateCompany, createClient, createProperty } =
    useStore();
  const [clients, setClients] = useState<DraftClient[]>([]);
  const [properties, setProperties] = useState<DraftProperty[]>([]);

  const setClient = (key: string, patch: Partial<DraftClient>) =>
    setClients((list) => list.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const setProperty = (key: string, patch: Partial<DraftProperty>) =>
    setProperties((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const removeClient = (key: string) => {
    setClients((list) => list.filter((c) => c.key !== key));
    // A property cannot keep a contact who is no longer being added.
    setProperties((list) =>
      list.map((p) => ({ ...p, clientKeys: p.clientKeys.filter((k) => k !== key) })),
    );
  };
  // Someone who cannot see the number must not be able to wipe it either.
  const mayPhones = canSeeCrmPhones(currentUser!);
  const [form, setForm] = useState<CompanyInput>({
    name: company?.name ?? "",
    nature: company?.nature ?? "",
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
  // "Others" is a choice in the list but not a stored value: what is stored
  // is the name typed beside it. A saved value outside the list was typed.
  const [natureOther, setNatureOther] = useState(
    !!company?.nature && !(COMPANY_NATURES as readonly string[]).includes(company.nature),
  );

  const set = <K extends keyof CompanyInput>(key: K, value: CompanyInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const duplicate = db.companies.some(
    (c) =>
      c.id !== company?.id &&
      c.name.trim().toLowerCase() === form.name.trim().toLowerCase(),
  );
  const natureMissing = natureOther && !form.nature.trim();
  const clientMissingName = clients.some((c) => !c.fullName.trim());
  const propertyMissingName = properties.some((p) => !p.name.trim());
  const valid =
    form.name.trim() && !duplicate && !natureMissing && !clientMissingName && !propertyMissingName;

  // Properties may name the contacts being added here, once they have a name.
  const draftClientOptions = clients
    .filter((c) => c.fullName.trim())
    .map((c) => ({ value: c.key, label: c.fullName.trim(), hint: c.designation }));

  return (
    <Modal
      open
      onClose={onClose}
      size={company ? "lg" : "xl"}
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
              const payload: CompanyInput = {
                ...form,
                name: form.name.trim(),
                nature: form.nature.trim(),
              };
              if (company) {
                const { phone, ...rest } = payload;
                updateCompany(company.id, mayPhones ? { ...rest, phone } : rest);
              } else {
                const created = createCompany(payload);
                const clientIds = new Map<string, string>();
                for (const c of clients) {
                  const { key, ...rest } = c;
                  const client = createClient({
                    ...rest,
                    companyId: created.id,
                    fullName: c.fullName.trim(),
                    status: "active",
                  });
                  clientIds.set(key, client.id);
                }
                for (const p of properties) {
                  createProperty({
                    companyId: created.id,
                    clientId: null,
                    clientIds: p.clientKeys.flatMap((k) => clientIds.get(k) ?? []),
                    name: p.name.trim(),
                    description: "",
                    address: p.address,
                    mapsUrl: "",
                    maharera: p.maharera,
                    configs: [],
                  });
                }
              }
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

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nature of company">
            <Select
              value={natureOther ? "__other__" : form.nature}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__other__") {
                  setNatureOther(true);
                  set("nature", "");
                } else {
                  setNatureOther(false);
                  set("nature", v);
                }
              }}
            >
              <option value="">Not set</option>
              {COMPANY_NATURES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
              <option value="__other__">Others</option>
            </Select>
          </Field>
          {natureOther ? (
            <Field
              label="Other — say what it is"
              required
              error={touched && natureMissing ? "Type the nature of the company." : undefined}
            >
              <Input
                autoFocus
                value={form.nature}
                onChange={(e) => set("nature", e.target.value)}
                placeholder="e.g. Land owner, Architect, Media agency"
              />
            </Field>
          ) : null}
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
          {mayPhones ? (
            <Field label="Primary phone">
              <Input
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="+91 98200 00000"
              />
            </Field>
          ) : null}
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

        {company ? null : (
          <>
            <DraftSection
              title="Clients"
              count={clients.length}
              hint="People at this company. More can be added from Clients later."
              error={
                touched && clientMissingName ? "Every client needs a full name." : undefined
              }
              addLabel="Add client"
              onAdd={() => setClients((list) => [...list, blankClient()])}
            >
              {clients.map((c) => (
                <DraftRow key={c.key} onRemove={() => removeClient(c.key)} label="Remove client">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Input
                      value={c.fullName}
                      onChange={(e) => setClient(c.key, { fullName: e.target.value })}
                      placeholder="Full name *"
                      aria-label="Full name"
                    />
                    <Input
                      value={c.designation}
                      onChange={(e) => setClient(c.key, { designation: e.target.value })}
                      placeholder="Designation"
                      aria-label="Designation"
                    />
                    <Select
                      value={c.role ?? ""}
                      onChange={(e) =>
                        setClient(c.key, { role: (e.target.value || null) as ClientRole | null })
                      }
                      aria-label="Role"
                    >
                      <option value="">Role not set</option>
                      {CLIENT_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </Select>
                    <Input
                      value={c.mobile}
                      onChange={(e) => setClient(c.key, { mobile: e.target.value })}
                      placeholder="Mobile"
                      aria-label="Mobile"
                    />
                    <Input
                      value={c.whatsapp}
                      onChange={(e) => setClient(c.key, { whatsapp: e.target.value })}
                      placeholder="WhatsApp (if different)"
                      aria-label="WhatsApp"
                    />
                    <Input
                      type="email"
                      value={c.email}
                      onChange={(e) => setClient(c.key, { email: e.target.value })}
                      placeholder="Email"
                      aria-label="Email"
                    />
                  </div>
                </DraftRow>
              ))}
            </DraftSection>

            <DraftSection
              title="Properties"
              count={properties.length}
              hint="Unit mix and the Drive folder are added from Properties afterwards."
              error={
                touched && propertyMissingName ? "Every property needs a name." : undefined
              }
              addLabel="Add property"
              onAdd={() => setProperties((list) => [...list, blankProperty()])}
            >
              {properties.map((p) => (
                <DraftRow
                  key={p.key}
                  onRemove={() =>
                    setProperties((list) => list.filter((x) => x.key !== p.key))
                  }
                  label="Remove property"
                >
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      value={p.name}
                      onChange={(e) => setProperty(p.key, { name: e.target.value })}
                      placeholder="Property name *"
                      aria-label="Property name"
                    />
                    <Input
                      value={p.maharera}
                      onChange={(e) => setProperty(p.key, { maharera: e.target.value })}
                      placeholder="MahaRERA number"
                      aria-label="MahaRERA number"
                    />
                    <Input
                      value={p.address}
                      onChange={(e) => setProperty(p.key, { address: e.target.value })}
                      placeholder="Site address"
                      aria-label="Site address"
                    />
                    <MultiSelect
                      disabled={draftClientOptions.length === 0}
                      options={draftClientOptions}
                      value={p.clientKeys}
                      onChange={(v) => setProperty(p.key, { clientKeys: v })}
                      placeholder="Search contacts…"
                      emptyLabel={
                        draftClientOptions.length
                          ? "No contacts linked"
                          : "Add a client above to link one"
                      }
                    />
                  </div>
                </DraftRow>
              ))}
            </DraftSection>
          </>
        )}
      </div>
    </Modal>
  );
}

function DraftSection({
  title,
  count,
  hint,
  error,
  addLabel,
  onAdd,
  children,
}: {
  title: string;
  count: number;
  hint: string;
  error?: string;
  addLabel: string;
  onAdd: () => void;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 border-t border-line-soft pt-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[11px] font-medium tracking-wide text-ink-muted uppercase">
            {title}
            {count ? ` (${count})` : ""}
          </h3>
          <p className="text-[11px] text-ink-faint">{hint}</p>
        </div>
        <Button size="sm" onClick={onAdd}>
          <IconPlus size={14} /> {addLabel}
        </Button>
      </div>
      {children}
      {error ? <p className="text-[11px] text-st-rejected">{error}</p> : null}
    </section>
  );
}

function DraftRow({
  label,
  onRemove,
  children,
}: {
  label: string;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 rounded-card border border-line-soft bg-surface-2 p-2.5">
      <div className="min-w-0 flex-1">{children}</div>
      <Button variant="ghost" aria-label={label} onClick={onRemove}>
        <IconTrash size={14} />
      </Button>
    </div>
  );
}
