"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ContentComposer } from "@/components/content/content-form";
import { ContentCard, ContentDetailScreen } from "@/components/content/content-view";
import {
  IconContact,
  IconContent,
  IconCrane,
  IconEdit,
  IconFolder,
  IconPlus,
  IconProperty,
  IconTrash,
} from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/modal";
import {
  Button,
  Card,
  cx,
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
  canViewClientsModule,
} from "@/lib/permissions";
import { formatMonth } from "@/lib/calendar";
import { useStore } from "@/lib/store";
import {
  CONTENT_BILLING_TYPES,
  CONTENT_PLACEMENTS,
  CONTENT_STAGES,
  CONTENT_TYPES,
  contentHolders,
  isContentStarted,
  type ContentBillingType,
  type ContentPlacement,
  type ContentEntry,
  type ContentStage,
  type ContentType,
} from "@/lib/types";

/**
 * Module 5 — the Content Bank.
 *
 * Content Writers write here; everyone else reads what was written for a
 * project they hold a task on. Read access is the project's own rule, so a
 * team with no task on a project sees nothing of its content.
 */
type Scope = "all" | "mine" | "allotted";

/** Stands for "nobody" in the assignee filter and "not set" in the status one. */
const NONE = "__none__";

type SortKey = "newest" | "oldest" | "assignee" | "writer" | "status";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "assignee", label: "Assignee A–Z" },
  { value: "writer", label: "Writer A–Z" },
  { value: "status", label: "Status" },
];

type GroupKey = "project" | "company" | "property" | "client";

const GROUPS: { value: GroupKey; label: string }[] = [
  { value: "project", label: "Project" },
  { value: "company", label: "Company" },
  { value: "property", label: "Property" },
  { value: "client", label: "Client" },
];

interface PieceGroup {
  id: string;
  title: string;
  /** A muted line beside the title - the company, under a project. */
  subtitle?: string;
  href?: string;
  /** A project's own colour; the other groupings show their icon instead. */
  color?: string;
  icon?: React.ReactNode;
  entries: ContentEntry[];
}

