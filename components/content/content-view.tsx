"use client";

import Link from "next/link";
import { useState } from "react";
import { AllotDialog } from "@/components/content/allot-dialog";
import { ContentJourney } from "@/components/content/content-journey";
import {
  IconChevronDown,
  IconContent,
  IconEdit,
  IconExternal,
  IconLink,
  IconTasks,
} from "@/components/ui/icons";
import {
  StageBadge,
  StagePicker,
  type StageValue,
} from "@/components/content/stage-picker";
import { DatePicker } from "@/components/ui/date-picker";
import { FullScreen } from "@/components/ui/modal";
import { Avatar, Badge, Button, Card, cx } from "@/components/ui/primitives";
import { RichText, isRichTextEmpty } from "@/components/ui/rich-text";
import { daysBetween, formatDate, formatMonth, todayISO } from "@/lib/calendar";
import {
  canAllotContent,
  canEditContentEntry,
  canSetContentStage,
  canSetContentDelivery,
} from "@/lib/permissions";
import { useStore } from "@/lib/store";
import {
  contentHolders,
  contentLabel,
  isContentStarted,
  isStmType,
  type ContentEntry,
} from "@/lib/types";

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
 * Who has a piece, in words: "Annu Sharma", or for a Static to Motion piece
 * "Static: Annu Sharma · Reel: Vipul Chalke". Null when nobody has it.
 */
export function allotmentText(
  entry: ContentEntry,
  name: (id: string | null) => string | undefined,
): string | null {
  if (!isStmType(entry.type)) return name(entry.allottedTo) ?? null;
  if (!entry.allottedTo && !entry.motionAllottedTo) return null;
  return `Static: ${name(entry.allottedTo) ?? "—"} · Reel: ${name(entry.motionAllottedTo) ?? "—"}`;
}

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
      title={contentLabel(entry)}
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
  const { db, currentUser, userById, projectById, taskById, setContentDeliveryDate } = useStore();
  const user = currentUser!;
  const writer = userById(entry.createdBy);
  const allotted = userById(entry.allottedTo);
  const project = projectById(entry.projectId) ?? null;
  const allottedTask = entry.allottedTaskId ? taskById(entry.allottedTaskId) : undefined;
  const [allotting, setAllotting] = useState(false);

  const mayAllot = canAllotContent(user, project);
  const reel = userById(entry.motionAllottedTo);
  const reelTask = entry.motionAllottedTaskId ? taskById(entry.motionAllottedTaskId) : undefined;
  const allotmentLabel = isStmType(entry.type) ? (
    // Static to Motion: both parts, static first.
    <span className="block min-w-0">
      <span className={cx("block truncate text-[13px]", allotted ? "text-ink" : "text-ink-faint")}>
        Static: {allotted?.fullName ?? "nobody yet"}
      </span>
      <span className={cx("block truncate text-[13px]", reel ? "text-ink" : "text-ink-faint")}>
        Reel: {reel?.fullName ?? "nobody yet"}
      </span>
      {reelTask ? (
        <span className="block truncate text-[11px] text-ink-faint">
          reel from {formatDate(reelTask.startDate)}
        </span>
      ) : null}
    </span>
  ) : (
    <span className="block min-w-0">
      <span className={cx("block truncate text-[13px]", allotted ? "text-ink" : "text-ink-faint")}>
        {allotted?.fullName ?? "Nobody yet"}
      </span>
      {allottedTask ? (
        <span className="block truncate text-[11px] text-ink-faint">
          on {allottedTask.title}
        </span>
      ) : null}
    </span>
  );

  return (
    <div className="flex flex-col gap-5">
      <Card className="grid gap-x-5 gap-y-4 p-4 sm:grid-cols-3 lg:grid-cols-7">
        <Fact label="Delivery date">
          {canSetContentDelivery(user, entry, project) ? (
            <DatePicker
              value={entry.deliveryDate ?? ""}
              onChange={(v) => setContentDeliveryDate(entry.id, v || null)}
              config={db.calendar}
              ignoreWorkingRules
              allowPast
              clearable
              placeholder="Set a date"
            />
          ) : (
            <span className={cx("text-[13px]", entry.deliveryDate ? "text-ink" : "text-ink-faint")}>
              {entry.deliveryDate ? formatDate(entry.deliveryDate) : "Not set"}
            </span>
          )}
        </Fact>
        <Fact label="CB type">
          <Badge className="border-brand-bright/30 bg-brand/15 text-brand-ink">{entry.type}</Badge>
        </Fact>
        <Fact label="Billing type">
          <Badge className={billingTone(entry.billingType)}>{entry.billingType}</Badge>
        </Fact>
        <Fact label="Allotment to">
          {mayAllot ? (
            <button
              type="button"
              onClick={() => setAllotting(true)}
              className="flex min-h-9.5 w-full items-center gap-2 rounded-[10px] border border-line bg-surface-2 px-3 py-1 text-left hover:border-brand-bright/40"
            >
              <span className="min-w-0 flex-1">{allotmentLabel}</span>
              <IconChevronDown size={14} className="shrink-0 text-ink-faint" />
            </button>
          ) : (
            allotmentLabel
          )}
        </Fact>
        <Fact label="Placement">
          <span className={cx("text-[13px]", entry.placement ? "text-ink" : "text-ink-faint")}>
            {entry.placement ?? "Not set"}
          </span>
        </Fact>
        <Fact label="Content for">
          <span className="text-[13px] text-ink">{formatMonth(entry.forMonth)}</span>
        </Fact>
        <Fact label="Status">
          <ContentStageControl entry={entry} />
        </Fact>
      </Card>

      <Card className="p-4">
        <ContentJourney entry={entry} />
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

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-soft pt-3 text-[11px] text-ink-faint">
        <span>Written by {writer?.fullName ?? "Unknown"}</span>
        {project ? (
          <Link href={`/projects/${project.id}`} className="hover:text-ink">
            {project.name}
          </Link>
        ) : null}
        {allottedTask ? (
          <Link
            href={`/projects/${allottedTask.projectId}?task=${allottedTask.id}`}
            className="hover:text-ink"
          >
            Allotted on: {allottedTask.title}
          </Link>
        ) : null}
      </div>

      {allotting && project ? (
        <AllotDialog entry={entry} project={project} onClose={() => setAllotting(false)} />
      ) : null}
    </div>
  );
}

