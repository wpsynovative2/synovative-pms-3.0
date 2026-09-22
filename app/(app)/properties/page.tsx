"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CollabPanel } from "@/components/collab/collab-panel";
import {
  IconBuilding,
  IconContact,
  IconEdit,
  IconExternal,
  IconFolder,
  IconPlus,
  IconProperty,
  IconTrash,
} from "@/components/ui/icons";
import { ConfirmDialog, Drawer, Modal } from "@/components/ui/modal";
import { ButtonLoader } from "@/components/ui/loader";
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
import { formatINR } from "@/lib/analytics";
import {
  CONFIG_STATUS_STYLE,
  PROPERTY_MEDIA_FOLDERS,
} from "@/lib/master-data";
import { canDeleteCrm, canManageCrm } from "@/lib/permissions";
import { formatDate } from "@/lib/calendar";
import { useStore, type DriveResult, type PropertyInput } from "@/lib/store";
import {
  CONFIG_STATUSES,
  type ConfigStatus,
  type Property,
  type PropertyConfig,
} from "@/lib/types";

/**
 * Module 3 — a real-estate property, its unit mix, and the Google Drive
 * folders its media lives in. It always carries both its company and its
 * client, which is the "Acc:" line on the workflow deck.
 */
export default function PropertiesPage() {
  const { db, currentUser, companyById, clientById, deleteProperty } = useStore();
  const user = currentUser!;
  const params = useSearchParams();

  const [query, setQuery] = useState("");
  const [companyId, setCompanyId] = useState(params.get("company") ?? "");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Property | null>(null);
  const [deleting, setDeleting] = useState<Property | null>(null);
  const [openId, setOpenId] = useState<string | null>(params.get("property"));

  const mayManage = canManageCrm(user);
  const noCompanies = db.companies.length === 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return db.properties.filter(
      (p) =>
        (!companyId || p.companyId === companyId) &&
        (!q ||
          p.name.toLowerCase().includes(q) ||
          p.address.toLowerCase().includes(q) ||
          p.maharera.toLowerCase().includes(q)),
    );
  }, [db.properties, query, companyId]);

  const open = openId ? db.properties.find((p) => p.id === openId) : undefined;
  const withDrive = db.properties.filter((p) => p.driveFolderId).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Real Estate Properties"
        icon={<IconProperty size={20} />}
        subtitle="Projects on the ground — their unit mix, their RERA number and their media folders"
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
              <IconPlus size={15} /> Add property
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Properties"
          value={db.properties.length}
          tone="brand"
          icon={<IconProperty size={17} />}
        />
        <StatTile
          label="Unit configurations"
          value={db.properties.reduce((s, p) => s + p.configs.length, 0)}
          tone="blue"
        />
        <StatTile
          label="Open inventory"
          value={db.properties.reduce(
            (s, p) => s + p.configs.filter((c) => c.status === "Open").length,
            0,
          )}
          tone="green"
        />
        <StatTile
          label="Drive folders made"
          value={`${withDrive}/${db.properties.length}`}
          tone="neutral"
          icon={<IconFolder size={17} />}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          className="max-w-md flex-1"
          placeholder="Search by name, address or MahaRERA…"
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
            body="A property belongs to a company and a client, so start with the company."
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
            icon={<IconProperty size={30} />}
            title="No properties match"
            body="Add the towers, plots and townships you are marketing."
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => {
            const company = companyById(p.companyId);
            const client = clientById(p.clientId);
            const open = p.configs.filter((c) => c.status === "Open").length;
            return (
              <Card key={p.id} className="flex flex-col p-4">
                <div className="flex items-start gap-2.5">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand/15 text-brand-ink">
                    <IconProperty size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <button
                      onClick={() => setOpenId(p.id)}
                      className="block max-w-full truncate text-left text-[14px] font-semibold text-ink hover:text-brand-bright"
                    >
                      {p.name}
                    </button>
                    <p className="truncate text-[11px] text-ink-faint">
                      {company?.name ?? "Unknown company"}
                    </p>
                  </div>
                  {p.driveFolderId ? (
                    <a
                      href={p.driveFolderUrl}
                      target="_blank"
                      rel="noreferrer"
                      title="Open the Drive folder"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface-2 text-ink-muted hover:text-ink"
                    >
                      <IconFolder size={14} />
                    </a>
                  ) : null}
                </div>

                <p className="mt-3 flex items-center gap-1.5 text-[12px] text-ink-muted">
                  <IconContact size={13} />
                  {client?.fullName ?? "No client linked"}
                </p>

                {p.configs.length ? (
                  <ul className="mt-2.5 flex flex-wrap gap-1.5">
                    {p.configs.slice(0, 4).map((c) => (
                      <Badge key={c.id} className={CONFIG_STATUS_STYLE[c.status]}>
                        {c.config}
                      </Badge>
                    ))}
                    {p.configs.length > 4 ? (
                      <Badge>+{p.configs.length - 4} more</Badge>
                    ) : null}
                  </ul>
                ) : (
                  <p className="mt-2.5 text-[12px] text-ink-faint">No unit mix entered.</p>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
                  <Badge>{open} open</Badge>
                  {p.maharera ? <Badge>RERA {p.maharera}</Badge> : null}
                  <div className="ml-auto flex gap-1">
                    {mayManage ? (
                      <Button
                        size="sm"
                        onClick={() => {
                          setEditing(p);
                          setFormOpen(true);
                        }}
                      >
                        <IconEdit size={13} />
                      </Button>
                    ) : null}
                    {canDeleteCrm(user) ? (
                      <Button size="sm" variant="danger" onClick={() => setDeleting(p)}>
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
        <PropertyFormModal
          property={editing}
          defaultCompanyId={companyId}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
        />
      ) : null}

      {open ? <PropertyDrawer property={open} onClose={() => setOpenId(null)} /> : null}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteProperty(deleting.id)}
        title={`Delete ${deleting?.name ?? "this property"}?`}
        body="The record and its unit mix go. Files already on Google Drive are left untouched."
        confirmLabel="Delete property"
      />
    </div>
  );
}

/* --------------------------------------------------------------- drawer */

type Pane = "details" | "collab";

function PropertyDrawer({
  property,
  onClose,
}: {
  property: Property;
  onClose: () => void;
}) {
  const { currentUser, companyById, clientById, userById, showToast, saveDriveFolders } =
    useStore();
  const user = currentUser!;
  const [pane, setPane] = useState<Pane>("details");
  const [creating, setCreating] = useState(false);

  const company = companyById(property.companyId);
  const client = clientById(property.clientId);
  const made = !!property.driveFolderId;

  const createDirectory = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/drive/property-folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ propertyId: property.id }),
      });
      const body = (await res.json()) as DriveResult & { error?: string };
      if (!res.ok) {
        showToast(body.error ?? "Couldn't create the folders.");
        return;
      }
      saveDriveFolders(property.id, body);
      showToast("Drive folders ready.", "success");
    } catch {
      showToast("Couldn't reach Google Drive.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={property.name}
      subtitle={`${company?.name ?? "Unknown company"} · ${client?.fullName ?? "No client linked"}`}
      headerExtra={
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge>{property.configs.length} configurations</Badge>
          {property.maharera ? <Badge>MahaRERA {property.maharera}</Badge> : null}
          {made ? (
            <Badge className="border-st-approved/30 bg-st-approved/15 text-st-approved">
              Drive ready
            </Badge>
          ) : null}
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
            {property.description ? (
              <p className="text-[13px] leading-relaxed text-ink-muted">
                {property.description}
              </p>
            ) : null}

            <Card className="p-4">
              <dl className="grid gap-2.5 text-[12px] sm:grid-cols-2">
                <div>
                  <dt className="text-[11px] text-ink-faint">Address</dt>
                  <dd className="mt-0.5 break-words text-ink">{property.address || "—"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] text-ink-faint">Map</dt>
                  <dd className="mt-0.5">
                    {property.mapsUrl ? (
                      <a
                        href={property.mapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-brand-bright hover:underline"
                      >
                        Open in Google Maps <IconExternal size={12} />
                      </a>
                    ) : (
                      <span className="text-ink">—</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-ink-faint">Added by</dt>
                  <dd className="mt-0.5 break-words text-ink">
                    {userById(property.createdBy)?.fullName ?? "Unknown"} —{" "}
                    {formatDate(property.createdAt)}
                  </dd>
                </div>
              </dl>
            </Card>

            <section>
              <h3 className="mb-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                Project configuration
              </h3>
              {property.configs.length === 0 ? (
                <p className="text-[12px] text-ink-faint">No unit mix entered yet.</p>
              ) : (
                <div className="overflow-hidden rounded-card border border-line">
                  <table className="w-full text-[12px]">
                    <thead className="bg-surface-2 text-ink-faint">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Config</th>
                        <th className="px-3 py-2 text-right font-medium">Sq.ft</th>
                        <th className="px-3 py-2 text-right font-medium">Price</th>
                        <th className="px-3 py-2 text-left font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {property.configs.map((c) => (
                        <tr key={c.id} className="border-t border-line-soft">
                          <td className="px-3 py-2 text-ink">{c.config}</td>
                          <td className="px-3 py-2 text-right font-mono text-ink-muted">
                            {c.sqFt ? c.sqFt.toLocaleString("en-IN") : "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-ink-muted">
                            {c.price ? formatINR(c.price) : "—"}
                          </td>
                          <td className="px-3 py-2">
                            <Badge className={CONFIG_STATUS_STYLE[c.status]}>{c.status}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-[11px] font-medium tracking-wide text-ink-muted uppercase">
                  Media on Google Drive
                </h3>
                {canManageCrm(user) ? (
                  <Button
                    size="sm"
                    variant={made ? "secondary" : "primary"}
                    disabled={creating}
                    onClick={createDirectory}
                  >
                    {creating ? <ButtonLoader /> : <IconFolder size={13} />}
                    {creating
                      ? "Creating…"
                      : made
                        ? "Re-check folders"
                        : "Create Directory"}
                  </Button>
                ) : null}
              </div>

              {made ? (
                <ul className="flex flex-col gap-1.5">
                  <li>
                    <a
                      href={property.driveFolderUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-[12px] font-medium text-ink hover:border-brand-bright/40"
                    >
                      <IconFolder size={14} /> {property.name}
                      <IconExternal size={12} className="ml-auto text-ink-faint" />
                    </a>
                  </li>
                  {property.folders.map((f) => (
                    <li key={f.id} className="pl-5">
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-[12px] text-ink-muted hover:border-brand-bright/40 hover:text-ink"
                      >
                        <IconFolder size={14} /> {f.name}
                        <IconExternal size={12} className="ml-auto text-ink-faint" />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-card border border-dashed border-line bg-surface-2 px-3 py-4 text-[12px] text-ink-faint">
                  Nothing on Drive yet. Creating the directory makes
                  <span className="text-ink-muted">
                    {" "}
                    Clients / {company?.name ?? "Company"} /{" "}
                    {client?.fullName ?? "Unassigned client"} / {property.name}{" "}
                  </span>
                  with {PROPERTY_MEDIA_FOLDERS.join(", ")} inside, then everyone uploads
                  straight into it.
                </div>
              )}
            </section>
          </div>
        ) : (
          <CollabPanel entityType="property" entityId={property.id} />
        )}
      </div>
    </Drawer>
  );
}

/* ----------------------------------------------------------------- form */

const blankConfig = (): PropertyConfig => ({
  id: crypto.randomUUID(),
  config: "",
  sqFt: 0,
  price: 0,
  status: "Open",
});

function PropertyFormModal({
  property,
  defaultCompanyId,
  onClose,
}: {
  property: Property | null;
  defaultCompanyId: string;
  onClose: () => void;
}) {
  const { db, createProperty, updateProperty } = useStore();
  const [form, setForm] = useState<PropertyInput>({
    companyId: property?.companyId ?? defaultCompanyId ?? "",
    clientId: property?.clientId ?? null,
    name: property?.name ?? "",
    description: property?.description ?? "",
    address: property?.address ?? "",
    mapsUrl: property?.mapsUrl ?? "",
    maharera: property?.maharera ?? "",
    configs: property?.configs ?? [],
  });
  const [touched, setTouched] = useState(false);

  const set = <K extends keyof PropertyInput>(key: K, value: PropertyInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // The client list narrows to the chosen company, as the deck shows.
  const clientOptions = db.clients
    .filter((c) => c.companyId === form.companyId)
    .map((c) => ({ value: c.id, label: c.fullName, hint: c.designation }));

  const setConfig = (id: string, patch: Partial<PropertyConfig>) =>
    set(
      "configs",
      form.configs.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );

  const badConfig = form.configs.some((c) => !c.config.trim());
  const valid = form.companyId && form.name.trim() && !badConfig;

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={property ? "Edit property" : "Add property"}
      subtitle="Linked to a company and a client, with its unit mix as line items"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              const payload: PropertyInput = {
                ...form,
                name: form.name.trim(),
                configs: form.configs.map((c) => ({ ...c, config: c.config.trim() })),
              };
              if (property) updateProperty(property.id, payload);
              else createProperty(payload);
              onClose();
            }}
          >
            {property ? "Save changes" : "Add property"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Company"
            required
            error={touched && !form.companyId ? "Pick the developer." : undefined}
          >
            <SearchSelect
              options={db.companies.map((c) => ({ value: c.id, label: c.name, hint: c.city }))}
              value={form.companyId}
              onChange={(v) =>
                setForm((f) => ({
                  ...f,
                  companyId: v,
                  // The old contact belongs to the old company.
                  clientId: null,
                }))
              }
              placeholder="Select a company"
            />
          </Field>
          <Field
            label="Client"
            hint={
              form.companyId
                ? "Only this company's contacts are listed."
                : "Pick a company first."
            }
          >
            <SearchSelect
              allowClear
              disabled={!form.companyId}
              options={clientOptions}
              value={form.clientId ?? ""}
              onChange={(v) => set("clientId", v || null)}
              placeholder="Nobody linked yet"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Property name"
            required
            error={touched && !form.name.trim() ? "Required." : undefined}
          >
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Anant Skyline, Phase 2"
            />
          </Field>
          <Field label="MahaRERA number">
            <Input
              value={form.maharera}
              onChange={(e) => set("maharera", e.target.value)}
              placeholder="P51700012345"
            />
          </Field>
        </div>

        <Field label="Description">
          <Textarea
            rows={2}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Positioning, USPs, anything the creative team should know…"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Address">
            <Textarea
              rows={2}
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              placeholder="Site address as written on the hoarding"
            />
          </Field>
          <Field label="Google Maps URL">
            <Input
              value={form.mapsUrl}
              onChange={(e) => set("mapsUrl", e.target.value)}
              placeholder="https://maps.app.goo.gl/…"
            />
          </Field>
        </div>

        <Field
          label="Project configuration"
          hint="One row per unit type. Status marks whether inventory is still open."
          error={touched && badConfig ? "Every row needs a configuration name." : undefined}
        >
          <div className="flex flex-col gap-2">
            {form.configs.map((c) => (
              <div
                key={c.id}
                className="grid gap-2 rounded-card border border-line-soft bg-surface-2 p-2.5 sm:grid-cols-[1.4fr_1fr_1.2fr_1fr_auto]"
              >
                <Input
                  value={c.config}
                  onChange={(e) => setConfig(c.id, { config: e.target.value })}
                  placeholder="2 BHK"
                  aria-label="Configuration"
                />
                <Input
                  type="number"
                  min="0"
                  value={c.sqFt || ""}
                  onChange={(e) => setConfig(c.id, { sqFt: Number(e.target.value) || 0 })}
                  placeholder="Sq.ft"
                  aria-label="Square feet"
                />
                <Input
                  type="number"
                  min="0"
                  value={c.price || ""}
                  onChange={(e) => setConfig(c.id, { price: Number(e.target.value) || 0 })}
                  placeholder="Price ₹"
                  aria-label="Price"
                />
                <Select
                  value={c.status}
                  onChange={(e) =>
                    setConfig(c.id, { status: e.target.value as ConfigStatus })
                  }
                  aria-label="Status"
                >
                  {CONFIG_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="ghost"
                  aria-label="Remove row"
                  onClick={() =>
                    set(
                      "configs",
                      form.configs.filter((x) => x.id !== c.id),
                    )
                  }
                >
                  <IconTrash size={14} />
                </Button>
              </div>
            ))}
            <div>
              <Button size="sm" onClick={() => set("configs", [...form.configs, blankConfig()])}>
                <IconPlus size={14} /> Add row
              </Button>
            </div>
          </div>
        </Field>
      </div>
    </Modal>
  );
}
