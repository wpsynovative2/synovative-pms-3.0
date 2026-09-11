"use client";

import { useMemo, useState } from "react";
import {
  IconCopy,
  IconEdit,
  IconExternal,
  IconFolder,
  IconLink,
  IconPlus,
  IconTrash,
} from "@/components/ui/icons";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  Input,
  PageHeader,
  SearchInput,
} from "@/components/ui/primitives";
import { SearchSelect } from "@/components/ui/selects";
import { canManageLinks } from "@/lib/permissions";
import { useStore, type LinkInput } from "@/lib/store";
import type { LinkGroup, OperationalLink } from "@/lib/types";

/** Kind of Google file a link points at, read from its address. */
function linkKind(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname;
    if (host === "docs.google.com") {
      if (path.startsWith("/document")) return "Doc";
      if (path.startsWith("/spreadsheets")) return "Sheet";
      if (path.startsWith("/presentation")) return "Slides";
      if (path.startsWith("/forms")) return "Form";
      return "Google Docs";
    }
    if (host === "forms.gle") return "Form";
    if (host === "drive.google.com") {
      if (/\/folders\//.test(path)) return "Folder";
      if (path.startsWith("/file")) return "File";
      return "Drive";
    }
    return host;
  } catch {
    return "Link";
  }
}

function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return (u.protocol === "https:" || u.protocol === "http:") && !!u.hostname;
  } catch {
    return false;
  }
}