/**
 * A piece's status - its stage. The writer sets it, as do the others
 * set_content_stage() allows (the allottee, the reviewers, the author desks);
 * everyone else reads it.
 */
export function ContentStageControl({ entry }: { entry: ContentEntry }) {
  const { db, currentUser, projectById, taskById, setContentStage } = useStore();
  const project = projectById(entry.projectId) ?? null;
  const task = (entry.taskId ? taskById(entry.taskId) : undefined) ?? null;
  const value = stageValueOf(entry);
  // No status before the writer has started (0027).
  const started = isContentStarted(entry);

  if (canSetContentStage(currentUser!, entry, task, project, db.tasks)) {
    return (
      <span title={started ? undefined : "Locked until the writer presses Start Writing"}>
        <StagePicker
          value={value}
          forMonth={entry.forMonth}
          disabled={!started}
          onChange={(next) => setContentStage(entry.id, next.stage, next.date)}
        />
      </span>
    );
  }
  return <StageBadge value={value} />;
}

/** A piece's stage and the date that goes with it, as the picker reads them. */
export const stageValueOf = (entry: ContentEntry): StageValue => ({
  stage: entry.stage,
  date: entry.stage === "Scheduled" ? entry.scheduledOn : entry.stage === "Carry Forwarded" ? entry.carryMonth : null,
});

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
  part,
  note,
}: {
  entry: ContentEntry;
  /** Opens it in place; without this the row links to the Content Bank. */
  onOpen?: (id: string) => void;
  className?: string;
  /** On a Static to Motion piece: which part this task does. */
  part?: string;
  /** A line under it, e.g. that the reel is waiting for the static. */
  note?: React.ReactNode;
}) {
  const { userById } = useStore();
  const held = allotmentText(entry, (id) => userById(id)?.fullName);
  const label = contentLabel(entry);

  const inner = (
    <>
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand-ink">
        <IconContent size={14} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{label}</span>
        <span className="block truncate text-[11px] text-ink-faint">
          {part ? `${part} · ` : ""}
          {entry.type} · {formatDate(entry.date)}
          {held ? ` · for ${held}` : ""}
        </span>
        {note ? <span className="mt-0.5 block text-[11px]">{note}</span> : null}
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

/**
 * One piece as a row of the Content Bank's list: what it is on the left, and
 * its journey from created to completed across the rest of the row.
 */
/*
 * The Content Bank list is a table, like the task list: one grid template
 * shared by the header and every row, so each column lines up down the page.
 * Columns drop away as the space narrows; the journey sits under each row.
 */
const CONTENT_GRID = cx(
  "grid items-center gap-x-4",
  "grid-cols-[minmax(0,1fr)_auto]",
  "@3xl:grid-cols-[minmax(0,1fr)_9.5rem_10.5rem_12rem_4.5rem]",
  "@5xl:grid-cols-[minmax(0,1fr)_9.5rem_6rem_10.5rem_12rem_9rem_4.5rem]",
);

/** Column headings for a Content Bank table; pairs with ContentCard. */
export function ContentTableHeader() {
  return (
    <div className="@container">
      <div
        className={cx(
          CONTENT_GRID,
          "hidden border-b border-line bg-surface-2 px-4 py-2 text-[10px] font-medium tracking-wide text-ink-faint uppercase @3xl:grid",
        )}
      >
        <span className="pl-5">Piece</span>
        <span>Delivery</span>
        <span className="hidden @5xl:block">Placement</span>
        <span>Status</span>
        <span>Allotted to</span>
        <span className="hidden @5xl:block">Written by</span>
        <span />
      </div>
    </div>
  );
}

/** The dot before a piece: its status at a glance. */
const STAGE_DOT: Record<string, string> = {
  none: "bg-ink-faint/50",
  "Ready To Design": "bg-st-inprogress",
  "Design Completed": "bg-st-approved",
  Scheduled: "bg-st-waiting",
  Cancelled: "bg-st-rejected",
  "Carry Forwarded": "bg-st-changes",
};

/** One piece as a table row, with its journey underneath. */
export function ContentCard({
  entry,
  onOpen,
  actions,
  showProject = true,
}: {
  entry: ContentEntry;
  onOpen: () => void;
  actions?: React.ReactNode;
  /** Off where the list is already filed under the project. */
  showProject?: boolean;
}) {
  const { db, currentUser, userById, projectById, setContentDeliveryDate } = useStore();
  const user = currentUser!;
  const writer = userById(entry.createdBy);
  const project = projectById(entry.projectId) ?? null;
  const holders = contentHolders(entry)
    .map((id) => userById(id))
    .filter((u): u is NonNullable<typeof u> => !!u);
  const stmPiece = holders.length > 1;
  const mayDeliver = canSetContentDelivery(user, entry, project);
  const mayAllot = !!project && canAllotContent(user, project);
  const [allotting, setAllotting] = useState(false);

  const holderList = (
    <span className="flex min-w-0 flex-col gap-1">
      {holders.length ? (
        holders.map((h, i) => (
          <span key={h.id} className="flex min-w-0 items-center gap-2 text-[12px] text-ink">
            <Avatar name={h.fullName} size={22} className="shrink-0" />
            <span className="truncate">
              {stmPiece ? (i === 0 ? "Static: " : "Reel: ") : ""}
              {h.fullName}
            </span>
          </span>
        ))
      ) : (
        <span className="text-[12px] text-ink-faint italic">Not allotted</span>
      )}
    </span>
  );

  return (
    <div className="@container border-b border-line-soft last:border-0">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter") onOpen();
        }}
        className="group cursor-pointer px-4 pt-3 pb-3.5 transition-colors hover:bg-surface-2/60"
      >
        <div className={CONTENT_GRID}>
          {/* Piece: status dot, name, then what it is. */}
          <div className="flex min-w-0 items-start gap-2.5">
            <span
              className={cx(
                "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
                STAGE_DOT[entry.stage ?? "none"],
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[13px] font-medium text-ink group-hover:text-ink-strong">
                  {contentLabel(entry)}
                </span>
                <Badge className={cx("shrink-0", billingTone(entry.billingType))}>
                  {entry.billingType}
                </Badge>
              </div>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-faint">
                <span className="text-brand-ink">{entry.type}</span>
                <span aria-hidden>·</span>
                <span>For {formatMonth(entry.forMonth)}</span>
                {showProject && project ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className="truncate">{project.name}</span>
                  </>
                ) : null}
                {entry.referenceLinks.length ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>{entry.referenceLinks.length} refs</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          {/*
            Delivery, Status and Allotted to are changed right here, by the
            same people (and through the same calls) as on the piece's page.
            Clicks inside them must not open the piece.
          */}
          <span className="hidden min-w-0 @3xl:block" {...KEEP_IN_CELL}>
            {mayDeliver ? (
              <span className="flex flex-col gap-0.5">
                <DatePicker
                  value={entry.deliveryDate ?? ""}
                  onChange={(v) => setContentDeliveryDate(entry.id, v || null)}
                  config={db.calendar}
                  ignoreWorkingRules
                  allowPast
                  clearable
                  placeholder="Set date"
                />
                {entry.deliveryDate ? <DeliveryDue entry={entry} /> : null}
              </span>
            ) : (
              <DeliveryCell entry={entry} />
            )}
          </span>

          <span
            className={cx(
              "hidden text-[12px] @5xl:block",
              entry.placement ? "text-ink" : "text-ink-faint",
            )}
          >
            {entry.placement ?? "Not set"}
          </span>

          <span className="min-w-0" {...KEEP_IN_CELL}>
            <ContentStageControl entry={entry} />
          </span>

          <span className="hidden min-w-0 @3xl:block" {...KEEP_IN_CELL}>
            {mayAllot ? (
              <button
                type="button"
                onClick={() => setAllotting(true)}
                title="Change who has it"
                className="flex min-h-9.5 w-full items-center gap-2 rounded-[10px] border border-line bg-surface-2 px-2.5 py-1 text-left hover:border-brand-bright/40"
              >
                <span className="min-w-0 flex-1">{holderList}</span>
                <IconChevronDown size={14} className="shrink-0 text-ink-faint" />
              </button>
            ) : (
              holderList
            )}
            {allotting && project ? (
              <AllotDialog entry={entry} project={project} onClose={() => setAllotting(false)} />
            ) : null}
          </span>

          <span className="hidden min-w-0 truncate text-[12px] text-ink-muted @5xl:block">
            {writer?.fullName ?? "Unknown"}
          </span>

          <span
            className="hidden justify-end gap-1 @3xl:flex"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {actions}
          </span>
        </div>

        {/* The pipeline, under the row it belongs to. */}
        <ContentJourney entry={entry} className="mt-3 border-t border-dashed border-line-soft pt-3" />
      </div>
    </div>
  );
}

/**
 * Spread on a row's editable cells: a click or Enter inside one - including
 * inside the dialogs and pop-overs it opens, which React bubbles through the
 * portal - stays there instead of opening the piece.
 */
const KEEP_IN_CELL = {
  onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation(),
};

const deliveryIsDone = (entry: ContentEntry) =>
  entry.stage === "Design Completed" || entry.stage === "Scheduled";

/** The delivery date, and underneath it how far off it is. */
function DeliveryCell({ entry }: { entry: ContentEntry }) {
  if (!entry.deliveryDate) {
    return <span className="text-[12px] text-ink-faint">Not set</span>;
  }
  const late = !deliveryIsDone(entry) && daysBetween(todayISO(), entry.deliveryDate) < 0;
  return (
    <span className="flex flex-col leading-tight">
      <span className={cx("text-[12px]", late ? "font-medium text-st-rejected" : "text-ink")}>
        {formatDate(entry.deliveryDate)}
      </span>
      <DeliveryDue entry={entry} />
    </span>
  );
}

/** "in 3 days", "Due today", "2 days late" or "Done". */
function DeliveryDue({ entry }: { entry: ContentEntry }) {
  if (!entry.deliveryDate) return null;
  const done = deliveryIsDone(entry);
  const days = daysBetween(todayISO(), entry.deliveryDate);
  return (
    <span
      className={cx(
        "text-[10px]",
        done ? "text-ink-faint" : days < 0 ? "text-st-rejected" : days === 0 ? "text-st-submitted" : "text-ink-faint",
      )}
    >
      {done
        ? "Done"
        : days < 0
          ? `${-days} day${days === -1 ? "" : "s"} late`
          : days === 0
            ? "Due today"
            : `in ${days} day${days === 1 ? "" : "s"}`}
    </span>
  );
}
