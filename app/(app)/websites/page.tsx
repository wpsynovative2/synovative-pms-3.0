"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import {
  IconCopy,
  IconEdit,
  IconExternal,
  IconEye,
  IconEyeOff,
  IconGlobe,
  IconPlus,
  IconRepeat,
  IconSend,
  IconTrash,
  IconWarning,
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
  Textarea,
  cx,
} from "@/components/ui/primitives";
import { SearchSelect } from "@/components/ui/selects";
import { formatINR } from "@/lib/analytics";
import { daysBetween, formatDate, todayISO } from "@/lib/calendar";
import {
  canManageWebsites,
  canRenewWebsites,
  canSeeWebsitePasswords,
} from "@/lib/permissions";
import { useStore, type WebsiteCredentialInput, type WebsiteInput } from "@/lib/store";
import {
  CREDENTIAL_LABELS,
  WEBSITE_BUILDS,
  WEBSITE_STATUSES,
  type Website,
  type WebsiteBuild,
  type WebsiteCredential,
  type WebsiteStatus,
} from "@/lib/types";

/*
 * Websites (0020): the client sites Synovative builds and looks after, their
 * logins, and the annual renewal of their domain and hosting - a year from the
 * start date, then every year after.
 *
 * Reminders go out from the database each morning (30, 15, 7 and 1 days
 * before, on the day, then weekly) to Super Admins, Admins, Website
 * Developers, Accounts & Finance and Business Development Executives. The
 * client is reminded from here: "Email client" opens a ready-written email in
 * the sender's own mail app - nothing is sent by the system.
 */

type RenewalFilter = "any" | "overdue" | "30" | "90";

/** Days until a site's renewal; negative once it has passed. */
const daysLeft = (w: Website) => (w.renewalDue ? daysBetween(todayISO(), w.renewalDue) : null);

/** A renewal only needs chasing when Synovative pays for the domain or hosting. */
const weRenew = (w: Website) => w.synovativeDomain || w.synovativeHosting;

function renewalTone(days: number | null) {
  if (days === null) return "border-line bg-surface-2 text-ink-faint";
  if (days < 0) return "border-st-rejected/30 bg-st-rejected/15 text-st-rejected";
  if (days <= 30) return "border-st-submitted/30 bg-st-submitted/15 text-st-submitted";
  return "border-line bg-surface-2 text-ink-muted";
}

function renewalText(w: Website) {
  const days = daysLeft(w);
  if (days === null || !w.renewalDue) return "No renewal date";
  if (days < 0) return `Overdue · was due ${formatDate(w.renewalDue)}`;
  if (days === 0) return "Renewal due today";
  return `Renews ${formatDate(w.renewalDue)} · in ${days} day${days === 1 ? "" : "s"}`;
}

/** What the renewal covers, in words. */
const renewalCovers = (w: Website) =>
  w.synovativeDomain && w.synovativeHosting
    ? "domain and hosting"
    : w.synovativeDomain
      ? "domain"
      : w.synovativeHosting
        ? "hosting"
        : "website";

/** The first renewal: a year after the start, or the next anniversary still ahead. */
function firstRenewal(start: string): string {
  const today = todayISO();
  let [y] = start.split("-").map(Number);
  const [, m, d] = start.split("-").map(Number);
  for (;;) {
    y += 1;
    const last = new Date(y, m, 0).getDate();
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
    if (iso >= today) return iso;
  }
}

const hrefOf = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

