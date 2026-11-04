"use client";

import { Field } from "@/components/ui/primitives";
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
