"use client";

import { useMemo, useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import {
  IconCalendar,
  IconChevronLeft,
  IconChevronRight,
  IconPlus,
  IconTrash,
} from "@/components/ui/icons";
import { Modal } from "@/components/ui/modal";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  PageHeader,
  StatTile,
  cx,
} from "@/components/ui/primitives";
import {
  NON_WORKING_LABEL,
  formatDate,
  formatMonthYear,
  fromISODate,
  monthGrid,
  nonWorkingReason,
  todayISO,
} from "@/lib/calendar";
import { canManageCalendar } from "@/lib/permissions";
import { useStore } from "@/lib/store";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** §5.4 — the calendar every task date picker reads from. */
export default function CalendarPage() {
  const { db, currentUser, updateCalendar } = useStore();
  const user = currentUser!;
  const mayManage = canManageCalendar(user);

  const now = new Date();
  const [cursor, setCursor] = useState({
    year: now.getFullYear(),
    month: now.getMonth(),
  });
  const [holidayOpen, setHolidayOpen] = useState(false);

  const cells = useMemo(
    () => monthGrid(cursor.year, cursor.month),
    [cursor.year, cursor.month],
  );

  const holidayByDate = useMemo(
    () => new Map(db.calendar.holidays.map((h) => [h.date, h.name])),
    [db.calendar.holidays],
  );

  const today = todayISO();
  const shift = (delta: number) => {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  };

  const monthCells = cells.filter((iso) => fromISODate(iso).getMonth() === cursor.month);
  const workingThisMonth = monthCells.filter((iso) =>
    !nonWorkingReason(iso, db.calendar, { allowPast: true }),
  ).length;

  const toggleOverride = (iso: string) => {
    if (!mayManage) return;
    const has = db.calendar.workingOverrides.includes(iso);
    updateCalendar({
      workingOverrides: has
        ? db.calendar.workingOverrides.filter((d) => d !== iso)
        : [...db.calendar.workingOverrides, iso],
    });
  };

  const removeHoliday = (iso: string) => {
    updateCalendar({ holidays: db.calendar.holidays.filter((h) => h.date !== iso) });
  };

  const upcomingHolidays = [...db.calendar.holidays]
    .filter((h) => h.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));
  const pastHolidays = [...db.calendar.holidays]
    .filter((h) => h.date < today)
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Working Calendar"
        icon={<IconCalendar size={20} />}
        subtitle="Drives every task date picker — start dates and due dates"
        actions={
          mayManage ? (
            <Button variant="primary" onClick={() => setHolidayOpen(true)}>
              <IconPlus size={15} /> Add holiday
            </Button>
          ) : null
        }
      />

      {!mayManage ? (
        <Card className="px-4 py-3 text-[12px] leading-relaxed text-ink-faint">
          This calendar is read-only for your role. Super Admins and HR Admins add
          holidays and mark exceptions.
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Working days this month"
          value={workingThisMonth}
          hint={`of ${monthCells.length} calendar days`}
          tone="green"
          icon={<IconCalendar size={17} />}
        />
        <StatTile
          label="Holidays on record"
          value={db.calendar.holidays.length}
          hint={`${upcomingHolidays.length} upcoming`}
          tone="red"
        />
        <StatTile
          label="Working-day overrides"
          value={db.calendar.workingOverrides.length}
          hint="Non-working days opened up by HR"
          tone="amber"
        />
        <StatTile label="Weekly pattern" value="Mon–Sat" hint="Sundays closed" tone="neutral" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader
            title={formatMonthYear(cursor.year, cursor.month)}
            subtitle={
              mayManage
                ? "Click a non-working day to open it, or a forced day to close it again"
                : "Grey days are non-working"
            }
            action={
              <div className="flex items-center gap-1">
                <button
                  onClick={() => shift(-1)}
                  aria-label="Previous month"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface-2 text-ink-muted hover:text-ink"
                >
                  <IconChevronLeft size={15} />
                </button>
                <button
                  onClick={() => setCursor({ year: now.getFullYear(), month: now.getMonth() })}
                  className="h-8 rounded-lg border border-line bg-surface-2 px-3 text-[12px] text-ink-muted hover:text-ink"
                >
                  Today
                </button>
                <button
                  onClick={() => shift(1)}
                  aria-label="Next month"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface-2 text-ink-muted hover:text-ink"
                >
                  <IconChevronRight size={15} />
                </button>
              </div>
            }
          />

          <div className="px-4 py-4">
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((w) => (
                <div
                  key={w}
                  className="pb-1.5 text-center text-[10px] font-medium tracking-wide text-ink-faint uppercase"
                >
                  {w}
                </div>
              ))}
              {cells.map((iso) => {
                const d = fromISODate(iso);
                const inMonth = d.getMonth() === cursor.month;
                const reason = nonWorkingReason(iso, db.calendar, { allowPast: true });
                const overridden = db.calendar.workingOverrides.includes(iso);
                const holiday = holidayByDate.get(iso);
                const isToday = iso === today;

                return (
                  <button
                    key={iso}
                    disabled={!mayManage}
                    onClick={() => toggleOverride(iso)}
                    title={
                      overridden
                        ? "Working day (HR override)"
                        : reason
                          ? (holiday ?? NON_WORKING_LABEL[reason])
                          : "Working day"
                    }
                    className={cx(
                      "relative flex h-16 flex-col items-start gap-0.5 rounded-lg border p-1.5 text-left transition-colors",
                      !inMonth && "opacity-35",
                      reason
                        ? "border-line-soft bg-surface-2/50"
                        : "border-line bg-surface-2",
                      overridden && "border-st-submitted/50 bg-st-submitted/10",
                      isToday && "ring-1 ring-brand-bright",
                      mayManage && "hover:border-brand-bright/50",
                    )}
                  >
                    <span
                      className={cx(
                        "text-[12px] font-medium",
                        reason ? "text-ink-faint" : "text-ink",
                      )}
                    >
                      {d.getDate()}
                    </span>
                    {holiday ? (
                      <span className="line-clamp-2 text-[9px] leading-tight text-st-rejected">
                        {holiday}
                      </span>
                    ) : overridden ? (
                      <span className="text-[9px] leading-tight text-st-submitted">
                        Working (override)
                      </span>
                    ) : reason ? (
                      <span className="text-[9px] leading-tight text-ink-faint">
                        {NON_WORKING_LABEL[reason]}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line-soft pt-3 text-[10px] text-ink-faint">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded border border-line bg-surface-2" /> Working
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded border border-line-soft bg-surface-2/50" />{" "}
                Closed
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded border border-st-submitted/50 bg-st-submitted/10" />{" "}
                HR override
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded ring-1 ring-brand-bright" /> Today
              </span>
            </div>
          </div>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Rules" subtitle="Applied to every task date picker" />
            <ol className="space-y-2 px-5 py-4 text-[12px] leading-relaxed text-ink-muted">
              {[
                "All past dates are disabled.",
                "Every Sunday is closed.",
                "The 2nd and 4th Saturday of each month are closed.",
                "Company holidays are closed.",
                "HR Admin can force any closed day back to working, and can add holidays.",
              ].map((rule, i) => (
                <li key={rule} className="flex gap-2.5">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[10px] text-ink-muted">
                    {i + 1}
                  </span>
                  {rule}
                </li>
              ))}
            </ol>
          </Card>

          <Card>
            <CardHeader
              title="Holidays"
              subtitle={`${db.calendar.holidays.length} on record`}
              action={
                mayManage ? (
                  <Button size="sm" onClick={() => setHolidayOpen(true)}>
                    <IconPlus size={13} /> Add
                  </Button>
                ) : null
              }
            />
            {db.calendar.holidays.length === 0 ? (
              <EmptyState icon={<IconCalendar size={26} />} title="No holidays added" />
            ) : (
              <div className="max-h-96 overflow-y-auto">
                {upcomingHolidays.length ? (
                  <>
                    <p className="bg-surface-2 px-4 py-1.5 text-[10px] font-medium tracking-wide text-ink-faint uppercase">
                      Upcoming
                    </p>
                    <HolidayList
                      holidays={upcomingHolidays}
                      onRemove={mayManage ? removeHoliday : undefined}
                    />
                  </>
                ) : null}
                {pastHolidays.length ? (
                  <>
                    <p className="bg-surface-2 px-4 py-1.5 text-[10px] font-medium tracking-wide text-ink-faint uppercase">
                      Earlier this year
                    </p>
                    <HolidayList
                      holidays={pastHolidays}
                      onRemove={mayManage ? removeHoliday : undefined}
                      muted
                    />
                  </>
                ) : null}
              </div>
            )}
          </Card>

          {db.calendar.workingOverrides.length ? (
            <Card>
              <CardHeader
                title="Working-day overrides"
                subtitle="Closed days HR has opened up"
              />
              <ul className="divide-y divide-line-soft">
                {[...db.calendar.workingOverrides].sort().map((iso) => (
                  <li key={iso} className="flex items-center gap-3 px-4 py-2.5">
                    <Badge className="border-st-submitted/30 bg-st-submitted/15 text-st-submitted">
                      Working
                    </Badge>
                    <span className="min-w-0 flex-1 text-[12px] text-ink">
                      {formatDate(iso)}
                    </span>
                    {mayManage ? (
                      <button
                        onClick={() => toggleOverride(iso)}
                        className="rounded p-1 text-ink-faint hover:text-st-rejected"
                        aria-label={`Remove override for ${formatDate(iso)}`}
                      >
                        <IconTrash size={14} />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>

      {holidayOpen ? (
        <AddHolidayModal open onClose={() => setHolidayOpen(false)} />
      ) : null}
    </div>
  );
}

function HolidayList({
  holidays,
  onRemove,
  muted,
}: {
  holidays: { date: string; name: string }[];
  onRemove?: (iso: string) => void;
  muted?: boolean;
}) {
  return (
    <ul className="divide-y divide-line-soft">
      {holidays.map((h) => (
        <li key={h.date} className={cx("flex items-center gap-3 px-4 py-2.5", muted && "opacity-60")}>
          <span className="h-2 w-2 shrink-0 rounded-full bg-st-rejected" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] text-ink">{h.name}</div>
            <div className="text-[10px] text-ink-faint">{formatDate(h.date)}</div>
          </div>
          {onRemove ? (
            <button
              onClick={() => onRemove(h.date)}
              className="rounded p-1 text-ink-faint hover:text-st-rejected"
              aria-label={`Remove ${h.name}`}
            >
              <IconTrash size={14} />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function AddHolidayModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { db, updateCalendar } = useStore();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);

  const duplicate = db.calendar.holidays.some((h) => h.date === date);
  const valid = !!date && !!name.trim() && !duplicate;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a company holiday"
      subtitle="The date becomes unavailable in every task date picker."
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              updateCalendar({
                holidays: [...db.calendar.holidays, { date, name: name.trim() }],
                // A holiday outranks a previous "make it working" override.
                workingOverrides: db.calendar.workingOverrides.filter((d) => d !== date),
              });
              onClose();
            }}
          >
            Add holiday
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Date"
          required
          error={
            touched && !date
              ? "Pick a date."
              : duplicate
                ? "A holiday already exists on that date."
                : undefined
          }
        >
          <DatePicker
            value={date}
            onChange={setDate}
            config={db.calendar}
            ignoreWorkingRules
            allowPast
          />
        </Field>

        <Field
          label="Holiday name"
          required
          error={touched && !name.trim() ? "Required." : undefined}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ganesh Chaturthi"
          />
        </Field>
      </div>
    </Modal>
  );
}
