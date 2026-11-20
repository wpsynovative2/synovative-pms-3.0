"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/primitives";
import { formatDateTime, relativeTime } from "@/lib/calendar";
import {
  CHANGE_LOG_KEEP,
  CHANGE_NOUN,
  changeField,
  changeValue,
  type ChangeEntityType,
  type ChangeEntry,
} from "@/lib/change-log";
import { useStore } from "@/lib/store";

/*
 * The last five things done to a project, task or piece (0047): who, when, and
 * each field from what to what. Read from the database when shown, and again a
 * moment after the record changes here, once the save has gone through.
 */

interface Loaded {
  key: string;
  rows: ChangeEntry[];
  error?: string;
}

/** Long enough for a save just made here to reach the database first. */
const AFTER_SAVE_MS = 1200;

export function RecentChanges({
  type,
  id,
  version,
}: {
  type: ChangeEntityType;
  id: string;
  /** The record as the store has it; a new one means it changed, so read again. */
  version: unknown;
}) {
  const { db, userById, changeLogFor } = useStore();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [seen, setSeen] = useState<unknown>(version);
  const [reads, setReads] = useState(0);
  const key = `${type}|${id}|${reads}`;

  // A changed record is read again; render-time, not in an effect (React docs:
  // "storing information from previous renders").
  if (seen !== version) {
    setSeen(version);
    setReads((n) => n + 1);
  }

  useEffect(() => {
    let live = true;
    const timer = setTimeout(
      () =>
        changeLogFor(type, id).then(
          (rows) => {
            if (live) setLoaded({ key, rows });
          },
          (err: unknown) => {
            if (live)
              setLoaded({
                key,
                rows: [],
                error: err instanceof Error ? err.message : "Couldn't load the history.",
              });
          },
        ),
      reads === 0 ? 0 : AFTER_SAVE_MS,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, type, id, reads, changeLogFor]);

  // Keep showing the last list while a fresh read is on its way.
  if (!loaded || !loaded.key.startsWith(`${type}|${id}|`))
    return <p className="text-[12px] text-ink-faint">Loading…</p>;
  if (loaded.error) return <p className="text-[12px] text-st-rejected">{loaded.error}</p>;
  if (loaded.rows.length === 0)
    return (
      <p className="text-[12px] text-ink-faint">
        Nothing recorded yet. The last {CHANGE_LOG_KEEP} changes show here.
      </p>
    );

  return (
    <ol className="flex flex-col gap-2.5">
      {loaded.rows.map((entry) => {
        const who = entry.changedBy ? userById(entry.changedBy)?.fullName : null;
        const name = entry.changedBy ? (who ?? "Someone no longer here") : "System";
        const fields = Object.entries(entry.changes);
        return (
          <li key={entry.id} className="flex gap-2.5">
            <Avatar name={name} size={22} />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] text-ink">
                <span className="font-medium">{name}</span>{" "}
                <span className="text-ink-faint">
                  {entry.action === "created"
                    ? `created this ${CHANGE_NOUN[type]}`
                    : `changed ${fields.length} field${fields.length === 1 ? "" : "s"}`}
                </span>
                <span
                  className="text-ink-faint"
                  title={formatDateTime(entry.changedAt)}
                >
                  {" · "}
                  {relativeTime(entry.changedAt)}
                </span>
              </p>
              {fields.length ? (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {fields.map(([column, [from, to]]) => {
                    const field = changeField(type, column);
                    return (
                      <li key={column} className="text-[11px] leading-relaxed text-ink-muted">
                        <span className="text-ink">{field.label}</span>
                        {field.body ? (
                          " edited"
                        ) : (
                          <>
                            {": "}
                            <span className="line-through decoration-ink-faint/60">
                              {changeValue(type, column, from, db)}
                            </span>
                            {" → "}
                            <span className="text-ink">{changeValue(type, column, to, db)}</span>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
