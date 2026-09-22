"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CollabPanel } from "@/components/collab/collab-panel";
import {
  IconBuilding,
  IconContact,
  IconEdit,
  IconPlus,
  IconProperty,
  IconTrash,
  IconWhatsApp,
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
} from "@/components/ui/primitives";
import { SearchSelect } from "@/components/ui/selects";
import { PARTY_STATUS_STYLE } from "@/lib/master-data";
import { canDeleteCrm, canManageCrm } from "@/lib/permissions";
import { formatDate } from "@/lib/calendar";
import { useStore, type ClientInput } from "@/lib/store";
import { CLIENT_ROLES, type Client, type ClientRole, type PartyStatus } from "@/lib/types";

/**
 * Module 2 — the people at a company. A client always belongs to exactly one
 * company, which is why the company picker is required and comes first.
 */
export default function ClientsPage() {
  const { db, currentUser, companyById, deleteClient } = useStore();
  const user = currentUser!;
  const params = useSearchParams();

  const [query, setQuery] = useState("");
  const [companyId, setCompanyId] = useState(params.get("company") ?? "");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState<Client | null>(null);
  const [openId, setOpenId] = useState<string | null>(params.get("client"));

  const mayManage = canManageCrm(user);
  const noCompanies = db.companies.length === 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return db.clients.filter(
      (c) =>
        (!companyId || c.companyId === companyId) &&
        (!q ||
          c.fullName.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.mobile.includes(q) ||
          c.designation.toLowerCase().includes(q)),
    );
  }, [db.clients, query, companyId]);

  const open = openId ? db.clients.find((c) => c.id === openId) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Clients"
        icon={<IconContact size={20} />}
        subtitle="The people behind each company — decision makers, influencers and coordinators"
        actions={
          mayManage ? (
            <Button
              variant="primary"
              disabled={noCompanies}
              title={noCompanies ? "Add a company first" : undefined}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <IconPlus size={15} /> Add client
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Clients"
          value={db.clients.length}
          tone="brand"
          icon={<IconContact size={17} />}
        />
        <StatTile
          label="Decision makers"
          value={db.clients.filter((c) => c.role === "Decision Maker").length}
          tone="green"
        />
        <StatTile
          label="Active"
          value={db.clients.filter((c) => c.status === "active").length}
          tone="blue"
        />
        <StatTile
          label="Companies covered"
          value={new Set(db.clients.map((c) => c.companyId)).size}
          tone="neutral"
          icon={<IconBuilding size={17} />}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          className="max-w-md flex-1"
          placeholder="Search by name, email, phone or designation…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="w-60">
          <SearchSelect
            allowClear
            options={db.companies.map((c) => ({ value: c.id, label: c.name }))}
            value={companyId}
            onChange={setCompanyId}
            placeholder="Any company"
          />
        </div>
      </div>

      {noCompanies ? (
        <Card>
          <EmptyState
            icon={<IconBuilding size={30} />}
            title="No companies yet"
            body="A client is always attached to a company, so start there."
            action={
              <Link href="/companies">
                <Button variant="primary">Go to Companies</Button>
              </Link>
            }
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconContact size={30} />}
            title="No clients match"
            body="Add the people you actually talk to at each developer."
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => {
            const company = companyById(c.companyId);
            const properties = db.properties.filter((p) => p.clientId === c.id);
            return (
              <Card key={c.id} className="flex flex-col p-4">
                <div className="flex items-start gap-2.5">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand/15 text-brand-ink">
                    <IconContact size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <button
                      onClick={() => setOpenId(c.id)}
                      className="block max-w-full truncate text-left text-[14px] font-semibold text-ink hover:text-brand-bright"
                    >
                      {c.fullName}
                    </button>
                    <p className="truncate text-[11px] text-ink-faint">
                      {c.designation || "No designation"}
                    </p>
                  </div>
                  <Badge className={PARTY_STATUS_STYLE[c.status]}>{c.status}</Badge>
                </div>

                <Link
                  href={`/companies?company=${c.companyId}`}
                  className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-brand-bright hover:underline"
                >
                  <IconBuilding size={13} /> {company?.name ?? "Unknown company"}
                </Link>

                <dl className="mt-2.5 space-y-1.5 text-[12px]">
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-ink-faint">Mobile</dt>
                    <dd className="min-w-0 truncate text-ink-muted">{c.mobile || "—"}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-ink-faint">Email</dt>
                    <dd className="min-w-0 truncate text-ink-muted">{c.email || "—"}</dd>
                  </div>
                </dl>

                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
                  {c.role ? <Badge>{c.role}</Badge> : null}
                  <Badge>{properties.length} properties</Badge>
                  <div className="ml-auto flex gap-1">
                    {c.whatsapp ? (
                      <a
                        href={`https://wa.me/${c.whatsapp.replace(/[^\d]/g, "")}`}
                        target="_blank"
                        rel="noreferrer"
                        title="Message on WhatsApp"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface-2 text-ink-muted hover:text-ink"
                      >
                        <IconWhatsApp size={14} />
                      </a>
                    ) : null}
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
            );
          })}
        </div>
      )}

      {formOpen ? (
        <ClientFormModal
          client={editing}
          defaultCompanyId={companyId}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
        />
      ) : null}

      {open ? <ClientDrawer client={open} onClose={() => setOpenId(null)} /> : null}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteClient(deleting.id)}
        title={`Delete ${deleting?.fullName ?? "this client"}?`}
        body="Their properties stay on record — they simply lose their named contact."
        confirmLabel="Delete client"
      />
    </div>
  );
}

