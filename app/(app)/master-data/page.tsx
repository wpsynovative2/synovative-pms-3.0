"use client";

import { useMemo, useState } from "react";
import {
  IconPlus,
  IconTasks,
  IconTemplate,
  IconTrash,
  IconUsers,
} from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/modal";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  PageHeader,
  SearchInput,
  StatTile,
  Tabs,
} from "@/components/ui/primitives";
import { isSuperAdmin } from "@/lib/permissions";
import { useStore } from "@/lib/store";

/**
 * Departments (§5.1) and services (§5.2) — the two name lists every picker in
 * the app is built from.
 *
 * Super Admin only, because these names are referenced by projects, tasks,
 * profiles, templates and vendors. Those references are real foreign keys, so
 * the database itself refuses to remove a name still in use; this screen only
 * has to explain the refusal.
 *
 * Renaming is not offered: the foreign keys have no ON UPDATE CASCADE, so a
 * rename would be rejected. Add the new name, move the work across, then
 * retire the old one.
 */
type Pane = "departments" | "services";

export default function MasterDataPage() {
  const { currentUser } = useStore();
  const user = currentUser!;
  const [pane, setPane] = useState<Pane>("departments");

  if (!isSuperAdmin(user)) {
    return (
      <Card>
        <EmptyState
          icon={<IconTemplate size={30} />}
          title="Super Admin only"
          body="Departments and services are referenced across every project and account, so only a Super Admin can change them."
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Departments & Services"
        icon={<IconTemplate size={20} />}
        subtitle="The master lists behind every department and service picker in the app"
      />

      <Tabs<Pane>
        active={pane}
        onChange={setPane}
        tabs={[
          { id: "departments", label: "Departments", icon: <IconUsers size={14} /> },
          { id: "services", label: "Services", icon: <IconTasks size={14} /> },
        ]}
      />

      {pane === "departments" ? <Departments /> : <Services />}
    </div>
  );
}

/* --------------------------------------------------------- departments */

function Departments() {
  const { db, addDepartment, removeDepartment } = useStore();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  // How many people and tasks each department carries, so nobody deletes one
  // blind and then has to read a foreign-key error.
  const usage = useMemo(() => {
    const people = new Map<string, number>();
    const tasks = new Map<string, number>();
    for (const u of db.users) {
      for (const d of u.departments) people.set(d, (people.get(d) ?? 0) + 1);
    }
    for (const t of db.tasks) tasks.set(t.department, (tasks.get(t.department) ?? 0) + 1);
    return { people, tasks };
  }, [db.users, db.tasks]);

  const duplicate = db.departments.some(
    (d) => d.toLowerCase() === draft.trim().toLowerCase(),
  );

  const filtered = db.departments.filter((d) =>
    d.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Departments"
          value={db.departments.length}
          tone="brand"
          icon={<IconUsers size={17} />}
        />
        <StatTile
          label="In use by people"
          value={usage.people.size}
          hint="Departments with at least one member"
          tone="green"
        />
        <StatTile
          label="In use by tasks"
          value={usage.tasks.size}
          tone="blue"
        />
      </div>

      <Card>
        <CardHeader
          title="Add a department"
          subtitle="It appears immediately in every department picker"
        />
        <div className="flex flex-wrap gap-2 px-5 py-4">
          <Input
            className="min-w-64 flex-1"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim() && !duplicate) {
                addDepartment(draft);
                setDraft("");
              }
            }}
            placeholder="e.g. Motion Graphics"
            aria-label="New department name"
          />
          <Button
            variant="primary"
            disabled={!draft.trim() || duplicate}
            onClick={() => {
              addDepartment(draft);
              setDraft("");
            }}
          >
            <IconPlus size={15} /> Add department
          </Button>
          {duplicate ? (
            <p className="w-full text-[12px] text-st-rejected">That department already exists.</p>
          ) : null}
        </div>
      </Card>

      <SearchInput
        className="max-w-md"
        placeholder="Search departments…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <Card className="overflow-hidden">
        <ul>
          {filtered.map((d) => {
            const people = usage.people.get(d) ?? 0;
            const tasks = usage.tasks.get(d) ?? 0;
            const inUse = people > 0 || tasks > 0;
            return (
              <li
                key={d}
                className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3 last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{d}</span>
                <Badge>{people} people</Badge>
                <Badge>{tasks} tasks</Badge>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={inUse}
                  title={
                    inUse
                      ? "Still used by people or tasks — move them first"
                      : "Remove this department"
                  }
                  onClick={() => setDeleting(d)}
                >
                  <IconTrash size={13} />
                </Button>
              </li>
            );
          })}
          {filtered.length === 0 ? (
            <li>
              <EmptyState title="No departments match" />
            </li>
          ) : null}
        </ul>
      </Card>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && removeDepartment(deleting)}
        title={`Remove ${deleting ?? "this department"}?`}
        body="It disappears from every department picker. Nothing currently points at it, so no existing work changes."
        confirmLabel="Remove"
      />
    </div>
  );
}

