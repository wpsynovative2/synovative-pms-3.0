"use client";

import { useMemo, useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import {
  IconCalendar,
  IconClock,
  IconInvoice,
  IconPhone,
  IconTrash,
  IconWarning,
} from "@/components/ui/icons";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  SearchInput,
  Select,
  StatTile,
  Tabs,
  Textarea,
  cx,
} from "@/components/ui/primitives";
import { addWorkingDays, daysBetween, formatDate, todayISO } from "@/lib/calendar";
import {
  customerSearchText,
  customerSubline,
  formatMoney,
  invoiceStatusLabel,
  invoiceStatusTone,
} from "@/lib/invoices";
import { canDeleteInvoiceCall, canLogInvoiceCalls, canManageInvoices } from "@/lib/permissions";
import { useStore, type InvoiceNextCall } from "@/lib/store";
import {
  CALL_AGAIN_OUTCOMES,
  INVOICE_CALL_OUTCOMES,
  PROMISE_OUTCOMES,
  type Invoice,
  type InvoiceCall,
  type InvoiceCallOutcome,
} from "@/lib/types";

/*
 * Payment follow-ups (0011): Accounts & Finance chase unpaid invoices by
 * phone. Each call is logged against its invoice, and each invoice carries at
 * most one next call — when, what about, and who makes it. Logging a call
 * sets (or clears) the next one in the same step. A reminder goes out at 09:30
 * IST to whoever has calls due or missed.
 */

/** Nothing left to chase: paid, void or a draft in Books, or no balance. */
export const isSettled = (i: Invoice) =>
  i.balance <= 0 || i.status === "paid" || i.status === "void" || i.status === "draft";

/** The people who can be given a call: active, and able to manage invoices. */
function useCallers() {
  const { db } = useStore();
  return useMemo(
    () =>
      db.users
        .filter((u) => u.active && canManageInvoices(u))
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    [db.users],
  );
}

function nextCallText(on: string) {
  const days = daysBetween(todayISO(), on);
  if (days < 0) return `Missed · was ${formatDate(on)}`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `${formatDate(on)} · in ${days} days`;
}

function nextCallTone(on: string) {
  const days = daysBetween(todayISO(), on);
  if (days < 0) return "border-st-rejected/30 bg-st-rejected/15 text-st-rejected";
  if (days === 0) return "border-st-submitted/30 bg-st-submitted/15 text-st-submitted";
  return "border-st-inprogress/30 bg-st-inprogress/15 text-st-inprogress";
}

function overdueText(i: Invoice) {
  if (!i.dueDate) return "No due date";
  const days = daysBetween(i.dueDate, todayISO());
  if (days > 0) return `Overdue by ${days} day${days === 1 ? "" : "s"}`;
  if (days === 0) return "Due today";
  return `Due ${formatDate(i.dueDate)}`;
}

/* --------------------------------------------------------- next call form */

