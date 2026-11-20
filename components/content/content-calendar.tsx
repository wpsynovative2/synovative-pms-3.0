"use client";

import { useMemo, useRef, useState } from "react";
import { STAGE_DOT } from "@/components/content/content-view";
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconPlus,
} from "@/components/ui/icons";
import { FullScreen } from "@/components/ui/modal";
import { Popover } from "@/components/ui/popover";
import { SearchInput, cx } from "@/components/ui/primitives";
import {
  formatDate,
  formatMonth,
  fromISODate,
  monthGrid,
  todayISO,
} from "@/lib/calendar";
import { canSetContentDelivery } from "@/lib/permissions";
import { useStore } from "@/lib/store";
import { contentLabel, type ContentEntry, type Project } from "@/lib/types";

/*
 * A project's pieces laid out on the month they are for. A piece sits on its
 * delivery date, so putting one on a day is the same call - and the same
 * permission - as setting the date from its row in the Content Bank.
 */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function ContentCalendar({
  project,
  entries,
  onOpen,
  onClose,
}: {
  project: Project;
  /** Every piece of the project the viewer can see, whatever the filters say. */
  entries: ContentEntry[];
  onOpen: (entryId: string) => void;
  onClose: () => void;
}) {
  const { db } = useStore();

  // Only the months some piece is for, oldest first so the arrows read left to right.
  const months = useMemo(
    () => Array.from(new Set(entries.map((e) => e.forMonth))).sort(),
    [entries],
  );

  // This month when the project has pieces for it, otherwise the latest.
  const [picked, setPicked] = useState<string | null>(null);
  const thisMonth = `${todayISO().slice(0, 7)}-01`;
  const month =
    picked && months.includes(picked)
      ? picked
      : months.includes(thisMonth)
        ? thisMonth
        : (months[months.length - 1] ?? thisMonth);
  const at = months.indexOf(month);

  const pieces = useMemo(
    () =>
      entries
        .filter((e) => e.forMonth === month)
        .sort((a, b) => contentLabel(a).localeCompare(contentLabel(b), undefined, { numeric: true })),
    [entries, month],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, ContentEntry[]>();
    for (const e of pieces) {
      if (!e.deliveryDate) continue;
      map.set(e.deliveryDate, [...(map.get(e.deliveryDate) ?? []), e]);
    }
    return map;
  }, [pieces]);

  const unplaced = pieces.filter((e) => !e.deliveryDate);
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1;
  const cells = useMemo(() => monthGrid(year, monthIndex), [year, monthIndex]);
  const holidays = useMemo(
    () => new Map(db.calendar.holidays.map((h) => [h.date, h.name])),
    [db.calendar.holidays],
  );
  const today = todayISO();

  return (
    <FullScreen
      open
      onClose={onClose}
      title={`${project.name} — content calendar`}
      subtitle={`${pieces.length - unplaced.length} of ${pieces.length} pieces for ${formatMonth(month)} are on a day`}
      toolbar={
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPicked(months[at - 1])}
            disabled={at <= 0}
            aria-label="Previous month"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent"
          >
            <IconChevronLeft size={16} />
          </button>
          <select
            value={month}
            onChange={(e) => setPicked(e.target.value)}
            aria-label="Content for month"
            className="h-8 cursor-pointer rounded-lg border border-line bg-surface-2 px-2 text-[13px] font-medium text-ink focus:border-brand-bright focus:outline-none"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setPicked(months[at + 1])}
            disabled={at === -1 || at >= months.length - 1}
            aria-label="Next month"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 hover:text-ink disabled:opacity-35 disabled:hover:bg-transparent"
          >
            <IconChevronRight size={16} />
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        {unplaced.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
              Not on a day yet
            </span>
            {unplaced.map((e) => (
              <PieceChip key={e.id} entry={e} onOpen={() => onOpen(e.id)} />
            ))}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <div className="grid min-w-[760px] grid-cols-7 overflow-hidden rounded-xl border border-line">
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                className="border-b border-line bg-surface-2 px-2 py-1.5 text-[11px] font-medium text-ink-faint"
              >
                {w}
              </div>
            ))}
            {cells.map((iso) => (
              <DayCell
                key={iso}
                iso={iso}
                inMonth={fromISODate(iso).getMonth() === monthIndex}
                isToday={iso === today}
                holiday={holidays.get(iso)}
                placed={byDay.get(iso) ?? []}
                pieces={pieces}
                project={project}
                onOpen={onOpen}
              />
            ))}
          </div>
        </div>
      </div>
    </FullScreen>
  );
}