/* ------------------------------------------------------------ services */

function Services() {
  const { db, addService, removeService } = useStore();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);

  const usage = useMemo(() => {
    const projects = new Map<string, number>();
    const vendors = new Map<string, number>();
    for (const p of db.projects) {
      for (const s of p.services) projects.set(s, (projects.get(s) ?? 0) + 1);
    }
    for (const v of db.vendors) {
      if (v.serviceType) vendors.set(v.serviceType, (vendors.get(v.serviceType) ?? 0) + 1);
    }
    return { projects, vendors };
  }, [db.projects, db.vendors]);

  const duplicate = db.services.some((s) => s.toLowerCase() === draft.trim().toLowerCase());

  const filtered = db.services.filter((s) =>
    s.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Services"
          value={db.services.length}
          tone="brand"
          icon={<IconTasks size={17} />}
        />
        <StatTile
          label="Sold on projects"
          value={usage.projects.size}
          tone="green"
        />
        <StatTile label="Supplied by vendors" value={usage.vendors.size} tone="blue" />
      </div>

      <Card>
        <CardHeader
          title="Add a service"
          subtitle="It appears immediately in project, template, OBC and vendor pickers"
        />
        <div className="flex flex-wrap gap-2 px-5 py-4">
          <Input
            className="min-w-64 flex-1"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim() && !duplicate) {
                addService(draft);
                setDraft("");
              }
            }}
            placeholder="e.g. Podcast Production"
            aria-label="New service name"
          />
          <Button
            variant="primary"
            disabled={!draft.trim() || duplicate}
            onClick={() => {
              addService(draft);
              setDraft("");
            }}
          >
            <IconPlus size={15} /> Add service
          </Button>
          {duplicate ? (
            <p className="w-full text-[12px] text-st-rejected">That service already exists.</p>
          ) : null}
        </div>
      </Card>

      <SearchInput
        className="max-w-md"
        placeholder="Search services…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <Card className="overflow-hidden">
        <ul>
          {filtered.map((s) => {
            const projects = usage.projects.get(s) ?? 0;
            const vendors = usage.vendors.get(s) ?? 0;
            const inUse = projects > 0 || vendors > 0;
            return (
              <li
                key={s}
                className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3 last:border-b-0"
              >
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{s}</span>
                <Badge>{projects} projects</Badge>
                <Badge>{vendors} vendors</Badge>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={inUse}
                  title={
                    inUse
                      ? "Still used by projects or vendors — move them first"
                      : "Remove this service"
                  }
                  onClick={() => setDeleting(s)}
                >
                  <IconTrash size={13} />
                </Button>
              </li>
            );
          })}
          {filtered.length === 0 ? (
            <li>
              <EmptyState title="No services match" />
            </li>
          ) : null}
        </ul>
      </Card>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && removeService(deleting)}
        title={`Remove ${deleting ?? "this service"}?`}
        body="It disappears from every service picker. Nothing currently points at it, so no existing work changes."
        confirmLabel="Remove"
      />
    </div>
  );
}