function NextCallFields({
  value,
  onChange,
  promisedOn,
  required,
}: {
  value: InvoiceNextCall;
  onChange: (next: InvoiceNextCall) => void;
  /** Offers "day after the promise" when a payment date was just promised. */
  promisedOn?: string;
  /** The outcome means calling the client again, so a date must be picked. */
  required?: boolean;
}) {
  const { db } = useStore();
  const callers = useCallers();
  const today = todayISO();
  const shortcuts = [
    { label: "Tomorrow", on: addWorkingDays(today, 1, db.calendar) },
    { label: "In 3 days", on: addWorkingDays(today, 3, db.calendar) },
    { label: "In a week", on: addWorkingDays(today, 6, db.calendar) },
    ...(promisedOn && promisedOn >= today
      ? [{ label: "Day after the promise", on: addWorkingDays(promisedOn, 1, db.calendar) }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Date"
        required={required}
        error={required && !value.on ? "This outcome means calling the client again — pick a date." : undefined}
        hint={
          required
            ? "Needed for this outcome: the client is to be called again."
            : "Leave empty when no further call is needed."
        }
      >
        <DatePicker
          value={value.on}
          onChange={(on) => onChange({ ...value, on })}
          config={db.calendar}
          min={today}
          clearable={!required}
          placeholder={required ? "Pick the next call date" : "No call scheduled"}
        />
        <div className="flex flex-wrap gap-1.5">
          {shortcuts.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => onChange({ ...value, on: s.on })}
              className={cx(
                "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                value.on === s.on
                  ? "border-brand-bright/50 bg-brand/15 text-brand-ink"
                  : "border-line bg-surface-2 text-ink-muted hover:text-ink",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Field>
      {value.on ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Who calls">
            <Select value={value.by ?? ""} onChange={(e) => onChange({ ...value, by: e.target.value || null })}>
              <option value="">Anyone in Accounts</option>
              {callers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="About">
            <Input
              value={value.note}
              maxLength={200}
              onChange={(e) => onChange({ ...value, note: e.target.value })}
              placeholder="Confirm the transfer, chase the TDS certificate…"
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- log call */

export function LogCallModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { db, currentUser, logInvoiceCall, showToast } = useStore();
  const today = todayISO();
  const lastContact = db.invoiceCalls.find((c) => c.invoiceId === invoice.id && c.contact)?.contact ?? "";

  const [calledOn, setCalledOn] = useState(today);
  const [contact, setContact] = useState(lastContact);
  const [outcome, setOutcome] = useState<InvoiceCallOutcome | "">("");
  const [promisedOn, setPromisedOn] = useState("");
  const [promisedAmount, setPromisedAmount] = useState(invoice.balance > 0 ? String(invoice.balance) : "");
  const [notes, setNotes] = useState("");
  const [next, setNext] = useState<InvoiceNextCall>({
    on: "",
    note: "",
    by: invoice.nextCallBy ?? currentUser!.id,
  });

  const promise = !!outcome && PROMISE_OUTCOMES.includes(outcome);
  const amount = promisedAmount.trim() === "" ? null : Number(promisedAmount);
  const badAmount = promise && amount !== null && (!Number.isFinite(amount) || amount < 0);
  const callAgain = !!outcome && CALL_AGAIN_OUTCOMES.includes(outcome);
  const valid =
    !!outcome &&
    !!calledOn &&
    calledOn <= today &&
    (!promise || !!promisedOn) &&
    !badAmount &&
    (!callAgain || !!next.on);

  const save = () => {
    if (!valid || !outcome) return;
    logInvoiceCall(
      {
        invoiceId: invoice.id,
        calledOn,
        contact,
        outcome,
        notes,
        promisedOn: promise ? promisedOn : null,
        promisedAmount: promise ? amount : null,
      },
      next.on ? next : null,
    );
    showToast(
      next.on ? `Call logged. Next call ${nextCallText(next.on).toLowerCase()}.` : "Call logged.",
      "success",
    );
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Log a call · ${invoice.invoiceNumber}`}
      subtitle={`${invoice.customerName} · ${formatMoney(invoice.balance, invoice.currencyCode)} due · ${overdueText(invoice)}`}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!valid}>
            <IconPhone size={14} /> Log call
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Called on" required>
            <DatePicker
              value={calledOn}
              onChange={setCalledOn}
              config={db.calendar}
              max={today}
              allowPast
              ignoreWorkingRules
            />
          </Field>
          <Field label="Spoke to">
            <Input
              value={contact}
              maxLength={160}
              onChange={(e) => setContact(e.target.value)}
              placeholder="Name or designation"
            />
          </Field>
        </div>

        <Field label="Outcome" required>
          <div className="flex flex-wrap gap-1.5">
            {INVOICE_CALL_OUTCOMES.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setOutcome(o)}
                className={cx(
                  "rounded-full border px-3 py-1 text-[12px] transition-colors",
                  outcome === o
                    ? "border-brand-bright/50 bg-brand/15 font-medium text-brand-ink"
                    : "border-line bg-surface-2 text-ink-muted hover:text-ink",
                )}
              >
                {o}
              </button>
            ))}
          </div>
        </Field>

        {promise ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Promised payment date" required>
              <DatePicker
                value={promisedOn}
                onChange={setPromisedOn}
                config={db.calendar}
                min={today}
                ignoreWorkingRules
              />
            </Field>
            <Field
              label="Promised amount"
              error={badAmount ? "Enter an amount of 0 or more." : undefined}
              hint={`Balance due ${formatMoney(invoice.balance, invoice.currencyCode)}`}
            >
              <Input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={promisedAmount}
                onChange={(e) => setPromisedAmount(e.target.value)}
              />
            </Field>
          </div>
        ) : null}

        <Field label="Notes">
          <Textarea
            value={notes}
            maxLength={4000}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What was said, what they asked for…"
          />
        </Field>

        <section className="rounded-card border border-line-soft bg-surface-2 p-3">
          <h3 className="mb-2 text-[11px] font-medium tracking-wide text-ink-muted uppercase">Next call</h3>
          <NextCallFields
            value={next}
            onChange={setNext}
            promisedOn={promise ? promisedOn : undefined}
            required={callAgain}
          />
        </section>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- schedule */

export function ScheduleCallModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { currentUser, scheduleInvoiceCall, showToast } = useStore();
  const [next, setNext] = useState<InvoiceNextCall>({
    on: invoice.nextCallOn ?? "",
    note: invoice.nextCallNote,
    by: invoice.nextCallOn ? invoice.nextCallBy : currentUser!.id,
  });

  const save = () => {
    scheduleInvoiceCall(invoice.id, next.on ? next : null);
    showToast(next.on ? `Call scheduled for ${formatDate(next.on)}.` : "Schedule cleared.", "success");
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${invoice.nextCallOn ? "Move the" : "Schedule a"} call · ${invoice.invoiceNumber}`}
      subtitle={`${invoice.customerName} · ${formatMoney(invoice.balance, invoice.currencyCode)} due`}
      footer={
        <>
          {invoice.nextCallOn ? (
            <Button
              variant="danger"
              className="mr-auto"
              onClick={() => {
                scheduleInvoiceCall(invoice.id, null);
                showToast("Schedule cleared.", "success");
                onClose();
              }}
            >
              Clear schedule
            </Button>
          ) : null}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!next.on && !invoice.nextCallOn}>
            Save
          </Button>
        </>
      }
    >
      <NextCallFields value={next} onChange={setNext} />
    </Modal>
  );
}

/* ------------------------------------------------------------- one call */

function CallItem({ call, heading }: { call: InvoiceCall; heading?: React.ReactNode }) {
  const { currentUser, userById, deleteInvoiceCall } = useStore();
  const [deleting, setDeleting] = useState(false);
  const by = userById(call.createdBy);
  const promise = PROMISE_OUTCOMES.includes(call.outcome);

  return (
    <li className="rounded-card border border-line-soft bg-surface-2 px-3 py-2.5 text-[12px]">
      {heading}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Badge className={outcomeTone(call.outcome)}>{call.outcome}</Badge>
        <span className="text-ink">{formatDate(call.calledOn)}</span>
        {call.contact ? <span className="text-ink-muted">with {call.contact}</span> : null}
        <span className="text-ink-faint">by {by?.fullName ?? "someone"}</span>
        {canDeleteInvoiceCall(currentUser!, call.createdBy) ? (
          <button
            onClick={() => setDeleting(true)}
            aria-label="Delete this call"
            className="ml-auto text-ink-faint hover:text-st-rejected"
          >
            <IconTrash size={13} />
          </button>
        ) : null}
      </div>
      {promise && call.promisedOn ? (
        <p className="mt-1 font-medium text-st-approved">
          Promised {call.promisedAmount !== null ? formatMoney(call.promisedAmount) : "payment"} by{" "}
          {formatDate(call.promisedOn)}
        </p>
      ) : null}
      {call.notes ? <p className="mt-1 whitespace-pre-wrap text-ink-muted">{call.notes}</p> : null}
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => deleteInvoiceCall(call.id)}
        title="Delete this call?"
        body="It is removed from the invoice's follow-up history. The next call scheduled is not changed."
        confirmLabel="Delete call"
      />
    </li>
  );
}

function outcomeTone(o: InvoiceCallOutcome) {
  switch (o) {
    case "Promised to pay":
    case "Part payment promised":
    case "Says already paid":
      return "border-st-approved/30 bg-st-approved/15 text-st-approved";
    case "Disputed":
      return "border-st-rejected/30 bg-st-rejected/15 text-st-rejected";
    case "Needs documents":
    case "Call back later":
      return "border-st-submitted/30 bg-st-submitted/15 text-st-submitted";
    default:
      return "border-line bg-surface-3 text-ink-muted";
  }
}

/* ------------------------------------------- the panel in the invoice drawer */

export function FollowUpPanel({ invoice }: { invoice: Invoice }) {
  const { db, currentUser, userById } = useStore();
  const mayLog = canLogInvoiceCalls(currentUser!);
  const [logging, setLogging] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const calls = db.invoiceCalls.filter((c) => c.invoiceId === invoice.id);
  const settled = isSettled(invoice);
  const caller = userById(invoice.nextCallBy);

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium tracking-wide text-ink-muted uppercase">Payment follow-ups</h3>
        {mayLog ? (
          <div className="flex gap-1.5">
            <Button size="sm" onClick={() => setScheduling(true)}>
              <IconCalendar size={13} /> {invoice.nextCallOn ? "Move call" : "Schedule"}
            </Button>
            <Button size="sm" variant="primary" onClick={() => setLogging(true)}>
              <IconPhone size={13} /> Log call
            </Button>
          </div>
        ) : null}
      </div>

      {invoice.nextCallOn ? (
        <div
          className={cx(
            "mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-card border px-3 py-2 text-[12px]",
            settled ? "border-line bg-surface-2 text-ink-muted" : nextCallTone(invoice.nextCallOn),
          )}
        >
          <IconClock size={13} />
          <span className="font-medium">Next call: {nextCallText(invoice.nextCallOn)}</span>
          {caller ? <span className="opacity-80">· {caller.fullName}</span> : null}
          {invoice.nextCallNote ? <span className="w-full opacity-90">{invoice.nextCallNote}</span> : null}
          {settled ? (
            <span className="w-full text-ink-faint">Settled in Books, so it isn&apos;t on anyone&apos;s list.</span>
          ) : null}
        </div>
      ) : (
        <p className="mb-2 text-[12px] text-ink-faint">
          {settled ? "Settled in Books — nothing to chase." : "No call scheduled."}
        </p>
      )}

      {calls.length ? (
        <ul className="flex flex-col gap-1.5">
          {calls.map((c) => (
            <CallItem key={c.id} call={c} />
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-ink-faint">No calls logged yet.</p>
      )}

      {logging ? <LogCallModal invoice={invoice} onClose={() => setLogging(false)} /> : null}
      {scheduling ? <ScheduleCallModal invoice={invoice} onClose={() => setScheduling(false)} /> : null}
    </section>
  );
}

/* ----------------------------------------------------- the Follow-ups tab */

type View = "to-call" | "upcoming" | "unscheduled" | "log";

export function FollowUpsTab({ onOpen }: { onOpen: (invoiceId: string) => void }) {
  const { db, currentUser } = useStore();
  const user = currentUser!;
  const callers = useCallers();
  const today = todayISO();

  const [view, setView] = useState<View>("to-call");
  const [query, setQuery] = useState("");
  // An accountant opens on their own calls; anyone else on everyone's.
  const [who, setWho] = useState(() =>
    db.invoices.some((i) => i.nextCallBy === user.id) ? user.id : "all",
  );

  const q = query.trim().toLowerCase();
  const matches = (i: Invoice) =>
    !q || [i.invoiceNumber, ...customerSearchText(i)].some((x) => x.toLowerCase().includes(q));
  const mine = (id: string | null) => who === "all" || id === who;

  const open = db.invoices.filter((i) => !isSettled(i));
  const scheduled = open.filter((i) => i.nextCallOn && mine(i.nextCallBy));
  const missed = scheduled.filter((i) => i.nextCallOn! < today);
  const dueToday = scheduled.filter((i) => i.nextCallOn === today);
  const upcoming = scheduled
    .filter((i) => i.nextCallOn! > today)
    .sort((a, b) => a.nextCallOn!.localeCompare(b.nextCallOn!));
  // Oldest debt first: what has waited longest needs the first call.
  const unscheduled = open
    .filter((i) => !i.nextCallOn)
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const toCall = [...missed, ...dueToday].sort((a, b) => a.nextCallOn!.localeCompare(b.nextCallOn!));

  const invoiceById = useMemo(() => new Map(db.invoices.map((i) => [i.id, i])), [db.invoices]);
  const log = db.invoiceCalls.filter((c) => {
    const i = invoiceById.get(c.invoiceId);
    return i && mine(c.createdBy) && matches(i);
  });

  const rows =
    view === "to-call" ? toCall : view === "upcoming" ? upcoming : view === "unscheduled" ? unscheduled : [];
  const shown = rows.filter(matches);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Calls due today" value={dueToday.length} tone="amber" icon={<IconPhone size={17} />} />
        <StatTile label="Missed calls" value={missed.length} tone="red" icon={<IconWarning size={17} />} />
        <StatTile label="Upcoming calls" value={upcoming.length} tone="blue" icon={<IconCalendar size={17} />} />
        <StatTile
          label="Unpaid, no call scheduled"
          value={unscheduled.length}
          tone="neutral"
          icon={<IconInvoice size={17} />}
        />
      </div>

      <Tabs<View>
        active={view}
        onChange={setView}
        tabs={[
          { id: "to-call", label: "To call", icon: <IconPhone size={14} />, count: toCall.length },
          { id: "upcoming", label: "Upcoming", icon: <IconCalendar size={14} />, count: upcoming.length },
          { id: "unscheduled", label: "Not scheduled", icon: <IconInvoice size={14} />, count: unscheduled.length },
          { id: "log", label: "Call log", icon: <IconClock size={14} />, count: log.length },
        ]}
      />

      <div className="flex flex-wrap items-center gap-2.5">
        <SearchInput
          className="w-full sm:max-w-xs"
          placeholder="Search invoice #, customer, company, contact…"
          value={query}
          active={!!q}
          onChange={(e) => setQuery(e.target.value)}
        />
        {view !== "unscheduled" ? (
          <div className="w-full sm:w-52">
            <Select value={who} active={who !== "all"} onChange={(e) => setWho(e.target.value)} aria-label="Whose calls">
              <option value="all">Everyone&apos;s calls</option>
              {callers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.id === user.id ? "My calls" : `${u.fullName}'s calls`}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      {view === "log" ? (
        log.length === 0 ? (
          <Card>
            <EmptyState icon={<IconClock size={30} />} title="No calls logged" body="Calls logged against invoices appear here, newest first." />
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {log.slice(0, 200).map((c) => {
              const i = invoiceById.get(c.invoiceId)!;
              return (
                <CallItem
                  key={c.id}
                  call={c}
                  heading={
                    <button
                      onClick={() => onOpen(i.id)}
                      className="mb-1.5 block text-left text-[13px] font-semibold text-ink hover:text-brand-bright"
                    >
                      {i.invoiceNumber} <span className="font-normal text-ink-muted">· {i.customerName}</span>
                    </button>
                  }
                />
              );
            })}
          </ul>
        )
      ) : shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={<IconPhone size={30} />}
            title={
              view === "to-call"
                ? "No calls due"
                : view === "upcoming"
                  ? "Nothing scheduled ahead"
                  : "Every unpaid invoice has a call scheduled"
            }
            body={
              view === "unscheduled"
                ? undefined
                : "Schedule calls from Not scheduled, or from any invoice."
            }
          />
        </Card>
      ) : (
        <Card>
          <FollowUpTable invoices={shown} onOpen={onOpen} />
        </Card>
      )}
    </div>
  );
}

/** "Today", "Yesterday", "12 days ago": how long since a date, counted to today. */
function daysAgo(iso: string) {
  const days = daysBetween(iso, todayISO());
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function FollowUpTable({
  invoices,
  onOpen,
}: {
  invoices: Invoice[];
  onOpen: (invoiceId: string) => void;
}) {
  const { db, currentUser, userById } = useStore();
  const mayLog = canLogInvoiceCalls(currentUser!);
  const [logging, setLogging] = useState<Invoice | null>(null);
  const [scheduling, setScheduling] = useState<Invoice | null>(null);
  const today = todayISO();

  // The newest call per invoice; invoiceCalls is held newest first.
  const lastCall = useMemo(() => {
    const out = new Map<string, InvoiceCall>();
    const counts = new Map<string, number>();
    for (const c of db.invoiceCalls) {
      if (!out.has(c.invoiceId)) out.set(c.invoiceId, c);
      counts.set(c.invoiceId, (counts.get(c.invoiceId) ?? 0) + 1);
    }
    return { out, counts };
  }, [db.invoiceCalls]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[64rem] text-left text-[12px]">
        <thead className="bg-surface-2 text-[10px] tracking-wide text-ink-faint uppercase">
          <tr>
            <th className="px-4 py-2.5 font-medium">Invoice</th>
            <th className="px-4 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 text-right font-medium">Balance due</th>
            <th className="px-4 py-2.5 font-medium">Invoice due</th>
            <th className="px-4 py-2.5 font-medium">Last call</th>
            <th className="px-4 py-2.5 font-medium">Next call</th>
            {mayLog ? <th className="px-4 py-2.5 font-medium"></th> : null}
          </tr>
        </thead>
        <tbody>
          {invoices.map((i) => {
            const last = lastCall.out.get(i.id);
            const calls = lastCall.counts.get(i.id) ?? 0;
            const caller = userById(i.nextCallBy);
            const late = !!i.dueDate && i.dueDate < today;
            return (
              <tr key={i.id} className="border-t border-line-soft align-top hover:bg-surface-2">
                <td className="px-4 py-3">
                  <button
                    onClick={() => onOpen(i.id)}
                    className="text-left text-[13px] font-semibold text-ink hover:text-brand-bright"
                  >
                    {i.invoiceNumber}
                  </button>
                  <div className="max-w-56 truncate text-ink-muted">{i.customerName}</div>
                  {customerSubline(i) ? (
                    <div className="max-w-56 truncate text-[11px] text-ink-faint">{customerSubline(i)}</div>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <Badge className={invoiceStatusTone(i.status)}>{invoiceStatusLabel(i.status)}</Badge>
                </td>
                <td className="px-4 py-3 text-right font-mono whitespace-nowrap text-ink">
                  {formatMoney(i.balance, i.currencyCode)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="text-ink-muted">{formatDate(i.dueDate)}</div>
                  <div className={cx("text-[11px]", late ? "text-st-rejected" : "text-ink-faint")}>
                    {overdueText(i)}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {last ? (
                    <>
                      <div className="whitespace-nowrap text-ink">
                        {formatDate(last.calledOn)}{" "}
                        <span className="text-ink-faint">· {daysAgo(last.calledOn)}</span>
                      </div>
                      <div className="max-w-56 truncate text-ink-muted">
                        {last.outcome}
                        {last.promisedOn ? ` · promised ${formatDate(last.promisedOn)}` : ""}
                      </div>
                      <div className="text-[11px] text-ink-faint">
                        {calls} call{calls === 1 ? "" : "s"} in all
                      </div>
                    </>
                  ) : (
                    <span className="text-ink-faint">Never called</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {i.nextCallOn ? (
                    <>
                      <Badge className={nextCallTone(i.nextCallOn)}>{nextCallText(i.nextCallOn)}</Badge>
                      {caller ? <div className="mt-1 text-ink-faint">{caller.fullName}</div> : null}
                      {i.nextCallNote ? (
                        <div className="max-w-56 truncate text-ink-muted">{i.nextCallNote}</div>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-ink-faint">Not scheduled</span>
                  )}
                </td>
                {mayLog ? (
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <Button
                        size="sm"
                        onClick={() => setScheduling(i)}
                        aria-label={i.nextCallOn ? "Move the call" : "Schedule a call"}
                        title={i.nextCallOn ? "Move the call" : "Schedule a call"}
                      >
                        <IconCalendar size={13} />
                      </Button>
                      <Button size="sm" variant="primary" onClick={() => setLogging(i)}>
                        <IconPhone size={13} /> Log call
                      </Button>
                    </div>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>

      {logging ? <LogCallModal invoice={logging} onClose={() => setLogging(null)} /> : null}
      {scheduling ? <ScheduleCallModal invoice={scheduling} onClose={() => setScheduling(null)} /> : null}
    </div>
  );
}