function DayCell({
  iso,
  inMonth,
  isToday,
  holiday,
  placed,
  pieces,
  project,
  onOpen,
}: {
  iso: string;
  inMonth: boolean;
  isToday: boolean;
  holiday?: string;
  placed: ContentEntry[];
  /** The month's pieces, to pick from. */
  pieces: ContentEntry[];
  project: Project;
  onOpen: (entryId: string) => void;
}) {
  const { currentUser, setContentDeliveryDate } = useStore();
  const user = currentUser!;
  const addRef = useRef<HTMLButtonElement>(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");

  const date = fromISODate(iso);
  const sunday = date.getDay() === 0;
  const mayPlaceAny = pieces.some((e) => canSetContentDelivery(user, e, project));
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const options = pieces.filter((e) => {
    const text = `${contentLabel(e)} ${e.type}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });

  return (
    <div
      className={cx(
        "group/day flex min-h-32 flex-col gap-1 border-b border-l border-line-soft p-1.5 [&:nth-child(7n+1)]:border-l-0",
        sunday || holiday ? "bg-surface-2/60" : "bg-surface",
        !inMonth && "opacity-45",
      )}
    >
      <div className="flex items-center gap-1">
        <span
          className={cx(
            "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[12px]",
            isToday ? "bg-brand font-semibold text-on-brand" : "text-ink-muted",
          )}
        >
          {date.getDate()}
        </span>
        {holiday ? (
          <span className="truncate text-[10px] text-st-rejected" title={holiday}>
            {holiday}
          </span>
        ) : null}
        {mayPlaceAny ? (
          <button
            ref={addRef}
            type="button"
            onClick={() => {
              setQuery("");
              setPicking((p) => !p);
            }}
            aria-label={`Put a piece on ${formatDate(iso)}`}
            title={`Put a piece on ${formatDate(iso)}`}
            className={cx(
              "ml-auto inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-opacity hover:bg-surface-3 hover:text-ink",
              picking ? "opacity-100" : "opacity-0 group-hover/day:opacity-100 focus-visible:opacity-100",
            )}
          >
            <IconPlus size={14} />
          </button>
        ) : null}
      </div>

      {placed.map((e) => (
        <PieceChip
          key={e.id}
          entry={e}
          onOpen={() => onOpen(e.id)}
          onRemove={
            canSetContentDelivery(user, e, project)
              ? () => setContentDeliveryDate(e.id, null)
              : undefined
          }
          block
        />
      ))}

      <Popover
        anchorRef={addRef}
        open={picking}
        onClose={() => setPicking(false)}
        className="w-80 rounded-xl p-2"
        maxHeight={380}
      >
        <div className="px-1.5 pt-1 pb-2 text-[12px] font-medium text-ink">
          Pieces for {formatDate(iso)}
        </div>
        {pieces.length > 6 ? (
          <SearchInput
            className="mb-2"
            placeholder="Find a piece…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        ) : null}
        <div className="flex flex-col">
          {options.map((e) => {
            const here = e.deliveryDate === iso;
            const allowed = canSetContentDelivery(user, e, project);
            return (
              <button
                key={e.id}
                type="button"
                disabled={!allowed}
                title={allowed ? undefined : "Only its writer and the people planning the work can move it"}
                // Picking a piece already on this day takes it off again.
                onClick={() => setContentDeliveryDate(e.id, here ? null : iso)}
                className={cx(
                  "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors",
                  allowed ? "hover:bg-surface-3" : "cursor-not-allowed opacity-50",
                  here && "bg-brand/10",
                )}
              >
                <span
                  className={cx(
                    "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    here ? "border-brand bg-brand text-on-brand" : "border-line",
                  )}
                >
                  {here ? <IconCheck size={11} /> : null}
                </span>
                <span className={cx("h-2 w-2 shrink-0 rounded-full", STAGE_DOT[e.stage ?? "none"])} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink">{contentLabel(e)}</span>
                  <span className="block truncate text-[10px] text-ink-faint">
                    {e.type}
                    {e.deliveryDate && !here ? ` · now on ${formatDate(e.deliveryDate)}` : ""}
                  </span>
                </span>
              </button>
            );
          })}
          {options.length === 0 ? (
            <div className="px-2 py-3 text-center text-[12px] text-ink-faint">No piece matches</div>
          ) : null}
        </div>
      </Popover>
    </div>
  );
}

function PieceChip({
  entry,
  onOpen,
  onRemove,
  block,
}: {
  entry: ContentEntry;
  onOpen: () => void;
  /** Takes the piece off its day; absent where the viewer may not. */
  onRemove?: () => void;
  /** Fill the day's width; off for the row of pieces not on a day yet. */
  block?: boolean;
}) {
  return (
    <div
      className={cx(
        "group/chip flex min-w-0 items-center rounded-md border border-line-soft bg-surface-2 transition-colors hover:border-line hover:bg-surface-3",
        block ? "w-full" : "max-w-64",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        title={`${contentLabel(entry)} · ${entry.type}${entry.stage ? ` · ${entry.stage}` : ""}`}
        className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-1 text-left text-[11px] text-ink"
      >
        <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", STAGE_DOT[entry.stage ?? "none"])} />
        <span className="truncate">{contentLabel(entry)}</span>
      </button>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Take ${contentLabel(entry)} off this day`}
          title="Take off this day"
          className="mr-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-faint opacity-0 transition-opacity group-hover/chip:opacity-100 hover:bg-surface hover:text-st-rejected focus-visible:opacity-100"
        >
          <IconClose size={12} />
        </button>
      ) : null}
    </div>
  );
}