/** Shared Google Drive folders and files, kept in named groups. */
export default function OperationalLinksPage() {
  const { db, currentUser, deleteLink, deleteLinkGroup, showToast } = useStore();
  const user = currentUser!;
  const mayManage = canManageLinks(user);

  const [query, setQuery] = useState("");
  const [linkForm, setLinkForm] = useState<{ link?: OperationalLink; groupId?: string } | null>(
    null,
  );
  const [renaming, setRenaming] = useState<LinkGroup | null>(null);
  const [deletingLink, setDeletingLink] = useState<OperationalLink | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<LinkGroup | null>(null);

  const linksByGroup = useMemo(() => {
    const map = new Map<string, OperationalLink[]>();
    for (const l of db.operationalLinks) {
      const list = map.get(l.groupId) ?? [];
      list.push(l);
      map.set(l.groupId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [db.operationalLinks]);

  // A group shows when its name matches, or with just the links that match.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...db.linkGroups]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((group) => {
        const links = linksByGroup.get(group.id) ?? [];
        if (!q || group.name.toLowerCase().includes(q)) return { group, links };
        return {
          group,
          links: links.filter(
            (l) => l.name.toLowerCase().includes(q) || l.url.toLowerCase().includes(q),
          ),
        };
      })
      .filter((g) => !q || g.links.length > 0 || g.group.name.toLowerCase().includes(q));
  }, [db.linkGroups, linksByGroup, query]);

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied.", "success");
    } catch {
      showToast("Couldn't copy — your browser blocked clipboard access.");
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Operational links"
        icon={<IconLink size={20} />}
        subtitle={
          mayManage
            ? "Shared Google Drive folders and files, organised in groups"
            : "Shared Google Drive folders and files — read only"
        }
        actions={
          mayManage ? (
            <Button variant="primary" onClick={() => setLinkForm({})}>
              <IconPlus size={15} /> Add link
            </Button>
          ) : null
        }
      />

      {db.linkGroups.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput
            className="max-w-md"
            placeholder="Search groups, link names or addresses…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="text-[12px] text-ink-faint">
            {db.operationalLinks.length} link{db.operationalLinks.length === 1 ? "" : "s"} in{" "}
            {db.linkGroups.length} group{db.linkGroups.length === 1 ? "" : "s"}
          </span>
        </div>
      ) : null}

      {db.linkGroups.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconLink size={30} />}
            title="No links yet"
            body={
              mayManage
                ? "Add the Drive folders and documents the team uses every day — brand assets, client folders, SOPs — grouped so they're easy to find."
                : "Links shared by your managers will appear here."
            }
            action={
              mayManage ? (
                <Button variant="primary" onClick={() => setLinkForm({})}>
                  <IconPlus size={15} /> Add the first link
                </Button>
              ) : null
            }
          />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState icon={<IconLink size={30} />} title="Nothing matches that search" />
        </Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {visible.map(({ group, links }) => (
            <Card key={group.id} className="overflow-hidden">
              <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-brand/15 text-brand-ink">
                  <IconFolder size={16} />
                </span>
                <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">
                  {group.name}
                </h2>
                <Badge>{(linksByGroup.get(group.id) ?? []).length}</Badge>
                {mayManage ? (
                  <div className="flex shrink-0 gap-1">
                    <IconButton
                      label={`Add a link to ${group.name}`}
                      onClick={() => setLinkForm({ groupId: group.id })}
                    >
                      <IconPlus size={14} />
                    </IconButton>
                    <IconButton label="Rename group" onClick={() => setRenaming(group)}>
                      <IconEdit size={14} />
                    </IconButton>
                    <IconButton label="Delete group" onClick={() => setDeletingGroup(group)}>
                      <IconTrash size={14} />
                    </IconButton>
                  </div>
                ) : null}
              </div>

              {links.length === 0 ? (
                <p className="px-4 py-5 text-center text-[12px] text-ink-faint">
                  No links in this group yet.
                </p>
              ) : (
                <ul>
                  {links.map((link) => (
                    <li
                      key={link.id}
                      className="group flex items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-0 hover:bg-surface-2"
                    >
                      <span className="w-14 shrink-0">
                        <span className="inline-flex max-w-full truncate rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
                          {linkKind(link.url)}
                        </span>
                      </span>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 flex-1"
                        title={link.url}
                      >
                        <span className="block truncate text-[13px] font-medium text-ink group-hover:text-ink-strong">
                          {link.name}
                        </span>
                        <span className="block truncate text-[11px] text-ink-faint">
                          {link.url.replace(/^https?:\/\//, "")}
                        </span>
                      </a>
                      <div className="flex shrink-0 gap-1">
                        <IconButton label="Copy link" onClick={() => void copy(link.url)}>
                          <IconCopy size={14} />
                        </IconButton>
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open ${link.name}`}
                          title="Open in a new tab"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface-2 text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
                        >
                          <IconExternal size={14} />
                        </a>
                        {mayManage ? (
                          <>
                            <IconButton label="Edit link" onClick={() => setLinkForm({ link })}>
                              <IconEdit size={14} />
                            </IconButton>
                            <IconButton label="Delete link" onClick={() => setDeletingLink(link)}>
                              <IconTrash size={14} />
                            </IconButton>
                          </>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}

      {linkForm && mayManage ? (
        <LinkFormModal
          link={linkForm.link}
          defaultGroupId={linkForm.groupId}
          onClose={() => setLinkForm(null)}
        />
      ) : null}

      {renaming ? <RenameGroupModal group={renaming} onClose={() => setRenaming(null)} /> : null}

      <ConfirmDialog
        open={!!deletingLink}
        onClose={() => setDeletingLink(null)}
        onConfirm={() => deletingLink && deleteLink(deletingLink.id)}
        title={`Delete “${deletingLink?.name ?? "this link"}”?`}
        body="It's removed for everyone. The Drive file itself isn't touched."
      />

      <ConfirmDialog
        open={!!deletingGroup}
        onClose={() => setDeletingGroup(null)}
        onConfirm={() => deletingGroup && deleteLinkGroup(deletingGroup.id)}
        title={`Delete the “${deletingGroup?.name ?? ""}” group?`}
        body={(() => {
          const n = deletingGroup ? (linksByGroup.get(deletingGroup.id) ?? []).length : 0;
          return n
            ? `Its ${n} link${n === 1 ? "" : "s"} will be deleted too. The Drive files themselves aren't touched.`
            : "The group is empty, so no links are affected.";
        })()}
      />
    </div>
  );
}

/* ------------------------------------------------------------ link form */

function LinkFormModal({
  link,
  defaultGroupId,
  onClose,
}: {
  link?: OperationalLink;
  defaultGroupId?: string;
  onClose: () => void;
}) {
  const { db, createLink, updateLink } = useStore();
  const hasGroups = db.linkGroups.length > 0;

  const [groupMode, setGroupMode] = useState<"existing" | "new">(hasGroups ? "existing" : "new");
  const [groupId, setGroupId] = useState(link?.groupId ?? defaultGroupId ?? "");
  const [newGroupName, setNewGroupName] = useState("");
  const [name, setName] = useState(link?.name ?? "");
  const [url, setUrl] = useState(link?.url ?? "");
  const [touched, setTouched] = useState(false);

  const groupOptions = useMemo(
    () =>
      [...db.linkGroups]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((g) => ({
          value: g.id,
          label: g.name,
          hint: `${db.operationalLinks.filter((l) => l.groupId === g.id).length} links`,
        })),
    [db.linkGroups, db.operationalLinks],
  );

  const typedGroup = newGroupName.trim();
  const matchingGroup = typedGroup
    ? db.linkGroups.find((g) => g.name.trim().toLowerCase() === typedGroup.toLowerCase())
    : undefined;

  const errors = {
    group:
      groupMode === "existing"
        ? !groupId
          ? "Pick a group."
          : undefined
        : !typedGroup
          ? "Name the new group."
          : typedGroup.length > 80
            ? "Keep it under 80 characters."
            : undefined,
    name: !name.trim() ? "Give the link a name." : name.trim().length > 120 ? "Keep it under 120 characters." : undefined,
    url: !url.trim()
      ? "Paste the link."
      : !isValidUrl(url)
        ? "That isn't a valid web address — it should start with https://"
        : undefined,
  };
  const valid = Object.values(errors).every((e) => !e);

  const save = () => {
    setTouched(true);
    if (!valid) return;
    const input: LinkInput =
      groupMode === "existing"
        ? { groupId, name, url }
        : { newGroupName: typedGroup, name, url };
    if (link) updateLink(link.id, input);
    else createLink(input);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={link ? "Edit link" : "Add link"}
      subtitle="Paste a Google Drive folder, file, Doc, Sheet or Slides link."
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            {link ? "Save changes" : "Add link"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field
          label="Group"
          required
          error={touched ? errors.group : undefined}
          hint={
            groupMode === "new" && matchingGroup
              ? `“${matchingGroup.name}” already exists — the link will go there.`
              : undefined
          }
        >
          {groupMode === "existing" ? (
            <SearchSelect
              options={groupOptions}
              value={groupId}
              onChange={setGroupId}
              placeholder="Choose a group"
            />
          ) : (
            <Input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="e.g. Brand assets"
              autoFocus
            />
          )}
          {hasGroups ? (
            <button
              type="button"
              onClick={() => setGroupMode(groupMode === "existing" ? "new" : "existing")}
              className="mt-1 w-fit text-[12px] font-medium text-brand-ink hover:underline"
            >
              {groupMode === "existing" ? "+ Create a new group" : "Choose an existing group"}
            </button>
          ) : null}
        </Field>

        <Field label="Name" required error={touched ? errors.name : undefined}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Lodha Amara — final creatives"
            autoFocus={groupMode === "existing"}
          />
        </Field>

        <Field label="Link" required error={touched ? errors.url : undefined}>
          <Input
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/…"
          />
        </Field>

        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------- rename group */

function RenameGroupModal({ group, onClose }: { group: LinkGroup; onClose: () => void }) {
  const { db, renameLinkGroup } = useStore();
  const [name, setName] = useState(group.name);
  const [touched, setTouched] = useState(false);

  const trimmed = name.trim();
  const clash = db.linkGroups.some(
    (g) => g.id !== group.id && g.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  const error = !trimmed
    ? "A group needs a name."
    : trimmed.length > 80
      ? "Keep it under 80 characters."
      : clash
        ? "Another group already has that name."
        : undefined;

  const save = () => {
    setTouched(true);
    if (error) return;
    if (trimmed !== group.name) renameLinkGroup(group.id, trimmed);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Rename group"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Group name" required error={touched ? error : undefined}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
