"use client";

import { useState } from "react";
import { IconChevronDown, IconChevronRight } from "@/components/ui/icons";
import { Field, cx } from "@/components/ui/primitives";
import { RichText, RichTextEditor, isRichTextEmpty } from "@/components/ui/rich-text";
import type { ThreeDNotes } from "@/lib/types";

/** The three notes a group and a task both carry (0024). All are optional rich text. */
const NOTES: { key: keyof ThreeDNotes; label: string }[] = [
  { key: "clientSupeNotes", label: "Client Supe Notes" },
  { key: "leadNote", label: "3D Lead Note" },
  { key: "generalNotes", label: "General Notes" },
];

export function ThreeDNotesFields({
  value,
  onChange,
}: {
  value: ThreeDNotes;
  onChange: (patch: Partial<ThreeDNotes>) => void;
}) {
  return (
    <>
      {NOTES.map((n) => (
        <Field key={n.key} label={n.label}>
          <RichTextEditor
            value={value[n.key]}
            onChange={(v) => onChange({ [n.key]: v })}
            minHeight={72}
          />
        </Field>
      ))}
    </>
  );
}

/**
 * A group's or sub-group's description and its three notes, all four always
 * named so it is plain what has not been written yet, folding to one line. Opens
 * on whatever has something in it; closed when nothing does.
 */
export function ThreeDDetailsPanel({
  description,
  notes,
  className,
}: {
  description: string;
  notes: Partial<ThreeDNotes>;
  className?: string;
}) {
  const fields = [
    { key: "description", label: "Description", html: description },
    ...NOTES.map((n) => ({ key: n.key, label: n.label, html: notes[n.key] ?? "" })),
  ];
  const filled = fields.filter((f) => !isRichTextEmpty(f.html));
  const [open, setOpen] = useState(filled.length > 0);
  return (
    <div className={cx("rounded-md border border-line-soft bg-surface", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {open ? (
          <IconChevronDown size={13} className="shrink-0 text-ink-faint" />
        ) : (
          <IconChevronRight size={13} className="shrink-0 text-ink-faint" />
        )}
        <span className="text-[12px] font-medium text-ink">Details</span>
        <span className="truncate text-[11px] text-ink-faint">
          {filled.length ? filled.map((f) => f.label).join(" · ") : "Nothing added yet"}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-ink-faint">
          {open ? "Collapse" : "Expand"}
        </span>
      </button>
      {open ? (
        <dl className="grid gap-x-5 gap-y-3 border-t border-line-soft px-3 py-3 sm:grid-cols-2 xl:grid-cols-4">
          {fields.map((f) => (
            <div key={f.key} className="min-w-0">
              <dt className="text-[10px] font-medium tracking-wide text-ink-faint uppercase">
                {f.label}
              </dt>
              <dd className="mt-0.5 break-words">
                {isRichTextEmpty(f.html) ? (
                  <span className="text-[12px] text-ink-faint">Not added</span>
                ) : (
                  <RichText html={f.html} />
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/** Only the notes that have something in them; nothing at all if none do. */
export function ThreeDNotesView({ notes }: { notes: Partial<ThreeDNotes> }) {
  const filled = NOTES.filter((n) => !isRichTextEmpty(notes[n.key] ?? ""));
  if (!filled.length) return null;
  return (
    <dl className="flex flex-col gap-2">
      {filled.map((n) => (
        <div key={n.key}>
          <dt className="text-[10px] font-medium tracking-wide text-ink-faint uppercase">
            {n.label}
          </dt>
          <dd className="mt-0.5 break-words">
            <RichText html={notes[n.key] ?? ""} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
