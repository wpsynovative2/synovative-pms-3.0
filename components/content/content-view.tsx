"use client";

import Link from "next/link";
import { IconContent, IconExternal, IconLink } from "@/components/ui/icons";
import { Badge, Card, cx } from "@/components/ui/primitives";
import { RichText, isRichTextEmpty } from "@/components/ui/rich-text";
import { formatDate } from "@/lib/calendar";
import { useStore } from "@/lib/store";
import type { ContentEntry } from "@/lib/types";

/*
 * Reading a Content Bank entry. Everyone on the project sees the same thing —
 * the writer's own editing controls live in the Content Bank page, not here.
 */

/** Billing type is the one field that changes what the agency charges. */
const billingTone = (billing: ContentEntry["billingType"]) =>
  billing === "Extra"
    ? "border-st-submitted/30 bg-st-submitted/15 text-st-submitted"
    : "border-line bg-surface-2 text-ink-muted";

export function ContentDetail({ entry }: { entry: ContentEntry }) {
  const { userById, projectById } = useStore();
  const writer = userById(entry.createdBy);
  const allotted = userById(entry.allottedTo);
  const project = projectById(entry.projectId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge className="border-brand-bright/30 bg-brand/15 text-brand-ink">{entry.type}</Badge>
        <Badge className={billingTone(entry.billingType)}>{entry.billingType}</Badge>
        <Badge>{formatDate(entry.date)}</Badge>
        {project ? (
          <Link href={`/projects/${project.id}`}>
            <Badge className="border-line bg-surface-2 text-ink-muted hover:text-ink">
              {project.name}
            </Badge>
          </Link>
        ) : null}
      </div>

      {!isRichTextEmpty(entry.onPic) ? (
        <Section title="On pic">
          <RichText html={entry.onPic} />
        </Section>
      ) : null}

      {entry.caption ? (
        <Section title="Caption">
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink">
            {entry.caption}
          </p>
        </Section>
      ) : null}

      {!isRichTextEmpty(entry.description) ? (
        <Section title="Content">
          <RichText html={entry.description} />
        </Section>
      ) : null}

      {entry.referenceLinks.length ? (
        <Section title="Reference links">
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
        </Section>
      ) : null}

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line-soft pt-3 text-[11px] text-ink-faint">
        <span>Written by {writer?.fullName ?? "Unknown"}</span>
        {allotted ? <span>Allotted to {allotted.fullName}</span> : null}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-muted uppercase">
        {title}
      </h4>
      {children}
    </section>
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
