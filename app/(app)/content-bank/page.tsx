"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ContentComposer } from "@/components/content/content-form";
import { ContentCard, ContentDetail } from "@/components/content/content-view";
import {
  IconContent,
  IconEdit,
  IconPlus,
  IconTasks,
  IconTrash,
} from "@/components/ui/icons";
import { ConfirmDialog, Drawer } from "@/components/ui/modal";
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  SearchInput,
  Select,
  StatTile,
  Tabs,
} from "@/components/ui/primitives";
import { SearchSelect } from "@/components/ui/selects";
import {
  canDeleteContentEntry,
  canEditContentEntry,
  canWriteContent,
  canViewProject,
} from "@/lib/permissions";
import { useStore } from "@/lib/store";
import { CONTENT_TYPES, type ContentEntry, type ContentType } from "@/lib/types";

/**
 * Module 5 — the Content Bank.
 *
 * Content Writers write here; everyone else reads what was written for a
 * project they hold a task on. Read access is the project's own rule, so a
 * team with no task on a project sees nothing of its content.
 */
type Scope = "all" | "mine" | "allotted";

export default function ContentBankPage() {
  const { db, currentUser, deleteContentEntry, taskById } = useStore();
  const user = currentUser!;
  const params = useSearchParams();

  const [scope, setScope] = useState<Scope>("all");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<ContentType | "all">("all");
  const [projectId, setProjectId] = useState(params.get("project") ?? "");
  const [openId, setOpenId] = useState<string | null>(params.get("entry"));
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<ContentEntry | null>(null);
  const [deleting, setDeleting] = useState<ContentEntry | null>(null);

  const mayWrite = canWriteContent(user);

  /*
   * Row Level Security already limits what came down, but the client filter
   * keeps the screen honest if a project's visibility changes mid-session.
   */
  const visible = useMemo(() => {
    const allowed = new Set(
      db.projects.filter((p) => canViewProject(user, p, db.tasks)).map((p) => p.id),
    );
    return db.contentEntries.filter((e) => allowed.has(e.projectId));
  }, [db.contentEntries, db.projects, db.tasks, user]);

  const scoped = useMemo(() => {
    if (scope === "mine") return visible.filter((e) => e.createdBy === user.id);
    if (scope === "allotted") return visible.filter((e) => e.allottedTo === user.id);
    return visible;
  }, [visible, scope, user.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped.filter(
      (e) =>
        (type === "all" || e.type === type) &&
        (!projectId || e.projectId === projectId) &&
        (!q ||
          e.caption.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.onPic.toLowerCase().includes(q) ||
          e.type.toLowerCase().includes(q)),
    );
  }, [scoped, query, type, projectId]);

  const projectOptions = useMemo(() => {
    const ids = new Set(visible.map((e) => e.projectId));
    return db.projects.filter((p) => ids.has(p.id)).map((p) => ({ value: p.id, label: p.name }));
  }, [visible, db.projects]);

  const open = openId ? visible.find((e) => e.id === openId) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Content Bank"
        icon={<IconContent size={20} />}
        subtitle={
          mayWrite
            ? "Everything you have written, filed against its project"
            : "Content written for the projects you work on"
        }
        actions={
          mayWrite ? (
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null);
                setComposing(true);
              }}
            >
              <IconPlus size={15} /> Write content
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Pieces you can see"
          value={visible.length}
          tone="brand"
          icon={<IconContent size={17} />}
        />
        <StatTile
          label="Written by you"
          value={visible.filter((e) => e.createdBy === user.id).length}
          tone="blue"
        />
        <StatTile
          label="Allotted to you"
          value={visible.filter((e) => e.allottedTo === user.id).length}
          tone="green"
        />
        <StatTile
          label="Billed extra"
          value={visible.filter((e) => e.billingType === "Extra").length}
          tone="amber"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs<Scope>
          active={scope}
          onChange={setScope}
          tabs={[
            { id: "all", label: "All content", count: visible.length },
            ...(mayWrite
              ? [
                  {
                    id: "mine" as const,
                    label: "Written by me",
                    count: visible.filter((e) => e.createdBy === user.id).length,
                  },
                ]
              : []),
            {
              id: "allotted",
              label: "Allotted to me",
              count: visible.filter((e) => e.allottedTo === user.id).length,
            },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          className="max-w-md flex-1"
          placeholder="Search captions, on-pic lines and content…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          className="w-auto min-w-44"
          value={type}
          onChange={(e) => setType(e.target.value as ContentType | "all")}
          aria-label="CB type"
        >
          <option value="all">Any type</option>
          {CONTENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <div className="w-56">
          <SearchSelect
            allowClear
            options={projectOptions}
            value={projectId}
            onChange={setProjectId}
            placeholder="Any project"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconContent size={30} />}
            title="Nothing here yet"
            body={
              mayWrite
                ? "Write the captions, scripts and body copy for your projects, and the rest of the team picks them up from their tasks."
                : "Content shows up here once a writer files it against a project you work on."
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((e) => (
            <ContentCard
              key={e.id}
              entry={e}
              onOpen={() => setOpenId(e.id)}
              actions={
                <>
                  {canEditContentEntry(user, e) ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        setEditing(e);
                        setComposing(true);
                      }}
                    >
                      <IconEdit size={13} />
                    </Button>
                  ) : null}
                  {canDeleteContentEntry(user, e) ? (
                    <Button size="sm" variant="danger" onClick={() => setDeleting(e)}>
                      <IconTrash size={13} />
                    </Button>
                  ) : null}
                </>
              }
            />
          ))}
        </div>
      )}

      {composing ? (
        <ContentComposer
          entry={editing ?? undefined}
          onClose={() => {
            setComposing(false);
            setEditing(null);
          }}
        />
      ) : null}

      {open ? (
        <Drawer
          open
          onClose={() => setOpenId(null)}
          title={open.caption.trim() || open.type}
          subtitle="Content Bank entry"
        >
          <div className="flex flex-col gap-5">
            <ContentDetail entry={open} />
            {open.taskId && taskById(open.taskId) ? (
              <Link
                href={
                  open.projectId
                    ? `/projects/${open.projectId}?task=${open.taskId}`
                    : `/tasks?task=${open.taskId}`
                }
                className="flex items-center gap-2 rounded-card border border-line-soft bg-surface-2 px-3 py-2 text-[12px] text-ink hover:border-brand-bright/40"
              >
                <IconTasks size={14} /> Open the task this was written for
              </Link>
            ) : null}
          </div>
        </Drawer>
      ) : null}

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteContentEntry(deleting.id)}
        title="Delete this content?"
        body="The piece disappears from the task it was written for, too."
        confirmLabel="Delete content"
      />
    </div>
  );
}
