"use client";

import { Field, Textarea } from "@/components/ui/primitives";
import type { ThreeDNotes } from "@/lib/types";

/** The three notes a group and a task both carry (0024). All are optional. */
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
          <Textarea
            rows={2}
            value={value[n.key]}
            onChange={(e) => onChange({ [n.key]: e.target.value })}
          />
        </Field>
      ))}
    </>
  );
}

/** Only the notes that have something in them; nothing at all if none do. */
export function ThreeDNotesView({ notes }: { notes: Partial<ThreeDNotes> }) {
  const filled = NOTES.filter((n) => notes[n.key]?.trim());
  if (!filled.length) return null;
  return (
    <dl className="flex flex-col gap-2">
      {filled.map((n) => (
        <div key={n.key}>
          <dt className="text-[10px] font-medium tracking-wide text-ink-faint uppercase">
            {n.label}
          </dt>
          <dd className="mt-0.5 text-[13px] break-words whitespace-pre-wrap text-ink">
            {notes[n.key]}
          </dd>
        </div>
      ))}
    </dl>
  );
}
