"use client";

import Link from "next/link";
import { AllotmentSelect } from "@/components/content/content-form";
import {
  IconContent,
  IconEdit,
  IconExternal,
  IconLink,
  IconTasks,
} from "@/components/ui/icons";
import { FullScreen } from "@/components/ui/modal";
import { Badge, Button, Card, Select, cx } from "@/components/ui/primitives";
import { RichText, isRichTextEmpty } from "@/components/ui/rich-text";
import { formatDate } from "@/lib/calendar";
import { CONTENT_STAGE_STYLE, TASK_STATUS_STYLE } from "@/lib/master-data";
import {
  canAllotContent,
  canEditContentEntry,
  canSetContentStage,
} from "@/lib/permissions";
import { useStore } from "@/lib/store";
import { CONTENT_STAGES, type ContentEntry, type ContentStage } from "@/lib/types";

/*
 * Reading a Content Bank entry. Everyone on the project sees the same thing —
 * the writer's own editing controls live in the Content Bank page, not here.
 */

/** Billing type is the one field that changes what the agency charges. */
const billingTone = (billing: ContentEntry["billingType"]) =>
  billing === "Extra"
    ? "border-st-submitted/30 bg-st-submitted/15 text-st-submitted"
    : "border-line bg-surface-2 text-ink-muted";

/**
 * A piece read in full, taking the whole window. The facts sit in one strip
 * across the top — including the two things people other than the writer may
 * change here, who has it and where it has got to — and the words follow.
 */
export function ContentDetailScreen({
  entry,
  onClose,
  onEdit,
  showTaskLink = true,
}: {
  entry: ContentEntry;
  onClose: () => void;
  /** Offered where the writer's editing lives (the Content Bank). */
  onEdit?: () => void;
  /** Off when the screen is opened from the task itself. */
  showTaskLink?: boolean;
}) {
  const { currentUser, projectById, taskById } = useStore();
  const project = projectById(entry.projectId);
  const task = entry.taskId ? taskById(entry.taskId) : undefined;
  const mayEdit = !!onEdit && canEditContentEntry(currentUser!, entry);

  return (
    <FullScreen
      open
      onClose={onClose}
      title={entry.caption.trim() || entry.type}
      subtitle={project ? `${project.name} · Content Bank entry` : "Content Bank entry"}
      toolbar={
        mayEdit ? (
          <Button size="sm" onClick={onEdit}>
            <IconEdit size={13} /> Edit
          </Button>
        ) : null
      }
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6">
        <ContentDetail entry={entry} />
        {showTaskLink && task ? (
          <Link
            href={
              entry.projectId
                ? `/projects/${entry.projectId}?task=${task.id}`
                : `/tasks?task=${task.id}`
            }
            className="flex items-center gap-2 self-start rounded-card border border-line-soft bg-surface-2 px-3 py-2 text-[12px] text-ink hover:border-brand-bright/40"
          >
            <IconTasks size={14} /> Open the task this was written for
          </Link>
        ) : null}
      </div>
    </FullScreen>
  );
}

