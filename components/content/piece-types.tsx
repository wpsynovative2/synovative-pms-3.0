"use client";

import { Select } from "@/components/ui/primitives";
import { CONTENT_TYPES, type ContentType } from "@/lib/types";

/*
 * The CB type of each piece a content task asks for (0015), shown wherever a
 * content task is raised: the task form, and the task rows of the project and
 * OBC forms. One dropdown per piece, plus one to set them all at once.
 */

/** What a piece is until someone says otherwise - as the database has it. */
export const DEFAULT_CONTENT_TYPE: ContentType = "Static Design";

/** `types` cut or padded to exactly `count` entries, ready to save. */
export function pieceTypes(count: number, types: ContentType[]): ContentType[] {
  const n = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  return Array.from({ length: n }, (_, i) => types[i] ?? DEFAULT_CONTENT_TYPE);
}

/** Drawn at most; the count itself is whatever was typed. */
const MAX_SHOWN = 200;

export function PieceTypesPicker({
  count,
  types,
  onChange,
}: {
  count: number;
  types: ContentType[];
  onChange: (next: ContentType[]) => void;
}) {
  const shown = pieceTypes(Math.min(count, MAX_SHOWN), types);
  if (shown.length === 0) return null;
  // Entries past what is drawn are kept as they are.
  const withRest = (head: ContentType[]) => [...head, ...types.slice(head.length)];

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2 p-3">
      {shown.length > 1 ? (
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[12px] text-ink-faint">Set all to</span>
          <Select
            aria-label="Set every piece to one type"
            value=""
            onChange={(e) => {
              const type = e.target.value as ContentType;
              if (type) onChange(pieceTypes(count, []).map(() => type));
            }}
          >
            <option value="">Choose…</option>
            {CONTENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <div className="grid max-h-64 gap-x-3 gap-y-2 overflow-y-auto sm:grid-cols-2">
        {shown.map((type, i) => (
          <label key={i} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-[12px] text-ink-faint">Count {i + 1}</span>
            <Select
              aria-label={`CB type of Count ${i + 1}`}
              value={type}
              onChange={(e) =>
                onChange(
                  withRest(shown.map((t, n) => (n === i ? (e.target.value as ContentType) : t))),
                )
              }
            >
              {CONTENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </label>
        ))}
      </div>
    </div>
  );
}