export default function ContentBankPage() {
  const { db, currentUser, deleteContentEntry, companyById, propertyById, clientById } =
    useStore();
  const user = currentUser!;
  const params = useSearchParams();

  const [scope, setScope] = useState<Scope>("all");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<ContentType | "all">("all");
  const [forMonth, setForMonth] = useState("");
  const [projectId, setProjectId] = useState(params.get("project") ?? "");
  const [assigneeId, setAssigneeId] = useState("");
  const [writerId, setWriterId] = useState("");
  const [stage, setStage] = useState<ContentStage | typeof NONE | "">("");
  const [billing, setBilling] = useState<ContentBillingType | "">("");
  const [placement, setPlacement] = useState<ContentPlacement | typeof NONE | "">("");
  const [progress, setProgress] = useState<"" | "started" | "not-started">("");
  const [sort, setSort] = useState<SortKey>("newest");
  const [groupBy, setGroupBy] = useState<GroupKey>("project");
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
      db.contentEntries.filter(
        (e) =>
          // A content task's pieces show from the start, so the ones nobody
          // has started yet can be found; anything else once written.
          (e.slot !== null || isContentStarted(e)) &&
          canViewContentEntry(user, e, db.projects, db.tasks),
      ),
    [db.contentEntries, db.projects, db.tasks, user],
  );

  const scoped = useMemo(() => {
    if (scope === "mine") return visible.filter((e) => e.createdBy === user.id);
    if (scope === "allotted") return visible.filter((e) => holds(e, user.id));
    return visible;
  }, [visible, scope, user.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped.filter(
      (e) =>
        (type === "all" || e.type === type) &&
        (!forMonth || e.forMonth === forMonth) &&
        (!projectId || e.projectId === projectId) &&
        (!assigneeId ||
          (assigneeId === NONE ? !e.allottedTo : holds(e, assigneeId))) &&
        (!writerId || e.createdBy === writerId) &&
        (!stage || (stage === NONE ? !e.stage : e.stage === stage)) &&
        (!billing || e.billingType === billing) &&
        (!placement || (placement === NONE ? !e.placement : e.placement === placement)) &&
        (!progress || isContentStarted(e) === (progress === "started")) &&
        (!q ||
          e.caption.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.onPic.toLowerCase().includes(q) ||
          e.type.toLowerCase().includes(q)),
    );
  }, [scoped, query, type, forMonth, projectId, assigneeId, writerId, stage, billing, placement, progress]);

  // Only months some visible piece is actually for, newest first.
  const monthsInUse = useMemo(
    () => Array.from(new Set(visible.map((e) => e.forMonth))).sort().reverse(),
    [visible],
  );

  const filtering =
    !!query.trim() ||
    type !== "all" ||
    !!forMonth ||
    !!projectId ||
    !!assigneeId ||
    !!writerId ||
    !!stage ||
    !!billing ||
    !!placement ||
    !!progress;

  const clearFilters = () => {
    setQuery("");
    setType("all");
    setForMonth("");
    setProjectId("");
    setAssigneeId("");
    setWriterId("");
    setStage("");
    setBilling("");
    setPlacement("");
    setProgress("");
  };

  // Only people who actually appear on a visible piece are offered.
  const peopleOptions = useMemo(() => {
    const options = (ids: Set<string | null>) =>
      db.users
        .filter((u) => ids.has(u.id))
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
        .map((u) => ({ value: u.id, label: u.fullName, avatarName: u.fullName }));
    return {
      assignees: [
        { value: NONE, label: "Not allotted" },
        ...options(new Set(visible.flatMap((e) => contentHolders(e)))),
      ],
      writers: options(new Set(visible.map((e) => e.createdBy))),
    };
  }, [visible, db.users]);

  const projectOptions = useMemo(() => {
    const ids = new Set(visible.map((e) => e.projectId));
    return db.projects.filter((p) => ids.has(p.id)).map((p) => ({ value: p.id, label: p.name }));
  }, [visible, db.projects]);

  /*
   * Order inside each project. Newest is the default because that is the
   * piece being worked on; the others answer "what does each person have" and
   * "what is still to move". Ties always fall back to newest first.
   */
  const compare = useMemo(() => {
    const name = (id: string | null) =>
      (id ? db.users.find((u) => u.id === id)?.fullName : undefined) ?? "";
    const newest = (a: ContentEntry, b: ContentEntry) =>
      b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt);
    // Unallotted and unset sort last, not first.
    const last = (x: string) => x || "\uffff";
    const stageRank = (e: ContentEntry) =>
      e.stage ? CONTENT_STAGES.indexOf(e.stage) : CONTENT_STAGES.length;
    return (a: ContentEntry, b: ContentEntry) => {
      switch (sort) {
        case "oldest":
          return -newest(a, b);
        case "assignee":
          return (
            last(name(a.allottedTo)).localeCompare(last(name(b.allottedTo))) || newest(a, b)
          );
        case "writer":
          return name(a.createdBy).localeCompare(name(b.createdBy)) || newest(a, b);
        case "status":
          return stageRank(a) - stageRank(b) || newest(a, b);
        default:
          return newest(a, b);
      }
    };
  }, [sort, db.users]);

  /*
   * The library is read one project at a time - "what have we written for
   * Majestic Tower?" - so the list is filed under the project rather than run
   * together; or, a level up, under the company, property or client contacts
   * the project is for. Groups are in name order, with anything the project
   * does not say last; inside each one the chosen sort applies.
   */
  const groups = useMemo(() => {
    const projectOf = new Map(db.projects.map((p) => [p.id, p]));
    const keyed = new Map<string, PieceGroup>();
    const NOT_SET = "__unset__";
    for (const e of filtered) {
      const project = projectOf.get(e.projectId) ?? null;
      let g: Omit<PieceGroup, "entries">;
      if (groupBy === "company") {
        const company = companyById(project?.companyId ?? null);
        g = company
          ? { id: company.id, title: company.name, href: `/companies?company=${company.id}`, icon: <IconCrane size={13} /> }
          : project?.clientName
            ? { id: `typed:${project.clientName}`, title: project.clientName, icon: <IconCrane size={13} /> }
            : { id: NOT_SET, title: "No company", icon: <IconCrane size={13} /> };
      } else if (groupBy === "property") {
        const property = propertyById(project?.propertyId ?? null);
        g = property
          ? {
              id: property.id,
              title: property.name,
              subtitle: companyById(property.companyId)?.name,
              href: `/properties?property=${property.id}`,
              icon: <IconProperty size={13} />,
            }
          : { id: NOT_SET, title: "No property", icon: <IconProperty size={13} /> };
      } else if (groupBy === "client") {
        // A project for several contacts files its pieces under all of them together.
        const clients = (project?.clientIds ?? [])
          .map((id) => clientById(id))
          .filter((c) => !!c);
        g = clients.length
          ? {
              id: clients.map((c) => c.id).join(","),
              title: clients.map((c) => c.fullName).join(", "),
              subtitle: companyById(clients[0].companyId)?.name,
              href:
                clients.length === 1 && canViewClientsModule(user)
                  ? `/clients?client=${clients[0].id}`
                  : undefined,
              icon: <IconContact size={13} />,
            }
          : { id: NOT_SET, title: "No client", icon: <IconContact size={13} /> };
      } else {
        g = project
          ? {
              id: project.id,
              title: project.name,
              subtitle: project.clientName || undefined,
              href: `/projects/${project.id}`,
              color: project.color,
            }
          : { id: NOT_SET, title: "Unknown project", icon: <IconFolder size={13} /> };
      }
      const existing = keyed.get(g.id);
      if (existing) existing.entries.push(e);
      else keyed.set(g.id, { ...g, entries: [e] });
    }
    return [...keyed.values()]
      .map((g) => ({ ...g, entries: [...g.entries].sort(compare) }))
      .sort((a, b) => {
        if (a.id === NOT_SET || b.id === NOT_SET) return a.id === NOT_SET ? 1 : -1;
        return a.title.localeCompare(b.title);
      });
  }, [filtered, db.projects, compare, groupBy, companyById, propertyById, clientById, user]);

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
          value={visible.filter((e) => holds(e, user.id)).length}
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
              count: visible.filter((e) => holds(e, user.id)).length,
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
        <Select
          className="w-auto min-w-44"
          value={forMonth}
          onChange={(e) => setForMonth(e.target.value)}
          aria-label="Content for month"
        >
          <option value="">Any month</option>
          {monthsInUse.map((m) => (
            <option key={m} value={m}>
              For {formatMonth(m)}
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
        <div className="w-52">
          <SearchSelect
            allowClear
            options={peopleOptions.assignees}
            value={assigneeId}
            onChange={setAssigneeId}
            placeholder="Any assignee"
          />
        </div>
        <div className="w-52">
          <SearchSelect
            allowClear
            options={peopleOptions.writers}
            value={writerId}
            onChange={setWriterId}
            placeholder="Any writer"
          />
        </div>
        <Select
          className="w-auto min-w-40"
          value={stage}
          onChange={(e) => setStage(e.target.value as ContentStage | typeof NONE | "")}
          aria-label="Status"
        >
          <option value="">Any status</option>
          <option value={NONE}>Not set</option>
          {CONTENT_STAGES.map((st) => (
            <option key={st} value={st}>
              {st}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto min-w-40"
          value={placement}
          onChange={(e) => setPlacement(e.target.value as ContentPlacement | typeof NONE | "")}
          aria-label="Content placement"
        >
          <option value="">Any placement</option>
          {CONTENT_PLACEMENTS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          <option value={NONE}>Placement not set</option>
        </Select>
        <Select
          className="w-auto min-w-36"
          value={progress}
          onChange={(e) => setProgress(e.target.value as "" | "started" | "not-started")}
          aria-label="Started or not"
        >
          <option value="">Started or not</option>
          <option value="started">Started</option>
          <option value="not-started">Not started</option>
        </Select>
        <Select
          className="w-auto min-w-36"
          value={billing}
          onChange={(e) => setBilling(e.target.value as ContentBillingType | "")}
          aria-label="Billing type"
        >
          <option value="">Any billing</option>
          {CONTENT_BILLING_TYPES.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto min-w-40"
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as GroupKey)}
          aria-label="Group by"
        >
          {GROUPS.map((o) => (
            <option key={o.value} value={o.value}>
              Group by: {o.label}
            </option>
          ))}
        </Select>
        <Select
          className="w-auto min-w-40"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort by"
        >
          {SORTS.map((o) => (
            <option key={o.value} value={o.value}>
              Sort: {o.label}
            </option>
          ))}
        </Select>
        {filtering ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
        <span className="ml-auto text-[12px] text-ink-faint">
          {filtered.length} of {scoped.length} pieces
        </span>
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
                {g.color ? (
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: g.color }}
                  />
                ) : (
                  <span className="shrink-0 text-ink-muted">{g.icon}</span>
                )}
                {g.href ? (
                  <Link
                    href={g.href}
                    className="truncate text-[14px] font-semibold text-ink hover:text-brand-bright"
                  >
                    {g.title}
                  </Link>
                ) : (
                  <span
                    className={cx(
                      "truncate text-[14px] font-semibold",
                      g.id === "__unset__" ? "text-ink-faint" : "text-ink",
                    )}
                  >
                    {g.title}
                  </span>
                )}
                {g.subtitle ? (
                  <span className="truncate text-[11px] text-ink-faint">{g.subtitle}</span>
                ) : null}
                <span className="ml-auto shrink-0 text-[11px] text-ink-faint">
                  {g.entries.length} {g.entries.length === 1 ? "piece" : "pieces"}
                </span>
              </div>

              <div className="flex flex-col gap-3">
                {g.entries.map((e) => (
                  <ContentCard
                    key={e.id}
                    entry={e}
                    // Under a project heading the card's second line is better
                    // spent on who the piece is waiting on; otherwise it names
                    // the project.
                    showProject={groupBy !== "project"}
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

/** Whether a person holds a piece - either part of a Static to Motion one. */
function holds(e: ContentEntry, userId: string) {
  return contentHolders(e).includes(userId);
}
