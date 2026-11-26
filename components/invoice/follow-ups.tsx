"use client";

import { useMemo, useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { ButtonLoader } from "@/components/ui/loader";
import {
  IconCalendar,
  IconClock,
  IconEdit,
  IconFilter,
  IconInvoice,
  IconPhone,
  IconPlus,
  IconRepeat,
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
import { SearchSelect } from "@/components/ui/selects";
import { RefetchButton, useInvoiceRefetch } from "./refetch";
import {
  addWorkingDays,
  daysBetween,
  formatDate,
  nextWorkingDay,
  todayISO,
} from "@/lib/calendar";
import {
  IMPORT_BATCH,
  INVOICE_STATUS_FILTERS,
  customerSearchText,
  customerSubline,
  formatMoney,
  invoiceCompany,
  invoiceCompanyKey,
  invoiceStatusLabel,
  invoiceStatusTone,
  joinPhones,
  splitPhones,
} from "@/lib/invoices";
import { canDeleteInvoiceCall, canLogInvoiceCalls, canManageInvoices } from "@/lib/permissions";
import { useStore, type InvoiceNextCall } from "@/lib/store";
import {
  CALL_AGAIN_OUTCOMES,
  CHEQUE_READY,
  INVOICE_CALL_OUTCOMES,
  PROMISE_OUTCOMES,
  type CustomerContact,
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
  collectOn,
  required,
}: {
  value: InvoiceNextCall;
  onChange: (next: InvoiceNextCall) => void;
  /** Offers "day after the promise" when a payment date was just promised. */
  promisedOn?: string;
  /** Offers "on collection day" when a cheque was just said to be ready. */
  collectOn?: string;
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
    ...(collectOn && collectOn >= today
      ? [{ label: "On collection day", on: nextWorkingDay(collectOn, db.calendar) }]
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

/** "Patil Builders · ₹53,000.00 due across 3 invoices", for a bulk dialog's subtitle. */
function acrossText(invoices: Invoice[]) {
  const due = invoices.reduce((sum, i) => sum + i.balance, 0);
  return `${invoiceCompany(invoices[0])} · ${formatMoney(due, invoices[0].currencyCode)} due across ${
    invoices.length
  } invoices`;
}

/**
 * Log a call against one invoice, or against several of one company's at once:
 * one conversation with a developer's accounts desk usually covers every bill
 * they owe. Each invoice gets its own call record, with its own promised
 * amount, and they all get the same next call.
 */
export function LogCallModal({
  invoices,
  onClose,
  onSaved,
}: {
  invoices: Invoice[];
  onClose: () => void;
  /** Runs once the call is logged, before closing: a bulk log clears its selection. */
  onSaved?: () => void;
}) {
  const { db, currentUser, logInvoiceCalls, showToast } = useStore();
  const today = todayISO();
  const [invoice] = invoices;
  const many = invoices.length > 1;
  const ids = new Set(invoices.map((i) => i.id));
  // One company can be several Books customers: offer all their contacts.
  const customers = new Set(invoices.map((i) => i.zohoCustomerId).filter(Boolean));
  const contacts = db.customerContacts.filter((c) => customers.has(c.zohoCustomerId));
  const lastCall = db.invoiceCalls.find((c) => ids.has(c.invoiceId));
  // A contact added from here is filed under the first invoice's Books customer.
  const contactHome = invoices.find((i) => i.zohoCustomerId);

  // Whoever was called last time, if they are still listed; else the primary
  // contact (listed first); else someone typed in.
  const firstPick =
    (lastCall?.contactId && contacts.find((c) => c.id === lastCall.contactId)) || contacts[0] || null;
  const [calledOn, setCalledOn] = useState(today);
  const [contactId, setContactId] = useState<string>(firstPick?.id ?? OTHER);
  const [otherName, setOtherName] = useState(firstPick ? "" : (lastCall?.contact ?? ""));
  const [phone, setPhone] = useState(
    firstPick ? (splitPhones(firstPick.phones)[0] ?? "") : (lastCall?.phone ?? ""),
  );
  // Adding a contact person, or editing the one picked (only those added here).
  const [contactDialog, setContactDialog] = useState<"new" | "edit" | null>(null);
  const picked = contacts.find((c) => c.id === contactId) ?? null;
  const pickedPhones = picked ? splitPhones(picked.phones) : [];
  const pickedCustomer = picked ? invoices.find((i) => i.zohoCustomerId === picked.zohoCustomerId) : undefined;

  const pickContact = (id: string) => {
    setContactId(id);
    const c = contacts.find((x) => x.id === id);
    setPhone(c ? (splitPhones(c.phones)[0] ?? "") : "");
  };
  const [outcome, setOutcome] = useState<InvoiceCallOutcome | "">("");
  const [promisedOn, setPromisedOn] = useState("");
  // What was promised on each invoice, starting at its balance due.
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(invoices.map((i) => [i.id, i.balance > 0 ? String(i.balance) : ""])),
  );
  const [chequeOn, setChequeOn] = useState("");
  const [notes, setNotes] = useState("");
  const [next, setNext] = useState<InvoiceNextCall>({
    on: "",
    note: "",
    by: invoices.find((i) => i.nextCallBy)?.nextCallBy ?? currentUser!.id,
  });

  const promise = !!outcome && PROMISE_OUTCOMES.includes(outcome);
  const cheque = outcome === CHEQUE_READY;
  const amountOf = (id: string) => {
    const raw = (amounts[id] ?? "").trim();
    return raw === "" ? null : Number(raw);
  };
  const badAmount =
    promise &&
    invoices.some((i) => {
      const a = amountOf(i.id);
      return a !== null && (!Number.isFinite(a) || a < 0);
    });
  const setAmount = (id: string, value: string) => setAmounts((a) => ({ ...a, [id]: value }));
  const callAgain = !!outcome && CALL_AGAIN_OUTCOMES.includes(outcome);
  const valid =
    !!outcome &&
    !!calledOn &&
    calledOn <= today &&
    (!promise || !!promisedOn) &&
    !badAmount &&
    (!cheque || !!chequeOn) &&
    (!callAgain || !!next.on);

  const save = () => {
    if (!valid || !outcome) return;
    logInvoiceCalls(
      invoices.map((i) => ({
        invoiceId: i.id,
        calledOn,
        contact: picked ? picked.name : otherName,
        contactId: picked?.id ?? null,
        phone,
        outcome,
        notes,
        promisedOn: promise ? promisedOn : null,
        promisedAmount: promise ? amountOf(i.id) : null,
        chequeCollectOn: cheque ? chequeOn : null,
      })),
      next.on ? next : null,
    );
    const logged = many ? `Call logged on ${invoices.length} invoices` : "Call logged";
    showToast(
      next.on ? `${logged}. Next call ${nextCallText(next.on).toLowerCase()}.` : `${logged}.`,
      "success",
    );
    onSaved?.();
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={many ? `Log a call · ${invoices.length} invoices` : `Log a call · ${invoice.invoiceNumber}`}
      subtitle={
        many
          ? acrossText(invoices)
          : `${invoice.customerName} · ${formatMoney(invoice.balance, invoice.currencyCode)} due · ${overdueText(invoice)}`
      }
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!valid}>
            <IconPhone size={14} /> {many ? `Log call on ${invoices.length}` : "Log call"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {many ? (
          <Field
            label="Invoices on this call"
            hint="Each gets its own call record, with the same outcome, notes and next call."
          >
            <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {invoices.map((i) => (
                <span
                  key={i.id}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-[11px]"
                >
                  <span className="font-medium text-ink">{i.invoiceNumber}</span>
                  <span className="font-mono text-ink-muted">{formatMoney(i.balance, i.currencyCode)}</span>
                </span>
              ))}
            </div>
          </Field>
        ) : null}

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
          <Field
            label="Spoke to"
            hint={contacts.length ? undefined : "No contact persons for this customer yet — add one, or type a name."}
          >
            <div className="flex gap-1.5">
              <Select value={contactId} onChange={(e) => pickContact(e.target.value)} aria-label="Contact person">
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.designation ? ` — ${c.designation}` : ""}
                    {c.isPrimary ? " (primary)" : ""}
                  </option>
                ))}
                <option value={OTHER}>Someone else…</option>
              </Select>
              {picked ? (
                // The hint sits on the wrapper: a disabled button shows no tooltip of its own.
                <span
                  className="inline-flex"
                  title={
                    picked.source === "pms"
                      ? `Edit ${picked.name}'s name, designation or numbers`
                      : "From Zoho Books: edit this contact in Books, then refetch the invoice"
                  }
                >
                  <Button
                    type="button"
                    disabled={picked.source !== "pms"}
                    onClick={() => setContactDialog("edit")}
                    aria-label={`Edit ${picked.name}`}
                  >
                    <IconEdit size={14} />
                  </Button>
                </span>
              ) : null}
              {contactHome ? (
                <Button
                  type="button"
                  onClick={() => setContactDialog("new")}
                  aria-label="Add a contact person"
                  title="Add a contact person"
                >
                  <IconPlus size={14} />
                </Button>
              ) : null}
            </div>
          </Field>
        </div>

        {picked ? (
          <Field label="Number called">
            {pickedPhones.length ? (
              <div className="flex flex-wrap gap-1.5">
                {pickedPhones.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setPhone(n)}
                    className={cx(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[12px] transition-colors",
                      phone === n
                        ? "border-brand-bright/50 bg-brand/15 font-medium text-brand-ink"
                        : "border-line bg-surface-2 text-ink-muted hover:text-ink",
                    )}
                  >
                    <IconPhone size={12} /> {n}
                  </button>
                ))}
              </div>
            ) : (
              <Input
                value={phone}
                maxLength={40}
                inputMode="tel"
                onChange={(e) => setPhone(e.target.value)}
                placeholder="No number saved for them — type the one you called"
              />
            )}
          </Field>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input
                value={otherName}
                maxLength={160}
                onChange={(e) => setOtherName(e.target.value)}
                placeholder="Name or designation"
              />
            </Field>
            <Field label="Number called">
              <Input
                value={phone}
                maxLength={40}
                inputMode="tel"
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91…"
              />
            </Field>
          </div>
        )}

        {contactDialog === "new" && contactHome ? (
          <ContactModal
            zohoCustomerId={contactHome.zohoCustomerId}
            customerName={contactHome.customerName}
            onClose={() => setContactDialog(null)}
            onSaved={(c) => {
              setContactId(c.id);
              setPhone(splitPhones(c.phones)[0] ?? "");
            }}
          />
        ) : null}
        {contactDialog === "edit" && picked?.source === "pms" ? (
          <ContactModal
            zohoCustomerId={picked.zohoCustomerId}
            customerName={pickedCustomer?.customerName ?? invoice.customerName}
            contact={picked}
            onClose={() => setContactDialog(null)}
            onSaved={(c) => {
              // Keep the number picked if it is still theirs; else their first.
              // With none saved, whatever was typed by hand stays.
              const numbers = splitPhones(c.phones);
              if (numbers.length && !numbers.includes(phone)) setPhone(numbers[0]);
            }}
          />
        ) : null}

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

        {promise && !many ? (
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
                value={amounts[invoice.id] ?? ""}
                onChange={(e) => setAmount(invoice.id, e.target.value)}
              />
            </Field>
          </div>
        ) : null}

        {promise && many ? (
          <div className="flex flex-col gap-3">
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
              label="Promised amounts"
              error={badAmount ? "Enter amounts of 0 or more." : undefined}
              hint="Each starts at its balance due. Empty one that nothing was promised on."
            >
              <ul className="flex flex-col gap-1.5">
                {invoices.map((i) => (
                  <li key={i.id} className="grid grid-cols-[1fr_auto_9rem] items-center gap-3 text-[12px]">
                    <span className="truncate font-medium text-ink">{i.invoiceNumber}</span>
                    <span className="font-mono text-ink-faint">
                      {formatMoney(i.balance, i.currencyCode)} due
                    </span>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      aria-label={`Promised on ${i.invoiceNumber}`}
                      value={amounts[i.id] ?? ""}
                      onChange={(e) => setAmount(i.id, e.target.value)}
                    />
                  </li>
                ))}
              </ul>
            </Field>
          </div>
        ) : null}

        {cheque ? (
          <Field
            label="Cheque collection date"
            required
            error={!chequeOn ? "Pick the day the cheque is to be collected." : undefined}
            hint="The day someone goes to pick the cheque up."
          >
            <DatePicker
              value={chequeOn}
              onChange={setChequeOn}
              config={db.calendar}
              min={today}
              ignoreWorkingRules
              placeholder="Pick the collection date"
            />
          </Field>
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
            collectOn={cheque ? chequeOn : undefined}
            required={callAgain}
          />
        </section>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- schedule */

/** Schedule, move or clear the next call on one invoice, or on several of one company's at once. */
export function ScheduleCallModal({
  invoices,
  onClose,
  onSaved,
}: {
  invoices: Invoice[];
  onClose: () => void;
  /** Runs once saved, before closing: a bulk schedule clears its selection. */
  onSaved?: () => void;
}) {
  const { currentUser, scheduleInvoiceCalls, showToast } = useStore();
  const [invoice] = invoices;
  const many = invoices.length > 1;
  const ids = invoices.map((i) => i.id);
  const anyScheduled = invoices.some((i) => i.nextCallOn);
  // Several invoices open on the call they already share, if they share one.
  const shared = invoices.every(
    (i) =>
      i.nextCallOn === invoice.nextCallOn &&
      i.nextCallBy === invoice.nextCallBy &&
      i.nextCallNote === invoice.nextCallNote,
  );
  const [next, setNext] = useState<InvoiceNextCall>(() =>
    shared && invoice.nextCallOn
      ? { on: invoice.nextCallOn, note: invoice.nextCallNote, by: invoice.nextCallBy }
      : { on: "", note: "", by: currentUser!.id },
  );
  const onMany = many ? ` on ${invoices.length} invoices` : "";

  const finish = (value: InvoiceNextCall | null) => {
    scheduleInvoiceCalls(ids, value);
    showToast(
      value ? `Call scheduled for ${formatDate(value.on)}${onMany}.` : `Schedule cleared${onMany}.`,
      "success",
    );
    onSaved?.();
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={
        many
          ? `Schedule a call · ${invoices.length} invoices`
          : `${invoice.nextCallOn ? "Move the" : "Schedule a"} call · ${invoice.invoiceNumber}`
      }
      subtitle={
        many
          ? acrossText(invoices)
          : `${invoice.customerName} · ${formatMoney(invoice.balance, invoice.currencyCode)} due`
      }
      footer={
        <>
          {anyScheduled ? (
            <Button variant="danger" className="mr-auto" onClick={() => finish(null)}>
              Clear schedule
            </Button>
          ) : null}
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => finish(next.on ? next : null)}
            disabled={!next.on && !anyScheduled}
          >
            Save
          </Button>
        </>
      }
    >
      {many && anyScheduled && !shared ? (
        <p className="mb-3 text-[12px] text-ink-faint">
          Some of these already have a call scheduled. Saving gives them all this one.
        </p>
      ) : null}
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
        {call.phone ? (
          <a href={`tel:${call.phone.replace(/\s+/g, "")}`} className="font-mono text-ink-muted hover:text-brand-bright">
            {call.phone}
          </a>
        ) : null}
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
      {call.chequeCollectOn ? (
        <p className="mt-1 font-medium text-st-approved">
          Cheque to be collected {formatDate(call.chequeCollectOn)}
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

/* ------------------------------------------------------ contact persons */

/** "Someone else": a call to a person not on the customer's list. */
const OTHER = "__other__";

/**
 * Add a contact person here, or edit one added here (0014). Books' own
 * contacts are edited in Books: the next fetch would overwrite a change made
 * here.
 */
function ContactModal({
  zohoCustomerId,
  customerName,
  contact,
  onClose,
  onSaved,
}: {
  zohoCustomerId: string;
  customerName: string;
  contact?: CustomerContact;
  onClose: () => void;
  onSaved?: (c: CustomerContact) => void;
}) {
  const { saveCustomerContact, showToast } = useStore();
  const [name, setName] = useState(contact?.name ?? "");
  const [designation, setDesignation] = useState(contact?.designation ?? "");
  const [phones, setPhones] = useState(contact?.phones ?? "");
  const valid = !!name.trim();

  const save = () => {
    if (!valid) return;
    const saved = saveCustomerContact({
      id: contact?.id,
      zohoCustomerId,
      name,
      designation,
      phones: joinPhones(phones.split(",")),
    });
    showToast(contact ? "Contact saved." : `${saved.name} added to ${customerName}'s contacts.`, "success");
    onSaved?.(saved);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={contact ? "Edit contact person" : "Add a contact person"}
      subtitle={`${customerName} — shared by every invoice of this customer`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!valid}>
            {contact ? "Save" : "Add contact"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name" required>
          <Input value={name} maxLength={160} autoFocus onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Designation">
          <Input
            value={designation}
            maxLength={160}
            onChange={(e) => setDesignation(e.target.value)}
            placeholder="Accounts head, Director…"
          />
        </Field>
        <Field label="Phone numbers" hint="Separate two numbers with a comma.">
          <Input
            value={phones}
            maxLength={200}
            inputMode="tel"
            onChange={(e) => setPhones(e.target.value)}
            placeholder="+91 98200 00000, +91 22 0000 0000"
          />
        </Field>
      </div>
    </Modal>
  );
}

/** The customer's contact persons, each number a tap to call. */
function ContactsSection({ invoice }: { invoice: Invoice }) {
  const { db, currentUser, deleteCustomerContact } = useStore();
  const mayEdit = canLogInvoiceCalls(currentUser!);
  const [editing, setEditing] = useState<CustomerContact | "new" | null>(null);
  const [deleting, setDeleting] = useState<CustomerContact | null>(null);
  const contacts = db.customerContacts.filter((c) => c.zohoCustomerId === invoice.zohoCustomerId);

  return (
    <div className="mb-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] tracking-wide text-ink-faint uppercase">Contact persons</span>
        {mayEdit && invoice.zohoCustomerId ? (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="inline-flex items-center gap-1 text-[12px] text-brand-bright hover:underline"
          >
            <IconPlus size={12} /> Add contact
          </button>
        ) : null}
      </div>
      {contacts.length === 0 ? (
        <p className="text-[12px] text-ink-faint">
          {invoice.zohoCustomerId
            ? "None yet. Refetch the invoice to bring them from Books, or add one."
            : "Refetch this invoice to bring its customer's contacts from Books."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {contacts.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-line-soft px-3 py-1.5 text-[12px]"
            >
              <span className="font-medium text-ink">{c.name}</span>
              {c.designation ? <span className="text-ink-faint">{c.designation}</span> : null}
              {c.isPrimary ? <Badge>Primary</Badge> : null}
              <span className="flex flex-wrap gap-x-2">
                {splitPhones(c.phones).map((n) => (
                  <a
                    key={n}
                    href={`tel:${n.replace(/\s+/g, "")}`}
                    className="inline-flex items-center gap-1 font-mono text-brand-bright hover:underline"
                  >
                    <IconPhone size={11} /> {n}
                  </a>
                ))}
                {c.phones ? null : <span className="text-ink-faint">No number</span>}
              </span>
              <span className="ml-auto flex items-center gap-1.5">
                <span className="text-[10px] text-ink-faint">{c.source === "zoho" ? "From Books" : "Added here"}</span>
                {mayEdit && c.source === "pms" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditing(c)}
                      aria-label={`Edit ${c.name}`}
                      className="text-ink-faint hover:text-ink"
                    >
                      <IconEdit size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(c)}
                      aria-label={`Delete ${c.name}`}
                      className="text-ink-faint hover:text-st-rejected"
                    >
                      <IconTrash size={12} />
                    </button>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <ContactModal
          zohoCustomerId={invoice.zohoCustomerId}
          customerName={invoice.customerName}
          contact={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteCustomerContact(deleting.id)}
        title={`Delete ${deleting?.name ?? "this contact"}?`}
        body="They are removed from every invoice of this customer. Calls already logged keep their name and number."
        confirmLabel="Delete contact"
      />
    </div>
  );
}

function outcomeTone(o: InvoiceCallOutcome) {
  switch (o) {
    case "Promised to pay":
    case "Part payment promised":
    case "Cheque ready":
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

      <ContactsSection invoice={invoice} />

      {calls.length ? (
        <ul className="flex flex-col gap-1.5">
          {calls.map((c) => (
            <CallItem key={c.id} call={c} />
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-ink-faint">No calls logged yet.</p>
      )}

      {logging ? <LogCallModal invoices={[invoice]} onClose={() => setLogging(false)} /> : null}
      {scheduling ? <ScheduleCallModal invoices={[invoice]} onClose={() => setScheduling(false)} /> : null}
    </section>
  );
}

/* ----------------------------------------------------- the Follow-ups tab */

type View = "to-call" | "upcoming" | "unscheduled" | "log";

/** The overdue filter's ranges, in days past the invoice's due date (both ends included). */
const OVERDUE_FILTERS = [
  { id: "not-due", label: "Not due yet", min: -Infinity, max: 0 },
  { id: "1-30", label: "Overdue 1–30 days", min: 1, max: 30 },
  { id: "31-60", label: "Overdue 31–60 days", min: 31, max: 60 },
  { id: "61-90", label: "Overdue 61–90 days", min: 61, max: 90 },
  { id: "91-180", label: "Overdue 91–180 days", min: 91, max: 180 },
  { id: "181+", label: "Overdue over 180 days", min: 181, max: Infinity },
] as const;

/** "Not called lately": nothing logged in more than this many days. */
const STALE_DAYS = 30;

/** Never called, not called lately, or how the last call ended. */
type LastCallFilter = "" | "never" | "stale" | InvoiceCallOutcome;

/** Past this many invoices, refetching the list asks first: Books allows about 100 calls a minute. */
const REFETCH_CONFIRM_OVER = IMPORT_BATCH * 3;

/** The newest call on each invoice, and how many it has had. */
function useLastCalls() {
  const { db } = useStore();
  return useMemo(() => {
    const last = new Map<string, InvoiceCall>();
    const counts = new Map<string, number>();
    // invoiceCalls is held newest first.
    for (const c of db.invoiceCalls) {
      if (!last.has(c.invoiceId)) last.set(c.invoiceId, c);
      counts.set(c.invoiceId, (counts.get(c.invoiceId) ?? 0) + 1);
    }
    return { last, counts };
  }, [db.invoiceCalls]);
}

type LastCalls = ReturnType<typeof useLastCalls>;

export function FollowUpsTab({ onOpen }: { onOpen: (invoiceId: string) => void }) {
  const { db, currentUser } = useStore();
  const user = currentUser!;
  const mayLog = canLogInvoiceCalls(user);
  const callers = useCallers();
  const calls = useLastCalls();
  const { progress, refetch } = useInvoiceRefetch();
  const today = todayISO();

  const [view, setView] = useState<View>("to-call");
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState("");
  const [status, setStatus] = useState("");
  const [overdue, setOverdue] = useState("");
  const [lastFilter, setLastFilter] = useState<LastCallFilter>("");
  // An accountant opens on their own calls; anyone else on everyone's.
  const [who, setWho] = useState(() =>
    db.invoices.some((i) => i.nextCallBy === user.id) ? user.id : "all",
  );
  // Invoices ticked for one call, always of one company (FollowUpTable keeps it so).
  const [picked, setPicked] = useState<string[]>([]);
  const [bulk, setBulk] = useState<"log" | "schedule" | null>(null);
  const [confirmingRefetch, setConfirmingRefetch] = useState(false);

  const changeView = (next: View) => {
    setView(next);
    setPicked([]);
  };

  const q = query.trim().toLowerCase();
  const mine = (id: string | null) => who === "all" || id === who;
  const overdueBucket = OVERDUE_FILTERS.find((b) => b.id === overdue);
  // Who the invoice is for and where it stands: these narrow the call log too.
  const invoiceMatches = (i: Invoice) => {
    if (q && ![i.invoiceNumber, ...customerSearchText(i)].some((x) => x.toLowerCase().includes(q))) return false;
    if (company && invoiceCompanyKey(i) !== company) return false;
    if (status && i.status !== status) return false;
    if (overdueBucket) {
      if (!i.dueDate) return false;
      const days = daysBetween(i.dueDate, today);
      if (days < overdueBucket.min || days > overdueBucket.max) return false;
    }
    return true;
  };
  const lastCallMatches = (i: Invoice) => {
    if (!lastFilter) return true;
    const last = calls.last.get(i.id);
    if (lastFilter === "never") return !last;
    if (lastFilter === "stale") return !!last && daysBetween(last.calledOn, today) > STALE_DAYS;
    return last?.outcome === lastFilter;
  };

  const open = useMemo(() => db.invoices.filter((i) => !isSettled(i)), [db.invoices]);
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
    return i && mine(c.createdBy) && invoiceMatches(i);
  });

  const rows =
    view === "to-call" ? toCall : view === "upcoming" ? upcoming : view === "unscheduled" ? unscheduled : [];
  const shown = rows.filter((i) => invoiceMatches(i) && lastCallMatches(i));
  // What is ticked and still on screen: a filter that hides a row unticks it.
  const selected = shown.filter((i) => picked.includes(i.id));
  const selectedKey = selected.length ? invoiceCompanyKey(selected[0]) : null;
  const sameCompany = selectedKey ? shown.filter((i) => invoiceCompanyKey(i) === selectedKey) : [];

  const toggle = (ids: string[], on: boolean) => {
    const onScreen = new Set(shown.map((i) => i.id));
    setPicked((prev) =>
      on
        ? [...new Set([...prev.filter((id) => onScreen.has(id)), ...ids])]
        : prev.filter((id) => !ids.includes(id)),
    );
  };

  // Every company with something unpaid, A–Z, with what it owes.
  const companyOptions = useMemo(() => {
    const byKey = new Map<string, { label: string; count: number; due: number }>();
    for (const i of open) {
      const key = invoiceCompanyKey(i);
      if (!key) continue;
      const g = byKey.get(key) ?? { label: invoiceCompany(i), count: 0, due: 0 };
      g.count += 1;
      g.due += i.balance;
      byKey.set(key, g);
    }
    return [...byKey]
      .sort((a, b) => a[1].label.localeCompare(b[1].label))
      .map(([value, g]) => ({
        value,
        label: g.label,
        hint: `${g.count} unpaid · ${formatMoney(g.due)}`,
      }));
  }, [open]);

  // The statuses unpaid invoices are in, in Books' order.
  const statusOptions = useMemo(() => {
    const rank = (s: string) => {
      const at = INVOICE_STATUS_FILTERS.indexOf(s);
      return at < 0 ? 99 : at;
    };
    return [...new Set(open.map((i) => i.status))].sort((a, b) => rank(a) - rank(b));
  }, [open]);

  const filtering = !!q || !!company || !!status || !!overdue || !!lastFilter;
  const clearFilters = () => {
    setQuery("");
    setCompany("");
    setStatus("");
    setOverdue("");
    setLastFilter("");
  };

  const refetchList = () => {
    if (shown.length > REFETCH_CONFIRM_OVER) setConfirmingRefetch(true);
    else void refetch(shown);
  };
  const refetchLabel = progress ? `Refetching ${progress.done} of ${progress.total}…` : null;

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
        onChange={changeView}
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
        <div className="w-full sm:w-60">
          <SearchSelect
            allowClear
            options={companyOptions}
            value={company}
            active={!!company}
            onChange={setCompany}
            placeholder="Any company"
          />
        </div>
        <div className="w-full sm:w-44">
          <Select value={status} active={!!status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Any status</option>
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {invoiceStatusLabel(s)}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-full sm:w-48">
          <Select
            value={overdue}
            active={!!overdue}
            onChange={(e) => setOverdue(e.target.value)}
            aria-label="How overdue"
          >
            <option value="">Any due date</option>
            {OVERDUE_FILTERS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </Select>
        </div>
        {view !== "log" ? (
          <div className="w-full sm:w-52">
            <Select
              value={lastFilter}
              active={!!lastFilter}
              onChange={(e) => setLastFilter(e.target.value as LastCallFilter)}
              aria-label="Last call"
            >
              <option value="">Any last call</option>
              <option value="never">Never called</option>
              <option value="stale">Not called in {STALE_DAYS}+ days</option>
              {INVOICE_CALL_OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  Last call: {o}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
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
        {filtering ? (
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-1 text-[12px] text-ink-faint hover:text-ink"
          >
            <IconFilter size={13} /> Clear
          </button>
        ) : null}
        {view !== "log" ? (
          <span className="ml-auto flex items-center gap-2.5">
            <span className="text-[11px] text-ink-faint">
              {shown.length} of {rows.length} invoices
            </span>
            {mayLog && shown.length ? (
              <Button
                size="sm"
                onClick={refetchList}
                disabled={!!progress}
                title="Bring every invoice on this list up to date from Zoho Books"
              >
                {progress ? <ButtonLoader /> : <IconRepeat size={13} />}
                {refetchLabel ?? `Refetch ${shown.length} from Books`}
              </Button>
            ) : null}
          </span>
        ) : null}
      </div>

      {mayLog && selected.length ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-brand-bright/40 bg-brand/10 px-4 py-2.5 text-[12px]">
          <span className="font-semibold text-brand-ink">{selected.length} selected</span>
          <span className="text-ink-muted">
            {invoiceCompany(selected[0])} ·{" "}
            {formatMoney(
              selected.reduce((sum, i) => sum + i.balance, 0),
              selected[0].currencyCode,
            )}{" "}
            due
          </span>
          {sameCompany.length > selected.length ? (
            <button
              type="button"
              onClick={() => toggle(sameCompany.map((i) => i.id), true)}
              className="font-medium text-brand-bright hover:underline"
            >
              Select all {sameCompany.length} of theirs
            </button>
          ) : null}
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => void refetch(selected)} disabled={!!progress}>
              {progress ? <ButtonLoader /> : <IconRepeat size={13} />}
              {refetchLabel ?? "Refetch"}
            </Button>
            <Button size="sm" onClick={() => setBulk("schedule")}>
              <IconCalendar size={13} /> Schedule
            </Button>
            <Button size="sm" variant="primary" onClick={() => setBulk("log")}>
              <IconPhone size={13} /> Log one call for {selected.length}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPicked([])}>
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      {view === "log" ? (
        log.length === 0 ? (
          <Card>
            <EmptyState
              icon={<IconClock size={30} />}
              title={filtering ? "No calls match" : "No calls logged"}
              body={
                filtering
                  ? "Try another company, status or due date, or clear the filters."
                  : "Calls logged against invoices appear here, newest first."
              }
            />
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
              filtering
                ? "No invoices match"
                : view === "to-call"
                  ? "No calls due"
                  : view === "upcoming"
                    ? "Nothing scheduled ahead"
                    : "Every unpaid invoice has a call scheduled"
            }
            body={
              filtering
                ? "Try another company, status, due date or last call, or clear the filters."
                : view === "unscheduled"
                  ? undefined
                  : "Schedule calls from Not scheduled, or from any invoice."
            }
          />
        </Card>
      ) : (
        <Card>
          <FollowUpTable
            invoices={shown}
            onOpen={onOpen}
            calls={calls}
            picked={picked}
            onToggle={toggle}
          />
        </Card>
      )}

      {bulk === "log" && selected.length ? (
        <LogCallModal invoices={selected} onClose={() => setBulk(null)} onSaved={() => setPicked([])} />
      ) : null}
      {bulk === "schedule" && selected.length ? (
        <ScheduleCallModal invoices={selected} onClose={() => setBulk(null)} onSaved={() => setPicked([])} />
      ) : null}
      <ConfirmDialog
        open={confirmingRefetch}
        onClose={() => setConfirmingRefetch(false)}
        onConfirm={() => void refetch(shown)}
        title={`Refetch ${shown.length} invoices from Zoho Books?`}
        body={`Each invoice is one request to Books, which allows about 100 a minute, so this can take a few minutes. If Books starts refusing, the refetch stops and says how far it got. Filter by company to refetch fewer.`}
        confirmLabel={`Refetch ${shown.length}`}
        danger={false}
      />
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

/**
 * The follow-up list. Whoever logs calls can tick invoices to log one call (or
 * schedule one) for all of them, one company at a time: once one is ticked,
 * other companies' rows cannot be. The header box ticks every row of the
 * ticked company, or every row when the list is down to one company.
 */
function FollowUpTable({
  invoices,
  onOpen,
  calls,
  picked,
  onToggle,
}: {
  invoices: Invoice[];
  onOpen: (invoiceId: string) => void;
  calls: LastCalls;
  picked: string[];
  onToggle: (ids: string[], on: boolean) => void;
}) {
  const { currentUser, userById } = useStore();
  const mayLog = canLogInvoiceCalls(currentUser!);
  const [logging, setLogging] = useState<Invoice | null>(null);
  const [scheduling, setScheduling] = useState<Invoice | null>(null);
  const today = todayISO();

  const pickedSet = new Set(picked);
  const first = invoices.find((i) => pickedSet.has(i.id));
  const selectedKey = first ? invoiceCompanyKey(first) : null;
  const companies = new Set(invoices.map(invoiceCompanyKey));
  const tickable = selectedKey
    ? invoices.filter((i) => invoiceCompanyKey(i) === selectedKey)
    : companies.size === 1
      ? invoices
      : [];
  const allTicked = tickable.length > 0 && tickable.every((i) => pickedSet.has(i.id));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[64rem] text-left text-[12px]">
        <thead className="bg-surface-2 text-[10px] tracking-wide text-ink-faint uppercase">
          <tr>
            {mayLog ? (
              <th
                className="w-10 py-2.5 pl-4"
                title={
                  tickable.length
                    ? `Select every invoice of ${invoiceCompany(tickable[0])}`
                    : "Filter to one company, or tick one invoice, to select a company's invoices together"
                }
              >
                <input
                  type="checkbox"
                  aria-label="Select every invoice of this company"
                  disabled={!tickable.length}
                  checked={allTicked}
                  onChange={(e) => onToggle(tickable.map((i) => i.id), e.target.checked)}
                  className="h-4 w-4 accent-brand-bright disabled:opacity-30"
                />
              </th>
            ) : null}
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
            const last = calls.last.get(i.id);
            const count = calls.counts.get(i.id) ?? 0;
            const caller = userById(i.nextCallBy);
            const late = !!i.dueDate && i.dueDate < today;
            const ticked = pickedSet.has(i.id);
            const otherCompany = !!selectedKey && invoiceCompanyKey(i) !== selectedKey;
            return (
              <tr
                key={i.id}
                className={cx(
                  "border-t border-line-soft align-top",
                  ticked ? "bg-brand/8" : "hover:bg-surface-2",
                )}
              >
                {mayLog ? (
                  // The hint sits on the cell: a disabled box shows no tooltip of its own.
                  <td
                    className="py-3 pl-4"
                    title={
                      otherCompany
                        ? `One company at a time: clear the selection to pick ${invoiceCompany(i)}`
                        : "Select to log one call for several of this company's invoices"
                    }
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${i.invoiceNumber}`}
                      disabled={otherCompany}
                      checked={ticked}
                      onChange={(e) => onToggle([i.id], e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-brand-bright disabled:opacity-30"
                    />
                  </td>
                ) : null}
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
                        {last.chequeCollectOn ? ` · collect ${formatDate(last.chequeCollectOn)}` : ""}
                      </div>
                      <div className="text-[11px] text-ink-faint">
                        {count} call{count === 1 ? "" : "s"} in all
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
                      <RefetchButton invoice={i} />
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

      {logging ? <LogCallModal invoices={[logging]} onClose={() => setLogging(null)} /> : null}
      {scheduling ? <ScheduleCallModal invoices={[scheduling]} onClose={() => setScheduling(null)} /> : null}
    </div>
  );
}