export default function WebsitesPage() {
  const { db, currentUser, companyById } = useStore();
  const user = currentUser!;
  const params = useSearchParams();
  const mayManage = canManageWebsites(user);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<WebsiteStatus | "all">("Active");
  const [build, setBuild] = useState<WebsiteBuild | "all">("all");
  const [renewal, setRenewal] = useState<RenewalFilter>("any");
  // A reminder links straight to its site.
  const [openId, setOpenId] = useState<string | null>(params.get("site"));
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Website | null>(null);
  const [renewing, setRenewing] = useState<Website | null>(null);

  const active = db.websites.filter((w) => w.status === "Active");
  const dueSoon = active.filter((w) => {
    const d = daysLeft(w);
    return weRenew(w) && d !== null && d >= 0 && d <= 30;
  });
  const overdue = active.filter((w) => {
    const d = daysLeft(w);
    return weRenew(w) && d !== null && d < 0;
  });

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return db.websites
      .filter((w) => status === "all" || w.status === status)
      .filter((w) => build === "all" || w.builtWith === build)
      .filter((w) => {
        if (renewal === "any") return true;
        const d = daysLeft(w);
        if (d === null) return false;
        return renewal === "overdue" ? d < 0 : d >= 0 && d <= Number(renewal);
      })
      .filter((w) => {
        if (!q) return true;
        const company = companyById(w.companyId)?.name ?? "";
        return [w.name, w.url, w.hostingPlan, company].some((x) => x.toLowerCase().includes(q));
      })
      // Soonest renewal first; sites without a date at the end.
      .sort(
        (a, b) =>
          (a.renewalDue ?? "9999").localeCompare(b.renewalDue ?? "9999") ||
          a.name.localeCompare(b.name),
      );
  }, [db.websites, query, status, build, renewal, companyById]);

  const open = openId ? db.websites.find((w) => w.id === openId) : undefined;
  const filtered = query || status !== "Active" || build !== "all" || renewal !== "any";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Websites"
        icon={<IconGlobe size={20} />}
        subtitle="Client sites we build and look after: logins, hosting and annual renewals"
        actions={
          mayManage ? (
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <IconPlus size={15} /> Add website
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Active websites" value={active.length} icon={<IconGlobe size={17} />} />
        <StatTile
          label="Renewing in 30 days"
          value={dueSoon.length}
          tone="amber"
          icon={<IconRepeat size={17} />}
        />
        <StatTile
          label="Renewal overdue"
          value={overdue.length}
          tone="red"
          icon={<IconWarning size={17} />}
        />
        <StatTile
          label="Off-boarded"
          value={db.websites.length - active.length}
          tone="neutral"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <SearchInput
          className="w-full sm:max-w-xs"
          placeholder="Search sites, URLs, companies…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="w-full sm:w-40">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as WebsiteStatus | "all")}
            aria-label="Status"
          >
            {WEBSITE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value="all">Any status</option>
          </Select>
        </div>
        <div className="w-full sm:w-44">
          <Select
            value={renewal}
            onChange={(e) => setRenewal(e.target.value as RenewalFilter)}
            aria-label="Renewal"
          >
            <option value="any">Any renewal date</option>
            <option value="overdue">Overdue</option>
            <option value="30">Next 30 days</option>
            <option value="90">Next 90 days</option>
          </Select>
        </div>
        <div className="w-full sm:w-40">
          <Select
            value={build}
            onChange={(e) => setBuild(e.target.value as WebsiteBuild | "all")}
            aria-label="Built with"
          >
            <option value="all">Any build</option>
            {WEBSITE_BUILDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
        </div>
        <span className="ml-auto text-[11px] text-ink-faint">
          {list.length} of {db.websites.length} websites
        </span>
      </div>

      {list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconGlobe size={30} />}
            title={filtered ? "No websites match" : "No websites yet"}
            body={
              filtered
                ? "Try another status, renewal window or search."
                : "Add the client sites Synovative builds and hosts to keep their logins and renewals in one place."
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          {list.map((w) => (
            <WebsiteRow
              key={w.id}
              site={w}
              onOpen={() => setOpenId(w.id)}
              onRenew={() => setRenewing(w)}
            />
          ))}
        </div>
      )}

      {open ? (
        <WebsiteDrawer
          site={open}
          onClose={() => setOpenId(null)}
          onEdit={() => {
            setEditing(open);
            setFormOpen(true);
          }}
          onRenew={() => setRenewing(open)}
        />
      ) : null}

      {formOpen ? (
        <WebsiteFormModal
          site={editing ?? undefined}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
        />
      ) : null}

      {renewing ? <RenewModal site={renewing} onClose={() => setRenewing(null)} /> : null}
    </div>
  );
}

/* --------------------------------------------------------------- the row */

function WebsiteRow({
  site,
  onOpen,
  onRenew,
}: {
  site: Website;
  onOpen: () => void;
  onRenew: () => void;
}) {
  const { currentUser, companyById } = useStore();
  const user = currentUser!;
  const company = companyById(site.companyId);
  const days = daysLeft(site);
  const offBoarded = site.status === "Off-boarded";

  return (
    <Card className={cx("flex flex-col gap-3 p-4 lg:flex-row lg:items-center", offBoarded && "opacity-70")}>
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand/15 text-brand-ink">
          <IconGlobe size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <button
            onClick={onOpen}
            className="block max-w-full truncate text-left text-[14px] font-semibold text-ink hover:text-brand-bright"
          >
            {site.name}
          </button>
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-[11px] text-ink-faint">
            {site.url ? (
              <a
                href={hrefOf(site.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-brand-bright hover:underline"
              >
                {site.url}
              </a>
            ) : null}
            {company ? <span className="truncate">{company.name}</span> : null}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge>{site.builtWith}</Badge>
            {site.hostingPlan ? <Badge>{site.hostingPlan}</Badge> : null}
            {site.synovativeDomain ? (
              <Badge className="border-brand-bright/30 bg-brand/15 text-brand-ink">Our domain</Badge>
            ) : null}
            {site.synovativeHosting ? (
              <Badge className="border-brand-bright/30 bg-brand/15 text-brand-ink">Our hosting</Badge>
            ) : null}
            {!weRenew(site) ? <Badge>Client renews</Badge> : null}
            {offBoarded ? <Badge>Off-boarded</Badge> : null}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        <Badge className={cx("px-2.5 py-1 text-[12px]", renewalTone(offBoarded ? null : days))}>
          {renewalText(site)}
        </Badge>
        {!offBoarded ? <EmailClientButton site={site} /> : null}
        {!offBoarded && canRenewWebsites(user) ? (
          <Button size="sm" variant="success" onClick={onRenew}>
            <IconRepeat size={13} /> Mark renewed
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------- email to the client */

/** Who the renewal email goes to: the linked contact, else the address on the site. */
function useClientEmail(site: Website) {
  const { clientById } = useStore();
  const client = clientById(site.clientId);
  return {
    email: site.clientEmail.trim() || client?.email.trim() || "",
    name: client?.fullName ?? "",
  };
}

/**
 * Opens the sender's own mail app with the renewal email written, addressed
 * to the client. The app never sends it.
 */
function EmailClientButton({ site, size = "sm" }: { site: Website; size?: "sm" | "md" }) {
  const { currentUser } = useStore();
  const { email, name } = useClientEmail(site);
  const due = site.renewalDue ? formatDate(site.renewalDue) : "soon";
  const days = daysLeft(site);
  const subject = `Annual renewal of ${site.url || site.name} - due ${due}`;
  const lines = [
    `Dear ${name || "Sir/Madam"},`,
    "",
    days !== null && days < 0
      ? `This is a reminder that the annual renewal of the ${renewalCovers(site)} for your website ${site.url || site.name} was due on ${due} and is still pending.`
      : `This is a reminder that the annual renewal of the ${renewalCovers(site)} for your website ${site.url || site.name} is due on ${due}.`,
    ...(site.renewalFee > 0 ? ["", `Renewal amount: ${formatINR(site.renewalFee)} (plus applicable taxes).`] : []),
    "",
    "Please let us know to go ahead with the renewal so the website stays live without interruption.",
    "",
    "Regards,",
    currentUser?.fullName ?? "",
    "Synovative",
  ];
  const href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;

  return (
    <Button
      size={size}
      title={email ? `Email ${email}` : "No client email yet - you can add the address in the email"}
      onClick={() => {
        window.location.href = href;
      }}
    >
      <IconSend size={13} /> Email client
    </Button>
  );
}

/* ------------------------------------------------------------ the drawer */

function WebsiteDrawer({
  site,
  onClose,
  onEdit,
  onRenew,
}: {
  site: Website;
  onClose: () => void;
  onEdit: () => void;
  onRenew: () => void;
}) {
  const { db, currentUser, companyById, clientById, projectById, userById, deleteWebsite } =
    useStore();
  const user = currentUser!;
  const [deleting, setDeleting] = useState(false);
  const { email } = useClientEmail(site);
  const client = clientById(site.clientId);
  const project = site.projectId ? projectById(site.projectId) : undefined;
  const renewals = db.websiteRenewals.filter((r) => r.websiteId === site.id);
  const days = daysLeft(site);

  return (
    <Drawer
      open
      onClose={onClose}
      title={site.name}
      subtitle={site.url || "No URL yet"}
      headerExtra={
        canManageWebsites(user) ? (
          <div className="flex gap-1.5">
            <Button size="sm" onClick={onEdit}>
              <IconEdit size={13} /> Edit
            </Button>
            <Button size="sm" variant="danger" aria-label="Delete website" onClick={() => setDeleting(true)}>
              <IconTrash size={13} />
            </Button>
          </div>
        ) : null
      }
    >
      <div className="flex flex-col gap-5">
        <div
          className={cx(
            "flex flex-wrap items-center gap-2 rounded-card border px-3 py-2.5",
            renewalTone(site.status === "Off-boarded" ? null : days),
          )}
        >
          <span className="text-[13px] font-medium">{renewalText(site)}</span>
          <span className="text-[11px] opacity-80">({renewalCovers(site)})</span>
          {site.status === "Active" ? (
            <div className="ml-auto flex flex-wrap gap-1.5">
              <EmailClientButton site={site} />
              {canRenewWebsites(user) ? (
                <Button size="sm" variant="success" onClick={onRenew}>
                  <IconRepeat size={13} /> Mark renewed
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <dl className="grid gap-x-5 gap-y-3 text-[13px] sm:grid-cols-2">
          <Fact label="Website">
            {site.url ? (
              <a
                href={hrefOf(site.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-bright hover:underline"
              >
                {site.url}
              </a>
            ) : (
              "—"
            )}
          </Fact>
          <Fact label="Company">{companyById(site.companyId)?.name ?? "—"}</Fact>
          <Fact label="Client contact">{client ? client.fullName : "—"}</Fact>
          <Fact label="Renewal email to">{email || "—"}</Fact>
          <Fact label="Project">{project?.name ?? "—"}</Fact>
          <Fact label="Built with">{site.builtWith}</Fact>
          <Fact label="Hosting">{site.hostingPlan || "—"}</Fact>
          <Fact label="Who holds it">
            Domain: {site.synovativeDomain ? "Synovative" : "Client"} · Hosting:{" "}
            {site.synovativeHosting ? "Synovative" : "Client"}
          </Fact>
          <Fact label="Start date">{formatDate(site.startDate)}</Fact>
          <Fact label="Renewal fee">{site.renewalFee > 0 ? formatINR(site.renewalFee) : "—"}</Fact>
          <Fact label="Status">{site.status}</Fact>
          <Fact label="Added by">{userById(site.createdBy)?.fullName ?? "—"}</Fact>
        </dl>

        {site.notes ? (
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-muted">
            {site.notes}
          </p>
        ) : null}

        {canSeeWebsitePasswords(user) ? <Logins site={site} /> : null}

        <section>
          <h3 className="mb-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
            Renewal history
          </h3>
          {renewals.length === 0 ? (
            <p className="text-[12px] text-ink-faint">Not renewed through the app yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {renewals.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg bg-surface-2 px-3 py-2 text-[12px]"
                >
                  <span className="font-medium text-ink">
                    {formatDate(r.periodFrom)} → {formatDate(r.periodTo)}
                  </span>
                  {r.amount !== null ? <span className="text-ink-muted">{formatINR(r.amount)}</span> : null}
                  <span className="text-ink-faint">
                    on {formatDate(r.renewedOn)} by {userById(r.createdBy)?.fullName ?? "someone"}
                  </span>
                  {r.note ? <span className="w-full text-ink-faint">{r.note}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => {
          deleteWebsite(site.id);
          onClose();
        }}
        title="Delete this website?"
        body="Its logins and renewal history are deleted with it. To keep them, mark it Off-boarded instead."
        confirmLabel="Delete website"
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

/* ---------------------------------------------------------------- logins */

function Logins({ site }: { site: Website }) {
  const { db, deleteWebsiteCredential } = useStore();
  const [editing, setEditing] = useState<WebsiteCredential | "new" | null>(null);
  const [deleting, setDeleting] = useState<WebsiteCredential | null>(null);
  const creds = db.websiteCredentials
    .filter((c) => c.websiteId === site.id)
    .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium tracking-wide text-ink-muted uppercase">
          Logins
          <span className="ml-2 font-normal tracking-normal text-ink-faint normal-case">
            Each password shown is logged
          </span>
        </h3>
        <Button size="sm" onClick={() => setEditing("new")}>
          <IconPlus size={13} /> Add login
        </Button>
      </div>

      {creds.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[12px] text-ink-faint">
          No logins saved for this website yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {creds.map((c) => (
            <CredentialRow
              key={c.id}
              cred={c}
              onEdit={() => setEditing(c)}
              onDelete={() => setDeleting(c)}
            />
          ))}
        </ul>
      )}

      {editing ? (
        <CredentialModal
          site={site}
          cred={editing === "new" ? undefined : editing}
          nextPosition={creds.length}
          onClose={() => setEditing(null)}
        />
      ) : null}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteWebsiteCredential(deleting.id)}
        title="Delete this login?"
        body="The username and password are removed for good."
        confirmLabel="Delete login"
      />
    </section>
  );
}

function CredentialRow({
  cred,
  onEdit,
  onDelete,
}: {
  cred: WebsiteCredential;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { revealWebsitePassword, showToast } = useStore();
  // Held only while shown; hiding forgets it.
  const [password, setPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${what} copied.`, "success");
    } catch {
      showToast("Couldn't copy - your browser blocked clipboard access.");
    }
  };

  const fetchPassword = async () => {
    setBusy(true);
    try {
      return await revealWebsitePassword(cred.id);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn't read the password.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-card border border-line-soft bg-surface-2 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium text-ink">{cred.label}</span>
        {cred.loginUrl ? (
          <a
            href={hrefOf(cred.loginUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 truncate text-[11px] text-brand-bright hover:underline"
          >
            Open login <IconExternal size={11} />
          </a>
        ) : null}
        <div className="ml-auto flex gap-1">
          <Button size="sm" aria-label="Edit login" onClick={onEdit}>
            <IconEdit size={13} />
          </Button>
          <Button size="sm" variant="danger" aria-label="Delete login" onClick={onDelete}>
            <IconTrash size={13} />
          </Button>
        </div>
      </div>

      <dl className="mt-2 grid gap-2 text-[12px] sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-[10px] tracking-wide text-ink-faint uppercase">Username / ID</dt>
          <dd className="flex items-center gap-1.5">
            <span className="truncate font-mono text-ink">{cred.username || "—"}</span>
            {cred.username ? (
              <button
                onClick={() => copy(cred.username, "Username")}
                aria-label="Copy username"
                className="shrink-0 text-ink-faint hover:text-ink"
              >
                <IconCopy size={13} />
              </button>
            ) : null}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] tracking-wide text-ink-faint uppercase">Password</dt>
          <dd className="flex items-center gap-1.5">
            <span className="truncate font-mono text-ink">{password ?? "••••••••"}</span>
            <button
              disabled={busy}
              onClick={async () => {
                if (password !== null) setPassword(null);
                else setPassword(await fetchPassword());
              }}
              aria-label={password !== null ? "Hide password" : "Show password"}
              className="shrink-0 text-ink-faint hover:text-ink disabled:opacity-40"
            >
              {password !== null ? <IconEyeOff size={13} /> : <IconEye size={13} />}
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                const value = password ?? (await fetchPassword());
                if (value !== null) await copy(value, "Password");
              }}
              aria-label="Copy password"
              className="shrink-0 text-ink-faint hover:text-ink disabled:opacity-40"
            >
              <IconCopy size={13} />
            </button>
          </dd>
        </div>
        {cred.recovery ? (
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-[10px] tracking-wide text-ink-faint uppercase">Recovery</dt>
            <dd className="text-ink-muted">{cred.recovery}</dd>
          </div>
        ) : null}
        {cred.notes ? (
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-[10px] tracking-wide text-ink-faint uppercase">Notes</dt>
            <dd className="whitespace-pre-wrap text-ink-muted">{cred.notes}</dd>
          </div>
        ) : null}
      </dl>
    </li>
  );
}

function CredentialModal({
  site,
  cred,
  nextPosition,
  onClose,
}: {
  site: Website;
  cred?: WebsiteCredential;
  nextPosition: number;
  onClose: () => void;
}) {
  const { saveWebsiteCredential } = useStore();
  const [label, setLabel] = useState(
    cred?.label ?? (site.builtWith === "WordPress" ? "WordPress admin" : "Hosting"),
  );
  const [loginUrl, setLoginUrl] = useState(cred?.loginUrl ?? "");
  const [username, setUsername] = useState(cred?.username ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [recovery, setRecovery] = useState(cred?.recovery ?? "");
  const [notes, setNotes] = useState(cred?.notes ?? "");
  const [touched, setTouched] = useState(false);
  const labels = CREDENTIAL_LABELS.includes(label) ? CREDENTIAL_LABELS : [label, ...CREDENTIAL_LABELS];

  const save = () => {
    setTouched(true);
    if (!label.trim()) return;
    const input: WebsiteCredentialInput = {
      id: cred?.id,
      websiteId: site.id,
      label: label.trim(),
      loginUrl: loginUrl.trim(),
      username: username.trim(),
      recovery: recovery.trim(),
      notes: notes.trim(),
      position: cred?.position ?? nextPosition,
      // An edit with the box left empty keeps the saved password.
      ...(password || !cred ? { password } : {}),
    };
    saveWebsiteCredential(input);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={cred ? "Edit login" : "Add login"}
      subtitle={site.name}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            {cred ? "Save login" : "Add login"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="What login" required error={touched && !label.trim() ? "Required." : undefined}>
            <Select value={label} onChange={(e) => setLabel(e.target.value)}>
              {labels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Login link">
            <Input
              value={loginUrl}
              onChange={(e) => setLoginUrl(e.target.value)}
              placeholder="e.g. example.com/wp-admin"
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Username / ID">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
          </Field>
          <Field
            label="Password"
            hint={cred ? "Leave empty to keep the saved password." : undefined}
          >
            <div className="flex items-center gap-1.5">
              <Input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder={cred ? "Unchanged" : ""}
              />
              <Button
                size="sm"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <IconEyeOff size={13} /> : <IconEye size={13} />}
              </Button>
            </div>
          </Field>
        </div>
        <Field label="Recovery email / phone">
          <Input value={recovery} onChange={(e) => setRecovery(e.target.value)} />
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------- renewal */

function RenewModal({ site, onClose }: { site: Website; onClose: () => void }) {
  const { markWebsiteRenewed } = useStore();
  const [amount, setAmount] = useState(site.renewalFee > 0 ? String(site.renewalFee) : "");
  const [note, setNote] = useState("");
  const from = site.renewalDue ?? (site.startDate ? firstRenewal(site.startDate) : todayISO());
  const [fy, fm, fd] = from.split("-").map(Number);
  const last = new Date(fy + 1, fm, 0).getDate();
  const to = `${fy + 1}-${String(fm).padStart(2, "0")}-${String(Math.min(fd, last)).padStart(2, "0")}`;

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Mark as renewed"
      subtitle={site.name}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              markWebsiteRenewed(site.id, amount ? Number(amount) : null, note.trim());
              onClose();
            }}
          >
            Mark renewed
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-ink-muted">
          Renewed for {formatDate(from)} → {formatDate(to)}. The next reminder will be for{" "}
          <span className="font-medium text-ink">{formatDate(to)}</span>.
        </p>
        <Field label="Amount received (₹)">
          <Input
            type="number"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Optional"
          />
        </Field>
        <Field label="Note">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Invoice number, payment mode…"
          />
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ form */

function WebsiteFormModal({ site, onClose }: { site?: Website; onClose: () => void }) {
  const { db, createWebsite, updateWebsite } = useStore();
  const [form, setForm] = useState<WebsiteInput>(() => ({
    name: site?.name ?? "",
    url: site?.url ?? "",
    companyId: site?.companyId ?? null,
    clientId: site?.clientId ?? null,
    projectId: site?.projectId ?? null,
    builtWith: site?.builtWith ?? "WordPress",
    hostingPlan: site?.hostingPlan ?? "",
    synovativeDomain: site?.synovativeDomain ?? false,
    synovativeHosting: site?.synovativeHosting ?? true,
    status: site?.status ?? "Active",
    startDate: site?.startDate ?? null,
    renewalDue: site?.renewalDue ?? null,
    renewalFee: site?.renewalFee ?? 0,
    clientEmail: site?.clientEmail ?? "",
    notes: site?.notes ?? "",
  }));
  // Until someone sets the renewal date by hand, it follows the start date.
  const [renewalByHand, setRenewalByHand] = useState(
    !!site?.renewalDue && (!site.startDate || site.renewalDue !== firstRenewal(site.startDate)),
  );
  const [touched, setTouched] = useState(false);
  const set = <K extends keyof WebsiteInput>(key: K, value: WebsiteInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const contacts = db.clients.filter((c) => !form.companyId || c.companyId === form.companyId);
  const projects = db.projects.filter((p) => !form.companyId || p.companyId === form.companyId);
  const valid = !!form.name.trim();

  const save = () => {
    setTouched(true);
    if (!valid) return;
    const payload: WebsiteInput = {
      ...form,
      name: form.name.trim(),
      url: form.url.trim(),
      hostingPlan: form.hostingPlan.trim(),
      clientEmail: form.clientEmail.trim(),
      notes: form.notes.trim(),
      renewalDue: renewalByHand
        ? form.renewalDue
        : form.startDate
          ? firstRenewal(form.startDate)
          : form.renewalDue,
    };
    if (site) updateWebsite(site.id, payload);
    else createWebsite(payload);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={site ? "Edit website" : "Add website"}
      subtitle="Renewal reminders go out for whatever Synovative holds: the domain, the hosting, or both."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            {site ? "Save changes" : "Add website"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Website name" required error={touched && !valid ? "Required." : undefined}>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Nakshatra Auris"
            />
          </Field>
          <Field label="Website URL">
            <Input
              value={form.url}
              onChange={(e) => set("url", e.target.value)}
              placeholder="e.g. nakshatraauris.com"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company">
            <SearchSelect
              options={db.companies.map((c) => ({ value: c.id, label: c.name }))}
              value={form.companyId ?? ""}
              onChange={(v) =>
                setForm((f) => ({
                  ...f,
                  companyId: v || null,
                  // A contact from another company no longer fits.
                  clientId:
                    f.clientId && db.clients.find((c) => c.id === f.clientId)?.companyId !== v
                      ? null
                      : f.clientId,
                }))
              }
              placeholder="Whose website is it?"
              allowClear
            />
          </Field>
          <Field label="Client contact" hint="The renewal email is addressed to them.">
            <SearchSelect
              options={contacts.map((c) => ({
                value: c.id,
                label: c.fullName,
                hint: c.email || undefined,
              }))}
              value={form.clientId ?? ""}
              onChange={(v) => set("clientId", v || null)}
              placeholder="Pick a contact"
              allowClear
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Renewal email address" hint="Leave empty to use the contact's email.">
            <Input
              type="email"
              value={form.clientEmail}
              onChange={(e) => set("clientEmail", e.target.value)}
              placeholder="accounts@client.com"
            />
          </Field>
          <Field label="Project">
            <SearchSelect
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
              value={form.projectId ?? ""}
              onChange={(v) => set("projectId", v || null)}
              placeholder="The build project, if any"
              allowClear
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Built with" required>
            <Select
              value={form.builtWith}
              onChange={(e) => set("builtWith", e.target.value as WebsiteBuild)}
            >
              {WEBSITE_BUILDS.map((b) => (
                <option key={b} value={b}>
                  {b === "Plain code" ? "Plain code (HTML / CSS / JS)" : b}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Hosting plan">
            <Input
              value={form.hostingPlan}
              onChange={(e) => set("hostingPlan", e.target.value)}
              placeholder="e.g. business hosting 1"
            />
          </Field>
          <Field label="Status">
            <Select
              value={form.status}
              onChange={(e) => set("status", e.target.value as WebsiteStatus)}
            >
              {WEBSITE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Synovative holds" hint="Only what Synovative holds is chased for renewal.">
          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 text-[13px] text-ink">
              <input
                type="checkbox"
                className="accent-brand-bright"
                checked={form.synovativeDomain}
                onChange={(e) => set("synovativeDomain", e.target.checked)}
              />
              The domain
            </label>
            <label className="flex items-center gap-2 text-[13px] text-ink">
              <input
                type="checkbox"
                className="accent-brand-bright"
                checked={form.synovativeHosting}
                onChange={(e) => set("synovativeHosting", e.target.checked)}
              />
              The hosting
            </label>
          </div>
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Website start date">
            <DatePicker
              value={form.startDate ?? ""}
              onChange={(v) => set("startDate", v || null)}
              config={db.calendar}
              ignoreWorkingRules
              allowPast
              clearable
            />
          </Field>
          <Field
            label="Next renewal"
            hint={
              renewalByHand
                ? "Set by hand."
                : form.startDate
                  ? `A year from the start: ${formatDate(firstRenewal(form.startDate))}.`
                  : "Follows the start date."
            }
          >
            <DatePicker
              value={(renewalByHand ? form.renewalDue : form.startDate ? firstRenewal(form.startDate) : form.renewalDue) ?? ""}
              onChange={(v) => {
                setRenewalByHand(!!v);
                set("renewalDue", v || null);
              }}
              config={db.calendar}
              ignoreWorkingRules
              allowPast
              clearable
            />
          </Field>
          <Field label="Annual renewal fee (₹)">
            <Input
              type="number"
              min="0"
              value={form.renewalFee ? String(form.renewalFee) : ""}
              onChange={(e) => set("renewalFee", Math.max(0, Number(e.target.value) || 0))}
              placeholder="Optional"
            />
          </Field>
        </div>

        <Field label="Notes">
          <Textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            placeholder="Vendor details, special arrangements…"
          />
        </Field>
      </div>
    </Modal>
  );
}