/* --------------------------------------------------------------- drawer */

type Pane = "details" | "collab";

function ClientDrawer({ client, onClose }: { client: Client; onClose: () => void }) {
  const { db, companyById, userById } = useStore();
  const [pane, setPane] = useState<Pane>("details");
  const company = companyById(client.companyId);
  const properties = db.properties.filter((p) => p.clientId === client.id);

  return (
    <Drawer
      open
      onClose={onClose}
      title={client.fullName}
      subtitle={company?.name ?? "Unknown company"}
      headerExtra={
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge className={PARTY_STATUS_STYLE[client.status]}>{client.status}</Badge>
          {client.role ? <Badge>{client.role}</Badge> : null}
          {client.designation ? <Badge>{client.designation}</Badge> : null}
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
                <Fact label="Mobile" value={client.mobile} />
                <Fact label="WhatsApp" value={client.whatsapp} />
                <Fact label="Email" value={client.email} />
                <Fact label="Designation" value={client.designation} />
                <Fact label="Role" value={client.role ?? ""} />
                <Fact label="Company" value={company?.name ?? ""} />
                <Fact
                  label="Added by"
                  value={`${userById(client.createdBy)?.fullName ?? "Unknown"} — ${formatDate(
                    client.createdAt,
                  )}`}
                />
              </dl>
            </Card>

            <section>
              <h3 className="mb-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                Properties ({properties.length})
              </h3>
              {properties.length === 0 ? (
                <p className="text-[12px] text-ink-faint">
                  No property is filed under this contact yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {properties.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/properties?property=${p.id}`}
                        className="flex items-center gap-2 rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-[12px] text-ink hover:border-brand-bright/40"
                      >
                        <IconProperty size={14} /> {p.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : (
          <CollabPanel entityType="client" entityId={client.id} />
        )}
      </div>
    </Drawer>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-faint">{label}</dt>
      <dd className="mt-0.5 break-words text-ink">{value || "—"}</dd>
    </div>
  );
}

/* ----------------------------------------------------------------- form */

function ClientFormModal({
  client,
  defaultCompanyId,
  onClose,
}: {
  client: Client | null;
  defaultCompanyId: string;
  onClose: () => void;
}) {
  const { db, createClient, updateClient } = useStore();
  const [form, setForm] = useState<ClientInput>({
    companyId: client?.companyId ?? defaultCompanyId ?? "",
    fullName: client?.fullName ?? "",
    designation: client?.designation ?? "",
    mobile: client?.mobile ?? "",
    whatsapp: client?.whatsapp ?? "",
    email: client?.email ?? "",
    role: client?.role ?? null,
    status: client?.status ?? "active",
  });
  const [touched, setTouched] = useState(false);

  const set = <K extends keyof ClientInput>(key: K, value: ClientInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const valid = form.companyId && form.fullName.trim();

  return (
    <Modal
      open
      onClose={onClose}
      title={client ? "Edit client" : "Add client"}
      subtitle="A client always belongs to one company"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              const payload: ClientInput = { ...form, fullName: form.fullName.trim() };
              if (client) updateClient(client.id, payload);
              else createClient(payload);
              onClose();
            }}
          >
            {client ? "Save changes" : "Add client"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Company"
          required
          error={touched && !form.companyId ? "Pick the company they work for." : undefined}
        >
          <SearchSelect
            options={db.companies.map((c) => ({
              value: c.id,
              label: c.name,
              hint: c.city,
            }))}
            value={form.companyId}
            onChange={(v) => set("companyId", v)}
            placeholder="Select a company"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Full name"
            required
            error={touched && !form.fullName.trim() ? "Required." : undefined}
          >
            <Input
              value={form.fullName}
              onChange={(e) => set("fullName", e.target.value)}
              placeholder="e.g. Rohit Mehra"
            />
          </Field>
          <Field label="Designation">
            <Input
              value={form.designation}
              onChange={(e) => set("designation", e.target.value)}
              placeholder="Head of Marketing"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mobile">
            <Input
              value={form.mobile}
              onChange={(e) => set("mobile", e.target.value)}
              placeholder="+91 98200 00000"
            />
          </Field>
          <Field label="WhatsApp" hint="Leave blank if it is the same as the mobile.">
            <Input
              value={form.whatsapp}
              onChange={(e) => set("whatsapp", e.target.value)}
              placeholder="+91 98200 00000"
            />
          </Field>
        </div>

        <Field label="Email">
          <Input
            type="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="rohit@example.com"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Role" hint="How much weight their word carries.">
            <Select
              value={form.role ?? ""}
              onChange={(e) => set("role", (e.target.value || null) as ClientRole | null)}
            >
              <option value="">Not set</option>
              {CLIENT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
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
      </div>
    </Modal>
  );
}