export function ContentDetail({ entry }: { entry: ContentEntry }) {
  const { db, currentUser, userById, projectById, taskById, allotContent, setContentStage } =
    useStore();
  const user = currentUser!;
  const writer = userById(entry.createdBy);
  const allotted = userById(entry.allottedTo);
  const project = projectById(entry.projectId) ?? null;
  const task = (entry.taskId ? taskById(entry.taskId) : undefined) ?? null;

  const mayAllot = canAllotContent(user, entry, task, project);
  const mayStage = canSetContentStage(user, entry, task, project, db.tasks);

  return (
    <div className="flex flex-col gap-5">
      <Card className="grid gap-x-5 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <Fact label="Date">
          <span className="text-[13px] text-ink">{formatDate(entry.date)}</span>
        </Fact>
        <Fact label="CB type">
          <Badge className="border-brand-bright/30 bg-brand/15 text-brand-ink">{entry.type}</Badge>
        </Fact>
        <Fact label="Billing type">
          <Badge className={billingTone(entry.billingType)}>{entry.billingType}</Badge>
        </Fact>
        <Fact label="Allotment to">
          {mayAllot ? (
            <AllotmentSelect
              projectId={entry.projectId}
              value={entry.allottedTo}
              onChange={(next) => allotContent(entry.id, next)}
            />
          ) : (
            <span className="text-[13px] text-ink">{allotted?.fullName ?? "Nobody yet"}</span>
          )}
        </Fact>
        <Fact label="Status">
          {mayStage ? (
            <Select
              aria-label="Status"
              value={entry.stage ?? ""}
              onChange={(e) =>
                setContentStage(entry.id, (e.target.value || null) as ContentStage | null)
              }
            >
              <option value="">Not set</option>
              {CONTENT_STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          ) : entry.stage ? (
            <Badge className={CONTENT_STAGE_STYLE[entry.stage]}>{entry.stage}</Badge>
          ) : (
            <span className="text-[13px] text-ink-faint">Not set</span>
          )}
        </Fact>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="On pic">
          {isRichTextEmpty(entry.onPic) ? <Empty /> : <RichText html={entry.onPic} />}
        </Section>
        <Section title="Caption">
          {entry.caption.trim() ? (
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink">
              {entry.caption}
            </p>
          ) : (
            <Empty />
          )}
        </Section>
      </div>

      <Section title="Content description">
        {isRichTextEmpty(entry.description) ? <Empty /> : <RichText html={entry.description} />}
      </Section>

      <Section title="Reference links">
        {entry.referenceLinks.length ? (
          <ul className="flex flex-col gap-1.5">
            {entry.referenceLinks.map((link, i) => (
              <li key={i}>
                <a
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-[12px] break-all text-brand-bright hover:border-brand-bright/40"
                >
                  <IconLink size={13} className="shrink-0" />
                  <span className="min-w-0 flex-1">{link}</span>
                  <IconExternal size={12} className="shrink-0 text-ink-faint" />
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <Empty />
        )}
      </Section>

      {entry.reviews.length ? (
        <Section title="Decisions">
          <ul className="flex flex-col gap-1.5">
            {[...entry.reviews].reverse().map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-[12px]"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <Badge className={TASK_STATUS_STYLE[r.decision].chip}>{r.decision}</Badge>
                  <span className="text-[11px] text-ink-faint">
                    {userById(r.byUserId)?.fullName ?? "Unknown"} · {formatDate(r.at)}
                  </span>
                </span>
                {r.remarks.trim() ? (
                  <p className="mt-1 leading-relaxed text-ink-muted">{r.remarks}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-soft pt-3 text-[11px] text-ink-faint">
        <span>Written by {writer?.fullName ?? "Unknown"}</span>
        {/* Only a piece written for a task is answerable to anyone. */}
        {entry.taskId ? (
          <span className="flex items-center gap-1.5">
            Review
            <Badge className={TASK_STATUS_STYLE[entry.status].chip}>{entry.status}</Badge>
          </span>
        ) : null}
        {project ? (
          <Link href={`/projects/${project.id}`} className="hover:text-ink">
            {project.name}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] font-medium tracking-wide text-ink-muted uppercase">
        {label}
      </span>
      <div className="flex min-h-9.5 items-center">
        <div className="w-full min-w-0">{children}</div>
      </div>
    </div>
  );
}

function Empty() {
  return <p className="text-[12px] text-ink-faint italic">Nothing written here.</p>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <h4 className="mb-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
        {title}
      </h4>
      {children}
    </Card>
  );
}

/**
 * The hyperlink other team members see on a task: enough to know what the
 * piece is, and a way into the Content Bank to read it.
 */
export function ContentLinkRow({
  entry,
  onOpen,
  className,
}: {
  entry: ContentEntry;
  /** Opens it in place; without this the row links to the Content Bank. */
  onOpen?: (id: string) => void;
  className?: string;
}) {
  const { userById } = useStore();
  const allotted = userById(entry.allottedTo);
  const label = entry.caption.trim() || entry.type;

  const inner = (
    <>
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand-ink">
        <IconContent size={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{label}</span>
        <span className="block truncate text-[11px] text-ink-faint">
          {entry.type} · {formatDate(entry.date)}
          {allotted ? ` · for ${allotted.fullName}` : ""}
        </span>
      </span>
      <IconExternal size={13} className="shrink-0 text-ink-faint" />
    </>
  );

  const shell = cx(
    "flex w-full items-center gap-2.5 rounded-card border border-line-soft bg-surface-2 px-3 py-2 text-left transition-colors hover:border-brand-bright/40",
    className,
  );

  if (onOpen) {
    return (
      <button className={shell} onClick={() => onOpen(entry.id)}>
        {inner}
      </button>
    );
  }
  return (
    <Link className={shell} href={`/content-bank?entry=${entry.id}`}>
      {inner}
    </Link>
  );
}

/** A compact card for the Content Bank's own list. */
export function ContentCard({
  entry,
  onOpen,
  actions,
  showProject = true,
}: {
  entry: ContentEntry;
  onOpen: () => void;
  actions?: React.ReactNode;
  /** Off where the list is already filed under the project (the Content Bank). */
  showProject?: boolean;
}) {
  const { userById, projectById } = useStore();
  const writer = userById(entry.createdBy);
  const project = projectById(entry.projectId);
  const allotted = userById(entry.allottedTo);

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start gap-2.5">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand/15 text-brand-ink">
          <IconContent size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <button
            onClick={onOpen}
            className="block max-w-full truncate text-left text-[14px] font-semibold text-ink hover:text-brand-bright"
          >
            {entry.caption.trim() || entry.type}
          </button>
          <p className="truncate text-[11px] text-ink-faint">
            {showProject
              ? (project?.name ?? "Unknown project")
              : allotted
                ? `Allotted to ${allotted.fullName}`
                : "Not allotted yet"}
          </p>
        </div>
        <Badge className={billingTone(entry.billingType)}>{entry.billingType}</Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge className="border-brand-bright/30 bg-brand/15 text-brand-ink">{entry.type}</Badge>
        {entry.taskId ? (
          <Badge className={TASK_STATUS_STYLE[entry.status].chip}>{entry.status}</Badge>
        ) : null}
        {entry.stage ? (
          <Badge className={CONTENT_STAGE_STYLE[entry.stage]}>{entry.stage}</Badge>
        ) : null}
        <Badge>{formatDate(entry.date)}</Badge>
        {entry.referenceLinks.length ? (
          <Badge>{entry.referenceLinks.length} refs</Badge>
        ) : null}
      </div>

      <div className="mt-auto flex items-center gap-2 border-t border-line-soft pt-3">
        <span className="min-w-0 truncate text-[11px] text-ink-faint">
          {writer?.fullName ?? "Unknown"}
        </span>
        {actions ? <div className="ml-auto flex gap-1">{actions}</div> : null}
      </div>
    </Card>
  );
}
