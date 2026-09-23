"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ContentComposer } from "@/components/content/content-form";
import { ContentCard, ContentDetailScreen } from "@/components/content/content-view";
import {
  IconContent,
  IconEdit,
  IconPlus,
  IconTrash,
} from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/modal";
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
  canViewContentEntry,
  canWriteContent,
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
  const { db, currentUser, deleteContentEntry } = useStore();
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
   * It is the same rule the database runs: the project's people, plus whoever
   * the piece was allotted to.
   */
  const visible = useMemo(
    () =>
      db.contentEntries.filter((e) =>
        canViewContentEntry(user, e, db.projects, db.tasks),
      ),
    [db.contentEntries, db.projects, db.tasks, user],
  );

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

  /*
   * The library is read one project at a time — "what have we written for
   * Majestic Tower?" — so the list is filed under the project rather than run
   * together. Projects are in name order; inside each one the newest piece
   * comes first, which is the one being worked on.
   */
  const groups = useMemo(() => {
    const byProject = new Map<string, ContentEntry[]>();
    for (const e of filtered) {
      const list = byProject.get(e.projectId);
      if (list) list.push(e);
      else byProject.set(e.projectId, [e]);
    }
    return [...byProject]
      .map(([id, entries]) => ({
        id,
        project: db.projects.find((p) => p.id === id) ?? null,
        entries: [...entries].sort(
          (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
        ),
      }))
      .sort((a, b) => {
        // A project that has gone missing sorts last rather than first.
        if (!a.project || !b.project) return a.project ? -1 : b.project ? 1 : 0;
        return a.project.name.localeCompare(b.project.name);
      });
  }, [filtered, db.projects]);

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
        <div className="flex flex-col gap-7">
          {groups.map((g) => (
            <section key={g.id}>
              <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-line-soft pb-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: g.project?.color ?? "var(--color-ink-faint)" }}
                />
                {g.project ? (
                  <Link
                    href={`/projects/${g.project.id}`}
                    className="truncate text-[14px] font-semibold text-ink hover:text-brand-bright"
                  >
                    {g.project.name}
                  </Link>
                ) : (
                  <span className="truncate text-[14px] font-semibold text-ink-faint">
                    Unknown project
                  </span>
                )}
                {g.project?.clientName ? (
                  <span className="truncate text-[11px] text-ink-faint">
                    {g.project.clientName}
                  </span>
                ) : null}
                <span className="ml-auto shrink-0 text-[11px] text-ink-faint">
                  {g.entries.length} {g.entries.length === 1 ? "piece" : "pieces"}
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {g.entries.map((e) => (
                  <ContentCard
                    key={e.id}
                    entry={e}
                    // The project is the heading above; the card's second line
                    // is better spent on who the piece is waiting on.
                    showProject={false}
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
            </section>
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
        <ContentDetailScreen
          entry={open}
          onClose={() => setOpenId(null)}
          onEdit={() => {
            setEditing(open);
            setComposing(true);
          }}
        />
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
