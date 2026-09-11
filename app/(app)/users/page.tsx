"use client";

import { useMemo, useState } from "react";
import { IconEdit, IconPlus, IconTrash, IconUser, IconUsers } from "@/components/ui/icons";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import {
  Avatar,
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
  cx,
} from "@/components/ui/primitives";
import { MultiSelect, SearchSelect } from "@/components/ui/selects";
import { formatDate } from "@/lib/calendar";
import { DEPARTMENTS } from "@/lib/master-data";
import {
  assignableRoles,
  canAddUsers,
  canDeleteUsers,
  canEditUsers,
} from "@/lib/permissions";
import { MIN_PASSWORD } from "@/components/layout/first-sign-in";
import { useStore, type UserPatch } from "@/lib/store";
import { ROLE_LABEL, type Role, type User } from "@/lib/types";

/** §6 — user management. Deactivation is preferred over deletion. */
export default function UsersPage() {
  const { db, currentUser, createUser, updateUser, deleteUser, showToast } = useStore();
  const user = currentUser!;

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return db.users.filter((u) => {
      if (q && !u.fullName.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q))
        return false;
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (departmentFilter !== "all" && !u.departments.includes(departmentFilter))
        return false;
      return true;
    });
  }, [db.users, query, roleFilter, departmentFilter]);

  if (!canAddUsers(user)) {
    return (
      <Card>
        <EmptyState
          icon={<IconUsers size={30} />}
          title="User management isn't available for your role"
          body="Super Admins, Admins and HR Admins manage users."
        />
      </Card>
    );
  }

  const leadCount = (u: User) => db.projects.filter((p) => p.leaderId === u.id).length;
  const taskCount = (u: User) => db.tasks.filter((t) => t.assigneeId === u.id).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Users"
        icon={<IconUser size={20} />}
        subtitle="Accounts, roles and departments"
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <IconPlus size={15} /> Add user
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Total users"
          value={db.users.length}
          tone="brand"
          icon={<IconUsers size={17} />}
        />
        <StatTile
          label="Active"
          value={db.users.filter((u) => u.active).length}
          tone="green"
        />
        <StatTile
          label="Deactivated"
          value={db.users.filter((u) => !u.active).length}
          tone="neutral"
        />
        <StatTile
          label="Departments covered"
          value={new Set(db.users.flatMap((u) => u.departments)).size}
          hint={`of ${DEPARTMENTS.length}`}
          tone="blue"
        />
      </div>

      <Card className="flex flex-wrap items-end gap-2.5 p-3.5">
        <SearchInput
          className="min-w-52 flex-1"
          placeholder="Search by name or email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          className="w-auto min-w-36"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          aria-label="Role"
        >
          <option value="all">All roles</option>
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto min-w-44"
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          aria-label="Department"
        >
          <option value="all">All departments</option>
          {DEPARTMENTS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </Select>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon={<IconUsers size={30} />} title="No users match these filters" />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-left text-[12px]">
            <thead className="bg-surface-2 text-[10px] tracking-wide text-ink-faint uppercase">
              <tr>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Department(s)</th>
                <th className="px-4 py-2.5 font-medium">Workload</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className="border-t border-line-soft hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={u.fullName} size={30} />
                      <div className="min-w-0">
                        <div className="truncate text-[13px] text-ink">{u.fullName}</div>
                        <div className="truncate text-[11px] text-ink-faint">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      className={cx(
                        u.role === "super_admin" &&
                          "border-brand-bright/40 bg-brand/25 text-brand-ink",
                      )}
                    >
                      {ROLE_LABEL[u.role]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex max-w-64 flex-wrap gap-1">
                      {u.departments.map((d) => (
                        <span
                          key={d}
                          className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-ink-muted"
                        >
                          {d}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink-muted">
                    {taskCount(u)} task{taskCount(u) === 1 ? "" : "s"}
                    {leadCount(u) > 0 ? (
                      <span className="block text-[10px] text-ink-faint">
                        Leads {leadCount(u)} project{leadCount(u) === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {u.active ? (
                      <Badge className="border-st-approved/30 bg-st-approved/15 text-st-approved">
                        Active
                      </Badge>
                    ) : (
                      <Badge className="border-line bg-surface-3 text-ink-faint">
                        Deactivated
                      </Badge>
                    )}
                    <div className="mt-1 text-[10px] text-ink-faint">
                      Since {formatDate(u.createdAt.slice(0, 10))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {canEditUsers(user) ? (
                        <Button
                          size="sm"
                          onClick={() => {
                            setEditing(u);
                            setFormOpen(true);
                          }}
                        >
                          <IconEdit size={13} />
                        </Button>
                      ) : null}
                      {canEditUsers(user) && u.id !== user.id ? (
                        <Button
                          size="sm"
                          onClick={async () => {
                            const r = await updateUser(u.id, { active: !u.active });
                            if (r.ok) {
                              showToast(`${u.fullName} ${u.active ? "deactivated" : "reactivated"}.`, "success");
                            } else showToast(r.error ?? "Couldn't update the account.");
                          }}
                        >
                          {u.active ? "Deactivate" : "Reactivate"}
                        </Button>
                      ) : null}
                      {/* Hard delete is Super Admin only (§4.2). */}
                      {canDeleteUsers(user) && u.id !== user.id ? (
                        <Button size="sm" variant="danger" onClick={() => setDeleting(u)}>
                          <IconTrash size={13} />
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="px-4 py-3 text-[11px] leading-relaxed text-ink-faint">
        Deactivating is preferred over deletion — task history, time logs and reviews stay
        intact, and the person can no longer sign in. Only a Super Admin can delete an
        account outright, or grant the Admin role.
      </Card>

      {formOpen ? (
        <UserFormModal
          open
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          editing={editing ?? undefined}
          assignable={assignableRoles(user)}
          onSave={async (payload) => {
            const result = editing
              ? await updateUser(editing.id, payload)
              : await createUser({
                  fullName: payload.fullName ?? "",
                  email: payload.email ?? "",
                  password: payload.password ?? "",
                  role: payload.role ?? "team_member",
                  departments: payload.departments ?? [],
                });
            if (result.ok) {
              showToast(editing ? "Changes saved." : `${payload.fullName} can now sign in.`, "success");
            }
            return result;
          }}
        />
      ) : null}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const r = await deleteUser(deleting.id);
          if (r.ok) showToast(`${deleting.fullName}'s account was deleted.`, "success");
          else showToast(r.error ?? "Couldn't delete the account.");
        }}
        title={`Delete ${deleting?.fullName ?? "this user"}?`}
        body="Only possible for someone with no work on record — otherwise deactivate them, which keeps their history and blocks access."
      />
    </div>
  );
}

function UserFormModal({
  open,
  onClose,
  editing,
  assignable,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  editing?: User;
  assignable: Role[];
  onSave: (payload: UserPatch) => Promise<{ ok: boolean; error?: string }>;
}) {
  const { db } = useStore();
  const [fullName, setFullName] = useState(editing?.fullName ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(editing?.role ?? "team_member");
  const [departments, setDepartments] = useState<string[]>(editing?.departments ?? []);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const multiDepartment = role === "team_leader";
  const emailTaken = db.users.some(
    (u) => u.email.toLowerCase() === email.trim().toLowerCase() && u.id !== editing?.id,
  );

  const errors = {
    fullName: !fullName.trim() ? "Required." : undefined,
    email: !email.trim()
      ? "Required."
      : emailTaken
        ? "That email is already in use."
        : undefined,
    password:
      (!editing || password) && password.length < MIN_PASSWORD
        ? `At least ${MIN_PASSWORD} characters.`
        : undefined,
    departments: departments.length === 0 ? "Pick at least one department." : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit user" : "Add user"}
      subtitle={
        editing
          ? undefined
          : "Creates their login. They choose their own password the first time they sign in."
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setTouched(true);
              if (!valid) return;
              const payload: UserPatch = {
                fullName: fullName.trim(),
                email: email.trim().toLowerCase(),
                departments: multiDepartment ? departments : departments.slice(0, 1),
              };
              // Leave the role out when it isn't changing — a Super Admin's own
              // role isn't in the assignable list and must not be re-sent.
              if (role !== editing?.role) payload.role = role;
              if (password) payload.password = password;
              setBusy(true);
              setServerError(null);
              const result = await onSave(payload);
              setBusy(false);
              if (result.ok) onClose();
              else setServerError(result.error ?? "Couldn't save.");
            }}
          >
            {busy ? "Saving…" : editing ? "Save changes" : "Create user"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Full name" required error={touched ? errors.fullName : undefined}>
          <Input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Ashirwad Agrawal"
          />
        </Field>

        <Field
          label="Email"
          required
          hint="Used as the login ID."
          error={touched ? errors.email : undefined}
        >
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@synovative.in"
          />
        </Field>

        <Field
          label={editing ? "Reset password" : "Temporary password"}
          required={!editing}
          hint={
            editing
              ? "Leave blank to keep the current password. A reset asks them to choose a new one."
              : "Share it privately; they must change it at first sign-in."
          }
          error={touched ? errors.password : undefined}
        >
          <Input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={`At least ${MIN_PASSWORD} characters`}
            autoComplete="new-password"
          />
        </Field>

        <Field
          label="Role"
          required
          hint={
            assignable.includes("admin")
              ? "Only a Super Admin can grant the Admin role."
              : "The Admin role can only be granted by a Super Admin."
          }
        >
          <Select
            value={role}
            onChange={(e) => {
              const next = e.target.value as Role;
              setRole(next);
              if (next !== "team_leader") setDepartments((d) => d.slice(0, 1));
            }}
          >
            {assignable.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
            {editing?.role === "super_admin" ? (
              <option value="super_admin">{ROLE_LABEL.super_admin}</option>
            ) : null}
          </Select>
        </Field>

        <Field
          label={multiDepartment ? "Departments" : "Department"}
          required
          hint={
            multiDepartment
              ? "A Team Leader can lead several departments and sees all their tasks."
              : undefined
          }
          error={touched ? errors.departments : undefined}
        >
          {multiDepartment ? (
            <MultiSelect
              options={DEPARTMENTS.map((d) => ({ value: d, label: d }))}
              value={departments}
              onChange={setDepartments}
              placeholder="Search departments…"
              emptyLabel="No departments selected"
            />
          ) : (
            <SearchSelect
              options={DEPARTMENTS.map((d) => ({ value: d, label: d }))}
              value={departments[0] ?? ""}
              onChange={(v) => setDepartments(v ? [v] : [])}
              placeholder="Select a department"
            />
          )}
        </Field>

        {serverError ? (
          <p className="rounded-lg border border-st-rejected/30 bg-st-rejected/10 px-3 py-2 text-[12px] text-st-rejected">
            {serverError}
          </p>
        ) : null}

        {departments.includes("Accounts & Finance") ? (
          <p className="rounded-lg border border-st-submitted/25 bg-st-submitted/10 px-3 py-2 text-[11px] leading-relaxed text-st-submitted">
            Members of Accounts &amp; Finance can approve or reject project expenses —
            that authority comes from the department, not the role.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
